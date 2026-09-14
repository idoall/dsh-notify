export const USER_KINDS = new Set(['approval', 'question', 'plan-review', 'completed', 'failed', 'job-end', 'subagent-end', 'workflow-end', 'test']);
export function isAOnlyRecord(record) { return record?.kind === 'test' && record?.deliveryScope === 'a-only' && typeof record?.testRunId === 'string'; }
export const CLEAR_DEDUPE_POLICY = Object.freeze({ scope: 'epoch', resetPullDelivers: false, idb: 'retain-and-isolate', host: 'reset-epoch-scope' });
export function deliveryIdentity(epoch, record) { return `${epoch}:${record?.eventId || ''}:${record?.mergeKey || ''}`; }

export function sanitizeBody(body = '', verbosity = 'normal') {
  const text = String(body)
    .replace(/(?:[A-Za-z]:\\|\/)[^\s]+/g, '[path]')
    .replace(/\b(?:token|secret|key|password)\s*[:=]\s*\S+/gi, '[redacted]')
    .replace(/\$\{?\w+\}?/g, '[redacted]');
  return (verbosity === 'detailed' ? text : text.replace(/\s+/g, ' ').slice(0, 120)).slice(0, 240);
}

export function isNotifiableEnd(reason) {
  const kind = typeof reason === 'string' ? reason : reason?.kind;
  return kind === 'completed' || kind === 'error';
}

export class EventReducer {
  #seq = 0;
  constructor(now = () => Date.now(), initial = []) {
    this.now = now;
    this.records = new Map(initial.map((record) => [record.mergeKey, { ...record }]));
  }
  makeId() { this.#seq += 1; const nonce = globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2); return `nt-${this.now()}-${this.#seq}-${nonce}`; }
  upsert(input) {
    if (!USER_KINDS.has(input.kind) || typeof input.mergeKey !== 'string') return null;
    const existing = this.records.get(input.mergeKey);
    if (existing) return Object.assign(existing, input, { eventId: existing.eventId, unread: existing.unread });
    if (input.kind === 'test' && (input.deliveryScope !== 'a-only' || typeof input.testRunId !== 'string')) return null;
    if (input.kind !== 'test' && (input.deliveryScope !== undefined || input.testRunId !== undefined)) return null;
    const record = { eventId: this.makeId(), kind: input.kind, mergeKey: input.mergeKey, sessionId: input.sessionId, title: sanitizeBody(input.title || input.kind), body: sanitizeBody(input.body, input.verbosity), at: this.now(), unread: input.unread ?? true, phase: input.phase || 'settled', outcome: input.outcome, deepLink: input.deepLink, ...(Number.isSafeInteger(input.turn) && input.turn > 0 ? { turn: input.turn } : {}), ...(input.kind === 'test' ? { deliveryScope: 'a-only', testRunId: input.testRunId } : {}) };
    this.records.set(input.mergeKey, record);
    return record;
  }
  approvalAsked(event, sessionId) {
    return this.upsert({ kind: 'approval', mergeKey: `approval:${event.id}`, sessionId, title: '需要审批', body: event.reason || event.toolName, phase: 'open', turn: event.turn });
  }
  approvalRequest(next) { try { /* observation only */ } finally { return next?.(); } }
  approvalDecided(id, outcome) {
    const record = this.records.get(`approval:${id}`);
    if (!record) return null;
    record.phase = outcome === 'unavailable' || outcome === 'cancelled' ? 'expired' : 'settled';
    record.outcome = outcome;
    return record;
  }
  question(event) {
    const kind = event.intent?.kind === 'plan-review' ? 'plan-review' : 'question';
    // callId is authoritative only when supplied by the source event.  Never
    // infer it from same-kind FIFO ordering: concurrent requests can reverse.
    const callId = event.callId || `unlinked:${event.uniqueId || this.makeId()}`;
    return this.upsert({ kind, mergeKey: `question:${event.sessionId}:${callId}`, sessionId: event.sessionId, title: kind === 'plan-review' ? '计划待审' : '需要回复', body: event.title, phase: 'open', turn: event.turn });
  }
  settleQuestionKey(mergeKey, outcome = 'settled') {
    if (typeof mergeKey !== 'string') return null;
    const record = this.records.get(mergeKey);
    if (!record || record.phase !== 'open' || (record.kind !== 'question' && record.kind !== 'plan-review')) return null;
    record.phase = outcome === 'settled' ? 'settled' : 'expired';
    record.outcome = outcome;
    return record;
  }
  questionResult({ sessionId, callId, outcome = 'settled' }) {
    if (!callId) return null;
    return this.settleQuestionKey(`question:${sessionId}:${callId}`, outcome);
  }
  /**
   * At the end of a turn nothing can still be waiting on that session, so any record left open is a
   * leftover whose decision event we never saw. Expiring it here matters: a single stale open record
   * used to shadow every later notification (see the client toast queue).
   */
  expireOpenForSession(sessionId) {
    const expired = [];
    for (const record of this.records.values()) {
      if (record.sessionId !== sessionId || record.phase !== 'open') continue;
      record.phase = 'expired';
      record.outcome = 'expired';
      expired.push(record);
    }
    return expired;
  }
  turnEnd(event) {
    if (event.origin === 'subagent' || !isNotifiableEnd(event.reason)) return null;
    const reason = typeof event.reason === 'string' ? event.reason : event.reason.kind;
    const failed = reason === 'error';
    return this.upsert({ kind: failed ? 'failed' : 'completed', mergeKey: `${failed ? 'fail' : 'turn'}:${event.sessionId}:${event.turn}`, sessionId: event.sessionId, title: failed ? '运行失败' : '任务完成', body: event.body || event.reason?.error?.message, phase: 'settled', outcome: reason, turn: event.turn });
  }
  agentError(event) {
    return this.upsert({ kind: 'failed', mergeKey: `fail:${event.sessionId}:${event.turn}`, sessionId: event.sessionId, title: '运行失败', body: event.message || event.error?.message || String(event.error || ''), phase: 'settled', outcome: 'error', turn: event.turn });
  }
}

/**
 * The plugin ships exactly two notification channels: A (the in-page toast + bell, always on) and B
 * (the optional browser system notification). C (host OS notification) and D (web push) were removed
 * because keeping them correct was a browser x OS x permission x focus matrix with no end, and the
 * failures were invisible to the user. B no longer defers to another channel, so there is no
 * arbitration left to compute here.
 */
export class MemoryDedupe {
  constructor() { this.keys = new Set(); }
  reserve(eventId, recipientId) { const key = `${eventId}:${recipientId}`; if (this.keys.has(key)) return false; this.keys.add(key); return true; }
  release(eventId, recipientId) { this.keys.delete(`${eventId}:${recipientId}`); }
}

export function validateRequest({ rejection, authenticated, originOK = true, bodyBytes = 0, limit = 16384, fields = {}, allowed = [] }) {
  if (rejection === undefined && authenticated === false) return 401;
  if (rejection === 401 || rejection === 403) return rejection;
  if (rejection !== undefined) return 403;
  if (!originOK) return 403;
  if (bodyBytes > limit || Object.keys(fields).some((key) => !allowed.includes(key))) return 400;
  return 200;
}

