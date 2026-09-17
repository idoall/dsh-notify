import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import { mountNotifyClient, NotificationSelfTests, publishLocalSelfTest, setToastConfig, toastAnchor } from '../src/client.js';

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
        const live = { eventId: 'live', mergeKey: 'turn:live', kind: 'completed', sessionId: 's1', title: '任务完成', body: '新事件', at: 2, unread: true, phase: 'settled' };
        pulls += 1;
        // The store may pull more than once while mounting; every mount pull stays a silent reset.
        return response(releaseLive ? { seq: 2, items: [prime, live] } : { seq: 1, items: [prime] });
      }
      return response({});
    },
  };
  const saved = Object.fromEntries(Object.keys(values).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(values)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  t.after(async () => { if (root) await act(async () => { root.unmount(); }); mounted?.destroy(); setToastConfig({ sound: 'chime', soundEnabled: true }); for (const [key, descriptor] of Object.entries(saved)) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; } dom.window.close(); });

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
  assert.ok(document.querySelector('aside.dsh-notify-toast'), 'the live record is toasted');
  assert.deepEqual(started, [880, 1318.5], 'a live toast plays the configured built-in cue');

  setToastConfig({ sound: 'custom:ding.mp3' });
  await act(async () => { publishLocalSelfTest({ eventId: 'local-1', localOnly: true, kind: 'completed', title: '任务完成', body: '自定义音' }); });
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
  assert.deepEqual(audioSrc, ['/plugins/dsh-notify/sound?name=ding.mp3'], 'a custom choice plays the uploaded file');
});

test('a question toast closes itself when the answer happens elsewhere', async (t) => {
  const dom = new JSDOM('<!doctype html><div data-conversation-scroll></div><main id="root"></main>', { url: 'https://dsh.test/' });
  let root; let mounted; let pullTimer;
  const listeners = new Set(); let pendingMap = new Map();
  const observable = { getSnapshot: () => pendingMap, subscribe: (listener) => { listeners.add(listener); return () => listeners.delete(listener); } };
  const publish = (next) => { pendingMap = next; for (const listener of listeners) listener(); };
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
  mounted = mountNotifyClient({ slots, sessions, getUiSession: () => ({ pendingInteractions: observable }) });
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
    fetch: async (url) => String(url).includes('/pull?') ? response({ seq: release ? 2 : 1, items: release ? items : [] }) : response({}),
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
  assert.equal(document.querySelector('aside.dsh-notify-toast'), null, 'history never toasts on load, even when it contains an open record');

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
  const observable = { getSnapshot: () => pendingMap, subscribe: (listener) => { listeners.add(listener); return () => listeners.delete(listener); } };
  const publish = (next) => { pendingMap = next; for (const listener of listeners) listener(); };
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
  mounted = mountNotifyClient({ slots, sessions, getUiSession: () => ({ pendingInteractions: observable }) });
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
  const stack = () => document.querySelector('.dsh-notify-stack');
  await fire('anchor-check'); const toast = document.querySelector('aside[role="status"]');
  assert.ok(toast); assert.equal(stack().style.insetInlineEnd, '340px', 'the stack container carries the anchor');
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
  assert.ok(viewportToast, 'the off switch must not latch'); assert.equal(stack().style.insetInlineEnd, '16px');
});

/**
 * Mount only the toast seat against a host whose record list the test drives by hand, so a burst can
 * be delivered one poll at a time. Cards are addressed in DOM order, which is newest first.
 */
async function mountStackSandbox(t, { host = 'live' } = {}) {
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
  const components = new Map();
  const slots = { inject(_name, callback) { const dispose = callback(); return () => dispose?.(); }, register(options, Component) { if (options.inject) components.set(`${options.name}:props`, options.inject()); components.set(options.name, Component); return () => components.delete(options.name); } };
  mounted = mountNotifyClient({ slots, getUiSession: () => ({ pendingInteractions: observable }) });
  root = createRoot(document.getElementById('root'));
  const wait = async (ms) => { await act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)); }); };
  await act(async () => { root.render(React.createElement(components.get('shell.overlay'), components.get('shell.overlay:props'))); });
  await wait(30);
  const nodes = () => [...document.querySelectorAll('aside[role="status"]')];
  const slotsOf = () => [...document.querySelectorAll('.dsh-notify-slot')];
  return {
    push: (record) => { feed = [...feed, record]; },
    setHidden: async (value) => { hidden.value = value; await act(async () => { document.dispatchEvent(new dom.window.Event('visibilitychange')); }); },
    publish: (next) => { pendingMap = next; for (const listener of listeners) listener(); },
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
    stack: () => document.querySelector('.dsh-notify-stack'),
    expanded: () => document.querySelector('.dsh-notify-stack')?.getAttribute('data-expanded'),
    depths: () => slotsOf().map((node) => node.getAttribute('data-depth')),
    tabTitle: () => title.value,
  };
}

const burstRecord = (n) => ({ eventId: `burst-${n}`, mergeKey: `turn:s1:${n}`, kind: 'completed', sessionId: 's1', title: `任务完成 ${n}`, body: '', at: n, phase: 'settled' });

test('five cards lie flat, and the rest are hidden behind the count instead of dropped', async (t) => {
  const sandbox = await mountStackSandbox(t);
  for (const n of [1, 2, 3, 4, 5]) { sandbox.push(burstRecord(n)); await sandbox.tick(); }
  assert.equal(sandbox.count(), 5, 'five notifications lie flat');
  assert.deepEqual(sandbox.titles(), ['任务完成 5', '任务完成 4', '任务完成 3', '任务完成 2', '任务完成 1'], 'the newest takes the top slot');
  assert.deepEqual(sandbox.transforms(), ['translateY(0px) scale(1)', 'translateY(12px) scale(1)', 'translateY(24px) scale(1)', 'translateY(36px) scale(1)', 'translateY(48px) scale(1)'], 'each card is pushed down by the ones above it');
  assert.equal(document.querySelector('.dsh-notify-toast-more'), null, 'nothing is hidden yet');

  sandbox.push(burstRecord(6));
  await sandbox.tick();
  assert.equal(sandbox.count(), 5, 'the corner keeps showing five');
  assert.deepEqual(sandbox.transforms(), ['translateY(0px) scale(1)', 'translateY(10px) scale(0.96)', 'translateY(20px) scale(0.92)', 'translateY(30px) scale(0.88)', 'translateY(40px) scale(0.84)'], 'and turns into a deck, so "there is more" is visible');
  assert.equal(document.querySelector('.dsh-notify-toast-more').textContent, '+1', 'the front card counts what is not on screen');
  // A layer behind the front card is an edge, not a card: it carries a depth so the stylesheet can
  // hide its contents, which is what stops a taller notification from leaking a line of its text.
  assert.equal(sandbox.stack().getAttribute('data-decked'), 'true', 'the stack says it is a deck');
  assert.deepEqual(sandbox.depths(), ['0', '1', '2', '3', '4'], 'and marks every layer behind the front card');

  // Hovering shows the whole queue, and every card that was behind the count is really there.
  await sandbox.hover();
  assert.equal(sandbox.count(), 6, 'hovering expands the whole queue');
  assert.deepEqual(sandbox.transforms(), ['', '', '', '', '', ''], 'the expanded column is laid out in flow, not by transform');
  assert.deepEqual(sandbox.titles(), ['任务完成 6', '任务完成 5', '任务完成 4', '任务完成 3', '任务完成 2', '任务完成 1']);
  assert.equal(document.querySelector('.dsh-notify-toast-more'), null, 'and the count chip belongs to the collapsed state only');
  assert.equal(sandbox.stack().getAttribute('data-decked'), 'false', 'and every card is a card again');
  assert.deepEqual(sandbox.depths(), ['0', '0', '0', '0', '0', '0']);
  await sandbox.leave();
  await sandbox.wait(200);
  assert.equal(sandbox.count(), 5, 'leaving the stack collapses it again');
  assert.equal(document.querySelector('.dsh-notify-toast-more').textContent, '+1');
});

test('crossing the gap between two expanded cards keeps the stack open instead of flickering', async (t) => {
  const sandbox = await mountStackSandbox(t);
  for (const n of [1, 2, 3, 4, 5, 6, 7, 8]) { sandbox.push(burstRecord(n)); await sandbox.tick(); }
  assert.equal(sandbox.count(), 5, 'eight cards, five on screen');
  assert.equal(sandbox.expanded(), 'false');

  await sandbox.hover();
  assert.equal(sandbox.expanded(), 'true', 'hovering a card expands the stack');
  assert.equal(sandbox.count(), 8, 'and every hidden card is rendered');

  // The pointer is now over the 12px gap: it left the card but not the container, so the stack must
  // stay open. The card is the only node a boundary event can name here — the gap IS the container —
  // and a card-level leave listener collapsed the stack at this exact moment, which flickered.
  await sandbox.pointer(sandbox.nodes()[0], 'pointerout', sandbox.stack());
  await sandbox.wait(200);
  assert.equal(sandbox.expanded(), 'true', 'moving from a card into the gap leaves the stack open');
  assert.equal(sandbox.count(), 8, 'and nothing is re-sorted away underneath the pointer');

  // Leaving the container for the page is the real exit, and it still collapses — after the grace.
  await sandbox.pointer(sandbox.stack(), 'pointerout', document.body);
  assert.equal(sandbox.expanded(), 'true', 'the grace period keeps it open for a moment');
  await sandbox.wait(200);
  assert.equal(sandbox.expanded(), 'false', 'and then the stack collapses');
  assert.equal(sandbox.count(), 5, 'back to the window');
  assert.equal(document.querySelector('.dsh-notify-toast-more').textContent, '+3', 'with the three hidden ones counted');
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
  const sandbox = await mountStackSandbox(t);
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

test('nothing is dropped: the corner shows five, the count hides the rest, and expanding brings them all back', async (t) => {
  const sandbox = await mountStackSandbox(t);
  const live = () => sandbox.nodes().filter((node) => node.getAttribute('data-leaving') !== 'true');
  // One card that waits on the user, then a burst of finished work on top of it.
  sandbox.push({ eventId: 'ask-1', mergeKey: 'ask-1', kind: 'question', sessionId: 's1', title: '需要回复', body: '还在等你', at: 1, phase: 'open' });
  await sandbox.tick();
  assert.equal(live().length, 1);
  for (const n of [2, 3, 4, 5, 6, 7]) { sandbox.push(burstRecord(n)); await sandbox.tick(); }

  // Seven cards in the page, five on screen: waiting work first, then the newest finished ones.
  assert.equal(live().length, 5, 'the corner stays at five cards');
  assert.deepEqual(live().map((node) => node.querySelector('.dsh-notify-toast-title').textContent), ['需要回复', '任务完成 7', '任务完成 6', '任务完成 5', '任务完成 4']);
  assert.equal(document.querySelector('.dsh-notify-toast-more').textContent, '+2', 'the chip counts what is not on screen, not what was thrown away');

  // Expanding shows every one of them — nothing was dropped to fit.
  await sandbox.hover();
  assert.equal(sandbox.count(), 7, 'expanding brings the whole queue back');
  assert.deepEqual(sandbox.titles(), ['需要回复', '任务完成 7', '任务完成 6', '任务完成 5', '任务完成 4', '任务完成 3', '任务完成 2']);
  assert.equal(document.querySelector('.dsh-notify-toast-more'), null);

  await sandbox.leave();
  await sandbox.wait(200);
  assert.equal(live().length, 5, 'and collapsing it puts the count back');
  assert.equal(document.querySelector('.dsh-notify-toast-more').textContent, '+2');

  // A card that leaves takes only itself out of the queue.
  await sandbox.click(sandbox.closer(0));
  await sandbox.wait(320);
  assert.equal(live().length, 5, 'the queue drops from seven to six and the window stays full');
  assert.equal(document.querySelector('.dsh-notify-toast-more').textContent, '+1');
  assert.deepEqual(live().map((node) => node.querySelector('.dsh-notify-toast-title').textContent), ['任务完成 7', '任务完成 6', '任务完成 5', '任务完成 4', '任务完成 3'], 'the next finished card moves up into the freed slot');
});

