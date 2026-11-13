#!/usr/bin/env bash
# Orca security gate: only problems this PR introduces block the merge; old ones go to the backlog issue.
#   .github/orca/security.sh [base-ref]      needs gitleaks, osv-scanner and semgrep on PATH
# exit 0 pass, 1 blocking findings, 2 a scanner couldn't run (never reads as a pass).
set -uo pipefail
base=${1:-origin/main}
here=$(cd "$(dirname "$0")" && pwd)
cd "$(git rev-parse --show-toplevel)" || exit 2
mb=$(git merge-base "$base" HEAD) || { echo "security: no merge base with $base (use fetch-depth: 0)" >&2; exit 2; }
tmp=$(mktemp -d)
trap 'git worktree remove --force "$tmp/base" >/dev/null 2>&1; rm -rf "$tmp"' EXIT
blocked=0 broken=0
step() { printf '\n── %s\n' "$*"; }

step "secrets: gitleaks over this PR's commits"
gitleaks git --log-opts="$mb..HEAD" --redact --no-banner --verbose --exit-code 3 . 2>&1 | tail -40
case ${PIPESTATUS[0]} in 0) echo "✓ no secrets" ;; 3) blocked=1 ;; *) broken=1 ;; esac

step "vulnerable packages: osv-scanner, new since $base"
git worktree add -q --detach "$tmp/base" "$mb" || broken=1
osv() { # 0 clean, 1 vulns, 128 no lockfiles: all usable; anything else means the scan failed
  osv-scanner scan source -r --format json "$1" > "$2" 2> "$2.err"
  case $? in 0|1|128) return 0 ;; *) cat "$2.err" >&2; return 1 ;; esac
}
osv . "$tmp/head.json" && osv "$tmp/base" "$tmp/base.json" || broken=1
python3 - "$tmp/head.json" "$tmp/base.json" <<'PY' || blocked=1
import json, sys
def vulns(path):
    try:
        data = json.load(open(path))
    except (OSError, ValueError):
        return {}
    out = {}
    for res in data.get("results") or []:
        for pkg in res.get("packages") or []:
            name, ver = pkg["package"]["name"], pkg["package"].get("version", "?")
            fixed = {}
            for v in pkg.get("vulnerabilities") or []:
                for aff in v.get("affected") or []:
                    for rng in aff.get("ranges") or []:
                        for ev in rng.get("events") or []:
                            if "fixed" in ev:
                                fixed[v["id"]] = ev["fixed"]
            for g in pkg.get("groups") or []:
                ids = sorted(g.get("ids") or []) or ["unknown"]
                try:
                    sev = float(g.get("max_severity") or 0)
                except ValueError:
                    sev = 0.0
                fix = next((fixed[i] for i in ids if i in fixed), None)
                out[(name, ids[0])] = (ver, ids, sev, fix)
    return out
head, base = vulns(sys.argv[1]), vulns(sys.argv[2])
new = {k: v for k, v in head.items() if k not in base}
hard = {k: v for k, v in new.items() if v[2] >= 7.0}
for (name, _), (ver, ids, sev, fix) in sorted(new.items(), key=lambda kv: -kv[1][2]):
    tag = "BLOCK" if sev >= 7.0 else "note "
    print(f"  {tag} {name}@{ver}: {', '.join(ids[:3])} (CVSS {sev or '?'})" + (f" — fixed in {fix}" if fix else ""))
print(f"✓ {len(head)} known issue(s) in dependencies, {len(new)} new, {len(hard)} new at high/critical"
      if not hard else f"✗ {len(hard)} new high/critical vulnerable package(s): upgrade them (see 'fixed in')")
sys.exit(1 if hard else 0)
PY

step "unsafe code: semgrep p/default + orca rules, new since $base"
semgrep scan --config p/default --config "$here/semgrep.yml" --baseline-commit "$mb" --metrics=off \
  --exclude .github/orca --json -o "$tmp/sg.json" --quiet >/dev/null 2>"$tmp/sg.err"
case $? in 0|1) ;; *) tail -20 "$tmp/sg.err" >&2; broken=1 ;; esac
python3 - "$tmp/sg.json" <<'PY' || blocked=1
import json, sys
try:
    data = json.load(open(sys.argv[1]))
except (OSError, ValueError):
    sys.exit(0)  # the scan itself failed; reported above as broken
hits = data.get("results") or []
hard = [r for r in hits if r.get("extra", {}).get("severity") in ("ERROR", "HIGH", "CRITICAL")]
for r in sorted(hits, key=lambda r: r in hard, reverse=True):
    tag = "BLOCK" if r in hard else "note "
    msg = " ".join(r.get("extra", {}).get("message", "").split())[:220]
    print(f"  {tag} {r['path']}:{r['start']['line']} [{r['check_id'].split('.')[-1]}] {msg}")
    if r in hard:
        print(f"::error file={r['path']},line={r['start']['line']}::{r['check_id'].split('.')[-1]}: {msg}")
print(f"✓ no new unsafe code ({len(hits)} note(s))" if not hard else f"✗ {len(hard)} new unsafe pattern(s)")
sys.exit(1 if hard else 0)
PY

echo
if [ $broken = 1 ]; then echo "security: a scanner could not run — not a pass" >&2; exit 2; fi
if [ $blocked = 1 ]; then echo "security: BLOCKED — fix the findings marked BLOCK above" >&2; exit 1; fi
echo "security: pass"
