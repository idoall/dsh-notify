import test from 'node:test';
import assert from 'node:assert/strict';
import { EventReducer, PLAN_REVIEW_FALLBACK, RECORD_MEMORY, sanitizeBody, validateRequest } from '../src/core.js';

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
test('a tool/call and its unlinked waterfall are one card, not two', () => {
  const r = new EventReducer(() => 1);
  const linked = r.question({ sessionId: 's', callId: 'call-plan', intent: { kind: 'plan-review' }, title: PLAN_REVIEW_FALLBACK, turn: 3 });
  const waterfall = r.question({ sessionId: 's', intent: { kind: 'plan-review' }, title: 'Approve this plan and leave plan mode?' });
  assert.equal(waterfall, linked);
  assert.equal(linked.eventId, waterfall.eventId);
  assert.equal(r.records.size, 1);
  assert.equal(linked.mergeKey, 'question:s:call-plan');
  assert.equal(linked.body, 'Approve this plan and leave plan mode?', 'the real question replaces the exit_plan_mode fallback');
  assert.equal(linked.turn, 3, 'the tool/call turn survives the waterfall, which has none');
  assert.equal(r.questionResult({ sessionId: 's', callId: 'call-plan' }).phase, 'settled');

  const unlinkedFirst = r.question({ sessionId: 's2', intent: { kind: 'plan-review' }, title: 'Approve this plan and leave plan mode?' });
  const lateCall = r.question({ sessionId: 's2', callId: 'call-late', intent: { kind: 'plan-review' }, title: PLAN_REVIEW_FALLBACK });
  assert.equal(lateCall, unlinkedFirst);
  assert.equal(lateCall.mergeKey, 'question:s2:call-late');
  assert.equal(lateCall.body, 'Approve this plan and leave plan mode?', 'the fallback must not clobber the question the waterfall already had');
  assert.equal(r.questionResult({ sessionId: 's2', callId: 'call-late' }).phase, 'settled');

  const ask = r.question({ sessionId: 's3', callId: 'q1', title: '通道范围：怎么处理？' });
  const askWaterfall = r.question({ sessionId: 's3', title: '通道范围：怎么处理？' });
  assert.equal(askWaterfall.eventId, ask.eventId);
  assert.equal(ask.mergeKey, 'question:s3:q1');

  const question = r.question({ sessionId: 's4', callId: 'q2', title: 'Continue?' });
  const plan = r.question({ sessionId: 's4', callId: 'p2', intent: { kind: 'plan-review' }, title: PLAN_REVIEW_FALLBACK });
  assert.notEqual(question.mergeKey, plan.mergeKey, 'a question and a plan review in the same session stay two cards');

  const first = r.question({ sessionId: 's5', title: 'first' });
  const second = r.question({ sessionId: 's5', title: 'second' });
  const third = r.question({ sessionId: 's5', callId: 'c5', title: 'third' });
  assert.notEqual(third.mergeKey, first.mergeKey);
  assert.notEqual(third.mergeKey, second.mergeKey);
  assert.equal(third.mergeKey, 'question:s5:c5', 'two open unlinked records are ambiguous: a later callId must not guess');
});
test('a replayed ask leaves a resolved interaction resolved', () => {
  const r = new EventReducer(() => 1);
  const settled = r.approvalAsked({ id: 'a', toolName: 'Bash' }, 's');
  assert.equal(settled.phase, 'open');
  r.approvalDecided('a', 'allowed-once');
  assert.equal(r.approvalAsked({ id: 'a', toolName: 'Bash' }, 's'), null, 'a settled approval is not resurrected');
  assert.equal(settled.phase, 'settled');
  const expired = r.approvalAsked({ id: 'b', toolName: 'Bash' }, 's');
  r.expireOpenForSession('s');
  assert.equal(expired.phase, 'expired');
  assert.equal(r.approvalAsked({ id: 'b', toolName: 'Bash' }, 's'), null, 'an expired approval is not resurrected');
  // A still-open ask keeps its identity and takes the newest payload.
  const live = r.approvalAsked({ id: 'c', toolName: 'Bash' }, 's');
  const again = r.approvalAsked({ id: 'c', toolName: 'Read' }, 's');
  assert.equal(again, live); assert.equal(again.eventId, live.eventId); assert.equal(again.body, 'Read'); assert.equal(again.phase, 'open');
});
test('the in-memory record map is bounded and never drops something that still waits on the user', () => {
  let clock = 0;
  const r = new EventReducer(() => (clock += 1));
  const pending = r.question({ sessionId: 's', callId: 'keep-me', title: 'still asking' });
  for (let n = 0; n < RECORD_MEMORY + 20; n += 1) r.turnEnd({ sessionId: 's', turn: n + 1, reason: 'completed' });
  assert.ok(r.records.size <= RECORD_MEMORY + 1, `bounded: ${r.records.size}`);
  assert.equal(r.records.get(pending.mergeKey), pending, 'an open interaction is never the one dropped');
  assert.ok(r.records.size <= RECORD_MEMORY + 1);
});
test('auth csrf schema and endpoint SSRF safeguards reject unsafe input', () => {
  assert.equal(validateRequest({ authenticated: false, originOK: true }), 401); assert.equal(validateRequest({ authenticated: true, originOK: false }), 403); assert.equal(validateRequest({ authenticated: true, originOK: true, fields: { bad: 1 }, allowed: [] }), 400);
});
test('privacy strips paths and secret-shaped data', () => { const body = sanitizeBody('run /tmp/key token=abc'); assert.match(body, /\[path\]/); assert.match(body, /\[redacted\]/); });
