#!/usr/bin/env node
// Orca browser check. Visits pages at phone and laptop width and records what's wrong; `compare` blocks
// only what a PR made worse than its base, so a site's old problems don't block unrelated work.
//   node browser-check.mjs check <url> <out.json> [--routes-from other.json] [--shots dir]
//   node browser-check.mjs compare <base.json> <head.json>     (base may be missing: then all count)
// Needs playwright + axe-core under $ORCA_TOOLS/node_modules. CHROMIUM_PATH overrides the browser.
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';

const WIDTHS = [390, 1440];
const MAX_PAGES = Number(process.env.ORCA_MAX_PAGES || 8);
const [mode, ...args] = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i > -1 ? args[i + 1] : undefined; };

const norm = (s) => String(s).replace(/https?:\/\/[^\s'")]+/g, (u) => { try { const x = new URL(u); return x.host + x.pathname; } catch { return u; } })
  .replace(/\d+/g, 'N').replace(/\s+/g, ' ').trim().slice(0, 160);

async function check(url, out) {
  const req = createRequire((process.env.ORCA_TOOLS || process.cwd()) + '/');
  const { chromium } = req('playwright');
  const axePath = req.resolve('axe-core/axe.min.js');
  const origin = new URL(url).origin;
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  const shots = opt('--shots');
  if (shots) mkdirSync(shots, { recursive: true });

  let routes;
  if (opt('--routes-from')) routes = JSON.parse(readFileSync(opt('--routes-from'), 'utf8')).routes;
  else if (existsSync('.github/orca/routes.txt')) {
    routes = readFileSync('.github/orca/routes.txt', 'utf8').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  } else { // the home page plus the internal pages it links to
    const p = await browser.newPage();
    routes = ['/'];
    try {
      await p.goto(url, { waitUntil: 'load', timeout: 30000 });
      const links = await p.$$eval('a[href]', (as) => as.map((a) => a.href));
      for (const l of links) {
        const u = new URL(l, url);
        if (u.origin !== origin || /\.(?!html?$)\w{2,5}$/.test(u.pathname)) continue;
        if (!routes.includes(u.pathname)) routes.push(u.pathname);
      }
    } catch { /* the per-page pass reports a home page that won't load */ }
    await p.close();
    routes = routes.slice(0, MAX_PAGES);
  }

  const findings = [];
  const add = (route, width, kind, key, extra = {}) => {
    const f = findings.find((x) => x.route === route && x.width === width && x.kind === kind && x.key === key);
    if (f) f.count += extra.count || 1;
    else findings.push({ route, width, kind, key, count: extra.count || 1, detail: extra.detail || '', blocking: extra.blocking ?? true });
  };
  for (const width of WIDTHS) {
    const ctx = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce' });
    for (const route of routes) {
      const page = await ctx.newPage();
      page.on('console', (m) => { if (m.type() === 'error') add(route, width, 'console-error', norm(m.text())); });
      page.on('pageerror', (e) => add(route, width, 'page-crash', norm(e.message)));
      page.on('response', (r) => { if (r.status() >= 400 && r.url().startsWith(origin) && r.request().resourceType() !== 'document') add(route, width, 'broken-request', new URL(r.url()).pathname, { detail: String(r.status()) }); });
      page.on('requestfailed', (r) => { if (r.url().startsWith(origin)) add(route, width, 'broken-request', new URL(r.url()).pathname, { detail: r.failure()?.errorText || 'failed' }); });
      let resp = null;
      try { resp = await page.goto(origin + route, { waitUntil: 'load', timeout: 30000 }); } catch (e) { add(route, width, 'page-status', 'no response', { detail: norm(e.message) }); }
      if (resp && resp.status() >= 400) add(route, width, 'page-status', String(resp.status()));
      if (resp && resp.status() < 400) {
        await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
        await page.evaluate(() => document.fonts && document.fonts.ready).catch(() => {});
        const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth).catch(() => 0);
        if (over > 1) add(route, width, 'sideways-scroll', 'page', { detail: `${over}px wider than the screen` });
        const sticking = await page.evaluate(() => { // cut off by overflow clipping: a note, carousels do it on purpose
          const W = innerWidth, bad = [];
          const scroller = (el) => { for (let p = el.parentElement; p; p = p.parentElement) { const o = getComputedStyle(p).overflowX; if (o === 'auto' || o === 'scroll') return true; } return false; };
          for (const el of document.body.querySelectorAll('*')) {
            const r = el.getBoundingClientRect(), cs = getComputedStyle(el);
            if (!r.width || cs.visibility === 'hidden' || cs.display === 'none' || cs.position === 'fixed') continue;
            if ((r.right > W + 1 || r.left < -1) && !scroller(el) && !(el.parentElement && bad.includes(el.parentElement))) bad.push(el);
          }
          return bad.slice(0, 5).map((el) => el.tagName.toLowerCase() + (typeof el.className === 'string' && el.className.trim() ? '.' + el.className.trim().split(/\s+/)[0] : ''));
        }).catch(() => []); // a page that navigates mid-check: no finding, not a crash
        for (const s of sticking) add(route, width, 'sticks-out', s, { blocking: false });
        try {
          await page.addScriptTag({ path: axePath });
          const v = await page.evaluate(async () => (await window.axe.run(document, {
            runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] }, resultTypes: ['violations'],
          })).violations.map((x) => ({ id: x.id, impact: x.impact, help: x.help, n: x.nodes.length, at: x.nodes[0]?.target?.join(' ') })));
          for (const x of v) add(route, width, 'a11y', x.id, { count: x.n, detail: `${x.impact}: ${x.help} (e.g. ${x.at})`, blocking: x.impact === 'serious' || x.impact === 'critical' });
        } catch (e) { add(route, width, 'a11y', 'axe could not run', { detail: norm(e.message), blocking: false }); }
        if (shots) await page.screenshot({ path: `${shots}/${(route.replace(/\W+/g, '-').replace(/^-|-$/g, '') || 'home')}-${width}.png`, fullPage: true }).catch(() => {});
      }
      await page.close();
    }
    await ctx.close();
  }
  await browser.close();
  writeFileSync(out, JSON.stringify({ url, routes, findings }, null, 1));
  console.log(`checked ${routes.length} page(s) × ${WIDTHS.length} widths at ${url}: ${findings.length} finding(s)`);
}

function compare(basePath, headPath) {
  const head = JSON.parse(readFileSync(headPath, 'utf8'));
  const base = existsSync(basePath) ? JSON.parse(readFileSync(basePath, 'utf8')) : null;
  const k = (f) => `${f.route}|${f.width}|${f.kind}|${f.key}`;
  const had = new Map((base?.findings || []).map((f) => [k(f), f.count]));
  const rows = head.findings.map((f) => ({ ...f, added: f.count - (had.get(k(f)) || 0) })).filter((f) => f.added > 0);
  const hard = rows.filter((f) => f.blocking), soft = rows.filter((f) => !f.blocking);
  const line = (f) => `${f.blocking ? 'BLOCK' : 'note '} ${f.route} @${f.width}px  ${f.kind}: ${f.key}${f.detail ? ' — ' + f.detail : ''}${f.added > 1 ? ` (+${f.added})` : ''}`;
  if (!base) console.log('base could not be built or served: every problem on this PR counts as new');
  for (const f of [...hard, ...soft]) console.log('  ' + line(f));
  const old = head.findings.filter((f) => f.blocking).length - hard.length;
  const verdict = hard.length ? `✗ ${hard.length} problem(s) this PR adds or makes worse` : `✓ nothing worse than ${base ? 'main' : 'before'}`;
  console.log(`${verdict} (${head.routes.length} page(s); ${old} older problem(s) left for the backlog)`);
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Orca browser check\n${verdict}\n\n` +
      (rows.length ? rows.map((f) => '- ' + line(f).replace(/^(BLOCK|note )/, (m) => m.trim() === 'BLOCK' ? '⛔' : 'ℹ️')).join('\n') : '') +
      '\n\nScreenshots: see the run\'s **orca-screenshots** artifact.\n');
  }
  for (const f of hard) console.log(`::error::${f.route} @${f.width}px ${f.kind}: ${f.key}${f.detail ? ' — ' + f.detail : ''}`);
  process.exit(hard.length ? 1 : 0);
}

if (mode === 'check') await check(args[0], args[1]);
else if (mode === 'compare') compare(args[0], args[1]);
else { console.error('usage: browser-check.mjs check <url> <out.json> | compare <base.json> <head.json>'); process.exit(2); }
