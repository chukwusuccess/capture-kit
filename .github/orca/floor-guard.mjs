#!/usr/bin/env node
// Orca floor guard: blocks the cheap roads to a green build in this PR's diff.
//   node .github/orca/floor-guard.mjs [--base origin/main]
// exit 0 clean (or an exception claimed for a human to approve), 1 the bar was lowered, 2 couldn't run.
// Adapted from the constraint-driven-development floor-guard reference. Reports rule + place, never values.
import { execFileSync } from 'node:child_process';

const i = process.argv.indexOf('--base');
const base = i > -1 ? process.argv[i + 1] : 'origin/main';
const git = (args) => {
  try { return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 1 << 28 }); }
  catch { return null; }
};
const bail = (msg) => { console.error('floor-guard: ' + msg); process.exit(2); };

const top = git(['rev-parse', '--show-toplevel'])?.trim();
if (!top) bail('not inside a git work tree');
process.chdir(top);
const mergeBase = git(['merge-base', base, 'HEAD'])?.trim();
if (!mergeBase) bail('no merge base against ' + base + ' (shallow clone? use fetch-depth: 0)');
const diff = git(['diff', '--unified=0', '--no-color', '--no-ext-diff', mergeBase, 'HEAD', '--',
  '.', ':(exclude).github/orca/**', ':(exclude)**/node_modules/**']);
if (diff === null) bail('could not diff against ' + mergeBase);

const added = [], removed = [], deleted = [];
const pathOf = (s) => s.replace(/^[ab]\//, '');
let file = '', oldFile = '', inHeader = false;
for (const line of diff.split('\n')) {
  if (line.startsWith('diff ')) inHeader = true;
  else if (line.startsWith('@@')) inHeader = false;
  else if (inHeader) {
    if (line.startsWith('--- ')) oldFile = pathOf(line.slice(4));
    else if (line.startsWith('+++ ')) {
      const newFile = pathOf(line.slice(4));
      file = newFile === '/dev/null' ? oldFile : newFile;
      if (newFile === '/dev/null') deleted.push(file);
    }
  } else if (line.startsWith('+')) added.push({ file, text: line.slice(1) });
  else if (line.startsWith('-')) removed.push({ file, text: line.slice(1) });
}

const findings = [], notes = [];
const flag = (rule, f, text) => findings.push({ rule, file: f, text: text.trim().slice(0, 120) });
const note = (rule, f, text) => notes.push({ rule, file: f, text: text.trim().slice(0, 120) });
const isCode = (f) => /\.(m?[jt]sx?|cjs|cts|vue|svelte|astro|py|rb|go|rs|swift|kt|java|php)$/.test(f);
const isTest = (f) => /(^|\/)(__tests__|tests?|e2e)\/|\.(test|spec)\.|_test\.|(^|\/)test_/.test(f);
const isConstraints = (f) => /(^|\/)CONSTRAINTS\.md$/.test(f);
const isTsconfig = (f) => /(^|\/)[jt]sconfig[^/]*\.json$/.test(f);
const isLintConfig = (f) => /(^|\/)(\.?eslint[^/]*|biome\.jsonc?|\.ruff\.toml|ruff\.toml)$/.test(f);

// Checkers switched off instead of satisfied.
const SUPPRESSIONS = /@ts-ignore|@ts-nocheck|@ts-expect-error|eslint-disable|biome-ignore|#\s*noqa|#\s*type:\s*ignore|istanbul ignore|c8 ignore|nosemgrep|gitleaks:allow|Stryker disable/;
// Tests made easier: skipped, or focused so the rest stop running.
const SKIPS = /\b(it|test|describe|context|suite)\.(skip|only|todo)\b|\b(xit|xdescribe|xtest|fit|fdescribe)\(|@pytest\.mark\.skip|\bt\.Skip\(/;
const STUB = /throw new \w*Error\(\s*['"`][^'"`]*not implemented/i;
const EMPTY_CATCH = /catch\s*(\(\s*\w*\s*\))?\s*\{\s*\}/;

for (const { file, text } of added) {
  if (isCode(file)) {
    if (SUPPRESSIONS.test(text)) flag('silenced-checker', file, text);
    if (SKIPS.test(text)) flag('test-made-easier', file, text);
    if (STUB.test(text)) flag('unfinished-work', file, text);
    if (EMPTY_CATCH.test(text)) note('empty-catch', file, text);
  }
  if (isTsconfig(file) && /"(strict|noImplicitAny|strictNullChecks|noUncheckedIndexedAccess)"\s*:\s*false/.test(text)) {
    flag('typecheck-loosened', file, text);
  }
  if (isLintConfig(file) && /["']?[\w@/-]+["']?\s*:\s*(["']off["']|0\b|\[\s*["']off["'])/.test(text)) {
    flag('lint-rule-switched-off', file, text);
  }
  if (isConstraints(file) && /^\| *(W|E)\d+ *\|/.test(text)) flag('new-exception', file, text);
}
for (const { file, text } of removed) {
  if (isTsconfig(file) && /"(strict|noImplicitAny|strictNullChecks)"\s*:\s*true/.test(text)
      && !added.some((a) => a.file === file && a.text.includes(text.trim().split(':')[0]))) {
    flag('typecheck-loosened', file, text);
  }
}

// Tests deleted, or assertions pulled out of tests that stayed.
for (const f of deleted) if (isTest(f) && isCode(f)) flag('test-deleted', f, 'file deleted');
const testsDeletedCount = new Map();
for (const { file, text } of removed) {
  if (isTest(file) && isCode(file) && !deleted.includes(file) && /\b(expect|assert\w*|should)\b/.test(text)) {
    testsDeletedCount.set(file, (testsDeletedCount.get(file) || 0) + 1);
  }
}
for (const [f, n] of testsDeletedCount) {
  const back = added.filter((a) => a.file === f && /\b(expect|assert\w*|should)\b/.test(a.text)).length;
  if (n > back) flag('assertion-removed', f, `${n - back} assertion(s) removed`);
}

// CONSTRAINTS.md: a rule removed or a number moved the loose way.
const ruleKey = (t) => {
  const s = t.trim();
  if (s.startsWith('|')) return s.split('|').map((c) => c.trim()).filter(Boolean)[0] ?? '';
  if (/^[-*] /.test(s)) return s.slice(2).split(':')[0].trim();
  return null;
};
const isException = (t) => /^\| *(W|E)\d+ *\|/.test(t.trim());
const MIN_BEFORE = /(>=|>|≥|at least|minimum|\bmin\b|no less than|not fall|not drop)\s*$/;
const MAX_BEFORE = /(<=|<|≤|at most|maximum|\bmax\b|no more than|under|below|not grow|not exceed)\s*$/;
const MIN_AFTER = /^\s*\S*\s*(?:\|\s*)?(or more|or higher|must not fall|must not drop)/;
const MAX_AFTER = /^\s*\S*\s*(?:\|\s*)?(or less|or lower|must not grow|must not exceed)/;
const thresholds = (t) => {
  const out = [], re = /\d+(?:\.\d+)?/g;
  let m;
  while ((m = re.exec(t))) {
    const before = t.slice(Math.max(0, m.index - 24), m.index).toLowerCase();
    const after = t.slice(m.index + m[0].length, m.index + m[0].length + 40).toLowerCase();
    const dir = MIN_BEFORE.test(before) || MIN_AFTER.test(after) ? 'min'
      : MAX_BEFORE.test(before) || MAX_AFTER.test(after) ? 'max' : null;
    out.push({ n: Number(m[0]), dir });
  }
  return out;
};
const removedRules = removed.filter((l) => isConstraints(l.file) && ruleKey(l.text) !== null);
const addedRules = added.filter((l) => isConstraints(l.file) && ruleKey(l.text) !== null);
for (const r of removedRules) {
  const a = addedRules.find((x) => ruleKey(x.text) === ruleKey(r.text));
  if (!a) { if (!isException(r.text)) flag('rule-removed', r.file, r.text); continue; }
  const before = thresholds(r.text), after = thresholds(a.text);
  let verdict = null;
  for (const dir of ['min', 'max', null]) {
    const was = before.filter((x) => x.dir === dir), now = after.filter((x) => x.dir === dir);
    was.forEach((b, k) => {
      const n = now[k];
      if (verdict) return;
      if (!n) verdict = 'threshold-removed';
      else if (n.n === b.n) return;
      else if (dir === 'min' ? n.n < b.n : dir === 'max' ? n.n > b.n : true) {
        verdict = dir ? 'threshold-loosened' : 'threshold-changed';
      }
    });
  }
  if (verdict) flag(verdict, r.file, r.text + '  ->  ' + a.text);
}

for (const n of notes) console.log(`note [${n.rule}] ${n.file}: ${n.text}`);
if (findings.length === 0) { console.log('floor-guard: clean'); process.exit(0); }
for (const f of findings) console.error(`::error file=${f.file}::[${f.rule}] ${f.text}`);
console.error(`\nfloor-guard: ${findings.length} change(s) lower the bar:`);
for (const f of findings) console.error(`  [${f.rule}] ${f.file}: ${f.text}`);
// A genuine exception is claimed in a commit message; the pipeline then waits for a human to approve it.
const claimed = git(['log', '--format=%B', `${mergeBase}..HEAD`])?.match(/^Orca-Exception:.+$/im);
if (claimed) {
  console.error(`\nException claimed (${claimed[0].trim()}): passing here; the pipeline holds the PR for human approval.`);
  process.exit(0);
}
console.error('\nFix the code instead of lowering the bar. If this really is right, explain it in a commit\n'
  + 'message line "Orca-Exception: <reason>" and a human will be asked to approve it.');
process.exit(1);
