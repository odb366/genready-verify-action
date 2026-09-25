/**
 * The GenReady check, as a GitHub Action.
 *
 * Scans a URL (a deploy preview, usually), reports what it found on the pull
 * request, and fails the job only for problems a machine can prove. The
 * decision about what blocks lives in gate.js and is tested; this file is the
 * plumbing around it.
 *
 * No dependencies on purpose: Node 20+ has fetch, and a published Action with
 * no node_modules has nothing to install and nothing to audit.
 */
import { appendFileSync, readFileSync } from 'node:fs';
// Imported rather than taken from the global scope, so this file states every
// runtime capability it uses.
import process from 'node:process';
import { selectBlocking, summarize, COMMENT_MARKER } from './gate.js';

const say = (message) => process.stdout.write(`${message}\n`);
const warn = (message) => process.stderr.write(`${message}\n`);

// Global since Node 18, but there is no module to import it from, so name it
// once here rather than reaching for an undeclared global three times.
const { fetch } = globalThis;

const DEFAULT_API_URL = 'https://genready.ai/api/v1';

function input(name, fallback = '') {
  const value = process.env[`INPUT_${name.toUpperCase().replace(/-/g, '_')}`];
  return value === undefined || value === '' ? fallback : value.trim();
}

function output(name, value) {
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
  }
}

function fail(message) {
  warn(`::error::${message}`);
  process.exit(1);
}

/**
 * Errors are explained in terms the person reading the log can act on. A 401
 * is a secret problem and a 402 is a billing problem; neither is a problem
 * with their pull request.
 */
async function callApi(apiUrl, apiKey, path, body) {
  const response = await fetch(`${apiUrl}${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    let message = `GenReady API returned ${response.status}`;
    try {
      message = JSON.parse(text)?.error?.message || message;
    } catch {
      // Non-JSON body: keep the status, never echo the raw text into the log.
    }

    if (response.status === 401) {
      fail(`GenReady rejected the API key. Check the secret passed as api-key: ${message}`);
    }
    if (response.status === 402) {
      fail(`Out of API credits, so this pull request was not checked: ${message}`);
    }
    if (response.status === 403) {
      fail(`This API key is missing a scope the check needs: ${message}`);
    }
    fail(message);
  }

  return response.json();
}

/** Replace our previous comment rather than adding another one on every push. */
async function upsertComment(token, repo, prNumber, body) {
  const base = `https://api.github.com/repos/${repo}/issues/${prNumber}`;
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'Content-Type': 'application/json',
  };
  const marked = `${COMMENT_MARKER}\n${body}`;

  const existing = await fetch(`${base}/comments?per_page=100`, { headers })
    .then((r) => (r.ok ? r.json() : []))
    .catch(() => []);

  const mine = Array.isArray(existing)
    ? existing.find((c) => typeof c.body === 'string' && c.body.includes(COMMENT_MARKER))
    : null;

  const target = mine
    ? `https://api.github.com/repos/${repo}/issues/comments/${mine.id}`
    : `${base}/comments`;

  const res = await fetch(target, {
    method: mine ? 'PATCH' : 'POST',
    headers,
    body: JSON.stringify({ body: marked }),
  });

  if (!res.ok) {
    // A missing comment is not worth failing a build over: the job summary
    // carries the same content, and comment permissions vary by trigger.
    warn(`::warning::Could not post the comment (${res.status}). The job summary has it.`);
  }
}

function pullRequestNumber() {
  if (!process.env.GITHUB_EVENT_PATH) return null;
  try {
    const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
    return event?.pull_request?.number ?? null;
  } catch {
    return null;
  }
}

async function main() {
  const apiKey = input('api-key');
  if (!apiKey) fail('api-key is required. Pass a GenReady API key, usually from a secret.');

  const url = input('url');
  const domainId = input('domain-id');
  if (Boolean(url) === Boolean(domainId)) {
    fail('Pass exactly one of url or domain-id.');
  }

  const apiUrl = input('api-url', DEFAULT_API_URL).replace(/\/+$/, '');
  const failOn = input('fail-on', 'regressed');
  if (!['regressed', 'high', 'never'].includes(failOn)) {
    fail(`fail-on must be regressed, high or never. Got: ${failOn}`);
  }

  const payload = url
    ? await callApi(apiUrl, apiKey, '/analyze', { url, waitForCompletion: true })
    : await callApi(apiUrl, apiKey, `/domains/${encodeURIComponent(domainId)}/fix-plan`);

  const data = payload?.data ?? {};
  const findings = Array.isArray(data.findings) ? data.findings : [];
  const blocking = selectBlocking(findings, failOn);

  const reportUrl = data.reportId ? `https://genready.ai/report/${data.reportId}` : '';
  const body = summarize({ findings, blocking, url: url || data.url, reportUrl, failOn });

  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${body}\n`);
  }

  output('findings-count', findings.length);
  output('blocking-count', blocking.length);
  output('report-url', reportUrl);

  const prNumber = pullRequestNumber();
  const token = input('github-token');
  if (input('comment', 'true') === 'true' && prNumber && token && process.env.GITHUB_REPOSITORY) {
    await upsertComment(token, process.env.GITHUB_REPOSITORY, prNumber, body);
  }

  if (blocking.length > 0) {
    fail(
      `${blocking.length} AI-readiness ${blocking.length === 1 ? 'problem' : 'problems'} would ship with this change. See the job summary.`,
    );
  }

  say(`GenReady: ${findings.length} findings, nothing blocking.`);
}

main().catch((err) => fail(`The GenReady check could not run: ${err?.message ?? err}`));
