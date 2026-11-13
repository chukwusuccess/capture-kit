# Constraints

The bar every change to this repo must meet, whichever agent or person makes it. Every rule names
the check that enforces it. AI reviewers judge each PR against this file as it is on `main`.

Changing this file needs a human's approval (the Orca pipeline asks). Tightening a rule is welcome;
loosening one, or adding an exception, is flagged by the floor guard.

## Floor (always enforced)

- No new suppressions: `@ts-ignore`, `@ts-expect-error`, `eslint-disable`, `# noqa`, `nosemgrep`, `gitleaks:allow`
- No skipped, focused or deleted tests, and no assertions removed from tests that stay
- No loosened typecheck or lint config (`strict: false`, rules switched `off`)
- No unimplemented stubs (`throw new Error("not implemented")`)
- No secrets in source (gitleaks: commit hook + CI), and no file over 5 MB (orca commit hook)
- A real exception is claimed with a commit line `Orca-Exception: <reason>` and approved by a human

## Enforced with numbers

| Dimension | Rule | Checked by | Runs at |
|-----------|------|-----------|---------|
| Types | Zero type errors | `.github/verify.sh` (typecheck) | task end, CI |
| Lint | Zero errors from this repo's config | `.github/verify.sh` (lint) | task end, CI |
| Tests | Every test passes | `.github/verify.sh` (test) | task end, CI |
| Build | The production build succeeds | CI `build` step | CI |
| Secrets | Nothing new in this PR's commits | gitleaks (`.github/orca/security.sh`) | commit, CI |
| Dependencies | No new vulnerable package at CVSS ≥ 7.0 (high) | osv-scanner (`security.sh`) | CI |
| Code security | No new semgrep finding at ERROR or above | semgrep p/default + `.github/orca/semgrep.yml` | CI |
| Auth & data | No blocker from the security reviewer | `review.py` security seat (auth, API, DB, storage, env) | review |
| Pages | No new page error, console error, broken request or crash at 390 and 1440 px | `.github/orca/browser.sh` | CI |
| Layout | No new sideways scroll at 390 and 1440 px | `browser.sh` | CI |
| Accessibility | No new critical or serious axe violation (WCAG 2.1 AA) | `browser.sh` (axe-core 4.14) | CI |

"New" means compared with `main`. Problems that already exist don't block unrelated work: security
ones are listed in the repo's **Security backlog** issue, browser ones in each PR's orca-gate summary,
and they get fixed on purpose, not by whoever touches the file next.

## Measured, not yet enforced

| Metric | Today | Direction |
|--------|-------|-----------|
| Security problems already on main | see the Security backlog issue | must not grow |

## Exceptions

| ID | Rule | Path | Reason | Owner | Expires |
|----|------|------|--------|-------|---------|
