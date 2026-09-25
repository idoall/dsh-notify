import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import z from '@deepseek-ai/schemastery';
import { EventReducer, PLAN_REVIEW_FALLBACK, validateRequest } from './core.js';
import { createBuffer, createSettings } from './buffer.js';
import { createSoundLibrary } from './sounds.js';
import { BUILTIN_SOUNDS, SOUND_BYTES } from './sound-choices.js';
import { createUpdateChecker } from './update.js';

export const name = 'dsh-notify';
export const inject = [];
export const Config = z.object({
  dataDir: z.string().description('Absolute path to the profile-owned dsh-notify data directory.'),
  // Compatibility switch for old hosts/tests without `agent/status`; current DSH releases use the
  // authoritative idle transition instead of guessing completion from elapsed time.
  completionGraceMs: z.number().step(1).min(0).max(600_000).default(8_000).description('Legacy fallback for hosts without agent lifecycle status; current DSH releases notify on authoritative idle.'),
});
export { EventReducer, PLAN_REVIEW_FALLBACK, sanitizeBody, validateRequest } from './core.js';
export { createBuffer, createSettings, BUFFER_LIMIT } from './buffer.js';
export { createSoundLibrary } from './sounds.js';
export { BUILTIN_SOUNDS, SOUND_BYTES, parseSoundChoice, validSoundName } from './sound-choices.js';
export { createUpdateChecker, compareVersions, isNewer, parseVersion, PACKAGE_NAME, REGISTRY_LATEST_URL } from './update.js';

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
const DEFAULT_SETTINGS = Object.freeze({ verbosity: 'normal', toastPosition: 'conversation', toastEnabled: true, notificationStyle: 'strong', stackCollapsed: true, subtaskNotify: false, soundEnabled: true, sound: 'chime' });
const SETTING_KEYS = Object.freeze(Object.keys(DEFAULT_SETTINGS));
/**
 * Only the settings this version knows about are adopted — or written back. A file left by an older
 * version must not smuggle its own shape into the config, and a request must not add keys that the
 * plugin would then hand straight back to the page.
 */
const pickSettings = (value = {}) => Object.fromEntries(Object.entries(value ?? {}).filter(([key]) => SETTING_KEYS.includes(key)));
function validSettingsPatch(value = {}) {
  if ('notificationStyle' in value && !['strong', 'soft'].includes(value.notificationStyle)) return false;
  if ('stackCollapsed' in value && typeof value.stackCollapsed !== 'boolean') return false;
  if ('toastEnabled' in value && typeof value.toastEnabled !== 'boolean') return false;
  if ('subtaskNotify' in value && typeof value.subtaskNotify !== 'boolean') return false;
  if ('soundEnabled' in value && typeof value.soundEnabled !== 'boolean') return false;
  if ('verbosity' in value && !['normal', 'detailed'].includes(value.verbosity)) return false;
  if ('toastPosition' in value && !['conversation', 'viewport', 'off'].includes(value.toastPosition)) return false;
  if ('sound' in value && (typeof value.sound !== 'string' || value.sound.length > 96)) return false;
  return true;
}
function normalizeSettings(value = {}) {
  const picked = pickSettings(value);
  return Object.fromEntries(Object.entries(picked).filter(([key, setting]) => validSettingsPatch({ [key]: setting })));
}

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
/**
 * Read this plugin's own version for the update check. A missing package.json only means the version
 * chip cannot compare — it must never stop the plugin from loading.
 */
async function readPackageVersion() {
  try {
    const parsed = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
    return typeof parsed?.version === 'string' && parsed.version !== '' ? parsed.version : '0.0.0';
  } catch { return '0.0.0'; }
}

export async function apply(ctx, config = {}) {
  // No store, no history: the buffer holds what has not been delivered yet, and preferences are the
  // only thing that outlives the process.
  const buffer = createBuffer();
  const preferences = createSettings({ dataDir: config.dataDir, keys: SETTING_KEYS });
  const settings = { ...DEFAULT_SETTINGS, ...normalizeSettings(preferences.get()) };
  const reducer = new EventReducer(() => Date.now());
  const diagnostics = { eventErrors: 0, services: {} };
  const sounds = createSoundLibrary({ dataDir: config.dataDir });
  // Online version detection: read-only and cached. `currentVersion`/`updateFetch`/`updateTtlMs` are
  // test seams, exactly like `config.now` above — the shipped profile passes none of them.
  const updates = createUpdateChecker({
    currentVersion: typeof config.currentVersion === 'string' ? config.currentVersion : await readPackageVersion(),
    fetchImpl: config.updateFetch,
    now: config.now,
    ttlMs: config.updateTtlMs,
    log: (message) => { try { ctx?.logger?.debug?.(message); } catch { /* logging is never load-bearing */ } },
  });
  // Tool call IDs remain available for authoritative replay/result handling.
  // A live user-questions/request has no source-proven causal callId, therefore
  // this host must not infer one from an arrival queue or FIFO ordering.
  const pendingToolCalls = new Map();
  // Plan reviews and execution approvals are control gates: their idle pause is not task completion.
  // An ordinary question can instead be the last operation of a task, so retain its kind and allow that
  // directly-settled turn to announce completion once native DSH reaches idle.
  const interactiveTurns = new Map();
  const markInteractiveTurn = (sessionId, turn, kind = 'question') => {
    if (!Number.isSafeInteger(turn) || turn <= 0) return;
    let turns = interactiveTurns.get(sessionId);
    if (!turns) { turns = new Map(); interactiveTurns.set(sessionId, turns); }
    turns.set(turn, kind);
  };
  const consumeInteractiveTurn = (sessionId, turn) => {
    const turns = interactiveTurns.get(sessionId);
    if (!turns || !turns.has(turn)) return undefined;
    const kind = turns.get(turn);
    turns.delete(turn);
    if (!turns.size) interactiveTurns.delete(sessionId);
    return kind;
  };
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
   * A turn boundary only says that one response has ended. DSH's native sidebar stays busy until the
   * owning Agent enters `idle`; that lifecycle transition is the authority for a completed task. The
   * old elapsed-time heuristic could disagree with the spinner and, worse, leave a goal-held candidate
   * stranded forever. Keep the timer solely as a compatibility fallback for pre-lifecycle hosts.
   */
  const completionGraceMs = Number.isSafeInteger(config.completionGraceMs) ? config.completionGraceMs : 8_000;
  const deferredCompletions = new Map();   // sessionId -> { payload, timer }
  const engagedGoals = new Set();          // only used for a legacy host without agent/status
  const agentStatuses = new Map();         // sessionId -> 'idle' | 'running'
  const statusCapable = new Set();         // sessions for which the Host has emitted agent/status
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
    // Current DSH: wait for exactly the same idle state that clears the native sidebar spinner.
    if (statusCapable.has(sessionId)) {
      deferredCompletions.set(sessionId, { payload, timer: null });
      if (agentStatuses.get(sessionId) === 'idle') void flushCompletion(sessionId).catch(() => { diagnostics.eventErrors += 1; });
      return;
    }
    // Legacy DSH has no status lifecycle: retain the old grace behaviour as a safe fallback.
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
    if (name === 'exit_plan_mode') return PLAN_REVIEW_FALLBACK;
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

  // `agent/status: idle` is the public DSH signal that no driver remains scheduled or active. It
  // matches the native session spinner, so completion Toasts cannot precede the sidebar state.
  ctx?.on?.('agent/status', ({ agent, status } = {}) => {
    const sessionId = sessionIdOf(agent);
    if (typeof sessionId !== 'string' || sessionId === '') return;
    if (status !== 'idle' && status !== 'running') return;
    statusCapable.add(sessionId);
    agentStatuses.set(sessionId, status);
    if (status === 'running') { cancelCompletion(sessionId); return; }
    // Re-check the status when the deferred flush actually runs. Every `session/event` is handled
    // through `safely` too, so a synchronous `idle -> running` flap — DSH resumes queued work in the
    // same stack right after the idle transition — queues this flush BEFORE the turn/end handler has
    // registered its candidate. The flush would then find that candidate and announce a task that
    // never stopped, because the `running` that cancelled it had already run. Reading the current
    // status here is what makes that cancellation win, with no debounce window and no added latency.
    safely(() => { if (agentStatuses.get(sessionId) === 'idle') return flushCompletion(sessionId); });
  });

  ctx?.on?.('session/event', (session, event) => {
    const data = event?.data ?? {};
    const sessionId = session?.id;
    if (Number.isSafeInteger(data.turn) && data.turn > 0) liveTurns.set(sessionId, data.turn);
    if (event?.type === 'tool/call' && data.callId && (data.name === 'ask_user_question' || data.name === 'exit_plan_mode')) {
      markInteractiveTurn(sessionId, turnOf(sessionId, data), data.name === 'exit_plan_mode' ? 'plan-review' : 'question');
      pendingFor(sessionId).add(data.callId);
      const interaction = reducer.question({ sessionId, callId: data.callId, intent: data.name === 'exit_plan_mode' ? { kind: 'plan-review' } : undefined, title: interactionBody(data.name, data.arguments), turn: turnOf(sessionId, data) });
      safely(() => dispatch(interaction));
      return;
    }
    if (event?.type === 'tool/result') {
      // DSH 0.1.7 flattened the tool result onto the tool-role message (`message.toolCallId` and
      // `message.isError`); the nested `tool-result` content block this used to read is gone. The message
      // is the authoritative shape, and the old nested block stays only as a fallback so an older host
      // keeps settling its interactions.
      const message = data.message ?? {};
      const nested = message.content?.find?.((block) => block?.type === 'tool-result');
      const callId = message.toolCallId ?? nested?.toolCallId;
      if (!callId) return; // Unlinked records cannot be guessed closed by an uncorrelated result.
      removePending(sessionId, callId);
      const failed = message.isError === true || nested?.isError === true || data.outcome === 'abort';
      const existing = reducer.questionResult({ sessionId, callId, outcome: failed ? 'abort' : 'settled' });
      if (existing) safely(() => dispatch(existing));
      return;
    }
    safely(async () => {
      // Work resumed: whatever turn end is still pending for this session was not the end of the task.
      if (event?.type === 'turn/start' || event?.type === 'tool/call') cancelCompletion(sessionId);
      if (event?.type === 'approval/asked') {
         markInteractiveTurn(sessionId, turnOf(sessionId, data), 'approval');
         await dispatch(reducer.approvalAsked({ ...data, turn: turnOf(sessionId, data) }, sessionId));
      } else if (event?.type === 'approval/decided') await dispatch(reducer.approvalDecided(data.id, data.outcome));
      else if (event?.type === 'turn/end') {
        const error = pendingErrors.get(`${sessionId}:${data.turn}`);
        pendingErrors.delete(`${sessionId}:${data.turn}`);
        // A turn just ended, so nothing can still be waiting on this session: a record left open is a
        // leftover whose decision event was never observed, and one leftover used to shadow every
        // later toast. Persist the expiry before the completion notification.
        for (const stale of reducer.expireOpenForSession(sessionId)) await dispatch(stale);
        // Plan reviews and execution approvals are intermediate native-idle control gates. An ordinary
         // question may directly finish the task after the user answers, so only the gates are suppressed.
         const interactionKind = consumeInteractiveTurn(sessionId, data.turn);
         if (interactionKind !== 'plan-review' && interactionKind !== 'approval') {
           deferCompletion(sessionId, { sessionId, turn: data.turn, reason: data.reason, body: error?.message || String(error || ''), origin: originOf(session) });
         }
      }
    });
  });
  // A reopened session replays its history, and this plugin used to rebuild still-open interactions
  // from that snapshot to keep the sidebar badge honest. There is no badge and no history any more:
  // the past is not news, so a rebuild would only re-announce an approval the user can already see in
  // the DSH UI, and it would do it on every session open.
  ctx?.on?.('approval/request', (request, next) => { try { /* live reason is non-authoritative */ } catch { diagnostics.eventErrors += 1; } return next(); });
  // Older Hosts may not publish agent/status. Keep goal awareness only for that legacy fallback;
  // lifecycle-capable Hosts flush on native `idle`, not when a separate goal bookkeeping event arrives.
  ctx?.on?.('goal/activation-changed', (payload) => safely(async () => {
    const sessionId = sessionIdOf(payload?.sessionId) ?? payload?.sessionId;
    if (typeof sessionId !== 'string' || sessionId === '' || statusCapable.has(sessionId)) return;
    if (payload?.goal) {
      engagedGoals.add(sessionId);
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
  /**
   * A failure is announced when DSH reports it, not when a later `turn/end` happens to arrive.
   * `turn/end` was the only path before, so a failure whose turn never ended was never announced at
   * all. The immediate record and the one `turn/end` derives (reason `error`) share the mergeKey
   * `fail:<session>:<turn>`, so the second arrival updates the same card instead of adding one — and
   * the error message is still carried onto that update through `pendingErrors`.
   *
   * A subtask failure stays as quiet as a subtask completion: `turn/end` already skips subagents.
   */
  ctx?.on?.('agent/error', ({ agent, turn, error }) => {
    const sessionId = sessionIdOf(agent);
    if (typeof sessionId !== 'string' || sessionId === '') return;
    pendingErrors.set(`${sessionId}:${turn}`, error);
    if (originOf(agent?.session) === 'subagent') return;
    safely(() => dispatch(reducer.agentError({ sessionId, turn, error: error ?? '', message: error?.message })));
  });
  // v1 user preference: subagent completion is intentionally silent. Keep the
  // historical kind schema for stored legacy records, but do not create records
  // or dispatch A/B/C/D for new subagent/end events.
  // Subtask/background completions are the biggest noise source (one record per subagent run and
  // per background job, often titled with the raw command). They are opt-in via `subtaskNotify`.
  const subtasksWanted = () => ({ ...settings, ...preferences.get() }).subtaskNotify === true;
  /**
   * Which session a workflow run belongs to.
   *
   * `workflow/end` cannot say. The engine emits it from its own unscoped context and the payload is
   * `{id, meta}` only, so a 工作流结束 card shipped with no session at all and could never jump anywhere —
   * the one kind that was not clickable. The session is in the log instead: `dsh-tool-workflow` appends
   * `tool-workflow/run-start {runId, name}` to the parent Session before the run begins, and every append
   * reaches `session/event`. So the owner is learned from the log and remembered for the `workflow/end`
   * that follows. The entry is dropped when it is consumed, and the map is capped so a run that never
   * ends cannot grow it forever; nothing depends on which of the two events lands first.
   */
  const workflowOwners = new Map();
  const WORKFLOW_OWNER_LIMIT = 50;
  ctx?.on?.('session/event', (session, event) => {
    const sessionId = session?.id; const runId = event?.data?.runId;
    if (event?.type !== 'tool-workflow/run-start' || typeof sessionId !== 'string' || typeof runId !== 'string') return;
    workflowOwners.delete(runId);
    workflowOwners.set(runId, sessionId);
    while (workflowOwners.size > WORKFLOW_OWNER_LIMIT) workflowOwners.delete(workflowOwners.keys().next().value);
  });
  ctx?.on?.('workflow/end', (info, result) => {
    if (!subtasksWanted()) return;
    const sessionId = workflowOwners.get(info.id);
    workflowOwners.delete(info.id);
    safely(() => dispatch(reducer.upsert({ kind: 'workflow-end', mergeKey: `wf:${info.id}`, ...(sessionId ? { sessionId } : {}), title: info.meta?.name || '工作流结束', body: result.error || result.stopReason, phase: 'settled', outcome: result.stopReason })));
  });
  /**
   * One settled job becomes one card. DSH 0.1.7 consolidated the registry into a single event stream whose
   * terminal event is `settled`, and a settlement that released a live waiter was already handed to that
   * caller, so only the unawaited ones are news for a human. The older `onJobDone` listener, which delivered
   * the terminal snapshot with its owning Agent, is kept for a host that still has it.
   */
  const onJobSettled = (job) => {
    if (!subtasksWanted() || !job) return;
    if (job.status === 'running' || job.status === 'stopping') return;
    safely(() => dispatch(reducer.upsert({ kind: 'job-end', mergeKey: `job:${job.id}`, ...(typeof job.owner === 'string' && job.owner !== '' ? { sessionId: job.owner } : {}), ...jobNotification(job), phase: 'settled', outcome: job.status })));
  };
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
    if (jobListenerAttached) return false;
    // Current DSH: one lifecycle stream, subscribed with an explicit owner filter. This plugin observes
    // every owner because a profile-level mount is the only composition that can see all sessions.
    if (typeof registry?.events?.subscribe === 'function') {
      jobListenerAttached = true;
      registry.events.subscribe({ owners: 'all' }, (event) => {
        if (event?.type !== 'settled' || event.awaited === true) return;
        onJobSettled(event.job);
      });
      diagnostics.services.jobs = 'events';
      return true;
    }
    if (typeof registry?.onJobDone !== 'function') return false;
    jobListenerAttached = true;
    registry.onJobDone(onJobDone);
    diagnostics.services.jobs = 'onJobDone';
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
      if (schemaStatus(value, SETTING_KEYS) !== 200 || !validSettingsPatch(value)) { sendJson(res, 400, { error: 'invalid config' }); return; }
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
    /**
     * Online version detection. Read-only: it reports what npm has, and the settings page offers a
     * copyable command. This host never installs anything and never restarts dsh.
     */
    registerSensitive(lifecycleCtx, webServer, connection, '/update', 'GET', async (req, res) => {
      const url = new URL(String(req.url ?? ''), 'http://dsh.invalid');
      const status = await updates.check({ force: url.searchParams.get('force') === '1' });
      sendJson(res, 200, { ok: true, ...status });
    });
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
  return Object.assign(dispose, { buffer, preferences, reducer, diagnostics, updates, guiAvailable, reason: guiAvailable ? undefined : 'authenticated web routes unavailable' });
}
