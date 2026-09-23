import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import { createLocalSelfTestBatch, mountNotifyClient, NotificationSelfTests, publishLocalSelfTest, setToastConfig, toastAnchor, TOAST_STACK_GAP, TOAST_STACK_PEEK } from '../src/client.js';

function response(value) { return { ok: true, json: async () => value }; }






test('a new toast asks for the configured sound, and prefers a custom upload when one is chosen', async (t) => {
  const dom = new JSDOM('<!doctype html><div data-conversation-scroll></div><main id="root"></main>', { url: 'https://dsh.test/' }); let root; let mounted; let pullTimer; let pulls = 0; let releaseLive = false;
  const started = []; const audioSrc = [];
  const values = {
    window: dom.window, document: dom.window.document, navigator: dom.window.navigator, localStorage: dom.window.localStorage,
    Event: dom.window.Event, CustomEvent: dom.window.CustomEvent, MouseEvent: dom.window.MouseEvent,
    addEventListener: dom.window.addEventListener.bind(dom.window), removeEventListener: dom.window.removeEventListener.bind(dom.window), dispatchEvent: dom.window.dispatchEvent.bind(dom.window),
    innerWidth: 1024, IS_REACT_ACT_ENVIRONMENT: true,
    setInterval: (fn) => { pullTimer = fn; return 1; }, clearInterval: () => {},
    AudioContext: class { state = 'running'; currentTime = 0; destination = {}; createOscillator() { const node = { type: '', frequency: { value: 0 }, connect() {}, start() { started.push(node.frequency.value); }, stop() {} }; return node; } createGain() { return { gain: { setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} }; } },
    Audio: class { constructor(src) { this.src = src; audioSrc.push(src); } addEventListener() {} play() { return Promise.resolve(); } pause() {} },
    fetch: async (url) => {
      if (String(url).includes('/pull?')) {
        const prime = { eventId: 'prime', mergeKey: 'turn:prime', kind: 'completed', sessionId: 's1', title: '任务完成', body: '预热', at: 1, unread: true, phase: 'settled' };
        const live = [
          { eventId: 'live-1', mergeKey: 'turn:live-1', kind: 'completed', sessionId: 's1', title: '任务完成', body: '新事件 1', at: 2, unread: true, phase: 'settled' },
          { eventId: 'live-2', mergeKey: 'turn:live-2', kind: 'completed', sessionId: 's1', title: '任务完成', body: '新事件 2', at: 3, unread: true, phase: 'settled' },
        ];
        pulls += 1;
        // The store may pull more than once while mounting; every mount pull stays a silent reset.
        return response(releaseLive ? { seq: 3, items: [prime, ...live] } : { seq: 1, items: [prime] });
      }
      return response({});
    },
  };
  const saved = Object.fromEntries(Object.keys(values).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(values)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  t.after(async () => { if (root) await act(async () => { root.unmount(); }); mounted?.destroy(); setToastConfig({ toastPosition: 'conversation', toastEnabled: true, notificationStyle: 'strong', stackCollapsed: true, sound: 'chime', soundEnabled: true }); for (const [key, descriptor] of Object.entries(saved)) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; } dom.window.close(); });

  document.querySelector('[data-conversation-scroll]').getBoundingClientRect = () => ({ right: 700, width: 420, x: 280, left: 280, top: 0, bottom: 600, height: 600 });
  // jsdom reports hidden=true by default, which is exactly the condition the hidden-mute rule checks.
  Object.defineProperty(dom.window.document, 'hidden', { configurable: true, value: false });
  const components = new Map();
  const slots = { inject(_name, callback) { const dispose = callback(); return () => dispose?.(); }, register(options, Component) { if (options.inject) components.set(`${options.name}:props`, options.inject()); components.set(options.name, Component); return () => components.delete(options.name); } };
  mounted = mountNotifyClient({ slots, getUiSession: () => undefined });
  root = createRoot(document.getElementById('root'));
  const Overlay = components.get('shell.overlay');
  setToastConfig({ sound: 'chime', soundEnabled: true });
  await act(async () => { root.render(React.createElement(Overlay, components.get('shell.overlay:props'))); });
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)); });   // mount pulls are resets and prime silently
  assert.deepEqual(started, [], 'the priming record must not beep');
  releaseLive = true;
  await act(async () => { await pullTimer(); });
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
  assert.equal(document.querySelectorAll('aside.dsh-notify-toast').length, 2, 'every record from one live delivery is toasted');
  assert.deepEqual(started, [880, 1318.5], 'a live delivery batch plays one configured built-in cue');

  setToastConfig({ sound: 'custom:ding.mp3' });
  await act(async () => { publishLocalSelfTest({ eventId: 'local-1', localOnly: true, kind: 'completed', title: '任务完成', body: '自定义音' }); });
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
  assert.deepEqual(audioSrc, ['/plugins/dsh-notify/sound?name=ding.mp3'], 'a custom choice plays the uploaded file');

  const notesBeforeVisualOff = started.length;
  setToastConfig({ toastPosition: 'off', toastEnabled: true, sound: 'chime', soundEnabled: true });
  await act(async () => { publishLocalSelfTest({ eventId: 'local-off', localOnly: true, kind: 'completed', title: '任务完成', body: '页面通知已关闭' }); });
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
  assert.equal(document.querySelector('aside.dsh-notify-toast'), null, 'an off visual notification renders no card');
  assert.equal(started.length, notesBeforeVisualOff, 'an off visual notification must not play an automatic sound');

  setToastConfig({ toastPosition: 'conversation', toastEnabled: false });
  await act(async () => { publishLocalSelfTest({ eventId: 'local-disabled', localOnly: true, kind: 'completed', title: '任务完成', body: '页面通知已禁用' }); });
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
  assert.equal(document.querySelector('aside.dsh-notify-toast'), null, 'a disabled visual notification renders no card');
  assert.equal(started.length, notesBeforeVisualOff, 'a disabled visual notification must not play an automatic sound');
});

test('a question toast closes itself when the answer happens elsewhere', async (t) => {
  const dom = new JSDOM('<!doctype html><div data-conversation-scroll></div><main id="root"></main>', { url: 'https://dsh.test/' });
  let root; let mounted; let pullTimer;
  const listeners = new Set(); let pendingMap = new Map();
  // DSH 0.1.7 publishes pending interactions through the unified Session status snapshot, so each map
  // value is a `SessionStatus` and the interaction itself is nested under `pendingInteraction`.
  const observable = { getSnapshot: () => pendingMap, subscribe: (listener) => { listeners.add(listener); return () => listeners.delete(listener); } };
  const publish = (next) => { pendingMap = new Map([...next].map(([sessionId, interaction]) => [sessionId, { pendingInteraction: interaction }])); for (const listener of listeners) listener(); };
  const calls = [];
  const earlier = { eventId: 'turn:prime', mergeKey: 'turn:prime', kind: 'completed', sessionId: 's1', title: '任务完成', body: '预热', at: 1, unread: true, phase: 'settled' };
  const question = (callId, phase) => ({ eventId: `question:s1:${callId}`, mergeKey: `question:s1:${callId}`, kind: 'question', sessionId: 's1', title: '需要回复', body: '要不要继续？', at: 2, unread: true, phase });
  // A realistic host: the cursor only advances when the record set actually changes.
  let record = question('call-9', 'open'); let cursor = 1;
  const values = {
    window: dom.window, document: dom.window.document, navigator: dom.window.navigator, localStorage: dom.window.localStorage,
    Event: dom.window.Event, CustomEvent: dom.window.CustomEvent, MouseEvent: dom.window.MouseEvent,
    addEventListener: dom.window.addEventListener.bind(dom.window), removeEventListener: dom.window.removeEventListener.bind(dom.window), dispatchEvent: dom.window.dispatchEvent.bind(dom.window),
    innerWidth: 1024, IS_REACT_ACT_ENVIRONMENT: true,
    // The store re-registers its poller whenever the cursor moves, so keep the latest callback and make
    // the page visible so the attention indicator never registers one of its own.
    setInterval: (fn) => { pullTimer = fn; return 1; }, clearInterval: () => {},
    fetch: async (url, init) => {
      if (String(url).includes('/pull?')) return response(cursor === 1 ? { seq: 1, items: [earlier] } : { seq: 2, items: [earlier, record] });
      return response({});
    },
  };
  const saved = Object.fromEntries(Object.keys(values).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(values)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  t.after(async () => {
    const open = document.querySelector('aside[role="status"] button[aria-label="关闭通知"]');
    if (open) { await act(async () => { open.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })); }); }
    if (root) await act(async () => { root.unmount(); });
    mounted?.destroy();
    for (const [key, descriptor] of Object.entries(saved)) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; }
    dom.window.close();
  });
  document.querySelector('[data-conversation-scroll]').getBoundingClientRect = () => ({ right: 700, width: 420, x: 280, left: 280, top: 0, bottom: 600, height: 600 });
  Object.defineProperty(dom.window.document, 'hidden', { configurable: true, value: false });
  const sessions = { binding: () => ({}), open: () => true, list: { getSnapshot: () => ({ current: 's1', byId: { s1: { id: 's1' } } }) } };
  const components = new Map();
  const slots = { inject(_name, callback) { const dispose = callback(); return () => dispose?.(); }, register(options, Component) { if (options.inject) components.set(`${options.name}:props`, options.inject()); components.set(options.name, Component); return () => components.delete(options.name); } };
  mounted = mountNotifyClient({ slots, sessions, getUiSession: () => ({ sessionStatus: observable }) });
  root = createRoot(document.getElementById('root'));
  const Overlay = components.get('shell.overlay');
  const settle = async (ms = 30) => { await act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)); }); };
  const toastNode = () => document.querySelector('aside[role="status"]');
  const answerCount = () => toastNode()?.querySelectorAll('.dsh-notify-toast-answer').length ?? 0;
  await act(async () => { root.render(React.createElement(Overlay, components.get('shell.overlay:props'))); });
  await settle();

  cursor = 2;   // the host now reports the open question
  await act(async () => { await pullTimer(); }); await settle();
  assert.ok(toastNode(), 'the question is toasted');
  assert.equal(answerCount(), 1, 'without a pending interaction only the session link is offered');

  // The official composer holds the question and the user answers it there: the toast must follow.
  await act(async () => { publish(new Map([['s1', { kind: 'question', questions: [{ id: 'q1', options: [{ label: '继续' }] }], answer: async () => {} }]])); });
  assert.equal(answerCount(), 2, 'answering from the toast is offered while it is pending');
  await act(async () => { publish(new Map()); }); await settle();
  assert.equal(Boolean(toastNode()), true, 'a card that is answered elsewhere first leaves its slot');
  assert.equal(toastNode()?.getAttribute('data-leaving'), 'true', 'it slides out instead of vanishing');
  await settle(260);
  assert.equal(Boolean(toastNode()), false, 'an answer given in the composer closes the toast');
  assert.deepEqual(calls, [], 'nothing is written and nothing navigates: the answer happened in the composer');

});



test('an unanswered record never starves later toasts, and every record is toasted at most once', async (t) => {
  const dom = new JSDOM('<!doctype html><div data-conversation-scroll></div><main id="root"></main>', { url: 'https://dsh.test/' });
  let root; let mounted; let pullTimer; let release = false;
  // The exact shape that used to break: one 3-hour-old approval left open by a missed decision event.
  const staleApproval = { eventId: 'approval-stale', mergeKey: 'approval:old', kind: 'approval', sessionId: 's1', title: '需要审批', body: '旧审批', at: 1, unread: false, phase: 'open' };
  const completion = { eventId: 'completion-new', mergeKey: 'turn:s1:9', kind: 'completed', sessionId: 's1', title: '任务完成', body: '新完成', at: 9, unread: true, phase: 'settled' };
  let items = [staleApproval];
  const values = {
    window: dom.window, document: dom.window.document, navigator: dom.window.navigator, localStorage: dom.window.localStorage,
    Event: dom.window.Event, CustomEvent: dom.window.CustomEvent, MouseEvent: dom.window.MouseEvent,
    addEventListener: dom.window.addEventListener.bind(dom.window), removeEventListener: dom.window.removeEventListener.bind(dom.window), dispatchEvent: dom.window.dispatchEvent.bind(dom.window),
    innerWidth: 1024, IS_REACT_ACT_ENVIRONMENT: true,
    setInterval: (fn) => { pullTimer = fn; return 1; }, clearInterval: () => {},
    fetch: async (url) => String(url).includes('/pull?') ? response({ seq: release ? 2 : 1, items: release ? items : [staleApproval] }) : response({}),
  };
  const saved = Object.fromEntries(Object.keys(values).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(values)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  t.after(async () => { if (root) await act(async () => { root.unmount(); }); mounted?.destroy(); for (const [key, descriptor] of Object.entries(saved)) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; } dom.window.close(); });
  document.querySelector('[data-conversation-scroll]').getBoundingClientRect = () => ({ right: 700, width: 420, x: 280, left: 280, top: 0, bottom: 600, height: 600 });
  Object.defineProperty(dom.window.document, 'hidden', { configurable: true, value: false });

  const components = new Map();
  const slots = { inject(_name, callback) { const dispose = callback(); return () => dispose?.(); }, register(options, Component) { if (options.inject) components.set(`${options.name}:props`, options.inject()); components.set(options.name, Component); return () => components.delete(options.name); } };
  mounted = mountNotifyClient({ slots, getUiSession: () => undefined });
  root = createRoot(document.getElementById('root'));
  const Overlay = components.get('shell.overlay');
  await act(async () => { root.render(React.createElement(Overlay, components.get('shell.overlay:props'))); });
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)); });
  assert.match(document.querySelector('aside.dsh-notify-toast')?.textContent ?? '', /需要审批/, 'a still-open approval is restored after a page/overlay remount');

  release = true; items = [completion, staleApproval];
  await act(async () => { await pullTimer(); });
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
  const toast = document.querySelector('aside.dsh-notify-toast');
  assert.ok(toast, 'a completion still toasts while an unrelated record is left open');
  assert.match(toast.textContent, /需要审批/, 'the record waiting on the user is the one the corner puts first');

  await act(async () => { await pullTimer(); });
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
  const titles = [...document.querySelectorAll('aside.dsh-notify-toast')].map((node) => node.querySelector('.dsh-notify-toast-title').textContent);
  assert.deepEqual(titles, ['需要审批', '任务完成'], 'the completion is not starved: it follows the pending card instead of being skipped');
  await act(async () => { await pullTimer(); });
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
  assert.equal(document.querySelectorAll('aside.dsh-notify-toast').length, 2, 'and a later poll does not toast either of them again');
});

test('a pending question can be answered straight from the toast and stays in sync with the composer', async (t) => {
  const dom = new JSDOM('<!doctype html><div data-conversation-scroll></div><main id="root"></main>', { url: 'https://dsh.test/' }); let root; let mounted; let pullTimer; let initial = true; let pulls = 0;
  const answered = []; const calls = [];
  const listeners = new Set();
  let pendingMap = new Map();
  // DSH 0.1.7 publishes pending interactions through the unified Session status snapshot, so each map
  // value is a `SessionStatus` and the interaction itself is nested under `pendingInteraction`.
  const observable = { getSnapshot: () => pendingMap, subscribe: (listener) => { listeners.add(listener); return () => listeners.delete(listener); } };
  const publish = (next) => { pendingMap = new Map([...next].map(([sessionId, interaction]) => [sessionId, { pendingInteraction: interaction }])); for (const listener of listeners) listener(); };
  const earlier = { eventId: 'turn:prime', mergeKey: 'turn:prime', kind: 'completed', sessionId: 's1', title: '任务完成', body: '预热', at: 1, unread: true, phase: 'settled' };
  const questionRecord = { eventId: 'question:s1:call-1', mergeKey: 'question:s1:call-1', kind: 'question', sessionId: 's1', title: '需要回复', body: '通道范围：要怎么处理？', at: 2, unread: true, phase: 'open' };
  const values = {
    window: dom.window, document: dom.window.document, navigator: dom.window.navigator, localStorage: dom.window.localStorage,
    Event: dom.window.Event, CustomEvent: dom.window.CustomEvent, MouseEvent: dom.window.MouseEvent,
    addEventListener: dom.window.addEventListener.bind(dom.window), removeEventListener: dom.window.removeEventListener.bind(dom.window), dispatchEvent: dom.window.dispatchEvent.bind(dom.window),
    innerWidth: 1024, IS_REACT_ACT_ENVIRONMENT: true,
    setInterval: (fn) => { pullTimer = fn; return 1; }, clearInterval: () => {},
    fetch: async (url) => {
      if (String(url).includes('/pull?')) { if (initial) { initial = false; return response({ seq: 0, items: [] }); } pulls += 1; return response({ seq: 9, items: pulls === 1 ? [earlier] : [earlier, questionRecord] }); }
      return response({});
    },
  };
  const saved = Object.fromEntries(Object.keys(values).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(values)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  t.after(async () => { if (root) await act(async () => { root.unmount(); }); mounted?.destroy(); for (const [key, descriptor] of Object.entries(saved)) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; } dom.window.close(); });

  document.querySelector('[data-conversation-scroll]').getBoundingClientRect = () => ({ right: 700, width: 420, x: 280, left: 280, top: 0, bottom: 600, height: 600 });
  const sessions = { binding: () => ({}), open: (id) => { calls.push(`open:${id}`); return true; }, list: { getSnapshot: () => ({ current: 's1', ids: ['s1'], byId: { s1: { id: 's1', displayTitle: '通知插件改造' } } }) } };
  const components = new Map();
  const slots = { inject(_name, callback) { const dispose = callback(); return () => dispose?.(); }, register(options, Component) { if (options.inject) components.set(`${options.name}:props`, options.inject()); components.set(options.name, Component); return () => components.delete(options.name); } };
  mounted = mountNotifyClient({ slots, sessions, getUiSession: () => ({ sessionStatus: observable }) });
  root = createRoot(document.getElementById('root'));
  const Overlay = components.get('shell.overlay');
  await act(async () => { root.render(React.createElement(Overlay, components.get('shell.overlay:props'))); });
  await act(async () => { await pullTimer(); }); await act(async () => { await pullTimer(); });
  let toast = document.querySelector('aside[role="status"]'); assert.ok(toast); assert.match(toast.textContent, /需要回复/);
  assert.equal(toast.querySelector('.dsh-notify-toast-source')?.textContent, '通知插件改造', 'the toast says which session it came from');

  // No interaction published yet: the toast must offer the session, not fake buttons.
  assert.equal(toast.querySelectorAll('.dsh-notify-toast-answer').length, 1, 'only the 去会话里回答 action exists without a pending interaction');
  assert.match(toast.textContent, /去会话里回答/);

  // The official composer publishes the question the user must answer.
  await act(async () => { publish(new Map([['s1', { kind: 'question', questions: [{ id: 'q1', options: [{ label: '批准' }, { label: '拒绝' }] }], answer: async (batch) => { answered.push(batch); publish(new Map()); } }]])); });
  toast = document.querySelector('aside[role="status"]');
  const labels = [...toast.querySelectorAll('.dsh-notify-toast-answer')].map((node) => node.textContent);
  assert.deepEqual(labels, ['批准', '拒绝', '去会话里回答'], 'the toast lists the real options plus a way into the session');

  await act(async () => { [...toast.querySelectorAll('.dsh-notify-toast-answer')].find((node) => node.textContent === '批准').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })); });
  assert.deepEqual(answered, [{ answers: [{ id: 'q1', selected: ['批准'] }] }], 'answering resolves the same PendingQuestion the composer renders');
  assert.deepEqual(calls, [], 'answering happens in the page: it never navigates away');
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 1200)); });
  const remaining = [...document.querySelectorAll('aside[role="status"]')].map((node) => node.textContent);
  assert.equal(remaining.length, 1, 'the answered card leaves its slot');
  assert.match(remaining[0], /任务完成/, 'the stack keeps the other notification: the question card is the one that went');

  // A multi-question batch is never half-answered from a 360px card: the session keeps it.
  await act(async () => { publish(new Map([['s1', { kind: 'question', questions: [{ id: 'q2', options: [{ label: 'ok' }] }, { id: 'q3', options: [{ label: 'ok' }] }], answer: async () => {} }]])); });
  assert.equal(document.querySelectorAll('.dsh-notify-toast-answer').length, 0, 'a card that cannot be answered from here offers no fake options');
});

test('clicking a card opens its session and retires the card, with no history list to fall back to', async (t) => {
  const dom = new JSDOM('<!doctype html><div data-conversation-scroll></div><main id="root"></main>', { url: 'https://dsh.test/' }); let root; let mounted; let pullTimer; let initial = true; let pulls = 0;
  const calls = []; let bound = true; let current = 'other-session';
  const earlier = { eventId: 'turn:real:8', mergeKey: 'turn:real:8', kind: 'completed', sessionId: 'other-session', title: '任务完成', body: '更早的一条', at: 8, phase: 'settled' };
  const record = { eventId: 'turn:real:9', mergeKey: 'turn:real:9', kind: 'completed', sessionId: 'target-session', title: '任务完成', body: '在别的会话里', at: 9, phase: 'settled' };
  const values = {
    window: dom.window, document: dom.window.document, navigator: dom.window.navigator, localStorage: dom.window.localStorage,
    Event: dom.window.Event, CustomEvent: dom.window.CustomEvent, MouseEvent: dom.window.MouseEvent,
    addEventListener: dom.window.addEventListener.bind(dom.window), removeEventListener: dom.window.removeEventListener.bind(dom.window), dispatchEvent: dom.window.dispatchEvent.bind(dom.window),
    innerWidth: 1024, IS_REACT_ACT_ENVIRONMENT: true,
    setInterval: (fn) => { pullTimer = fn; return 1; }, clearInterval: () => {},
    fetch: async (url) => {
      if (!String(url).includes('/pull?')) return response({});
      if (initial) { initial = false; return response({ seq: 0, items: [] }); }
      pulls += 1;
      return response({ seq: 9, items: pulls === 1 ? [earlier] : [earlier, record] });
    },
  };
  const saved = Object.fromEntries(Object.keys(values).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(values)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  t.after(async () => { if (root) await act(async () => { root.unmount(); }); mounted?.destroy(); for (const [key, descriptor] of Object.entries(saved)) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; } dom.window.close(); });

  document.querySelector('[data-conversation-scroll]').getBoundingClientRect = () => ({ right: 700, width: 420, x: 280, left: 280, top: 0, bottom: 600, height: 600 });
  const sessions = { binding: (id) => bound && id === 'target-session' ? {} : undefined, open: (id) => { calls.push(`open:${id}`); current = id; return true; }, list: { getSnapshot: () => ({ current }) } };
  const components = new Map();
  const slots = { inject(_name, callback) { const dispose = callback(); return () => dispose?.(); }, register(options, Component) { if (options.inject) components.set(`${options.name}:props`, options.inject()); components.set(options.name, Component); return () => components.delete(options.name); } };
  mounted = mountNotifyClient({ slots, sessions });
  root = createRoot(document.getElementById('root'));
  const Overlay = components.get('shell.overlay');
  await act(async () => { root.render(React.createElement(Overlay, components.get('shell.overlay:props'))); });
  await act(async () => { await pullTimer(); });   // the first delivered batch is history: it primes silently
  await act(async () => { await pullTimer(); });   // the next one is live and must be presented
  const toast = document.querySelector('aside[role="status"]');
  assert.ok(toast, 'a record arriving after load is presented as a card');
  await act(async () => { toast.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })); });
  assert.deepEqual(calls, ['open:target-session'], 'the card jumps straight to its session and writes nothing');
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 260)); });
  const left = [...document.querySelectorAll('aside[role="status"]')].map((node) => node.querySelector('.dsh-notify-toast-source')?.textContent);
  assert.equal(left.includes('target-session'), false, 'the card that was clicked retires, and the other one stays');
  assert.equal(document.querySelector('[role="dialog"]'), null, 'nothing opens a panel: there is no history list any more');

  bound = false; calls.length = 0;
  await act(async () => { globalThis.dispatchEvent(new dom.window.Event('dsh-notify:open-history')); });
  assert.equal(document.querySelector('[role="dialog"]'), null, 'the old history event is inert');
});

test('in-page toast anchors to the conversation column and the 关闭 option removes it without touching history', async (t) => {
  const dom = new JSDOM('<!doctype html><div data-conversation-scroll></div><main id="root"></main>', { url: 'https://dsh.test/' }); let root; let mounted;
  const values = {
    window: dom.window, document: dom.window.document, navigator: dom.window.navigator, localStorage: dom.window.localStorage,
    Event: dom.window.Event, CustomEvent: dom.window.CustomEvent, MouseEvent: dom.window.MouseEvent,
    addEventListener: dom.window.addEventListener.bind(dom.window), removeEventListener: dom.window.removeEventListener.bind(dom.window), dispatchEvent: dom.window.dispatchEvent.bind(dom.window),
    innerWidth: 1024, IS_REACT_ACT_ENVIRONMENT: true,
    fetch: async (url) => String(url).includes('/pull?') ? response({ seq: 0, items: [] }) : response({}),
  };
  const saved = Object.fromEntries(Object.keys(values).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(values)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  t.after(async () => { if (root) await act(async () => { root.unmount(); }); mounted?.destroy(); setToastConfig({ toastPosition: 'conversation', toastEnabled: true }); for (const [key, descriptor] of Object.entries(saved)) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; } dom.window.close(); });

  document.querySelector('[data-conversation-scroll]').getBoundingClientRect = () => ({ right: 700, width: 420, x: 280, left: 280, top: 0, bottom: 600, height: 600 });
  assert.equal(toastAnchor(), 340, 'innerWidth 1024 minus a conversation right edge at 700 plus the 16px gutter');
  const components = new Map();
  const slots = { inject(_name, callback) { const dispose = callback(); return () => dispose?.(); }, register(options, Component) { components.set(options.name, Component); return () => components.delete(options.name); } };
  mounted = mountNotifyClient({ slots });
  root = createRoot(document.getElementById('root'));
  await act(async () => { root.render(React.createElement(components.get('shell.overlay'))); });

  const fire = async (eventId) => { await act(async () => { publishLocalSelfTest({ eventId, localOnly: true, kind: 'completed', title: '任务完成', body: '自检' }); }); };
  const frame = () => document.querySelector('.dsh-notify-frame');
  await fire('anchor-check'); const toast = document.querySelector('aside[role="status"]');
  assert.ok(toast); assert.equal(frame().style.insetInlineEnd, '340px', 'the notification window carries the anchor');
  document.querySelector('[data-conversation-scroll]').getBoundingClientRect = () => ({ right: 1000, width: 720, x: 280, left: 280, top: 0, bottom: 600, height: 600 });
  await act(async () => { document.dispatchEvent(new dom.window.Event('transitionend', { bubbles: true })); });
  assert.equal(frame().style.insetInlineEnd, '40px', 'a sidebar grid transition re-anchors to the expanded conversation right edge');
  assert.match(toast.textContent, /任务完成/);
  assert.equal(toast.dataset.tone, 'success', 'a completed toast carries its tone for the icon/accent colour');
  assert.ok(toast.querySelector('.dsh-notify-toast-icon'), 'react-toastify-style per-result icon');
  assert.equal(toast.querySelector('.dsh-notify-toast-progress'), null, 'a toast carries no countdown: nothing expires on a clock');
  await act(async () => { toast.dispatchEvent(new dom.window.Event('pointerover', { bubbles: true })); });
  assert.equal(document.querySelector('aside[role="status"]'), toast, 'hovering keeps the card where it is');
  const closer = toast.querySelector('button[aria-label="关闭通知"]');
  assert.ok(closer, 'the toast must be closable from its own top-right corner');
  await act(async () => { closer.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })); });
  assert.equal(document.querySelector('aside[role="status"]')?.getAttribute('data-leaving'), 'true', 'closing starts the slide-out');
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 260)); });
  assert.equal(Boolean(document.querySelector('aside[role="status"]')), false, 'closing dismisses the toast');
  assert.equal(document.querySelector('[role="dialog"]'), null, 'closing must not open the history panel');

  setToastConfig({ toastPosition: 'off' }); await fire('off-check');
  assert.equal(Boolean(document.querySelector('aside[role="status"]')), false, '关闭（保留铃铛历史）must stop the in-page toast');
  setToastConfig({ toastPosition: 'viewport' }); await fire('viewport-check');
  const viewportToast = document.querySelector('aside[role="status"]');
  assert.ok(viewportToast, 'the off switch must not latch'); assert.equal(frame().style.insetInlineEnd, '16px');
});

/**
 * Mount only the toast seat against a host whose record list the test drives by hand, so a burst can
 * be delivered one poll at a time. Cards are addressed in DOM order, which is newest first.
 */
async function mountStackSandbox(t, { host = 'live', cardHeight = 0, sessions = null } = {}) {
  const dom = new JSDOM('<!doctype html><div data-conversation-scroll></div><main id="root"></main>', { url: 'https://dsh.test/' });
  let root; let mounted; let pullTimer; let primed = false; let feed = [];
  const listeners = new Set(); let pendingMap = new Map();
  const observable = { getSnapshot: () => pendingMap, subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); } };
  const values = {
    window: dom.window, document: dom.window.document, navigator: dom.window.navigator, localStorage: dom.window.localStorage,
    Event: dom.window.Event, CustomEvent: dom.window.CustomEvent, MouseEvent: dom.window.MouseEvent,
    addEventListener: dom.window.addEventListener.bind(dom.window), removeEventListener: dom.window.removeEventListener.bind(dom.window), dispatchEvent: dom.window.dispatchEvent.bind(dom.window),
    innerWidth: 1024, IS_REACT_ACT_ENVIRONMENT: true,
    setInterval: (fn) => { pullTimer = fn; return 1; }, clearInterval: () => {},
    fetch: async (url) => {
      if (!String(url).includes('/pull?')) return response({ ok: true });
      if (!primed) { primed = true; return response(host === 'legacy' ? { epoch: 1, cursor: 0, reset: true, items: [] } : { seq: 0, items: [] }); }
      // 'legacy': the pre-buffer host answers the old cursor protocol and re-sends everything, with no
      // sequence to advance. 'duplicate': a host whose sequence never moves, so it repeats itself too.
      // Either way the records come back as FRESH objects, exactly as a JSON round trip delivers them:
      // a shared reference would hide the difference between "the same notification again" and "the
      // host settled it", which is the whole point of these two tests.
      const items = feed.map((record) => JSON.parse(JSON.stringify(record)));
      if (host === 'legacy') return response({ epoch: 1, cursor: 9, reset: true, items });
      return response({ seq: host === 'duplicate' ? 0 : feed.length, items });
    },
  };
  const saved = Object.fromEntries(Object.keys(values).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(values)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  t.after(async () => { if (root) await act(async () => { root.unmount(); }); mounted?.destroy(); for (const [key, descriptor] of Object.entries(saved)) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; } dom.window.close(); });
  const hidden = { value: false };
  Object.defineProperty(dom.window.document, 'hidden', { configurable: true, get: () => hidden.value });
  const title = { value: 'DeepSeek Harness' };
  Object.defineProperty(dom.window.document, 'title', { configurable: true, get: () => title.value, set: (next) => { title.value = next; } });
  document.querySelector('[data-conversation-scroll]').getBoundingClientRect = () => ({ right: 700, width: 420, x: 280, left: 280, top: 0, bottom: 600, height: 600 });
  // jsdom lays nothing out, so a card height has to be faked. When a test asks for one it is faked as
  // "zero until this frame is in the top layer", which is exactly what a real browser reports for a
  // `popover` that has not been shown yet — the condition that used to make a whole batch measure as 0.
  if (cardHeight > 0) {
    let topLayer = false;
    const isFrame = (node) => Boolean(node?.classList?.contains?.('dsh-notify-frame'));
    dom.window.HTMLElement.prototype.showPopover = function showPopover() { if (isFrame(this)) topLayer = true; };
    dom.window.HTMLElement.prototype.hidePopover = function hidePopover() { if (isFrame(this)) topLayer = false; };
    const matches = dom.window.Element.prototype.matches;
    dom.window.Element.prototype.matches = function matchesPatched(selector) { return selector === ':popover-open' ? isFrame(this) && topLayer : matches.call(this, selector); };
    Object.defineProperty(dom.window.HTMLElement.prototype, 'offsetHeight', { configurable: true, get() { return topLayer && this.classList?.contains?.('dsh-notify-toast') ? cardHeight : 0; } });
  }
  const components = new Map();
  const slots = { inject(_name, callback) { const dispose = callback(); return () => dispose?.(); }, register(options, Component) { if (options.inject) components.set(`${options.name}:props`, options.inject()); components.set(options.name, Component); return () => components.delete(options.name); } };
  mounted = mountNotifyClient({ slots, ...(sessions ? { sessions } : {}), getUiSession: () => ({ sessionStatus: observable }) });
  root = createRoot(document.getElementById('root'));
  const wait = async (ms) => { await act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)); }); };
  await act(async () => { root.render(React.createElement(components.get('shell.overlay'), components.get('shell.overlay:props'))); });
  await wait(30);
  const nodes = () => [...document.querySelectorAll('aside[role="status"]')];
  const slotsOf = () => [...document.querySelectorAll('.dsh-notify-slot')];
  return {
    push: (record) => { feed = [...feed, record]; },
    // The settings self-test goes through the page-local event, not the poll: same corner, same commit.
    local: async (records) => { await act(async () => { for (const record of records) publishLocalSelfTest(record); }); },
    setHidden: async (value) => { hidden.value = value; await act(async () => { document.dispatchEvent(new dom.window.Event('visibilitychange')); }); },
    // One published pending interaction is wrapped into the 0.1.7 Session status snapshot shape.
    publish: (next) => { pendingMap = new Map([...next].map(([sessionId, interaction]) => [sessionId, { pendingInteraction: interaction }])); for (const listener of listeners) listener(); },
    tick: async () => { await act(async () => { await pullTimer(); }); await wait(20); },
    wait,
    nodes,
    count: () => nodes().length,
    titles: () => nodes().map((node) => node.querySelector('.dsh-notify-toast-title')?.textContent),
    transforms: () => slotsOf().map((node) => node.style.transform),
    statuses: () => nodes().map((node) => node.getAttribute('data-status')),
    answers: (index = 0) => [...nodes()[index].querySelectorAll('.dsh-notify-toast-answer')],
    closer: (index = 0) => nodes()[index].querySelector('button[aria-label="关闭通知"]'),
    click: async (target) => { await act(async () => { target.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })); }); },
    press: async (index = 0) => { await act(async () => { nodes()[index].dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })); }); },
    hover: async (index = 0) => { await act(async () => { nodes()[index].dispatchEvent(new dom.window.Event('pointerover', { bubbles: true })); }); },
    leave: async (index = 0) => { await act(async () => { nodes()[index].dispatchEvent(new dom.window.Event('pointerout', { bubbles: true })); }); },
    // The pointer, not the mouse: React derives enter/leave from the target's `relatedTarget`, which is
    // how a real browser reports "the pointer left this card and landed on the container behind it".
    pointer: async (target, type, related = null) => { await act(async () => { const event = new dom.window.Event(type, { bubbles: true }); Object.defineProperty(event, 'relatedTarget', { value: related }); target.dispatchEvent(event); }); },
    scrollTo: (impl) => { dom.window.Element.prototype.scrollTo = impl; },
    stack: () => document.querySelector('.dsh-notify-stack'),
    frame: () => document.querySelector('.dsh-notify-frame'),
    overflow: () => document.querySelector('.dsh-notify-stack')?.getAttribute('data-overflow'),
    windowHeight: () => document.querySelector('.dsh-notify-frame')?.style.height,
    contentHeight: () => document.querySelector('.dsh-notify-stack-inner')?.style.height,
    badge: () => document.querySelector('.dsh-notify-count')?.textContent ?? null,
    times: () => nodes().map((node) => node.querySelector('.dsh-notify-toast-time')?.textContent ?? null),
    headParts: (index = 0) => [...nodes()[index].querySelectorAll('.dsh-notify-toast-head > *')],
    tabTitle: () => title.value,
  };
}

const burstRecord = (n) => ({ eventId: `burst-${n}`, mergeKey: `turn:s1:${n}`, kind: 'completed', sessionId: 's1', title: `任务完成 ${n}`, body: '', at: n, phase: 'settled' });
/**
 * The smallest sessions service a card click can really go through: it lists `ids`, and `open` selects
 * (`list.current` is the older host; current DSH uses `uiWorkspace.openSession` + `retainedBy.mainView`).
 */
function fakeSessions(ids = ['s1']) {
  let current;
  return {
    binding: (id) => (ids.includes(id) ? {} : undefined),
    open: (id) => { current = id; },
    list: { getSnapshot: () => ({ current, byId: Object.fromEntries(ids.map((id) => [id, {}])) }) },
  };
}

test('the corner folds a newest-first pile and keeps every card for expansion', async (t) => {
  const sandbox = await mountStackSandbox(t);
  for (const n of [1, 2, 3, 4, 5]) { sandbox.push(burstRecord(n)); await sandbox.tick(); }
  assert.equal(sandbox.count(), 5, 'every notification remains mounted');
  assert.deepEqual(sandbox.titles(), ['任务完成 5', '任务完成 4', '任务完成 3', '任务完成 2', '任务完成 1'], 'the newest takes the top slot');
  assert.equal(sandbox.stack().getAttribute('data-collapsed'), 'true');
  assert.deepEqual(sandbox.transforms(), ['translateY(0px)', 'translateY(18px)', 'translateY(36px)', 'translateY(54px)', 'translateY(72px)'], 'unmeasured cards preserve equal 18px lips until the browser measures them');
  assert.equal(sandbox.windowHeight(), '58px', 'the folded frame reserves three exposed 18px edges');
  assert.equal(sandbox.badge(), null, 'the pile communicates its depth visually instead of with a queue badge');

  await sandbox.pointer(sandbox.stack(), 'pointerover');
  assert.equal(sandbox.stack().getAttribute('data-collapsed'), 'false', 'entering the pile expands it');
  assert.deepEqual(sandbox.transforms(), ['translateY(0px)', 'translateY(12px)', 'translateY(24px)', 'translateY(36px)', 'translateY(48px)'], 'the same cards expand into their complete slots without being recreated');
  assert.equal(sandbox.count(), 5, 'expansion does not discard cards');
});

test('a card closes on click, and an in-flight answer shows loading before it succeeds or fails', async (t) => {
  const sandbox = await mountStackSandbox(t);
  const question = (n) => ({ eventId: `question:s1:call-${n}`, mergeKey: `question:s1:call-${n}`, kind: 'question', sessionId: 's1', title: '需要回复', body: '通道范围？', at: 10 + n, unread: true, phase: 'open' });
  sandbox.push(question(1));
  await sandbox.tick();
  assert.equal(sandbox.count(), 1);

  // The host has not answered yet: the click has to look like work, not like a dead button.
  let release; const gate = new Promise((resolve) => { release = resolve; });
  sandbox.publish(new Map([['s1', { kind: 'question', questions: [{ id: 'q1', options: [{ label: '批准' }] }], answer: () => gate }]]));
  await sandbox.wait(20);
  await sandbox.click(sandbox.answers(0).find((node) => node.textContent === '批准'));
  assert.deepEqual(sandbox.statuses(), ['loading'], 'the card reports the answer as in flight');
  assert.equal(sandbox.nodes()[0].querySelector('.dsh-notify-toast-icon').getAttribute('data-spin'), 'true', 'the icon spins while it waits');
  assert.match(sandbox.nodes()[0].textContent, /正在提交/);
  assert.equal(sandbox.answers(0).every((node) => node.disabled), true, 'and no second click can fire');

  release();
  await sandbox.wait(40);
  assert.deepEqual(sandbox.statuses(), ['success'], 'the host confirmed: the card settles on success');
  assert.match(sandbox.nodes()[0].textContent, /已完成/);
  await sandbox.wait(1200);
  assert.equal(sandbox.count(), 0, 'a succeeded card retires on its own');

  // A refusal is reported in place, with a way to try again.
  sandbox.push(question(2));
  await sandbox.tick();
  sandbox.publish(new Map([['s1', { kind: 'question', questions: [{ id: 'q2', options: [{ label: '拒绝' }] }], answer: async () => { throw new Error('宿主拒绝了这次回答'); } }]]));
  await sandbox.wait(20);
  await sandbox.click(sandbox.answers(0).find((node) => node.textContent === '拒绝'));
  await sandbox.wait(40);
  assert.deepEqual(sandbox.statuses(), ['error'], 'a failed answer is not silently swallowed');
  assert.equal(sandbox.nodes()[0].getAttribute('data-tone'), 'error');
  assert.match(sandbox.nodes()[0].textContent, /宿主拒绝了这次回答/);
  assert.ok(sandbox.answers(0).some((node) => node.textContent === '重试'), 'and the card offers a retry');
});

test('a toast stays until the user closes it or opens its session', async (t) => {
  const sandbox = await mountStackSandbox(t, { sessions: fakeSessions() });
  sandbox.push(burstRecord(1));
  await sandbox.tick();
  assert.equal(sandbox.count(), 1);

  // Nothing here runs on a clock: the card has to outlive the 6s countdown this used to carry.
  await sandbox.wait(1200);
  assert.equal(sandbox.count(), 1, 'a notification does not expire on its own');
  assert.equal(sandbox.nodes()[0].querySelector('.dsh-notify-toast-progress'), null, 'and it carries no countdown bar');
  for (let poll = 0; poll < 3; poll += 1) await sandbox.tick();
  assert.equal(sandbox.count(), 1, 'refreshing the record list leaves it alone too');

  await sandbox.click(sandbox.closer(0));
  assert.equal(sandbox.nodes()[0].getAttribute('data-leaving'), 'true', 'the × starts the slide-out');
  await sandbox.wait(260);
  assert.equal(sandbox.count(), 0, 'and then the card is gone');

  // Clicking the body is the other way out: it opens the session and retires the card with it.
  sandbox.push(burstRecord(2));
  await sandbox.tick();
  assert.equal(sandbox.count(), 1);
  await sandbox.press(0);
  await sandbox.wait(260);
  assert.equal(sandbox.count(), 0, 'opening the session retires its card');
});

test('a notification that arrived in a background tab is still waiting when the user comes back', async (t) => {
  const sandbox = await mountStackSandbox(t);
  await sandbox.setHidden(true);
  sandbox.push(burstRecord(7));
  await sandbox.tick();
  assert.equal(sandbox.count(), 1, 'the background notification is toasted');
  await sandbox.wait(1200);
  assert.equal(sandbox.count(), 1, 'and it is still there while nobody can see it');

  await sandbox.setHidden(false);
  assert.equal(sandbox.count(), 1, 'coming back to the tab finds it waiting');
  await sandbox.wait(1200);
  assert.equal(sandbox.count(), 1, 'and looking at it is not a dismissal either');
});

test('a legacy host that re-sends its whole buffer cannot make a card flash and vanish', async (t) => {
  const sandbox = await mountStackSandbox(t, { host: 'legacy' });
  sandbox.push(burstRecord(1));
  await sandbox.tick();
  assert.equal(sandbox.count(), 1, 'the notification appears');
  for (let poll = 0; poll < 3; poll += 1) await sandbox.tick();
  await sandbox.wait(300);   // long enough for a slide-out to have finished, had the card been retired
  assert.equal(sandbox.count(), 1, 'and it is still there: a repeat of the same record is not a reason to close it');
  assert.equal(sandbox.nodes()[0].getAttribute('data-leaving'), 'false');
});

test('a host whose sequence never advances cannot make a card flash and vanish', async (t) => {
  const sandbox = await mountStackSandbox(t, { host: 'duplicate' });
  sandbox.push(burstRecord(1));
  await sandbox.tick();
  assert.equal(sandbox.count(), 1);
  for (let poll = 0; poll < 3; poll += 1) await sandbox.tick();
  await sandbox.wait(300);
  assert.equal(sandbox.count(), 1, 'every poll re-delivers the same record; none of them is news');
  assert.equal(sandbox.nodes()[0].getAttribute('data-leaving'), 'false');
});

test('an approval the host settles does retire its card', async (t) => {
  const sandbox = await mountStackSandbox(t);
  const approval = { eventId: 'approval:1', mergeKey: 'approval:1', kind: 'approval', sessionId: 's1', title: '需要审批', body: 'bash', at: 1, phase: 'open' };
  sandbox.push(approval);
  await sandbox.tick();
  assert.equal(sandbox.count(), 1, 'the approval is on screen, waiting');
  sandbox.push({ ...approval, phase: 'settled', outcome: 'allowed-once' });
  await sandbox.tick();
  await sandbox.wait(260);
  assert.equal(sandbox.count(), 0, 'the host decided it, so the card stops asking');
});

test('nothing is dropped: every card expands from the folded pile into its own slot', async (t) => {
  const sandbox = await mountStackSandbox(t);
  const live = () => sandbox.nodes().filter((node) => node.getAttribute('data-leaving') !== 'true');
  // One card that waits on the user, then a burst of finished work on top of it.
  sandbox.push({ eventId: 'ask-1', mergeKey: 'ask-1', kind: 'question', sessionId: 's1', title: '需要回复', body: '还在等你', at: 1, phase: 'open' });
  await sandbox.tick();
  assert.equal(live().length, 1);
  for (const n of [2, 3, 4, 5, 6, 7]) { sandbox.push(burstRecord(n)); await sandbox.tick(); }

  assert.equal(live().length, 7, 'every card remains in the stack');
  assert.deepEqual(sandbox.titles(), ['需要回复', '任务完成 7', '任务完成 6', '任务完成 5', '任务完成 4', '任务完成 3', '任务完成 2']);
  assert.equal(sandbox.stack().getAttribute('data-collapsed'), 'true');
  assert.equal(sandbox.badge(), null, 'the folded edges replace the old queue counter');
  assert.deepEqual(sandbox.transforms(), ['translateY(0px)', 'translateY(18px)', 'translateY(36px)', 'translateY(54px)', 'translateY(72px)', 'translateY(90px)', 'translateY(108px)']);

  await sandbox.pointer(sandbox.stack(), 'pointerover');
  assert.equal(sandbox.stack().getAttribute('data-collapsed'), 'false');
  assert.deepEqual(sandbox.transforms(), ['translateY(0px)', 'translateY(12px)', 'translateY(24px)', 'translateY(36px)', 'translateY(48px)', 'translateY(60px)', 'translateY(72px)']);

  await sandbox.click(sandbox.closer(0));
  await sandbox.wait(320);
  assert.equal(live().length, 6, 'closing removes only the selected card');
  assert.deepEqual(sandbox.titles(), ['任务完成 7', '任务完成 6', '任务完成 5', '任务完成 4', '任务完成 3', '任务完成 2'], 'the next finished card moves into the freed slot');
});


test('every card says when it happened, on the line the session name already used', async (t) => {
  const sandbox = await mountStackSandbox(t);
  // The card renders against the real clock, so "today at 09:05:03" is built from today's own date:
  // the label under test is the clock form, and the date form has its own unit test.
  const today = new Date(); const pad = (value) => String(value).padStart(2, '0');
  const day = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
  const at = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 9, 5, 3).getTime();
  sandbox.push({ ...burstRecord(1), at });
  await sandbox.tick();
  const time = sandbox.nodes()[0].querySelector('.dsh-notify-toast-time');
  assert.equal(time?.tagName, 'TIME', 'it is a real time element, not just styled text');
  assert.equal(time.textContent, '09:05:03', 'the clock, to the second');
  assert.equal(time.getAttribute('datetime'), new Date(at).toISOString(), 'machine-readable stamp');
  assert.equal(time.getAttribute('title'), `${day} 09:05:03`, 'the full date is one hover away');
  // The time shares the metadata row with the session name: adding it must not add a line to the card,
  // which is what keeps five cards in the same window they fitted in before.
  assert.deepEqual(sandbox.headParts(0).map((node) => node.className), ['dsh-notify-toast-time', 'dsh-notify-toast-source'], 'the clock leads, so the +N chip and the close button keep the right end of the row to themselves');
  assert.equal(sandbox.nodes()[0].querySelectorAll('.dsh-notify-toast-body > *').length, 2, 'head and title — the clock added no row');
  // A record without a usable stamp renders without one, instead of an empty element that shifts the row.
  sandbox.push({ ...burstRecord(2), at: undefined });
  await sandbox.tick();
  assert.deepEqual(sandbox.times(), [null, '09:05:03'], 'the undated card simply has no clock');
  assert.equal(sandbox.headParts(0).length, 1, 'and its row holds only the session name');
});

test('a batch delivered by one poll arrives whole, measured before it is ever visible', async (t) => {
  // The real numbers, as the browser reported them: a card is 114px tall and the window is five of them.
  const cardHeight = 114; const step = cardHeight + TOAST_STACK_GAP;
  const sandbox = await mountStackSandbox(t, { cardHeight });
  // Eight records delivered by ONE poll, so the whole batch is created in a single commit — while the
  // frame is still hidden and every card honestly reports a height of 0.
  for (const n of [1, 2, 3, 4, 5, 6, 7, 8]) sandbox.push(burstRecord(n));
  await sandbox.tick();
  assert.equal(sandbox.count(), 8, 'the whole batch is on screen, not one card per poll');
  assert.deepEqual(sandbox.titles(), ['任务完成 8', '任务完成 7', '任务完成 6', '任务完成 5', '任务完成 4', '任务完成 3', '任务完成 2', '任务完成 1'],
    'with the newest still on top');
  assert.deepEqual(sandbox.transforms(), [0, 1, 2, 3, 4, 5, 6, 7].map((index) => `translateY(${index * 18}px)`),
    'the complete cards are folded under equal 18px exposed edges');
  assert.equal(sandbox.stack().getAttribute('data-collapsed'), 'true');
  assert.equal(sandbox.windowHeight(), `${cardHeight + 18 * 3 + 4}px`, 'the folded stack is fully measured before its first visible paint');
  assert.equal(sandbox.badge(), null, 'the visual pile replaces the old queue count');
});

test('the settings self-test paints finished too: the corner is measured before it is shown', async (t) => {
  const cardHeight = 114; const step = cardHeight + TOAST_STACK_GAP;
  const sandbox = await mountStackSandbox(t, { cardHeight });
  // 设置 → 通知 → 测试 8 条: eight records published in one tick, into a corner that is still empty and
  // therefore still a hidden popover. This is the click the user reported the flash from.
  await sandbox.local(createLocalSelfTestBatch({ count: 8, randomUUID: () => 'self-test' }));
  assert.equal(sandbox.count(), 8, 'eight cards from one self-test');
  assert.deepEqual(sandbox.transforms(), [0, 1, 2, 3, 4, 5, 6, 7].map((index) => `translateY(${index * 18}px)`),
    'the self-test gets the same equal-edge folded treatment');
  assert.equal(sandbox.windowHeight(), `${cardHeight + 18 * 3 + 4}px`);
  assert.equal(sandbox.badge(), null);
});

test('a card whose session is gone stays put and says why', async (t) => {
  // The page's list no longer holds this record's session, so the click has nowhere to go.
  const sandbox = await mountStackSandbox(t, { sessions: fakeSessions(['other-session']) });
  sandbox.push(burstRecord(1));
  await sandbox.tick();
  await sandbox.press(0);
  await sandbox.wait(40);
  assert.equal(sandbox.count(), 1, 'the card does not vanish as if the jump had worked');
  assert.deepEqual(sandbox.statuses(), ['error']);
  assert.equal(sandbox.nodes()[0].getAttribute('data-tone'), 'error');
  assert.match(sandbox.nodes()[0].textContent, /这个会话已经不在了，无法打开/);
  assert.equal(sandbox.answers(0).some((node) => node.textContent === '重试'), false, 'no answer-retry button: nothing was being answered');
  // It is still an ordinary card: × takes it away.
  await sandbox.click(sandbox.closer(0));
  await sandbox.wait(260);
  assert.equal(sandbox.count(), 0, 'and closing it still works');
});

test('a click that cannot go anywhere says which way it failed', async (t) => {
  // No sessions service at all: the host exposes nothing to jump with, which is a transient problem.
  const sandbox = await mountStackSandbox(t);
  sandbox.push(burstRecord(1));
  await sandbox.tick();
  await sandbox.press(0);
  await sandbox.wait(40);
  assert.equal(sandbox.count(), 1, 'the card stays available for another try');
  assert.match(sandbox.nodes()[0].textContent, /没能打开这个会话，再点一次试试/);

  // A record with no session of its own — the shape a 工作流结束 record used to have — is a different
  // fact, and says so rather than blaming the navigation.
  sandbox.push({ ...burstRecord(2), sessionId: undefined });
  await sandbox.tick();
  await sandbox.press(0);
  await sandbox.wait(40);
  assert.match(sandbox.nodes()[0].textContent, /这条通知没有可以打开的会话/);
});
