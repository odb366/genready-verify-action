/**
 * What a pull request gets blocked for.
 *
 * The whole value of a CI check is that people trust it. A check that fails on
 * a judgement call ("this reads like AI wrote it") teaches a team to add
 * `continue-on-error` and stop reading it, and then it catches nothing at all.
 *
 * So the gate is deliberately narrow: only findings a machine can prove, only
 * the severities worth stopping a merge for, and by default only the ones that
 * were confirmed fixed and came back. Everything else is reported, never
 * blocking.
 *
 * Plain ESM with no dependencies, so the published Action needs no bundler and
 * no install step.
 */

/** Severities worth stopping a merge for. Anything below is informational. */
const BLOCKING_SEVERITIES = new Set(['critical', 'high']);

/**
 * Only deterministic findings can block. A heuristic or judgement rule can be
 * wrong about a page, and being wrong here costs a team its trust in the check.
 */
function canBlock(finding) {
  return (
    finding.determinism === 'deterministic' &&
    BLOCKING_SEVERITIES.has(String(finding.severity).toLowerCase())
  );
}

/**
 * `regressed` (the default): only fixes that were confirmed and then broke
 * again. This is the strongest signal there is - somebody proved it worked and
 * this change undid it - and it cannot fire on a repo's first run.
 *
 * `high`: any deterministic high or critical finding, whether or not it was
 * ever fixed. Stricter, and a reasonable choice once a site is clean.
 *
 * `never`: report only.
 */
export function selectBlocking(findings, failOn = 'regressed') {
  if (failOn === 'never') return [];
  const candidates = (findings ?? []).filter(canBlock);

  if (failOn === 'high') return candidates;
  return candidates.filter((f) => f.state?.status === 'regressed');
}

/** Keep a value from breaking out of a markdown table cell. */
function cell(value, maxLength = 120) {
  const text = String(value ?? '')
    .replace(/\|/g, '\\|')
    .replace(/[\r\n]+/g, ' ')
    .replace(/`/g, "'")
    .trim();
  return text.length > maxLength ? `${text.slice(0, maxLength - 3)}...` : text;
}

function firstUrl(finding) {
  const urls = finding.scope?.urls;
  return Array.isArray(urls) && urls.length > 0 ? urls[0] : '';
}

/**
 * The comment and the job summary, which are the same markdown. It states the
 * verdict first, because that is the only line most people read.
 */
export function summarize({ findings = [], blocking = [], url, reportUrl, failOn = 'regressed' }) {
  const lines = [];

  if (blocking.length > 0) {
    lines.push(
      `### ❌ GenReady: ${blocking.length} blocking ${blocking.length === 1 ? 'problem' : 'problems'}`,
      '',
      failOn === 'regressed'
        ? 'These were confirmed fixed before and are failing again, so something in this change undid them.'
        : 'These are machine-checkable problems at high or critical severity.',
      '',
      '| Severity | Problem | Rule | Page |',
      '| --- | --- | --- | --- |',
    );
    for (const f of blocking) {
      lines.push(
        `| ${cell(f.severity, 12)} | ${cell(f.metric, 60)} | \`${cell(f.ruleId, 60)}\` | ${cell(firstUrl(f), 80)} |`,
      );
    }
  } else if (findings.length > 0) {
    lines.push(
      '### ✅ GenReady: nothing blocking',
      '',
      `${findings.length} ${findings.length === 1 ? 'finding' : 'findings'} to look at, none of them a regression a machine can prove. Merging is fine.`,
    );
  } else {
    lines.push('### ✅ GenReady: no findings', '', 'Every check that produces a finding passed.');
  }

  const advisory = (findings ?? []).filter((f) => !blocking.includes(f));
  if (advisory.length > 0 && blocking.length > 0) {
    lines.push('', `<details><summary>${advisory.length} more, not blocking</summary>`, '');
    for (const f of advisory.slice(0, 25)) {
      lines.push(`- **${cell(f.severity, 12)}** ${cell(f.metric, 60)} (\`${cell(f.ruleId, 60)}\`)`);
    }
    if (advisory.length > 25) lines.push(`- ...and ${advisory.length - 25} more`);
    lines.push('', '</details>');
  }

  lines.push('', '---', '');
  if (url) lines.push(`Checked ${cell(url, 200)}`);
  if (reportUrl) lines.push(`[Full report](${cell(reportUrl, 300)})`);
  lines.push('', '<sub>Posted by the GenReady AI readiness check.</sub>');

  return lines.join('\n');
}

/** Marker so an update replaces our previous comment instead of piling up. */
export const COMMENT_MARKER = '<!-- genready-verify-action -->';
