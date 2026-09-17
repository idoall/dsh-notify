import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import { mountNotifyClient, NotificationSelfTests } from '../src/client.js';

const response = (value) => ({ ok: true, json: async () => value });

test('the self-test card only exercises the page: one button, no host request', async (t) => {
  const dom = new JSDOM('<!doctype html><main id="root"></main>', { url: 'https://dsh.test/' });
  let root; let mounted; let requests = 0;
  const values = {
    window: dom.window, document: dom.window.document, navigator: dom.window.navigator, localStorage: dom.window.localStorage,
    Event: dom.window.Event, CustomEvent: dom.window.CustomEvent, MouseEvent: dom.window.MouseEvent,
    addEventListener: dom.window.addEventListener.bind(dom.window), removeEventListener: dom.window.removeEventListener.bind(dom.window), dispatchEvent: dom.window.dispatchEvent.bind(dom.window),
    innerWidth: 1024, IS_REACT_ACT_ENVIRONMENT: true,
    setInterval: () => 1, clearInterval: () => {},
    fetch: async () => { requests += 1; return response({}); },
  };
  const saved = Object.fromEntries(Object.keys(values).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(values)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  t.after(async () => { if (root) await act(async () => { root.unmount(); }); mounted?.destroy(); for (const [key, descriptor] of Object.entries(saved)) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; } dom.window.close(); });

  document.querySelector('[data-conversation-scroll]') ?? document.body;
  const components = new Map();
  const slots = { inject(_name, callback) { const dispose = callback(); return () => dispose?.(); }, register(options, Component) { if (options.inject) components.set(`${options.name}:props`, options.inject()); components.set(options.name, Component); return () => components.delete(options.name); } };
  mounted = mountNotifyClient({ slots });
  root = createRoot(document.getElementById('root'));
  await act(async () => {
    root.render(React.createElement(React.Fragment, null,
      React.createElement(components.get('shell.overlay'), components.get('shell.overlay:props')),
      React.createElement(NotificationSelfTests)));
  });
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });

  assert.ok(document.querySelector('[aria-label="通知自测"]'), 'the card is there');
  assert.equal(document.querySelector('[aria-label="A 页面里"]'), null, 'the old dimension grid is gone with the host self-tests');
  const one = [...document.querySelectorAll('button')].find((node) => node.textContent === '测试一条');
  const windowed = [...document.querySelectorAll('button')].find((node) => node.textContent === '测试 5 条');
  const overflowing = [...document.querySelectorAll('button')].find((node) => node.textContent === '测试 8 条');
  assert.ok(one && windowed && overflowing, 'the three self-test buttons are offered');
  const button = one;
  const before = requests;   // the overlay polls on its own; only the click must stay silent
  await act(async () => { button.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  const toast = document.querySelector('aside[role="status"]');
  assert.ok(toast, 'the page toast is the only thing this test can prove');
  assert.match(toast.textContent, /自测：页面浮层/);
  assert.equal(requests, before, 'a page test never talks to the host');
  assert.equal(document.querySelector('section[aria-label="通知历史"]'), null, 'and there is no history panel to look in');

  // The window-sized group is what "the stack is full" looks like: five cards, nothing hidden behind
  // the count yet — the single test card from above is the sixth, so one card slips behind it.
  await act(async () => { windowed.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  const flat = [...document.querySelectorAll('aside[role="status"]')];
  assert.equal(flat.filter((node) => node.getAttribute('data-leaving') !== 'true').length, 5, 'the window is full');
  assert.equal(document.querySelector('.dsh-notify-toast-more').textContent, '+1', 'six cards, five on screen');

  // The overflowing group is the one that answers "what if there are more than the setting can show".
  const beforeBatch = requests;
  await act(async () => { overflowing.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  const all = [...document.querySelectorAll('aside[role="status"]')];
  const live = all.filter((node) => node.getAttribute('data-leaving') !== 'true');
  assert.equal(live.length, 5, 'the corner keeps showing five cards');
  assert.equal(document.querySelector('.dsh-notify-toast-more').textContent, '+9', 'and it says how many are not on screen');
  assert.equal(all.length - live.length, 0, 'nothing is thrown away to make room');
  assert.equal(requests, beforeBatch, 'a page test never talks to the host, however many it fires');

  // Expanding shows every card the groups fired, which is where the five tones are visible at once.
  const stack = document.querySelector('.dsh-notify-stack');
  await act(async () => { stack.dispatchEvent(new Event('pointerover', { bubbles: true })); });
  const expanded = [...document.querySelectorAll('aside[role="status"]')];
  assert.equal(expanded.length, 14, 'the single card and both groups are all still there');
  const tones = expanded.map((node) => node.getAttribute('data-tone'));
  for (const tone of ['success', 'warning', 'info', 'error', 'neutral']) assert.ok(tones.includes(tone), `the group covers the ${tone} tone`);
});
