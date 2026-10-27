import assert from 'node:assert';
import { groupPages, pagePath } from './src/pages.js';
import { emptyCapture } from '@capture-kit/model';
import { CaptureSessionStore, sessionResultKey, type SessionStorage } from './src/sessions.js';

const o = 'https://site.test';
const groups = groupPages([
  `${o}/blog/b`, `${o}/`, `${o}/blog/a`, `${o}/about`, `${o}/careers/eng`, `${o}/blog`, `${o}/docs/x?v=2`, `${o}/docs/y/`,
]);
assert.deepStrictEqual(groups.map((g) => g.label), ['Main pages', '/blog', '/docs']);
assert.deepStrictEqual(groups[0].urls.map(pagePath), ['/', '/about', '/careers/eng']);
assert.deepStrictEqual(groups[1].urls.map(pagePath), ['/blog', '/blog/a', '/blog/b']);
assert.deepStrictEqual(groups[2].urls.map(pagePath), ['/docs/x?v=2', '/docs/y']);
assert.deepStrictEqual(groupPages([]), []);
// This adapter exercises persisted values and failures, not implementation text.
class MemoryStorage implements SessionStorage {
  readonly values: Record<string, unknown> = {};
  failNextWrite = false;
  async get(keys: string | string[] | null): Promise<Record<string, unknown>> {
    const requested = keys === null ? Object.keys(this.values) : typeof keys === 'string' ? [keys] : keys;
    return structuredClone(Object.fromEntries(requested.filter((key) => key in this.values).map((key) => [key, this.values[key]])));
  }
  async set(items: Record<string, unknown>): Promise<void> {
    if (this.failNextWrite) {
      this.failNextWrite = false;
      throw new Error('QUOTA_BYTES quota exceeded');
    }
    Object.assign(this.values, structuredClone(items));
  }
  async remove(keys: string | string[]): Promise<void> {
    for (const key of typeof keys === 'string' ? [keys] : keys) delete this.values[key];
  }
}

const capture = (url = `${o}/`, width = 1440) => emptyCapture({
  url, frame: { width, height: 800, baseURI: url }, nodes: [],
});
const notedCapture = {
  ...capture(),
  diagnostics: [{ code: 'image_timeout', message: 'An image did not finish loading.', severity: 'warning' as const }],
};
const input = {
  origin: o, tabId: 10, mode: 'window' as const,
  urls: [`${o}/`, `${o}/about`], widths: [1440, 390],
  scrollStitch: true, dualTheme: false, format: 'figma-native', includeDesignSystem: true,
};
async function sessionTests(): Promise<void> {
  const identityStore = new CaptureSessionStore(new MemoryStorage(), { id: () => 'theme-run' });
  const dualTheme = await identityStore.create({
    ...input, urls: [`${o}/theme`], widths: [1440, 390], dualTheme: true,
  });
  assert.equal(dualTheme.jobs[0].id, `${encodeURIComponent(`${o}/theme`)}:1440:dual`);
  assert.equal(dualTheme.jobs[1].id, `${encodeURIComponent(`${o}/theme`)}:390:dual`);

  const storage = new MemoryStorage();
  let clock = 100;
  const store = new CaptureSessionStore(storage, { now: () => ++clock, id: () => `run-${clock}`, maxSessions: 3 });
  const run = await store.create(input);
  assert.equal(run.jobs.length, 4, 'each page/width pair is a checkpoint');
  assert.ok(run.jobs.every((job) => job.id.endsWith(':single')), 'job identity records single-theme captures');
  await assert.rejects(store.create(input), /already active/);
  await assert.rejects(store.resume(run.id), /already active/);
  await store.startJob(run.id, run.jobs[0].id);
  await store.completeJob(run.id, run.jobs[0].id, [notedCapture]);
  await store.startJob(run.id, run.jobs[1].id);

  // A new service-worker instance cannot trust a persisted busy flag.
  const recovered = new CaptureSessionStore(storage, { now: () => ++clock, id: () => `run-${clock}`, maxSessions: 3 });
  const [interrupted] = await recovered.list();
  assert.equal(interrupted.status, 'interrupted');
  assert.equal(interrupted.jobs[0].status, 'completed');
  assert.equal(interrupted.jobs[1].status, 'pending');
  assert.deepEqual(await recovered.getCaptures(run.id), [notedCapture]);
  assert.deepEqual(await recovered.getCaptures(run.id), [notedCapture], 'repeated exports do not consume durable results');
  const resumed = await recovered.resume(run.id);
  assert.equal(resumed.jobs.filter((job) => job.status !== 'completed').length, 3, 'resume schedules only unfinished jobs');
  assert.equal(resumed.format, 'figma-native', 'resume retains the original export format');
  assert.equal(resumed.includeDesignSystem, true, 'resume retains the original output options');
  assert.equal(resumed.scrollStitch, true, 'resume retains capture options');
  await assert.rejects(recovered.startJob(run.id, run.jobs[0].id), /already completed/, 'completed work cannot be recaptured');
  await recovered.requestCancel(run.id);
  await recovered.finish(run.id);
  assert.equal((await recovered.list())[0].status, 'cancelled');
  assert.deepEqual(await recovered.getCaptures(run.id), [notedCapture], 'cancellation keeps completed results');
  await recovered.resume(run.id);
  for (const job of run.jobs.slice(1)) {
    await recovered.startJob(run.id, job.id);
    await recovered.completeJob(run.id, job.id, [capture(job.url, job.width)]);
  }
  assert.equal((await recovered.finish(run.id)).status, 'completed');
  await assert.rejects(recovered.resume(run.id), /already complete/);
  assert.equal((await recovered.getCaptures(run.id, [run.jobs[1].id])).length, 1, 'selected jobs export independently');

  const next = await recovered.create({ ...input, urls: [`${o}/next`], widths: [768] });
  storage.failNextWrite = true;
  await assert.rejects(recovered.completeJob(next.id, next.jobs[0].id, [capture()]), /not saved.*quota/i);
  assert.equal((await recovered.list())[0].jobs[0].status, 'pending', 'quota failure never claims a completed checkpoint');
  assert.equal((await recovered.getCaptures(next.id)).length, 0);
  await recovered.interrupt(next.id, 'Capture result was not saved: QUOTA_BYTES quota exceeded. Previously saved captures are retained.');
  const quotaRecovery = (await recovered.list()).find((session) => session.id === next.id);
  assert.equal(quotaRecovery?.status, 'interrupted');
  assert.match(quotaRecovery?.error ?? '', /quota exceeded/i, 'quota failure remains visible in the recoverable session');
  const blockedStorage = new MemoryStorage();
  const blockedStore = new CaptureSessionStore(blockedStorage, { id: () => 'blocked-run' });
  const blockedRun = await blockedStore.create({ ...input, urls: [`${o}/blocked`], widths: [1440] });
  await blockedStore.startJob(blockedRun.id, blockedRun.jobs[0].id);
  const durableSet = blockedStorage.set.bind(blockedStorage);
  blockedStorage.set = async () => { throw new Error('QUOTA_BYTES quota exceeded'); };
  await assert.rejects(blockedStore.completeJob(blockedRun.id, blockedRun.jobs[0].id, [capture()]), /quota/i);
  await assert.rejects(blockedStore.interrupt(blockedRun.id, 'Capture result was not saved because extension storage is full'), /checkpoint.*quota/i);
  const visibleBlocked = (await blockedStore.list()).find((session) => session.id === blockedRun.id);
  assert.equal(visibleBlocked?.status, 'interrupted', 'failed metadata writes do not leave the worker run falsely active');
  assert.match(visibleBlocked?.error ?? '', /storage is full/i, 'the interrupted state remains user-visible in this worker');
  const restartedBlocked = new CaptureSessionStore(blockedStorage);
  const visibleAfterRestart = (await restartedBlocked.list()).find((session) => session.id === blockedRun.id);
  assert.equal(visibleAfterRestart?.status, 'interrupted', 'reopening after a failed quota checkpoint remains recoverable');
  blockedStorage.set = durableSet;
  await restartedBlocked.discard(blockedRun.id);
  assert.ok(!Object.keys(blockedStorage.values).some((key) => key.includes(`${blockedRun.id}:`)), 'a quota-blocked run can be discarded after storage is freed');
  const cancelled = await recovered.create({ ...input, urls: [`${o}/cancelled`], widths: [390] });
  await recovered.requestCancel(cancelled.id);
  const restarted = new CaptureSessionStore(storage, { now: () => ++clock, id: () => `run-${clock}`, maxSessions: 3 });
  assert.equal((await restarted.list()).find((session) => session.id === cancelled.id)?.status, 'cancelled');
  const newest = await restarted.create({ ...input, urls: [`${o}/new`], widths: [390] });
  const retained = await restarted.list();
  assert.equal(retained.length, 3, 'retention is bounded');
  assert.ok(retained.some((session) => session.id === run.id), 'latest completed session is protected');
  assert.ok(retained.some((session) => session.id === newest.id), 'active session is protected');
  assert.ok(!retained.some((session) => session.id === next.id), 'oldest unprotected session expires');
  await assert.rejects(restarted.discard(newest.id), /active/);
  await restarted.discard(run.id);
  await assert.rejects(restarted.getCaptures(run.id), /not found/);
  assert.ok(!Object.keys(storage.values).some((key) => key.includes(`${run.id}:`)), 'discard deletes persisted captures');

  // A completed payload survives a failed metadata checkpoint and is rolled forward.
  const rollingStorage = new MemoryStorage();
  const rollingStore = new CaptureSessionStore(rollingStorage);
  const rolling = await rollingStore.create({ ...input, urls: [`${o}/roll`], widths: [1440] });
  const write = rollingStorage.set.bind(rollingStorage);
  let writes = 0;
  rollingStorage.set = async (items) => {
    if (++writes === 2) throw new Error('metadata write interrupted');
    await write(items);
  };
  await assert.rejects(rollingStore.completeJob(rolling.id, rolling.jobs[0].id, [capture()]), /checkpoint/i);
  const rolled = new CaptureSessionStore(rollingStorage);
  assert.equal((await rolled.list())[0].status, 'completed');
  assert.deepEqual(await rolled.getCaptures(rolling.id), [capture()]);
  const missingStorage = new MemoryStorage();
  const missingStore = new CaptureSessionStore(missingStorage, { id: () => 'missing-run' });
  const missingRun = await missingStore.create({ ...input, urls: [`${o}/missing`], widths: [1440] });
  await missingStore.startJob(missingRun.id, missingRun.jobs[0].id);
  await missingStore.completeJob(missingRun.id, missingRun.jobs[0].id, [capture()]);
  await missingStore.finish(missingRun.id);
  await missingStorage.remove(sessionResultKey(missingRun.id, missingRun.jobs[0].id));
  const missingRecovery = new CaptureSessionStore(missingStorage);
  const [repaired] = await missingRecovery.list();
  assert.equal(repaired.status, 'interrupted', 'missing completed payload becomes resumable instead of a false success');
  assert.equal(repaired.jobs[0].status, 'pending');
  assert.equal((await missingRecovery.resume(missingRun.id)).jobs[0].status, 'pending');

  // Concurrent starts are serialized by the same authoritative session store.
  const racing = new CaptureSessionStore(new MemoryStorage());
  const starts = await Promise.allSettled([racing.create(input), racing.create(input)]);
  assert.equal(starts.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(starts.filter((result) => result.status === 'rejected').length, 1);
}

await sessionTests();
console.log('apps/extension tests passed: page grouping, session transitions, recovery, retention, quota and duplicate starts');
