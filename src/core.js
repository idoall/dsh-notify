export const USER_KINDS = new Set(['approval', 'question', 'plan-review', 'completed', 'failed', 'job-end', 'subagent-end', 'workflow-end']);

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

/**
 * Events become records. The map is memory-only and deliberately small: a record exists so the live
 * delivery can merge an interaction that is asked and then decided into one notification, and so the
 * toast can tell a still-pending question from a settled one. Nothing survives the process, so the
 * oldest settled entries are simply dropped once the map grows past `RECORD_MEMORY`.
 */
export const RECORD_MEMORY = 100;

export class EventReducer {
  #seq = 0;
  constructor(now = () => Date.now()) {
    this.now = now;
    this.records = new Map();
  }
  makeId() { this.#seq += 1; const nonce = globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2); return `nt-${this.now()}-${this.#seq}-${nonce}`; }
  #trim() {
    while (this.records.size > RECORD_MEMORY) {
      let oldest = null;
      for (const record of this.records.values()) {
        if (record.phase === 'open') continue;   // something still waits on the user: never the one dropped
        if (!oldest || record.at < oldest.at) oldest = record;
      }
      if (!oldest) return;                       // every record is pending; keep them all
      this.records.delete(oldest.mergeKey);
    }
  }
  upsert(input) {
    if (!USER_KINDS.has(input.kind) || typeof input.mergeKey !== 'string') return null;
    const existing = this.records.get(input.mergeKey);
    if (existing) {
      // An interrupted turn emits no `approval/decided`, so a replay re-asks an interaction the user
      // already settled. A resolved interaction stays resolved; a replay of it is not news.
      if (existing.phase !== 'open' && (input.phase ?? 'settled') === 'open') return null;
      return Object.assign(existing, input, { eventId: existing.eventId });
    }
    const record = { eventId: this.makeId(), kind: input.kind, mergeKey: input.mergeKey, sessionId: input.sessionId, title: sanitizeBody(input.title || input.kind), body: sanitizeBody(input.body, input.verbosity), at: this.now(), phase: input.phase || 'settled', outcome: input.outcome, deepLink: input.deepLink, ...(Number.isSafeInteger(input.turn) && input.turn > 0 ? { turn: input.turn } : {}) };
    this.records.set(input.mergeKey, record);
    this.#trim();
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
  expireOpenForSession(sessionId, endedTurn = Number.POSITIVE_INFINITY) {
    const expired = [];
    for (const record of this.records.values()) {
      if (record.sessionId !== sessionId || record.phase !== 'open') continue;
      // During a rebuild we only know which turns already ended; a record asked during a later turn
      // (or without a turn) is left alone so a live question is never closed by a restart.
      if (Number.isSafeInteger(record.turn) ? record.turn > endedTurn : endedTurn !== Number.POSITIVE_INFINITY) continue;
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

export function validateRequest({ rejection, authenticated, originOK = true, bodyBytes = 0, limit = 16384, fields = {}, allowed = [] }) {
  if (rejection === undefined && authenticated === false) return 401;
  if (rejection === 401 || rejection === 403) return rejection;
  if (rejection !== undefined) return 403;
  if (!originOK) return 403;
  if (bodyBytes > limit || Object.keys(fields).some((key) => !allowed.includes(key))) return 400;
  return 200;
}

