import test from 'node:test';
import assert from 'node:assert/strict';
import { CLEAR_DEDUPE_POLICY, EventReducer, MemoryDedupe, sanitizeBody, validateRequest } from '../src/core.js';
import { layoutFor, toastPolicy } from '../src/client.js';

test('approval merge uses asked id and request always advances waterfall', () => {
  const r = new EventReducer(() => 1); const a = r.approvalAsked({ id: 'a', title: 'x' }); const b = r.approvalAsked({ id: 'a', title: 'y' }); let next = 0;
  r.approvalRequest(() => next++); assert.equal(a.eventId, b.eventId); assert.equal(next, 1); assert.equal(r.approvalDecided('a').phase, 'settled');
});
test('questions and terminal events bind exact session turn', () => {
  const r = new EventReducer(() => 1); assert.equal(r.question({ sessionId: 's', callId: 'c', intent: { kind: 'plan-review' } }).kind, 'plan-review');
  assert.equal(r.turnEnd({ sessionId: 's', turn: 2, reason: 'blocked' }), null);
  const done = r.turnEnd({ sessionId: 's', turn: 2, reason: 'completed' }); const fail = r.agentError({ sessionId: 's', turn: 2, message: 'bad' });
  assert.equal(done.kind, 'completed'); assert.equal(fail.kind, 'failed'); assert.equal(r.turnEnd({ sessionId: 's', turn: 2, reason: { kind: 'error' } }).eventId, fail.eventId);
});
test('unlinked questions do not use FIFO association and result requires authoritative call id', () => {
  const r = new EventReducer(() => 1);
  const first = r.question({ sessionId: 's', title: 'first' }); const second = r.question({ sessionId: 's', title: 'second' });
  assert.notEqual(first.mergeKey, second.mergeKey); assert.equal(r.questionResult({ sessionId: 's', callId: 'none' }), null);
  assert.equal(first.phase, 'open'); assert.equal(second.phase, 'open');
  assert.equal(r.settleQuestionKey(first.mergeKey, 'error').phase, 'expired'); assert.equal(r.settleQuestionKey(first.mergeKey, 'settled'), null); assert.equal(second.phase, 'open');
  const b = r.question({ sessionId: 's', callId: 'b', title: 'b' }); const a = r.question({ sessionId: 's', callId: 'a', title: 'a' });
  r.questionResult({ sessionId: 's', callId: 'a' }); assert.equal(a.phase, 'settled'); assert.equal(b.phase, 'open');
  assert.equal(r.questionResult({ sessionId: 's', outcome: 'abort' }), null); assert.equal(r.questionResult({ sessionId: 's', callId: 'b', outcome: 'abort' }).phase, 'expired');
});
test('clear dedupe policy is epoch-scoped and reset pulls never deliver historical items', () => {
  assert.equal(CLEAR_DEDUPE_POLICY.scope, 'epoch'); assert.equal(CLEAR_DEDUPE_POLICY.resetPullDelivers, false);
});
test('auth csrf schema and endpoint SSRF safeguards reject unsafe input', () => {
  assert.equal(validateRequest({ authenticated: false, originOK: true }), 401); assert.equal(validateRequest({ authenticated: true, originOK: false }), 403); assert.equal(validateRequest({ authenticated: true, originOK: true, fields: { bad: 1 }, allowed: [] }), 400);
});
test('privacy strips paths and secret-shaped data', () => { const body = sanitizeBody('run /tmp/key token=abc'); assert.match(body, /\[path\]/); assert.match(body, /\[redacted\]/); });
