import { createHash, randomBytes } from 'node:crypto';
import z from '@deepseek-ai/schemastery';
import { EventReducer, validateRequest } from './core.js';
import { createStore } from './storage.js';
import { createSoundLibrary } from './sounds.js';
import { BUILTIN_SOUNDS, SOUND_BYTES } from './sound-choices.js';

export const name = 'dsh-notify';
export const inject = [];
export const Config = z.object({
  dataDir: z.string().description('Absolute path to the profile-owned dsh-notify data directory.'),
});
export { EventReducer, MemoryDedupe, sanitizeBody, validateRequest } from './core.js';
export { createStore } from './storage.js';
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
const DEFAULT_SETTINGS = Object.freeze({ verbosity: 'normal', toastPosition: 'conversation', toastEnabled: true, subtaskNotify: false, soundEnabled: true, sound: 'chime', readRetentionDays: 0 });
const validSessionId = (value) => typeof value === 'string' && value.length > 0 && value.length <= 256 && /^[A-Za-z0-9._:-]+$/.test(value);

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
function requestHash(value) {
  const sorted = Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)));
  return digest(JSON.stringify(sorted));
}
const opaqueId = (prefix) => `${prefix}-${randomBytes(24).toString('base64url')}`;
const validTestRunId = (value, dimension) => typeof value === 'string' && value.startsWith(`self-test:${dimension}:`) && value.length <= 256 && /^[A-Za-z0-9:_-]+$/.test(value);
function selfTestBody(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.confirm !== true
    || !['a-history', 'navigation', 'persistence-roundtrip'].includes(value.dimension)
    || !validTestRunId(value.testRunId, value.dimension)) return false;
  const allowed = value.dimension === 'navigation' ? ['dimension', 'confirm', 'testRunId', 'sessionId'] : ['dimension', 'confirm', 'testRunId'];
  if (schemaStatus(value, allowed) !== 200 || Object.keys(value).length !== allowed.length) return false;
  return value.dimension !== 'navigation' || validSessionId(value.sessionId);
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
  const store = await createStore({ dataDir: config.dataDir });
  const settings = { ...DEFAULT_SETTINGS, ...store.getSettings() };
  const reducer = new EventReducer(() => Date.now(), store.getRecords());
  const diagnostics = { eventErrors: 0 };
  const sounds = createSoundLibrary({ dataDir: store.enabled ? config.dataDir : undefined });
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

  const dispatch = async (record, { historical = false } = {}) => {
    if (!record) return null;
    await store.putRecord(record);
    ctx?.emit?.('dsh-notify/record', record);
    return record;
  };
  const safely = (work) => { Promise.resolve().then(work).catch(() => { diagnostics.eventErrors += 1; }); };
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
  /** Yield to the event loop so a long rebuild cannot starve HTTP handling. */
  const yieldToHost = () => new Promise((resolve) => setTimeout(resolve, 0));

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

  ctx?.on?.('session/event', (session, event) => {
    const data = event?.data ?? {};
    const sessionId = session?.id;
    if (event?.type === 'tool/call' && data.callId && (data.name === 'ask_user_question' || data.name === 'exit_plan_mode')) {
      pendingFor(sessionId).add(data.callId);
      const interaction = reducer.question({ sessionId, callId: data.callId, intent: data.name === 'exit_plan_mode' ? { kind: 'plan-review' } : undefined, title: interactionBody(data.name, data.arguments), turn: data.turn });
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
      if (event?.type === 'approval/asked') await dispatch(reducer.approvalAsked(data, sessionId));
      else if (event?.type === 'approval/decided') await dispatch(reducer.approvalDecided(data.id, data.outcome));
      else if (event?.type === 'turn/end') {
        const error = pendingErrors.get(`${sessionId}:${data.turn}`);
        pendingErrors.delete(`${sessionId}:${data.turn}`);
        // A turn just ended, so nothing can still be waiting on this session: a record left open is a
        // leftover whose decision event was never observed, and one leftover used to shadow every
        // later toast. Persist the expiry before the completion notification.
        for (const stale of reducer.expireOpenForSession(sessionId)) await dispatch(stale);
        await dispatch(reducer.turnEnd({ sessionId, turn: data.turn, reason: data.reason, body: error?.message || String(error || ''), origin: originOf(session) }));
      }
    });
  });
  ctx?.on?.('session/created', (session) => safely(() => bounded(async () => {
    const openCalls = new Map();
    let seen = 0;
    for (const event of session?.snapshotEvents?.() ?? []) {
      seen += 1;
      // Long histories are the normal case here; yield periodically so the host keeps serving.
      if (seen % 400 === 0) await yieldToHost();
      const data = event?.data ?? {};
      if (event?.type === 'approval/asked') await dispatch(reducer.approvalAsked(data, session.id), { historical: true });
      else if (event?.type === 'approval/decided') await dispatch(reducer.approvalDecided(data.id, data.outcome), { historical: true });
      else if (event?.type === 'tool/call' && (data.name === 'ask_user_question' || data.name === 'exit_plan_mode')) openCalls.set(data.callId, { name: data.name, arguments: data.arguments, turn: data.turn });
      else if (event?.type === 'tool/result') {
        const callId = data.message?.content?.find?.((block) => block?.type === 'tool-result')?.toolCallId;
        if (callId) openCalls.delete(callId);
      }
    }
    for (const [callId, call] of openCalls) await dispatch(reducer.question({ sessionId: session.id, callId, intent: call.name === 'exit_plan_mode' ? { kind: 'plan-review' } : undefined, title: interactionBody(call.name, call.arguments), turn: call.turn }), { historical: true });
  })));
  ctx?.on?.('approval/request', (request, next) => { try { /* live reason is non-authoritative */ } catch { diagnostics.eventErrors += 1; } return next(); });
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
      record = reducer.question({ sessionId, intent: wantsPlan ? { kind: 'plan-review' } : undefined, title });
      opening = Promise.resolve(dispatch(record)).catch(() => { diagnostics.eventErrors += 1; });
    } catch { diagnostics.eventErrors += 1; }
    const settle = (outcome) => {
      if (settlement) return settlement;
      const closed = record && reducer.settleQuestionKey(record.mergeKey, outcome);
      settlement = opening.then(() => closed ? dispatch(closed, { historical: true }) : undefined).catch(() => { diagnostics.eventErrors += 1; });
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
  const subtasksWanted = () => ({ ...settings, ...store.getSettings() }).subtaskNotify === true;
  ctx?.on?.('workflow/end', (info, result) => { if (!subtasksWanted()) return; safely(() => dispatch(reducer.upsert({ kind: 'workflow-end', mergeKey: `wf:${info.id}`, title: info.meta?.name || '工作流结束', body: result.error || result.stopReason, phase: 'settled', outcome: result.stopReason }))); });
  const jobs = contextService(ctx, 'jobs');
  jobs?.onJobDone?.((snapshot, owner) => { if (!subtasksWanted()) return; safely(() => dispatch(reducer.upsert({ kind: 'job-end', mergeKey: `job:${snapshot.id}`, sessionId: snapshot.ownerSession ?? sessionIdOf(owner), ...jobNotification(snapshot), phase: 'settled', outcome: snapshot.status }))); });

  let guiAvailable = false;
  const mountWeb = (lifecycleCtx, webServer, connection) => {
    guiAvailable = true;
    registerSensitive(lifecycleCtx, webServer, connection, '/pull', 'GET', async (req, res) => {
      const url = new URL(req.url, 'http://dsh.invalid');
      const cursor = Number(url.searchParams.get('cursor') ?? 0);
      const epochValue = url.searchParams.get('epoch');
      const epoch = epochValue === null ? undefined : Number(epochValue);
      sendJson(res, 200, store.pull({ epoch, cursor }));
    });
    registerSensitive(lifecycleCtx, webServer, connection, '/open', 'GET', async (req, res) => {
      const url = new URL(req.url, 'http://dsh.invalid');
      const sessionId = url.searchParams.get('sessionId');
      res.statusCode = 302;
      res.setHeader('location', validSessionId(sessionId) ? `/?sessionId=${encodeURIComponent(sessionId)}` : '/');
      res.setHeader('cache-control', 'no-store');
      res.end();
    });
    registerSensitive(lifecycleCtx, webServer, connection, '/ack', 'POST', async (req, res) => {
      const { value, size } = await readJson(req);
      const code = validateRequest({ rejection: undefined, originOK: true, bodyBytes: size, fields: value, allowed: ['eventId'] });
      if (code !== 200 || typeof value.eventId !== 'string') { sendJson(res, 400, { error: 'invalid body' }); return; }
      sendJson(res, 200, { ok: await store.ack(value.eventId) });
    });
    registerSensitive(lifecycleCtx, webServer, connection, '/clear', 'POST', async (req, res) => {
      const { value, size } = await readJson(req, 1024);
      const code = validateRequest({ rejection: undefined, originOK: true, bodyBytes: size, fields: value, allowed: ['confirm'] });
      if (code !== 200 || value.confirm !== true) { sendJson(res, 400, { error: 'explicit confirmation required' }); return; }
      if (!enforceLimit(req, res, limitSession, 'clear', 3)) return;
      if (!store.enabled) { sendJson(res, 503, { error: 'persistence unavailable' }); return; }
      const cleared = await store.clearRecords();
      reducer.records.clear();
      sendJson(res, 200, { ok: true, epoch: cleared.epoch, cursor: cleared.cursor, reset: true, items: [] });
    });
    registerSensitive(lifecycleCtx, webServer, connection, '/delete', 'POST', async (req, res) => {
      const { value, size } = await readJson(req, 8192);
      const code = validateRequest({ rejection: undefined, originOK: true, bodyBytes: size, fields: value, allowed: ['confirm', 'eventIds'] });
      if (code !== 200 || value.confirm !== true || !Array.isArray(value.eventIds) || value.eventIds.length === 0
        || value.eventIds.length > 50 || !value.eventIds.every((id) => typeof id === 'string' && id.length > 0 && id.length <= 256)) { sendJson(res, 400, { error: 'invalid delete request' }); return; }
      if (!enforceLimit(req, res, limitSession, 'delete', 6)) return;
      if (!store.enabled) { sendJson(res, 503, { error: 'persistence unavailable' }); return; }
      const dropped = new Set(value.eventIds);
      const result = await store.deleteRecords(value.eventIds);
      reducer.records.clear();
      for (const record of store.getRecords()) reducer.records.set(record.mergeKey, record);
      sendJson(res, 200, { ok: true, reset: true, epoch: result.epoch, cursor: 0, removed: result.removed, requested: dropped.size, items: result.items });
    });
    registerSensitive(lifecycleCtx, webServer, connection, '/config', ['GET', 'POST'], async (req, res) => {
      if (req.method === 'GET') { sendJson(res, 200, { ...settings, ...store.getSettings(), persist: store.status }); return; }
      const { value } = await readJson(req);
      if (schemaStatus(value, ['verbosity', 'toastPosition', 'toastEnabled', 'subtaskNotify', 'soundEnabled', 'sound', 'readRetentionDays']) !== 200
        || ('readRetentionDays' in value && (!Number.isSafeInteger(value.readRetentionDays) || value.readRetentionDays < 0 || value.readRetentionDays > 365))
        || ('sound' in value && typeof value.sound === 'string' && value.sound.length > 96)) { sendJson(res, 400, { error: 'invalid config' }); return; }
      Object.assign(settings, value);
      sendJson(res, 200, await store.setSettings(settings));
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
    registerSensitive(lifecycleCtx, webServer, connection, '/self-test/preflight', 'GET', async (_req, res) => {
      sendJson(res, 200, { persist: store.status });
    });
    registerSensitive(lifecycleCtx, webServer, connection, '/self-test', 'POST', async (req, res) => {
      const { value } = await readJson(req);
      if (!selfTestBody(value)) { sendJson(res, 400, { error: 'invalid self-test request' }); return; }
      if (!enforceLimit(req, res, limitSession, `self-test:${value.dimension}`, 3)) return;
      const ownerHash = requestOwnerHash(req);
      const safeRequest = { ...value };
      const reservation = await store.reserveSelfTestRun({ testRunId: value.testRunId, ownerHash, dimension: value.dimension, requestHash: requestHash(safeRequest) });
      if (!reservation.ok) {
        if (reservation.reason === 'finished') { sendJson(res, 200, reservation.run.result); return; }
        sendJson(res, 409, { testRunId: value.testRunId, dimension: value.dimension, status: reservation.reason === 'active' ? 'untested' : 'failed', reason: reservation.reason === 'active' ? 'previous-attempt-uncertain' : reservation.reason, submittedAt: reservation.run?.reservedAt ?? Date.now() }); return;
      }
      const submittedAt = Date.now(); let result;
      if (value.dimension === 'persistence-roundtrip') {
        const probe = await store.persistenceProbe({ testRunId: value.testRunId, nonce: opaqueId('probe') });
        result = { testRunId: value.testRunId, dimension: value.dimension, status: probe.ok && probe.cleaned ? 'passed' : 'failed', reason: probe.ok && probe.cleaned ? 'self-test namespace write/read/delete passed' : 'persistence probe failed', submittedAt };
      } else {
        const record = reducer.upsert({ kind: 'test', mergeKey: `test:${value.testRunId}`, sessionId: value.sessionId, title: value.dimension === 'navigation' ? '自测：导航与未读' : '自测：页内历史', body: '仅验证页内历史，不会发送系统通知', phase: 'settled', deliveryScope: 'a-only', testRunId: value.testRunId });
        await dispatch(record);
        result = { testRunId: value.testRunId, dimension: value.dimension, status: 'passed', reason: 'a-only record stored for pull', submittedAt };
      }
      await store.finishSelfTestRun(value.testRunId, reservation.run.reservationId, result, Date.now());
      sendJson(res, 200, result);
    });
    registerSensitive(lifecycleCtx, webServer, connection, '/self-test/cleanup', 'POST', async (req, res) => {
      const { value } = await readJson(req);
      if (schemaStatus(value, ['confirm', 'testRunId']) !== 200 || Object.keys(value).length !== 2 || value.confirm !== true || typeof value.testRunId !== 'string' || !/^self-test:[a-z-]+:[A-Za-z0-9_-]+$/.test(value.testRunId)) { sendJson(res, 400, { error: 'invalid cleanup request' }); return; }
      if (!enforceLimit(req, res, limitSession, 'self-test-cleanup', 6)) return;
      const run = store.getTestRun(value.testRunId); if (!run || run.ownerHash !== requestOwnerHash(req)) { sendJson(res, 403, { error: 'self-test ownership required' }); return; }
      const cleared = await store.clearTestRecords(value.testRunId);
      if (cleared.removed) reducer.records.clear();
      sendJson(res, 200, { ok: true, ...cleared });
    });
    registerSensitive(lifecycleCtx, webServer, connection, '/test', 'POST', async (_req, res) => sendJson(res, 410, { error: 'legacy self-test endpoint closed' }));
    registerSensitive(lifecycleCtx, webServer, connection, '/health', 'GET', async (_req, res) => sendJson(res, 200, { persist: store.status, guiAvailable, diagnostics }));
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
  return Object.assign(dispose, { store, reducer, diagnostics, guiAvailable, reason: guiAvailable ? undefined : 'authenticated web routes unavailable' });
}
