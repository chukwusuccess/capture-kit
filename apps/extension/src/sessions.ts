import type { Capture } from '@capture-kit/model';

export interface SessionStorage {
  get(keys: string | string[] | null): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string | string[]): Promise<void>;
}

export type SessionStatus = 'running' | 'cancelling' | 'completed' | 'interrupted' | 'cancelled' | 'failed';
export interface CaptureJob {
  id: string;
  url: string;
  width: number;
  status: 'pending' | 'running' | 'completed' | 'failed';
  captureCount: number;
  error?: string;
}
export interface SessionInput {
  origin: string;
  tabId: number;
  mode: 'live' | 'window' | 'pick';
  urls: string[];
  widths: number[];
  scrollStitch: boolean;
  dualTheme: boolean;
  format?: string;
  includeDesignSystem?: boolean;
}
export interface CaptureSession {
  id: string;
  createdAt: number;
  updatedAt: number;
  status: SessionStatus;
  origin: string;
  tabId: number;
  mode: SessionInput['mode'];
  scrollStitch: boolean;
  dualTheme: boolean;
  format: string;
  includeDesignSystem: boolean;
  jobs: CaptureJob[];
  error?: string;
}
interface SessionIndex { version: 1; sessions: CaptureSession[] }
interface JobResult { completedAt: number; captures: Capture[] }
interface StoreOptions { maxSessions?: number; now?: () => number; id?: () => string }

export const SESSION_INDEX_KEY = 'capture-kit:sessions:v1';
export const MAX_SAVED_SESSIONS = 8;
const resultKey = (sessionId: string, jobId: string): string => `capture-kit:result:${sessionId}:${jobId}`;
export const sessionResultKey = resultKey;
export const isSessionActive = (session: CaptureSession): boolean => session.status === 'running' || session.status === 'cancelling';
const errorMessage = (error: unknown): string => error instanceof Error ? error.message : String(error);

/** The service worker is the only writer. Popup messages are advisory, never capture transport. */
export class CaptureSessionStore {
  private readonly maxSessions: number;
  private readonly now: () => number;
  private readonly id: () => string;
  private queue: Promise<unknown> = Promise.resolve();
  private readonly volatileSessions = new Map<string, CaptureSession>();
  private initialized?: Promise<void>;

  constructor(private readonly storage: SessionStorage, options: StoreOptions = {}) {
    this.maxSessions = options.maxSessions ?? MAX_SAVED_SESSIONS;
    this.now = options.now ?? Date.now;
    this.id = options.id ?? (() => crypto.randomUUID());
    if (this.maxSessions < 2) throw new Error('Session retention must allow at least two sessions');
  }

  private exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(operation);
    this.queue = result.catch(() => undefined);
    return result;
  }

  private async index(): Promise<SessionIndex> {
    const data = await this.storage.get(SESSION_INDEX_KEY);
    const stored = data[SESSION_INDEX_KEY] as SessionIndex | undefined;
    if (!stored) return { version: 1, sessions: [] };
    if (stored.version !== 1 || !Array.isArray(stored.sessions)) throw new Error('Saved session data is not supported; it has not been overwritten');
    return {
      version: 1,
      sessions: stored.sessions.map((session) => {
        const volatile = this.volatileSessions.get(session.id);
        return volatile ? structuredClone(volatile) : session;
      }),
    };
  }

  private async save(index: SessionIndex): Promise<void> {
    try {
      await this.storage.set({ [SESSION_INDEX_KEY]: index });
      this.volatileSessions.clear();
    } catch (error) {
      throw new Error(`Session checkpoint was not saved: ${errorMessage(error)}. Saved captures are retained; free extension storage or discard an older session.`);
    }
  }

  private session(index: SessionIndex, id: string): CaptureSession {
    const session = index.sessions.find((item) => item.id === id);
    if (!session) throw new Error('Saved session not found');
    return session;
  }

  /** Run exactly once per worker lifetime, not on every popup open. */
  initialize(): Promise<void> {
    this.initialized ??= this.exclusive(async () => {
      const index = await this.index();
      const keys = index.sessions.flatMap((session) => session.jobs.map((job) => resultKey(session.id, job.id)));
      const results = keys.length ? await this.storage.get(keys) : {};
      let changed = false;
      const changedSessionIds = new Set<string>();
      for (const session of index.sessions) {
        const wasActive = isSessionActive(session);
        let missingResult = false;
        for (const job of session.jobs) {
          const result = results[resultKey(session.id, job.id)] as JobResult | undefined;
          if (result && Array.isArray(result.captures) && result.captures.length > 0) {
            if (job.status !== 'completed' || job.captureCount !== result.captures.length) {
              job.status = 'completed';
              job.captureCount = result.captures.length;
              delete job.error;
              changed = true;
              changedSessionIds.add(session.id);
            }
          } else if (job.status === 'running' || job.status === 'completed') {
            missingResult ||= job.status === 'completed';
            job.status = 'pending';
            job.captureCount = 0;
            changed = true;
            changedSessionIds.add(session.id);
          }
        }
        if (wasActive || missingResult) {
          session.status = session.status === 'cancelling' ? 'cancelled'
            : session.jobs.every((job) => job.status === 'completed') ? 'completed' : 'interrupted';
          session.error = missingResult ? 'A saved result is missing. Resume to capture only unfinished jobs.'
            : session.status === 'interrupted' ? session.jobs.some((job) => job.status === 'completed')
              ? 'Capture stopped when the background worker restarted. Completed results are saved.'
              : 'Capture stopped when the background worker restarted. Resume to continue.'
            : session.status === 'cancelled' ? session.jobs.some((job) => job.status === 'completed')
              ? 'Capture was cancelled. Completed results are saved.'
              : 'Capture was cancelled. Resume to continue.' : undefined;
          session.updatedAt = this.now();
          changed = true;
          changedSessionIds.add(session.id);
        }
      }
      if (changed) {
        try {
          await this.save(index);
        } catch (error) {
          for (const session of index.sessions) {
            if (!changedSessionIds.has(session.id)) continue;
            session.error = [session.error, errorMessage(error)].filter(Boolean).join(' ');
            this.volatileSessions.set(session.id, structuredClone(session));
          }
        }
      }
    }).catch((error: unknown) => {
      this.initialized = undefined;
      throw error;
    });
    return this.initialized;
  }

  private async operation<T>(run: (index: SessionIndex) => Promise<T>): Promise<T> {
    await this.initialize();
    return this.exclusive(async () => run(await this.index()));
  }

  list(): Promise<CaptureSession[]> {
    return this.operation(async (index) => [...index.sessions].sort((a, b) => b.createdAt - a.createdAt));
  }

  create(input: SessionInput): Promise<CaptureSession> {
    return this.operation(async (index) => {
      if (index.sessions.some(isSessionActive)) throw new Error('A capture run is already active. Cancel it before starting another.');
      const urls = [...new Set(input.urls)];
      const widths = [...new Set(input.widths)];
      if (!urls.length || !widths.length) throw new Error('Select at least one page and viewport width');
      const timestamp = this.now();
      const session: CaptureSession = {
        id: this.id(), createdAt: timestamp, updatedAt: timestamp, status: 'running',
        origin: input.origin, tabId: input.tabId, mode: input.mode,
        scrollStitch: input.scrollStitch, dualTheme: input.dualTheme,
        format: input.format ?? 'figma', includeDesignSystem: input.includeDesignSystem ?? false,
        jobs: urls.flatMap((url) => widths.map((width) => ({
          id: `${encodeURIComponent(url)}:${width}:${input.dualTheme ? 'dual' : 'single'}`,
          url, width, status: 'pending' as const, captureCount: 0,
        }))),
      };
      if (index.sessions.some((item) => item.id === session.id)) throw new Error('Session identifier already exists');
      const latestCompleted = [...index.sessions].filter((item) => item.status === 'completed').sort((a, b) => b.updatedAt - a.updatedAt)[0]?.id;
      const expired: CaptureSession[] = [];
      while (index.sessions.length >= this.maxSessions) {
        const oldest = [...index.sessions].filter((item) => !isSessionActive(item) && item.id !== latestCompleted).sort((a, b) => a.createdAt - b.createdAt)[0];
        if (!oldest) throw new Error('Saved session retention is full. Discard an older session to continue.');
        index.sessions = index.sessions.filter((item) => item.id !== oldest.id);
        expired.push(oldest);
      }
      index.sessions.push(session);
      // Commit retention and the new run before deleting expired payloads. A quota
      // rejection must leave every previously persisted capture untouched.
      await this.save(index);
      try {
        const expiredKeys = expired.flatMap((item) => item.jobs.map((job) => resultKey(item.id, job.id)));
        if (expiredKeys.length) await this.storage.remove(expiredKeys);
      } catch (error) {
        session.status = 'interrupted';
        session.error = `Old session cleanup failed: ${errorMessage(error)}`;
        await this.save(index);
        throw new Error(session.error);
      }
      return session;
    });
  }

  resume(id: string): Promise<CaptureSession> {
    return this.operation(async (index) => {
      if (index.sessions.some(isSessionActive)) throw new Error('A capture run is already active');
      const session = this.session(index, id);
      await this.rollForward(session);
      if (session.jobs.every((job) => job.status === 'completed')) throw new Error('This session is already complete');
      session.status = 'running';
      session.updatedAt = this.now();
      delete session.error;
      for (const job of session.jobs) {
        if (job.status !== 'completed') {
          job.status = 'pending';
          delete job.error;
        }
      }
      await this.save(index);
      return session;
    });
  }

  startJob(id: string, jobId: string): Promise<void> {
    return this.operation(async (index) => {
      const session = this.session(index, id);
      if (session.status !== 'running') throw new Error('Capture run is no longer running');
      const job = session.jobs.find((item) => item.id === jobId);
      if (!job || job.status === 'completed') throw new Error('Capture job is missing or already completed');
      job.status = 'running';
      delete job.error;
      session.updatedAt = this.now();
      await this.save(index);
    });
  }

  completeJob(id: string, jobId: string, captures: Capture[]): Promise<void> {
    return this.operation(async (index) => {
      const session = this.session(index, id);
      const job = session.jobs.find((item) => item.id === jobId);
      if (!job) throw new Error('Capture job not found');
      if (!captures.length) throw new Error('No capture result to save');
      if (job.status === 'completed') throw new Error('Capture job is already completed');
      // The result is one durable record. On restart it rolls the manifest forward
      // if the separate, small metadata checkpoint could not be written.
      try {
        await this.storage.set({ [resultKey(id, jobId)]: { completedAt: this.now(), captures } satisfies JobResult });
      } catch (error) {
        throw new Error(`Capture result was not saved: ${errorMessage(error)}. Previously saved captures are retained.`);
      }
      job.status = 'completed';
      job.captureCount = captures.length;
      delete job.error;
      session.updatedAt = this.now();
      await this.save(index);
    });
  }

  failJob(id: string, jobId: string, error: string): Promise<void> {
    return this.operation(async (index) => {
      const session = this.session(index, id);
      const job = session.jobs.find((item) => item.id === jobId);
      if (!job || job.status === 'completed') return;
      job.status = 'failed';
      job.error = error;
      session.updatedAt = this.now();
      await this.save(index);
    });
  }

  requestCancel(id: string): Promise<void> {
    return this.operation(async (index) => {
      const session = this.session(index, id);
      if (!isSessionActive(session)) throw new Error('Capture run is not active');
      session.status = 'cancelling';
      session.updatedAt = this.now();
      await this.save(index);
    });
  }

  finish(id: string): Promise<CaptureSession> {
    return this.operation(async (index) => {
      const session = this.session(index, id);
      session.status = session.status === 'cancelling' ? 'cancelled'
        : session.jobs.every((job) => job.status === 'completed') ? 'completed' : 'failed';
      session.error = session.status === 'cancelled'
        ? session.jobs.some((job) => job.status === 'completed') ? 'Capture cancelled. Completed results are saved.' : 'Capture cancelled. Resume to continue.'
        : session.status === 'failed' ? session.jobs.find((job) => job.error)?.error ?? 'Some jobs did not finish. Resume to retry unfinished jobs.' : undefined;
      for (const job of session.jobs) if (job.status === 'running') job.status = 'pending';
      session.updatedAt = this.now();
      try {
        await this.save(index);
      } catch (error) {
        this.volatileSessions.set(session.id, structuredClone(session));
        throw error;
      }
      return session;
    });
  }

  private async rollForward(session: CaptureSession): Promise<void> {
    const data = session.jobs.length
      ? await this.storage.get(session.jobs.map((job) => resultKey(session.id, job.id)))
      : {};
    for (const job of session.jobs) {
      const result = data[resultKey(session.id, job.id)] as JobResult | undefined;
      if (result && Array.isArray(result.captures) && result.captures.length > 0) {
        job.status = 'completed';
        job.captureCount = result.captures.length;
        delete job.error;
      } else if (job.status === 'completed' || job.status === 'running') {
        job.status = 'pending';
        job.captureCount = 0;
      }
    }
  }

  interrupt(id: string, error: string): Promise<void> {
    return this.operation(async (index) => {
      const session = this.session(index, id);
      await this.rollForward(session);
      session.status = session.status === 'cancelling' ? 'cancelled' : 'interrupted';
      session.error = error;
      for (const job of session.jobs) if (job.status === 'running') job.status = 'pending';
      session.updatedAt = this.now();
      try {
        await this.save(index);
      } catch (checkpointError) {
        this.volatileSessions.set(session.id, structuredClone(session));
        throw checkpointError;
      }
    });
  }

  getCaptures(id: string, selectedJobIds?: string[]): Promise<Capture[]> {
    return this.operation(async (index) => {
      const session = this.session(index, id);
      const selected = selectedJobIds ? new Set(selectedJobIds) : undefined;
      const jobs = session.jobs.filter((job) => job.status === 'completed' && (!selected || selected.has(job.id)));
      const results = jobs.length ? await this.storage.get(jobs.map((job) => resultKey(id, job.id))) : {};
      return jobs.flatMap((job) => {
        const result = results[resultKey(id, job.id)] as JobResult | undefined;
        if (!result || !Array.isArray(result.captures) || result.captures.length === 0) throw new Error('A saved capture is missing. No export was produced; resume this session to recover the job.');
        return result.captures;
      });
    });
  }

  discard(id: string): Promise<void> {
    return this.operation(async (index) => {
      const session = this.session(index, id);
      if (isSessionActive(session)) throw new Error('Cancel the active session before discarding it');
      await this.storage.remove(session.jobs.map((job) => resultKey(id, job.id)));
      index.sessions = index.sessions.filter((item) => item.id !== id);
      try {
        await this.save(index);
      } catch (error) {
        const retryable = structuredClone(session);
        retryable.status = 'interrupted';
        retryable.error = `Discard cleanup was not saved after capture data was removed: ${errorMessage(error)}. Retry discard or resume the unfinished jobs.`;
        for (const job of retryable.jobs) {
          if (job.status === 'completed') {
            job.status = 'pending';
            job.captureCount = 0;
          }
        }
        this.volatileSessions.set(id, retryable);
        throw error;
      }
    });
  }
}
