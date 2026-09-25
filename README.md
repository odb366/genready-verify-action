# GenReady AI Readiness Check

Checks every pull request for changes that stop AI search engines and agents reading your site.

ChatGPT, Perplexity, Claude and the agents people now build all have to fetch and parse your pages before they can cite them. A routine change can quietly break that: a `robots.txt` rule that blocks GPTBot, a removed canonical, structured data that stops validating. Nothing looks wrong in a browser, so nobody notices until the traffic does.

This runs on your pull requests and tells you.

## What it does

1. Scans a URL you give it, usually a deploy preview for that branch.
2. Comments the result on the pull request, replacing its previous comment rather than adding another.
3. Fails the job **only** when something that was confirmed working before is broken again.

That third point is the design, and it is worth being clear about.

## When it fails your build

A finding has to be all three of these before it will fail anything:

|                                                  |                                                                                                                                                 |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| **Deterministic** (`determinism: deterministic`) | Something with a definite answer, like whether GPTBot is allowed in `robots.txt`. Never a judgement call such as "this reads like AI wrote it". |
| **High or critical**                             | Not cosmetic.                                                                                                                                   |
| **Already fixed once**                           | A previous check confirmed it working, and this change undid it.                                                                                |

So on your first run, nothing can fail. Nothing has been confirmed yet. The check earns the right to block you by first proving it was right.

This is deliberate. A check that fails on day one is a check people turn off, and a check people turn off catches nothing. Everything that does not meet all three conditions is still reported in the comment; it just does not stop the merge.

If you want a stricter gate once your site is clean, set `fail-on: high`.

## Quick start

**1. Create an API key** at [genready.ai/api-keys](https://genready.ai/api-keys).

**2. Add it to your repository** as a secret named `GENREADY_API_KEY`:
Settings → Secrets and variables → Actions → New repository secret.

**3. Add the workflow** at `.github/workflows/ai-readiness.yml`:

```yaml
name: AI readiness
on: pull_request

permissions:
  contents: read
  pull-requests: write # only needed for the comment

jobs:
  genready:
    runs-on: ubuntu-latest
    steps:
      - uses: odb366/genready-verify-action@v1
        with:
          api-key: ${{ secrets.GENREADY_API_KEY }}
          url: https://your-site.com
```

Replace `url` with your deploy preview if you have one. Most hosts expose it as a step output, for example `${{ steps.deploy.outputs.preview-url }}` or your provider's equivalent.

Each scan uses one API credit.

## Options

| Input          | Required | Default             | What it does                                                              |
| -------------- | -------- | ------------------- | ------------------------------------------------------------------------- |
| `api-key`      | yes      |                     | Your GenReady API key, from a secret.                                     |
| `url`          | one of   |                     | The URL to scan. Uses one credit.                                         |
| `domain-id`    | one of   |                     | Read a monitored domain's latest site analysis instead of scanning. Free. |
| `fail-on`      | no       | `regressed`         | `regressed`, `high`, or `never`. See below.                               |
| `comment`      | no       | `true`              | Post the result on the pull request.                                      |
| `github-token` | no       | `github.token`      | Used to post the comment. The default is fine.                            |
| `api-url`      | no       | GenReady production | Point at a different API. For testing.                                    |

### `fail-on`

- **`regressed`** (default) — fails only on a confirmed fix that broke again. Safe to add to any repository today.
- **`high`** — fails on any deterministic high or critical problem, whether or not it was ever fixed. Choose this once your site is clean and you want it kept that way.
- **`never`** — reports in the comment, never fails. A good way to watch it for a week before letting it block anything.

## Outputs

| Output           | What it is                                       |
| ---------------- | ------------------------------------------------ |
| `findings-count` | How many findings came back.                     |
| `blocking-count` | How many of them failed the job.                 |
| `report-url`     | Link to the full report, when a URL was scanned. |

## Good to know

- **No dependencies.** Two plain JavaScript files and a manifest, run by the Node already on the runner. Nothing to install, nothing to audit.
- **The comment is replaced, not repeated.** A long-running pull request gets one comment, kept current.
- **A failed comment does not fail the build.** Comment permissions vary by trigger; if posting fails, the result is still in the job summary.
- **Your key stays a secret.** It is never written to the log, including when GenReady rejects it.
