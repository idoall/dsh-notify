import { createHash } from 'node:crypto';
import z from '@deepseek-ai/schemastery';
import { EventReducer, validateRequest } from './core.js';
import { createBuffer, createSettings } from './buffer.js';
import { createSoundLibrary } from './sounds.js';
import { BUILTIN_SOUNDS, SOUND_BYTES } from './sound-choices.js';

export const name = 'dsh-notify';
export const inject = [];
export const Config = z.object({
  dataDir: z.string().description('Absolute path to the profile-owned dsh-notify data directory.'),
  // 0 restores the old "notify on every finished turn" behaviour.
  completionGraceMs: z.number().step(1).min(0).max(600_000).default(8_000).description('How long a finished turn must stay quiet before it counts as a finished task (ms).'),
});
export { EventReducer, sanitizeBody, validateRequest } from './core.js';
export { createBuffer, createSettings, BUFFER_LIMIT } from './buffer.js';
export { createSoundLibrary } from './sounds.js';
export { BUILTIN_SOUNDS, SOUND_BYTES, parseSoundChoice, validSoundName } from './sound-choices.js';

const BASE = '/plugins/dsh-notify';
const BODY_CAP = 16 * 1024;
const COMMAND_LIKE = /&&|\|\||[|;]|\$\(|`/;
/**
 * A job label is usually the raw command line, which makes an unusable notification title. Keep the
 * title human and only carry a label into the body when it reads like a description, not a command.
 */
const JOB_STATUS_LABEL = Object.freeze({ completed: '已完成', failed: '失败', error: '出错', aborted: '已中止', cancelled: '已取消', killed: '已终止' });
export function jobNotification(snapshot = {}) {
  const status = typeof snapshot.status === 'string' ? snapshot.status.trim().toLowerCase() : '';
  const label = typeof snapshot.label === 'string' ? snapshot.label.trim() : '';
  const failed = /fail|error|abort/.test(status);
  const readable = label !== '' && !COMMAND_LIKE.test(label) && label.length <= 60;
  const outcome = JOB_STATUS_LABEL[status] ?? status;
  return { title: failed ? '后台任务失败' : '后台任务结束', body: readable ? label : (outcome || undefined) };
}
const DEFAULT_SETTINGS = Object.freeze({ verbosity: 'normal', toastPosition: 'conversation', toastEnabled: true, subtaskNotify: false, soundEnabled: true, sound: 'chime' });
const SETTING_KEYS = Object.freeze(Object.keys(DEFAULT_SETTINGS));
/**
 * Only the settings this version knows about are adopted — or written back. A file left by an older
 * version must not smuggle its own shape into the config, and a request must not add keys that the
 * plugin would then hand straight back to the page.
 */
const pickSettings = (value = {}) => Object.fromEntries(Object.entries(value ?? {}).filter(([key]) => SETTING_KEYS.includes(key)));

function contextService(ctx, name) {
  const explicit = ctx?.get?.(name);
  if (explicit !== undefined && explicit !== null) return explicit;
  const reflected = ctx?.reflect?.get?.(name, true);
  if (reflected !== undefined && reflected !== null) return reflected;
  // Plain test doubles expose services as direct properties. A real Cordis
  // proxy intentionally throws for undeclared direct service reads.
  try { return ctx?.[name]; } catch { return undefined; }
}
const sessionIdOf = (agent) => agent?.session?.id ?? agent?.id;
const originOf = (session) => session?.header?.origin;

function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify(payload));
}
function sameOriginRequest(req) {
  const site = String(req.headers?.['sec-fetch-site'] ?? '').toLowerCase();
  if (site && site !== 'same-origin' && site !== 'same-site' && site !== 'none') return false;
  const origin = req.headers?.origin;
  if (!origin) return true;
  const host = req.headers?.host;
  try { return new URL(String(origin)).host === host; } catch { return false; }
}
function digest(value) { return createHash('sha256').update(String(value)).digest('base64url'); }
function requestOwnerHash(req) {
  const credential = String(req.headers?.cookie || req.headers?.authorization || '');
  return credential ? digest(credential) : '';
}
function requestSessionKey(req) {
  const peer = String(req.socket?.remoteAddress || 'unknown');
  return digest(`${requestOwnerHash(req)}\0${peer}`);
}
function createSessionLimiter({ now = () => Date.now(), windowMs = 60_000 } = {}) {
  const buckets = new Map();
  return (req, action, limit) => {
    const time = now();
    const key = `${requestSessionKey(req)}:${action}`;
    let bucket = buckets.get(key);
    if (!bucket || time >= bucket.resetAt) { bucket = { count: 0, resetAt: time + windowMs }; buckets.set(key, bucket); }
    if (bucket.count >= limit) return Math.max(1, Math.ceil((bucket.resetAt - time) / 1000));
    bucket.count += 1;
    return 0;
  };
}
function enforceLimit(req, res, limiter, action, limit) {
  const retryAfter = limiter(req, action, limit);
  if (!retryAfter) return true;
  res.statusCode = 429;
  res.setHeader('retry-after', String(retryAfter));
  res.setHeader('cache-control', 'no-store');
  res.end('too many requests');
  return false;
}
async function readBody(req, limit) {
  const declared = Number(req.headers?.['content-length'] ?? 0);
  if (Number.isFinite(declared) && declared > limit) throw Object.assign(new Error('request body too large'), { status: 413 });
  const chunks = []; let size = 0;
  for await (const chunk of req) {
    size += chunk.byteLength;
    if (size > limit) throw Object.assign(new Error('request body too large'), { status: 413 });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
async function readJson(req, limit = BODY_CAP) {
  const contentType = String(req.headers?.['content-type'] ?? '').split(';', 1)[0].trim().toLowerCase();
  if (contentType !== 'application/json') throw Object.assign(new Error('content-type must be application/json'), { status: 415 });
  const declared = Number(req.headers?.['content-length'] ?? 0);
  if (Number.isFinite(declared) && declared > limit) throw Object.assign(new Error('request body too large'), { status: 413 });
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.byteLength;
    if (size > limit) { req.resume?.(); throw Object.assign(new Error('request body too large'), { status: 413 }); }
    chunks.push(chunk);
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks, size).toString('utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('body must be an object');
    return { value, size };
  } catch (error) { throw Object.assign(error, { status: 400 }); }
}
function schemaStatus(fields, allowed) {
  return validateRequest({ rejection: undefined, originOK: true, fields, allowed });
}
function registerRoute(ctx, webServer, route) {
  const register = () => webServer.register(route);
  return ctx?.effect ? ctx.effect(register, `dsh-notify: ${route.path}`) : register();
}
function registerSensitive(ctx, webServer, connection, path, methods, handler) {
  const allowed = Array.isArray(methods) ? methods : [methods];
  return registerRoute(ctx, webServer, {
    kind: 'exact', path: `${BASE}${path}`,
    handler: async (req, res) => {
      const rejection = connection.requestRejection(req);
      if (rejection !== undefined) { res.statusCode = rejection; res.end(rejection === 401 ? 'unauthorized' : 'forbidden'); return; }
      if (!allowed.includes(req.method)) { res.statusCode = 405; res.setHeader('allow', allowed.join(', ')); res.end(); return; }
      if (req.method !== 'GET' && !sameOriginRequest(req)) { res.statusCode = 403; res.end('forbidden'); return; }
      try { await handler(req, res); } catch (error) { sendJson(res, error?.status ?? 500, { error: error?.status ? error.message : 'internal error' }); }
    },
  });
}

export async function apply(ctx, config = {}) {
  // No store, no history: the buffer holds what has not been delivered yet, and preferences are the
  // only thing that outlives the process.
  const buffer = createBuffer();
  const preferences = createSettings({ dataDir: config.dataDir, keys: SETTING_KEYS });
  const settings = { ...DEFAULT_SETTINGS, ...pickSettings(preferences.get()) };
  const reducer = new EventReducer(() => Date.now());
  const diagnostics = { eventErrors: 0, services: {} };
  const sounds = createSoundLibrary({ dataDir: config.dataDir });
  // Tool call IDs remain available for authoritative replay/result handling.
  // A live user-questions/request has no source-proven causal callId, therefore
  // this host must not infer one from an arrival queue or FIFO ordering.
  const pendingToolCalls = new Map();
  const pendingFor = (sessionId) => {
    let calls = pendingToolCalls.get(sessionId);
    if (!calls) { calls = new Set(); pendingToolCalls.set(sessionId, calls); }
    return calls;
  };
  const removePending = (sessionId, callId) => {
    const calls = pendingToolCalls.get(sessionId);
    if (!calls) return;
    calls.delete(callId);
    if (!calls.size) pendingToolCalls.delete(sessionId);
  };
  const pendingErrors = new Map();
  const limitSession = createSessionLimiter({ now: config.now, windowMs: config.rateLimitWindowMs });

  /**
   * One record, one delivery: the buffer is the whole hand-off. `ctx.emit` stays for anything that
   * wants to observe records in-process (the CLI diagnostics and the tests do).
   */
  const dispatch = async (record) => {
    if (!record) return null;
    buffer.push(record);
    ctx?.emit?.('dsh-notify/record', record);
    return record;
  };
  const safely = (work) => { Promise.resolve().then(work).catch(() => { diagnostics.eventErrors += 1; }); };
  /**
   * A turn ending is not the task finishing. With goals, queued prompts or an agent that keeps
   * working, one job produces several turns — and therefore several "任务完成" toasts, which is
   * exactly the noise the user could not reconcile. So a notifiable turn end is *deferred*: if the
   * session starts working again inside the grace window (which is what a goal round does), nothing is
   * recorded at all; if a goal is engaged, nothing is recorded until that goal ends.
   */
  const completionGraceMs = Number.isSafeInteger(config.completionGraceMs) ? config.completionGraceMs : 8_000;
  const deferredCompletions = new Map();   // sessionId -> { payload, timer }
  const engagedGoals = new Set();          // sessionIds whose goal loop is still running
  const clearDeferred = (sessionId) => { const entry = deferredCompletions.get(sessionId); if (entry?.timer) clearTimeout(entry.timer); };
  const flushCompletion = async (sessionId) => {
    const entry = deferredCompletions.get(sessionId);
    if (!entry) return;
    deferredCompletions.delete(sessionId);
    if (entry.timer) clearTimeout(entry.timer);
    await dispatch(reducer.turnEnd(entry.payload));
  };
  const cancelCompletion = (sessionId) => {
    const entry = deferredCompletions.get(sessionId);
    if (!entry) return;
    clearDeferred(sessionId);
    deferredCompletions.delete(sessionId);
    diagnostics.deferredCancelled = (diagnostics.deferredCancelled ?? 0) + 1;
  };
  const deferCompletion = (sessionId, payload) => {
    const existing = deferredCompletions.get(sessionId);
    if (existing?.timer) clearTimeout(existing.timer);
    // An engaged goal holds the payload with no timer: the announcement waits for the goal to end.
    // Grace 0 is the old "every finished turn" behaviour and flushes immediately.
    if (engagedGoals.has(sessionId)) {
      deferredCompletions.set(sessionId, { payload, timer: null });
      return;
    }
    if (completionGraceMs === 0) {
      deferredCompletions.set(sessionId, { payload, timer: null });
      void flushCompletion(sessionId).catch(() => { diagnostics.eventErrors += 1; });
      return;
    }
    const timer = setTimeout(() => { void flushCompletion(sessionId).catch(() => { diagnostics.eventErrors += 1; }); }, completionGraceMs);
    if (typeof timer.unref === 'function') timer.unref();
    deferredCompletions.set(sessionId, { payload, timer });
  };
  /**
   * Never let one of our listeners hold the host's event chain forever. Cordis awaits listener
   * promises, so a listener that waits on a stuck write would wedge session creation, the HTTP API
   * and every other plugin. This bounds our own work: past the deadline we resolve with the fallback
   * and record the timeout, so the host always moves on.
   */
  const bounded = async (work, ms = 20_000, fallback = undefined) => {
    let timer;
    try {
      return await Promise.race([
        Promise.resolve().then(work),
        new Promise((resolve) => { timer = setTimeout(() => { diagnostics.eventErrors += 1; resolve(fallback); }, ms); }),
      ]);
    } catch { diagnostics.eventErrors += 1; return fallback; } finally { clearTimeout(timer); }
  };

  // A live `tool/call` is the ONLY authoritative live signal for a human interaction:
  // dsh-user-questions emits `user-questions/request` through scopeTarget(agent, agent), which a
  // root-scope plugin never receives, so a profile plugin must read the session event stream.
  // It carries the real callId and the raw arguments, so this is not FIFO guessing.
  const interactionBody = (name, rawArguments) => {
    if (name === 'exit_plan_mode') return '计划待审：请在页面里查看并批准或拒绝';
    try {
      const parsed = JSON.parse(rawArguments || '{}');
      const list = Array.isArray(parsed.questions) ? parsed.questions.filter((item) => item && typeof item === 'object') : [];
      const first = list[0] ?? {};
      const text = [first.header, first.question].map((part) => typeof part === 'string' ? part.trim() : '').filter(Boolean).join('：');
      return `${text || '有人在等你回复'}${list.length > 1 ? `（共 ${list.length} 个问题）` : ''}`;
    } catch { return '有人在等你回复'; }
  };

  /**
   * `approval/asked` is the one interactive event that carries no `turn` of its own (its payload is
   * `{id, toolName, callId, reason}`), while every event around it does. Without the turn a record is
   * indistinguishable from a live question at rebuild time, so `expireOpenForSession` leaves it alone
   * and an interrupted approval can never be healed. Remember the newest turn per session instead.
   */
  const liveTurns = new Map();
  const turnOf = (sessionId, event) => (Number.isSafeInteger(event?.turn) && event.turn > 0 ? event.turn : liveTurns.get(sessionId));

  ctx?.on?.('session/event', (session, event) => {
    const data = event?.data ?? {};
    const sessionId = session?.id;
    if (Number.isSafeInteger(data.turn) && data.turn > 0) liveTurns.set(sessionId, data.turn);
    if (event?.type === 'tool/call' && data.callId && (data.name === 'ask_user_question' || data.name === 'exit_plan_mode')) {
      pendingFor(sessionId).add(data.callId);
      const interaction = reducer.question({ sessionId, callId: data.callId, intent: data.name === 'exit_plan_mode' ? { kind: 'plan-review' } : undefined, title: interactionBody(data.name, data.arguments), turn: turnOf(sessionId, data) });
      safely(() => dispatch(interaction));
      return;
    }
    if (event?.type === 'tool/result') {
      const result = data.message?.content?.find?.((block) => block?.type === 'tool-result');
      const callId = result?.toolCallId;
      if (!callId) return; // Unlinked records cannot be guessed closed by an uncorrelated result.
      removePending(sessionId, callId);
      const outcome = result?.isError || data.outcome === 'abort' ? 'abort' : 'settled';
      const existing = reducer.questionResult({ sessionId, callId, outcome });
      if (existing) safely(() => dispatch(existing));
      return;
    }
    safely(async () => {
      // Work resumed: whatever turn end is still pending for this session was not the end of the task.
      if (event?.type === 'turn/start' || event?.type === 'tool/call') cancelCompletion(sessionId);
      if (event?.type === 'approval/asked') await dispatch(reducer.approvalAsked({ ...data, turn: turnOf(sessionId, data) }, sessionId));
      else if (event?.type === 'approval/decided') await dispatch(reducer.approvalDecided(data.id, data.outcome));
      else if (event?.type === 'turn/end') {
        const error = pendingErrors.get(`${sessionId}:${data.turn}`);
        pendingErrors.delete(`${sessionId}:${data.turn}`);
        // A turn just ended, so nothing can still be waiting on this session: a record left open is a
        // leftover whose decision event was never observed, and one leftover used to shadow every
        // later toast. Persist the expiry before the completion notification.
        for (const stale of reducer.expireOpenForSession(sessionId)) await dispatch(stale);
        deferCompletion(sessionId, { sessionId, turn: data.turn, reason: data.reason, body: error?.message || String(error || ''), origin: originOf(session) });
      }
    });
  });
  // A reopened session replays its history, and this plugin used to rebuild still-open interactions
  // from that snapshot to keep the sidebar badge honest. There is no badge and no history any more:
  // the past is not news, so a rebuild would only re-announce an approval the user can already see in
  // the DSH UI, and it would do it on every session open.
  ctx?.on?.('approval/request', (request, next) => { try { /* live reason is non-authoritative */ } catch { diagnostics.eventErrors += 1; } return next(); });
  // A goal loop keeps starting rounds after each turn ends, so a completion is not news until the goal
  // itself is done. `goal` is omitted from the payload exactly when there is no goal for the session.
  ctx?.on?.('goal/activation-changed', (payload) => safely(async () => {
    const sessionId = sessionIdOf(payload?.sessionId) ?? payload?.sessionId;
    if (typeof sessionId !== 'string' || sessionId === '') return;
    if (payload?.goal) {
      engagedGoals.add(sessionId);
      // A goal engaging after a turn ended holds that announcement: the loop is still working, so the
      // pending payload waits for the goal to finish instead of firing on the grace timer.
      const entry = deferredCompletions.get(sessionId);
      if (entry?.timer) { clearTimeout(entry.timer); entry.timer = null; }
      return;
    }
    engagedGoals.delete(sessionId);
    await flushCompletion(sessionId);
  }));
  ctx?.on?.('user-questions/request', (request, next) => {
    let record; let signal; let opening = Promise.resolve(); let settlement;
    try {
      signal = request?.signal;
      const sessionId = sessionIdOf(request.agent);
      const questions = Array.isArray(request.questions) ? request.questions.filter((item) => item && typeof item === 'object') : [];
      const wantsPlan = questions.some((item) => item.intent?.kind === 'plan-review');
      const title = questions.map((item) => String(item.question || item.header || '')).filter(Boolean).join(' · ');
      // This record belongs to this exact waterfall invocation. No FIFO or later
      // tool/result is allowed to guess its authoritative call identity.
      record = reducer.question({ sessionId, intent: wantsPlan ? { kind: 'plan-review' } : undefined, title, turn: liveTurns.get(sessionId) });
      opening = Promise.resolve(dispatch(record)).catch(() => { diagnostics.eventErrors += 1; });
    } catch { diagnostics.eventErrors += 1; }
    const settle = (outcome) => {
      if (settlement) return settlement;
      const closed = record && reducer.settleQuestionKey(record.mergeKey, outcome);
      settlement = opening.then(() => closed ? dispatch(closed) : undefined).catch(() => { diagnostics.eventErrors += 1; });
      return settlement;
    };
    const abort = () => { void settle('abort'); };
    signal?.addEventListener?.('abort', abort, { once: true });
    if (signal?.aborted) abort();
    let delegated;
    try { delegated = next(); } catch (error) { delegated = Promise.reject(error); }
    return Promise.resolve(delegated).then(
      // The host awaits this waterfall, so the bookkeeping is bounded: the answer is returned to the
      // official flow even if our own write is stuck.
      async (answer) => { await bounded(() => settle(signal?.aborted ? 'abort' : 'settled'), 10_000); return answer; },
      async (error) => { await bounded(() => settle(signal?.aborted || error?.code === 'ASK_ABORTED' ? 'abort' : 'error'), 10_000); throw error; },
    ).finally(() => signal?.removeEventListener?.('abort', abort));
  });
  ctx?.on?.('agent/error', ({ agent, turn, error }) => { pendingErrors.set(`${sessionIdOf(agent)}:${turn}`, error); });
  // v1 user preference: subagent completion is intentionally silent. Keep the
  // historical kind schema for stored legacy records, but do not create records
  // or dispatch A/B/C/D for new subagent/end events.
  // Subtask/background completions are the biggest noise source (one record per subagent run and
  // per background job, often titled with the raw command). They are opt-in via `subtaskNotify`.
  const subtasksWanted = () => ({ ...settings, ...preferences.get() }).subtaskNotify === true;
  ctx?.on?.('workflow/end', (info, result) => { if (!subtasksWanted()) return; safely(() => dispatch(reducer.upsert({ kind: 'workflow-end', mergeKey: `wf:${info.id}`, title: info.meta?.name || '工作流结束', body: result.error || result.stopReason, phase: 'settled', outcome: result.stopReason }))); });
  const onJobDone = (snapshot, owner) => {
    if (!subtasksWanted()) return;
    safely(() => dispatch(reducer.upsert({ kind: 'job-end', mergeKey: `job:${snapshot?.id}`, sessionId: snapshot?.ownerSession ?? sessionIdOf(owner), ...jobNotification(snapshot ?? {}), phase: 'settled', outcome: snapshot?.status })));
  };
  /**
   * The job registry is a process-wide service, and this plugin is not the composition that provides
   * it. Registering through `contextService` alone failed silently for a long time — the listener was
   * simply never called, so "notify me when a background job finishes" did nothing — while the web
   * mount right below has always worked because it declares `ctx.inject([...])` and lets Cordis hand
   * it the service. So: inject first (the same seam as webServer/connection), keep the reflective read
   * as the fallback for plain test doubles, and report which one took.
   */
  let jobListenerAttached = false;
  const attachJobs = (registry) => {
    if (jobListenerAttached || typeof registry?.onJobDone !== 'function') return false;
    jobListenerAttached = true;
    registry.onJobDone(onJobDone);
    diagnostics.services.jobs = 'injected';
    return true;
  };
  if (typeof ctx?.inject === 'function') { try { ctx.inject(['jobs'], (jobCtx) => { attachJobs(jobCtx?.jobs); }); } catch { /* no registry in this composition */ } }
  if (!jobListenerAttached) {
    const reflected = contextService(ctx, 'jobs');
    if (attachJobs(reflected)) diagnostics.services.jobs = 'reflected';
  }
  if (!jobListenerAttached) diagnostics.services.jobs = 'unavailable';

  let guiAvailable = false;
  const mountWeb = (lifecycleCtx, webServer, connection) => {
    guiAvailable = true;
    registerSensitive(lifecycleCtx, webServer, connection, '/pull', 'GET', async (req, res) => {
      const url = new URL(req.url, 'http://dsh.invalid');
      const raw = url.searchParams.get('since');
      const since = raw === null ? 0 : Number(raw);
      sendJson(res, 200, buffer.pull({ since }));
    });
    registerSensitive(lifecycleCtx, webServer, connection, '/config', ['GET', 'POST'], async (req, res) => {
      if (req.method === 'GET') { sendJson(res, 200, { ...settings, storage: preferences.status }); return; }
      const { value } = await readJson(req);
      if (schemaStatus(value, SETTING_KEYS) !== 200
        || ('sound' in value && typeof value.sound === 'string' && value.sound.length > 96)) { sendJson(res, 400, { error: 'invalid config' }); return; }
      Object.assign(settings, value);
      preferences.set(pickSettings(value));
      sendJson(res, 200, { ...settings, storage: preferences.status });
    });
    registerSensitive(lifecycleCtx, webServer, connection, '/sounds', ['GET', 'POST'], async (req, res) => {
      if (req.method === 'GET') { sendJson(res, 200, { builtins: BUILTIN_SOUNDS, custom: await sounds.list(), maxBytes: SOUND_BYTES }); return; }
      const name = String(req.headers?.['x-sound-name'] ?? '');
      if (!enforceLimit(req, res, limitSession, 'sounds-upload', 6)) return;
      let bytes;
      try { bytes = await readBody(req, SOUND_BYTES); } catch (error) { sendJson(res, error?.status ?? 400, { error: error?.status === 413 ? 'sound too large' : 'invalid upload' }); return; }
      const stored = await sounds.put(name, bytes);
      if (!stored.ok) { sendJson(res, stored.reason === 'too-large' ? 413 : stored.reason === 'persistence-disabled' ? 503 : 400, { error: stored.reason }); return; }
      sendJson(res, 200, { ok: true, ...stored });
    });
    registerSensitive(lifecycleCtx, webServer, connection, '/sounds/delete', 'POST', async (req, res) => {
      const { value, size } = await readJson(req, 1024);
      const code = validateRequest({ rejection: undefined, originOK: true, bodyBytes: size, fields: value, allowed: ['confirm', 'name'] });
      if (code !== 200 || value.confirm !== true || typeof value.name !== 'string') { sendJson(res, 400, { error: 'invalid delete request' }); return; }
      if (!enforceLimit(req, res, limitSession, 'sounds-delete', 6)) return;
      sendJson(res, 200, { ok: await sounds.remove(value.name) });
    });
    // Serving a sound stays an EXACT route (the project invariant: raw routes are exact objects, so
    // no path parsing can be tricked) with the name carried as a validated query parameter.
    registerSensitive(lifecycleCtx, webServer, connection, '/sound', 'GET', async (req, res) => {
      const name = new URL(String(req.url ?? ''), 'http://localhost').searchParams.get('name') ?? '';
      const sound = await sounds.read(name);
      if (!sound) { res.statusCode = 404; res.end(); return; }
      res.statusCode = 200;
      res.setHeader('content-type', sound.type);
      res.setHeader('cache-control', 'no-store');
      res.end(sound.bytes);
    });
    registerSensitive(lifecycleCtx, webServer, connection, '/health', 'GET', async (_req, res) => sendJson(res, 200, { storage: preferences.status, buffered: buffer.size, guiAvailable, diagnostics }));
    return () => { guiAvailable = false; };
  };
  if (typeof ctx?.inject === 'function') {
    ctx.inject(['webServer', 'connection'], (lifecycleCtx) => mountWeb(lifecycleCtx, Reflect.get(lifecycleCtx, 'webServer'), Reflect.get(lifecycleCtx, 'connection')));
  } else {
    const webServer = contextService(ctx, 'webServer');
    const connection = contextService(ctx, 'connection');
    if (webServer?.register && connection?.requestRejection) mountWeb(ctx, webServer, connection);
  }
  // Cordis plugins may resolve asynchronously, but an async effect must resolve
  // to a disposer (or null), never an arbitrary runtime object. Keep the
  // diagnostics surface on the callable disposer for controlled tests/tools.
  const dispose = () => {};
  return Object.assign(dispose, { buffer, preferences, reducer, diagnostics, guiAvailable, reason: guiAvailable ? undefined : 'authenticated web routes unavailable' });
}
