import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { apply, inject, Config, jobNotification } from '../src/index.js';

const settle = () => new Promise((resolve) => setImmediate(resolve));
async function waitUntil(predicate) { for (let attempt = 0; attempt < 100; attempt += 1) { if (predicate()) return; await new Promise((resolve) => setTimeout(resolve, 5)); } throw new Error('condition did not settle'); }
async function fixture(t, rejection, config = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-notify-host-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const listeners = new Map();
  const routes = new Map();
  const webServer = { register(route) { const key = `${route.kind}:${route.path}`; if (routes.has(key)) throw new Error(`duplicate ${key}`); routes.set(key, route); return () => routes.delete(key); } };
  const connection = { requestRejection: typeof rejection === 'function' ? rejection : () => rejection };
  const jobs = { onJobDone(handler) { listeners.set('job/done', handler); return () => listeners.delete('job/done'); } };
  const ctx = {
    get(name) { return { webServer, connection, jobs }[name]; },
    on(name, handler) { listeners.set(name, handler); return () => listeners.delete(name); },
    effect(setup) { return setup(); },
    emit() {},
  };
  const runtime = await apply(ctx, { dataDir: dir, completionGraceMs: 0, ...config });
  assert.equal(typeof runtime, 'function', 'Cordis async plugin must resolve to a disposer');
  return { dir, listeners, routes, runtime, records: () => runtime.buffer.pull().items };
}
function request({ method = 'GET', path = '/', headers = {}, body } = {}) {
  const chunks = body === undefined ? [] : [Buffer.from(typeof body === 'string' ? body : JSON.stringify(body))];
  return { method, url: path, headers, resume() {}, async *[Symbol.asyncIterator]() { yield* chunks; } };
}
function response() {
  return { statusCode: 0, headers: {}, body: '', setHeader(name, value) { this.headers[name.toLowerCase()] = value; }, end(value = '') { this.body += Buffer.isBuffer(value) ? value.toString('utf8') : String(value); } };
}
async function invoke(route, req) { const res = response(); await route.handler(req, res); return res; }
const browserHeaders = { origin: 'http://127.0.0.1:3080', host: '127.0.0.1:3080', cookie: 'sid=one', 'content-type': 'application/json' };

test('sound routes list, upload, serve and delete only allow-listed audio, behind auth', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-notify-host-sounds-'));
  const { routes, runtime } = await fixture(t, undefined, { dataDir: dir });
  const list = routes.get('exact:/plugins/dsh-notify/sounds');
  const sound = routes.get('exact:/plugins/dsh-notify/sound');
  const remove = routes.get('exact:/plugins/dsh-notify/sounds/delete');
  assert.ok(list && sound && remove, 'all three sound routes are exact objects');

  const empty = JSON.parse((await invoke(list, request({ path: '/plugins/dsh-notify/sounds', headers: browserHeaders }))).body);
  assert.deepEqual(empty.custom, []); assert.deepEqual(empty.builtins, ['chime', 'ping', 'alert', 'none']); assert.equal(empty.maxBytes, 1024 * 1024);

  const reject = async (name, bytes, status) => { const result = await invoke(list, request({ method: 'POST', path: '/plugins/dsh-notify/sounds', headers: { ...browserHeaders, 'x-sound-name': name }, body: bytes })); assert.equal(result.statusCode, status, `${name} -> ${status}`); };
  await reject('../evil.mp3', 'x', 400);
  await reject('note.txt', 'x', 400);
  await reject('ok.mp3', '', 400);
  await reject('ok.mp3', 'x'.repeat(1024 * 1024 + 1), 413);

  const upload = await invoke(list, request({ method: 'POST', path: '/plugins/dsh-notify/sounds', headers: { ...browserHeaders, 'x-sound-name': 'Ding.MP3' }, body: 'audio-bytes' }));
  assert.equal(upload.statusCode, 200); assert.deepEqual(JSON.parse(upload.body), { ok: true, name: 'Ding.mp3', bytes: 11 });

  const served = await invoke(sound, request({ path: '/plugins/dsh-notify/sound?name=Ding.mp3', headers: browserHeaders }));
  assert.equal(served.statusCode, 200); assert.equal(served.headers['content-type'], 'audio/mpeg'); assert.equal(served.body, 'audio-bytes');
  assert.equal((await invoke(sound, request({ path: '/plugins/dsh-notify/sound?name=../etc/passwd', headers: browserHeaders }))).statusCode, 404);
  assert.equal((await invoke(sound, request({ path: '/plugins/dsh-notify/sound?name=missing.mp3', headers: browserHeaders }))).statusCode, 404);

  const deleted = await invoke(remove, request({ method: 'POST', path: '/plugins/dsh-notify/sounds/delete', headers: browserHeaders, body: { confirm: true, name: 'Ding.mp3' } }));
  assert.deepEqual(JSON.parse(deleted.body), { ok: true });
  assert.deepEqual(JSON.parse((await invoke(list, request({ path: '/plugins/dsh-notify/sounds', headers: browserHeaders }))).body).custom, []);
  await runtime();
});
test('the sound list degrades to empty when the profile directory is unusable', async (t) => {
  const { routes } = await fixture(t, undefined, { dataDir: 'relative/not/absolute' });
  const list = routes.get('exact:/plugins/dsh-notify/sounds');
  const result = await invoke(list, request({ path: '/plugins/dsh-notify/sounds', headers: browserHeaders }));
  assert.equal(result.statusCode, 200); assert.deepEqual(JSON.parse(result.body).custom, []);
});
test('Host declares no hard service injection and exports a DSH config schema', () => {
  assert.deepEqual(inject, []);
  assert.equal(typeof Config, 'function');
});

test('session/event turns approvals and finished turns into records, and waterfalls always delegate', async (t) => {
  const { listeners, records } = await fixture(t);
  listeners.get('session/event')({ id: 'session-1', header: {} }, { type: 'approval/asked', data: { id: 'approval-1', toolName: 'bash' } });
  listeners.get('session/event')({ id: 'session-1', header: {} }, { type: 'turn/end', data: { turn: 2, reason: { kind: 'completed' } } });
  listeners.get('session/event')({ id: 'sub', header: { origin: 'subagent' } }, { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } });
  await waitUntil(() => records().length >= 2);
  assert.equal(records().some((item) => item.mergeKey === 'approval:approval-1' && item.sessionId === 'session-1'), true);
  assert.equal(records().some((item) => item.mergeKey === 'turn:session-1:2'), true);
  assert.equal(records().some((item) => item.sessionId === 'sub' && item.kind === 'completed'), false, 'a subagent turn is not the task finishing');
  let approvalNext = 0; let questionNext = 0;
  await listeners.get('approval/request')({}, async () => { approvalNext += 1; return 'approved'; });
  await listeners.get('user-questions/request')({ agent: { session: { id: 'session-1' } }, questions: [{ id: 'q', question: 'Continue?' }] }, async () => { questionNext += 1; return { answers: [] }; });
  const hostile = {}; Object.defineProperty(hostile, 'agent', { get() { throw new Error('hostile live payload'); } });
  await listeners.get('user-questions/request')(hostile, async () => { questionNext += 1; return { answers: [] }; });
  await settle();
  assert.equal(approvalNext, 1); assert.equal(questionNext, 2);
});

test('a live tool/call is the authoritative question source and closes on its own tool/result', async (t) => {
  const { listeners, records, runtime } = await fixture(t);
  const session = { id: 'question-session', header: {} };
  listeners.get('session/event')(session, { type: 'tool/call', data: { callId: 'call-1', name: 'ask_user_question', arguments: JSON.stringify({ questions: [{ header: '通道范围', question: '浏览器与主机通知要怎么处理？' }] }) } });
  await waitUntil(() => records().some((record) => record.mergeKey === 'question:question-session:call-1'));
  const asked = records().find((record) => record.mergeKey === 'question:question-session:call-1');
  assert.equal(asked.kind, 'question'); assert.equal(asked.phase, 'open');
  assert.equal(asked.body, '通道范围：浏览器与主机通知要怎么处理？', 'the notification must say what is being asked, not just 需要回复');

  listeners.get('session/event')(session, { type: 'tool/call', data: { callId: 'call-2', name: 'exit_plan_mode', arguments: '{}' } });
  await waitUntil(() => records().some((record) => record.mergeKey === 'question:question-session:call-2'));
  assert.equal(records().find((record) => record.mergeKey === 'question:question-session:call-2').kind, 'plan-review');

  listeners.get('session/event')(session, { type: 'tool/result', data: { message: { content: [{ type: 'tool-result', toolCallId: 'call-2' }] } } });
  await waitUntil(() => records().find((record) => record.mergeKey === 'question:question-session:call-2').phase === 'settled');
  assert.equal(records().find((record) => record.mergeKey === 'question:question-session:call-1').phase, 'open', 'a reverse result must not close the other call');
  // An uncorrelated result can never close anything.
  listeners.get('session/event')(session, { type: 'tool/result', data: { message: { content: [{ type: 'tool-result' }] } } });
  await settle();
  assert.equal(records().find((record) => record.mergeKey === 'question:question-session:call-1').phase, 'open');
  await runtime();
});

test('each unlinked waterfall yields its own record and settles only its own key', async (t) => {
  const { listeners, records, runtime } = await fixture(t); const waterfall = listeners.get('user-questions/request'); const session = { id: 'unscoped-session' }; const next = async () => ({ answers: [] });
  await waterfall({ agent: { session }, questions: [{ id: 'same', question: 'First delivered second?' }] }, next);
  await waterfall({ agent: { session }, questions: [{ id: 'plan', question: 'Approve?', intent: { kind: 'plan-review' } }] }, next);
  await waitUntil(() => records().filter((record) => record.kind === 'question' || record.kind === 'plan-review').length >= 2);
  const questions = records().filter((record) => record.kind === 'question' || record.kind === 'plan-review');
  assert.equal(questions.every((record) => record.mergeKey.includes(':unlinked:')), true, 'no FIFO guess may bind these');
  assert.equal(questions.some((record) => record.kind === 'plan-review'), true);
  await runtime();
});

test('/pull hands a page only what it has not seen, and the buffer is memory-only', async (t) => {
  const { routes, runtime, listeners } = await fixture(t);
  const pull = routes.get('exact:/plugins/dsh-notify/pull');

  const first = await invoke(pull, request({ path: '/plugins/dsh-notify/pull?since=0', headers: browserHeaders }));
  const empty = JSON.parse(first.body);
  assert.deepEqual(empty, { seq: 0, items: [] });
  assert.equal(runtime.buffer.size, 0, 'nothing is written until something happens');

  listeners.get('session/event')({ id: 's1', header: {} }, { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } });
  await waitUntil(() => runtime.buffer.size === 1);

  const seen = JSON.parse((await invoke(pull, request({ path: `/plugins/dsh-notify/pull?since=${empty.seq}`, headers: browserHeaders }))).body);
  assert.equal(seen.items.length, 1); assert.equal(seen.items[0].title, '任务完成'); assert.equal(seen.seq, 1);

  const caughtUp = JSON.parse((await invoke(pull, request({ path: `/plugins/dsh-notify/pull?since=${seen.seq}`, headers: browserHeaders }))).body);
  assert.deepEqual(caughtUp.items, [], 'a page that is current is told nothing twice');
  await runtime();
});

test('/config persists the user own preferences to the profile directory', async (t) => {
  const { routes, dir, runtime } = await fixture(t);
  const config = routes.get('exact:/plugins/dsh-notify/config');
  const initial = JSON.parse((await invoke(config, request({ path: '/plugins/dsh-notify/config', headers: browserHeaders }))).body);
  assert.equal(initial.storage.records, 'memory', 'records never persist, and the page is told so');
  assert.equal(initial.storage.preferences, 'file');
  assert.deepEqual({ sound: initial.sound, toastPosition: initial.toastPosition }, { sound: 'chime', toastPosition: 'conversation' });

  const patched = await invoke(config, request({ method: 'POST', path: '/plugins/dsh-notify/config', headers: browserHeaders, body: { sound: 'alert', toastPosition: 'viewport', subtaskNotify: true } }));
  assert.equal(patched.statusCode, 200);
  assert.deepEqual(JSON.parse(await readFile(join(dir, 'settings.json'), 'utf8')), { sound: 'alert', toastPosition: 'viewport', subtaskNotify: true });

  const rejected = await invoke(config, request({ method: 'POST', path: '/plugins/dsh-notify/config', headers: browserHeaders, body: { readRetentionDays: 7 } }));
  assert.equal(rejected.statusCode, 400, 'a setting that only served the deleted history list is not accepted');
  const reloaded = JSON.parse((await invoke(config, request({ path: '/plugins/dsh-notify/config', headers: browserHeaders }))).body);
  assert.equal(reloaded.sound, 'alert');
  await runtime();
});

test('a restart forgets the notifications and keeps the preferences', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-notify-host-restart-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const build = async () => {
    const listeners = new Map(); const routes = new Map();
    const ctx = { get(name) { return { webServer: { register(route) { routes.set(`${route.kind}:${route.path}`, route); return () => {}; } }, connection: { requestRejection: () => undefined }, jobs: undefined }[name]; }, on(name, handler) { listeners.set(name, handler); return () => {}; }, effect(setup) { return setup(); }, emit() {} };
    return { listeners, routes, runtime: await apply(ctx, { dataDir: dir, completionGraceMs: 0 }) };
  };
  const first = await build();
  first.listeners.get('session/event')({ id: 's1', header: {} }, { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } });
  await waitUntil(() => first.runtime.buffer.size === 1);
  const config = first.routes.get('exact:/plugins/dsh-notify/config');
  await invoke(config, request({ method: 'POST', path: '/plugins/dsh-notify/config', headers: browserHeaders, body: { sound: 'ping' } }));

  const second = await build();
  assert.equal(second.runtime.buffer.size, 0, 'a page that was not connected when it happened never learns about it');
  assert.deepEqual(second.runtime.buffer.pull(), { seq: 0, items: [] });
  assert.equal(second.runtime.preferences.get().sound, 'ping', 'the users own choices survive');
});

test('raw routes are exact, check auth before business logic, and the history routes are gone', async (t) => {
  const { routes } = await fixture(t, (req) => (String(req.headers?.cookie ?? '') === 'sid=one' ? undefined : 401));
  assert.deepEqual([...routes.keys()].sort(), [
    'exact:/plugins/dsh-notify/config',
    'exact:/plugins/dsh-notify/health',
    'exact:/plugins/dsh-notify/pull',
    'exact:/plugins/dsh-notify/sound',
    'exact:/plugins/dsh-notify/sounds',
    'exact:/plugins/dsh-notify/sounds/delete',
  ], 'only the live transport, the preferences and the sound library remain');
  const pull = routes.get('exact:/plugins/dsh-notify/pull');
  assert.equal((await invoke(pull, request({ path: '/plugins/dsh-notify/pull', headers: { origin: 'http://127.0.0.1:3080', host: '127.0.0.1:3080' } }))).statusCode, 401);
  const config = routes.get('exact:/plugins/dsh-notify/config');
  assert.equal((await invoke(config, request({ method: 'POST', path: '/plugins/dsh-notify/config', headers: { ...browserHeaders, origin: 'http://evil.test' }, body: { sound: 'ping' } }))).statusCode, 403, 'a cross-site write is refused before it is parsed');
  assert.equal((await invoke(pull, request({ method: 'POST', path: '/plugins/dsh-notify/pull', headers: browserHeaders }))).statusCode, 405);
  const health = JSON.parse((await invoke(routes.get('exact:/plugins/dsh-notify/health'), request({ path: '/plugins/dsh-notify/health', headers: browserHeaders }))).body);
  assert.deepEqual(health.storage, { records: 'memory', preferences: 'file' });
  assert.equal(typeof health.buffered, 'number');
});

test('a job notification never turns a raw command line into its title', () => {
  assert.deepEqual(jobNotification({ status: 'completed', label: 'rm -rf / && echo done' }), { title: '后台任务结束', body: '已完成' });
  assert.deepEqual(jobNotification({ status: 'failed', label: 'build the docs' }), { title: '后台任务失败', body: 'build the docs' });
  assert.deepEqual(jobNotification({ status: 'completed' }), { title: '后台任务结束', body: '已完成' });
});

test('a finished turn is only announced once the session really stops', async (t) => {
  const { listeners, runtime } = await fixture(t, undefined, { completionGraceMs: 60 });
  const session = { id: 'graceful-session', header: {} };
  listeners.get('session/event')(session, { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } });
  await settle();
  assert.equal(runtime.buffer.size, 0, 'the grace window holds the announcement');
  listeners.get('session/event')(session, { type: 'turn/start', data: { turn: 2 } });
  await waitUntil(() => true);
  await new Promise((resolve) => setTimeout(resolve, 90));
  assert.equal(runtime.buffer.size, 0, 'work resumed inside the window: that turn end was not the task finishing');

  listeners.get('session/event')(session, { type: 'turn/end', data: { turn: 2, reason: { kind: 'completed' } } });
  await waitUntil(() => runtime.buffer.size === 1);
  assert.equal(runtime.buffer.pull().items[0].mergeKey, 'turn:graceful-session:2');
  await runtime();
});

test('a turn that ends expires leftover open records so they cannot shadow later notifications', async (t) => {
  const { listeners, runtime } = await fixture(t);
  const session = { id: 'leftover-session', header: {} };
  listeners.get('session/event')(session, { type: 'approval/asked', data: { id: 'never-decided', toolName: 'bash' } });
  await waitUntil(() => runtime.buffer.size === 1);
  assert.equal(runtime.buffer.pull().items[0].phase, 'open');

  listeners.get('session/event')(session, { type: 'turn/end', data: { turn: 3, reason: { kind: 'completed' } } });
  await waitUntil(() => runtime.buffer.pull().items.some((record) => record.mergeKey === 'turn:leftover-session:3'));
  const records = runtime.buffer.pull().items;
  const approval = records.filter((record) => record.mergeKey === 'approval:never-decided').at(-1);
  assert.equal(approval.phase, 'expired', 'nothing can still be waiting on a turn that ended');
  assert.equal(records.filter((record) => record.mergeKey === 'approval:never-decided').length, 1, 'the expiry replaced the open copy instead of queueing a second notification');
  await runtime();
});

test('/config only adopts the settings this version has, whatever the file on disk holds', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-notify-host-legacy-config-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  // A profile that has been through the previous release: the wrapper plus a key that is gone.
  await writeFile(join(dir, 'settings.json'), `${JSON.stringify({ version: 1, value: { sound: 'ping', toastPosition: 'viewport', readRetentionDays: 7 } }, null, 2)}\n`, 'utf8');
  const { routes, runtime } = await fixture(t, undefined, { dataDir: dir });
  const config = routes.get('exact:/plugins/dsh-notify/config');
  const loaded = JSON.parse((await invoke(config, request({ path: '/plugins/dsh-notify/config', headers: browserHeaders }))).body);
  assert.equal(loaded.sound, 'ping', 'the sound the user chose is the one that loads');
  assert.equal(loaded.toastPosition, 'viewport');
  assert.equal('readRetentionDays' in loaded, false, 'a setting this version does not have is not smuggled into the config');
  assert.equal('version' in loaded, false); assert.equal('value' in loaded, false);

  const patched = await invoke(config, request({ method: 'POST', path: '/plugins/dsh-notify/config', headers: browserHeaders, body: { subtaskNotify: true } }));
  assert.equal(patched.statusCode, 200);
  assert.deepEqual(JSON.parse(await readFile(join(dir, 'settings.json'), 'utf8')), { sound: 'ping', toastPosition: 'viewport', subtaskNotify: true }, 'the write is flat, drops the dead key and keeps the choices it did not touch');
  await runtime();
});

test('the job registry is reached through ctx.inject, since a reflective read is not guaranteed', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-notify-host-jobs-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const listeners = new Map();
  const jobs = { onJobDone(handler) { listeners.set('job/done', handler); return () => listeners.delete('job/done'); } };
  const routes = new Map();
  // A real Cordis profile context: services are declared, not readable as plain properties.
  const ctx = {
    inject(names, callback) { if (names.includes('jobs')) callback({ jobs }); return () => {}; },
    get() { return undefined; },
    on(name, handler) { listeners.set(name, handler); return () => {}; },
    effect(setup) { return setup(); },
    emit() {},
  };
  const runtime = await apply(ctx, { dataDir: dir, completionGraceMs: 0, webServer: undefined });
  assert.equal(runtime.diagnostics.services.jobs, 'injected', 'the injected seam is the one that takes');

  // Off by default: a background job finishing is not news.
  listeners.get('job/done')({ id: 'job-off', status: 'completed', label: 'pnpm build', ownerSession: 's1' }, { session: { id: 's1' } });
  await settle();
  assert.equal(runtime.buffer.size, 0, 'subtask noise stays off until the user asks for it');

  runtime.preferences.set({ subtaskNotify: true });
  listeners.get('job/done')({ id: 'job-1', status: 'completed', label: 'pnpm build', ownerSession: 'session-1' }, { session: { id: 'session-1' } });
  await waitUntil(() => runtime.buffer.size >= 1);
  const [record] = runtime.buffer.pull().items;
  assert.equal(record.kind, 'job-end'); assert.equal(record.title, '后台任务结束'); assert.equal(record.body, 'pnpm build');
  assert.equal(record.sessionId, 'session-1', 'the notification knows which session the job belonged to');
  void routes;
});

test('a composition with no job registry says so instead of failing silently', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-notify-host-nojobs-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const ctx = { get() { return undefined; }, on() { return () => {}; }, effect(setup) { return setup(); }, emit() {} };
  const runtime = await apply(ctx, { dataDir: dir, completionGraceMs: 0 });
  assert.equal(runtime.diagnostics.services.jobs, 'unavailable', 'the report is how a silent seam becomes visible');
});

test('a plain test double still resolves the registry reflectively', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-notify-host-reflect-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const listeners = new Map();
  const jobs = { onJobDone(handler) { listeners.set('job/done', handler); return () => {}; } };
  const ctx = { get(name) { return name === 'jobs' ? jobs : undefined; }, on() { return () => {}; }, effect(setup) { return setup(); }, emit() {} };
  const runtime = await apply(ctx, { dataDir: dir, completionGraceMs: 0 });
  assert.equal(runtime.diagnostics.services.jobs, 'reflected');
  runtime.preferences.set({ subtaskNotify: true });
  listeners.get('job/done')({ id: 'job-2', status: 'failed', label: 'go test ./...', ownerSession: 's2' }, undefined);
  await waitUntil(() => runtime.buffer.size >= 1);
  assert.equal(runtime.buffer.pull().items[0].kind, 'job-end');
  assert.equal(runtime.buffer.pull().items[0].title, '后台任务失败');
});
