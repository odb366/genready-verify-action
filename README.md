# GenReady AI Readiness Check

Fail a pull request that breaks how AI search engines and agents read your site.

A deploy preview gets scanned, the result is posted on the pull request, and the job fails only when something that was **proven working before** is failing again. Nothing else blocks a merge.

## Usage

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
          url: ${{ steps.deploy.outputs.preview-url }}
```

Create the API key at [genready.ai/api-keys](https://genready.ai/api-keys) and store it as a repository secret.

## What blocks a merge

Only findings that are all three of:

- **machine-checkable** (`determinism: deterministic`) - never a judgement call like "this reads like AI wrote it"
- **high or critical** severity
- **regressed**, meaning a check confirmed the fix worked and it is failing again

That last one matters most. On the first run nothing can block, because nothing has been confirmed fixed yet. A check that fails on day one teaches a team to add `continue-on-error`, and then it catches nothing ever again.

Everything else is reported in the comment and the job summary without failing the build.

## Inputs

| Input          | Required | Default             | Description                                                          |
| -------------- | -------- | ------------------- | -------------------------------------------------------------------- |
| `api-key`      | yes      |                     | Your GenReady API key, from a secret.                                |
| `url`          | one of   |                     | URL to scan, usually a deploy preview. Uses one API credit.          |
| `domain-id`    | one of   |                     | Check a monitored domain's latest site analysis instead. Free.       |
| `fail-on`      | no       | `regressed`         | `regressed`, `high` or `never`. See below.                           |
| `comment`      | no       | `true`              | Post the result on the pull request, replacing the previous comment. |
| `github-token` | no       | `github.token`      | Token used for the comment.                                          |
| `api-url`      | no       | GenReady production | Override the API base URL.                                           |

### `fail-on`

- **`regressed`** (default) - only fixes that were confirmed and came back. Safe to adopt on any repo.
- **`high`** - any machine-checkable high or critical problem, fixed before or not. Adopt this once a site is clean and you want to keep it that way.
- **`never`** - report only, never fail.

## Outputs

| Output           | Description                                      |
| ---------------- | ------------------------------------------------ |
| `findings-count` | How many findings came back.                     |
| `blocking-count` | How many of them failed the job.                 |
| `report-url`     | Link to the full report, when a URL was scanned. |

## Notes

- No dependencies and no bundled `node_modules`: the Action is two plain ESM files run by the Node already on the runner.
- The comment is replaced on each push rather than added to, so a long-running pull request gets one comment and not twenty.
- If the comment cannot be posted (permissions vary by trigger) the job still reports through the step summary instead of failing.
