#!/usr/bin/env bash
# Orca browser check: build and serve this PR and its base, check every page in a real browser at
# 390px and 1440px, block what the PR made worse. Not a web app (or neither side serves) → skipped.
#   .github/orca/browser.sh [base-ref]    needs ORCA_TOOLS (dir with node_modules/playwright, axe-core)
# Serving: Next → next start; a "preview" script (Vite, Astro) → that; a "start" script → that;
# otherwise a static index.html in dist/ build/ out/ _site/ public/ or the root.
set -uo pipefail
base=${1:-origin/main}
here=$(cd "$(dirname "$0")" && pwd)
root=$(git rev-parse --show-toplevel) || exit 2
cd "$root"
mb=$(git merge-base "$base" HEAD) || { echo "browser: no merge base with $base" >&2; exit 2; }
out=${ORCA_OUT:-$root/.orca-browser}; mkdir -p "$out"
tmp=$(mktemp -d); pids=""
trap 'for p in $pids; do pkill -P "$p" 2>/dev/null; kill "$p" 2>/dev/null; done; git worktree remove --force "$tmp/base" >/dev/null 2>&1; rm -rf "$tmp"' EXIT

if ! git diff --name-only "$mb" HEAD | grep -qvE '\.(md|txt)$|^docs/|^\.github/'; then
  echo "browser: only docs/CI files changed — skipped"; exit 0
fi

has() { [ -f package.json ] && node -e 'const p=require(process.argv[1]); process.exit(({...p.dependencies,...p.devDependencies})[process.argv[2]]?0:1)' "$PWD/package.json" "$1"; }
script() { [ -f package.json ] && node -e 'process.exit((require(process.argv[1]).scripts||{})[process.argv[2]]?0:1)' "$PWD/package.json" "$1"; }
mobile_only() { has expo && ! has next && ! has vite && ! has astro; }

up() { # dir port label → serves the built site in the background; 1 if it can't
  local dir=$1 port=$2 label=$3
  ( cd "$dir" || exit 1
    if [ -f package.json ]; then
      if [ -f pnpm-lock.yaml ]; then corepack enable && pnpm install --frozen-lockfile
      elif [ -f yarn.lock ]; then corepack enable && yarn install --immutable
      elif [ -f package-lock.json ]; then npm ci
      else npm install; fi && npm run build --if-present
    fi ) > "$out/$label-build.log" 2>&1 || { echo "browser: $label did not build (log: $label-build.log)"; return 1; }
  ( cd "$dir" || exit 1
    if has next; then exec npx next start -p "$port" -H 127.0.0.1
    elif script preview; then exec npm run preview -- --port "$port" --host 127.0.0.1
    elif script start; then PORT=$port HOST=127.0.0.1 exec npm start
    fi
    for d in dist build out _site public .; do
      [ -f "$d/index.html" ] && exec python3 -m http.server "$port" --bind 127.0.0.1 -d "$d"
    done
    echo "nothing to serve"; exit 1 ) > "$out/$label-serve.log" 2>&1 &
  pid=$!; pids="$pids $pid"; disown "$pid" 2>/dev/null
  for _ in $(seq 90); do
    code=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$port/" 2>/dev/null)
    [ "$code" != 000 ] && return 0
    kill -0 "$pid" 2>/dev/null || break
    sleep 1
  done
  echo "browser: $label did not start serving (log: $label-serve.log)"; return 1
}

if mobile_only; then echo "browser: mobile app (Expo) — skipped"; exit 0; fi
git worktree add -q --detach "$tmp/base" "$mb" || exit 2
head_ok=1 base_ok=1
up "$root" 4173 head || head_ok=0
up "$tmp/base" 4174 base || base_ok=0
if [ $head_ok = 0 ] && [ $base_ok = 0 ]; then echo "browser: neither side serves a website — skipped"; exit 0; fi
if [ $head_ok = 0 ]; then
  echo "browser: BLOCKED — main serves, this PR doesn't:"; tail -30 "$out/head-build.log" "$out/head-serve.log" 2>/dev/null; exit 1
fi
node "$here/browser-check.mjs" check http://127.0.0.1:4173 "$out/head.json" --shots "$out/shots" || exit 2
if [ $base_ok = 1 ]; then
  node "$here/browser-check.mjs" check http://127.0.0.1:4174 "$out/base.json" --routes-from "$out/head.json" || rm -f "$out/base.json"
fi
node "$here/browser-check.mjs" compare "$out/base.json" "$out/head.json"
