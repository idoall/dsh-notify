import React from 'react';
import { BUILTIN_SOUNDS, SOUND_LABELS, SOUND_PRESETS, parseSoundChoice } from './sound-choices.js';

const BASE = '/plugins/dsh-notify';
const LOCAL_TEST_EVENT = 'dsh-notify:self-test-local';
export const inject = ['slots'];
const HISTORY_PAGE = 20;
const ACK_ALL_CAP = 50;
/**
 * In-page toast anchor: the right edge of the conversation column, so the toast stays in the gutter
 * beside the chat and moves when the right sidebar opens or closes. `100vw` cannot express this —
 * it ignores the left sidebar and the right pane's width, which parked the toast over the right
 * sidebar. Falls back to the old centered-content guess only when the DSH hook is absent.
 */
export function toastAnchor({ document: doc = globalThis.document, innerWidth = globalThis.innerWidth, fallbackContentWidth = 720 } = {}) {
  const rect = doc?.querySelector?.('[data-conversation-scroll]')?.getBoundingClientRect?.();
  const right = rect && rect.width > 0 ? Math.min(rect.right, innerWidth) : null;
  return right === null ? Math.max(16, (innerWidth - fallbackContentWidth) / 2 + 16) : Math.max(16, innerWidth - right + 16);
}
/**
 * Official sidebar foot renders `sidebar.footer.action` as ONE nowrap flex line, so every
 * registrant (dsh-mobile 移动访问, Cordis, us) is forced onto the same row. Letting that row wrap
 * is the only way a plugin can occupy its own row there, because the sidebar exposes no row-level
 * foot slot for plugins (`sidebar.settings` is a single seat owned by ui-settings-general).
 * The `:has()` scope keeps the override on the one row that actually holds our bell, and degrades
 * to the shared row (never to an overlap) on engines without `:has()`.
 *
 * The bell's colour and interaction states live here rather than in inline style so they use the
 * SAME set as the two neighbouring rows: ui-settings-general's `.trigger:hover` and dsh-mobile's
 * `.dsh-mobile-control__trigger:hover/:active/:focus-visible` (inline style would out-rank `:hover`).
 */
export const SETTINGS_CSS = `.dsh-notify-settings{display:grid;gap:14px;max-width:640px;min-width:0;padding:4px 0;color:var(--dsw-alias-label-primary)}
.dsh-notify-heading{font-size:16px;font-weight:650;margin:0}
.dsh-notify-card{border:1px solid var(--dsw-alias-border-l2);border-radius:10px;min-width:0;padding:12px;background:var(--dsw-alias-bg-layer-2)}
.dsh-notify-card>*+*{margin-top:10px}
.dsh-notify-card-title{font-size:13px;font-weight:650;margin:0}
.dsh-notify-hint{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:1.5;margin:0}
.dsh-notify-status{align-items:center;display:flex;gap:8px;font-size:12px;line-height:1.45;margin:0;color:var(--dsw-alias-label-secondary)}
.dsh-notify-status::before{background:var(--dsw-alias-label-tertiary,#98a1ad);border-radius:50%;content:"";flex:none;height:8px;width:8px}
.dsh-notify-status[data-tone=ok]::before{background:var(--dsw-alias-state-success-primary,#16a36a)}
.dsh-notify-status[data-tone=warn]::before{background:var(--dsw-alias-state-warn-primary,#d97706)}
.dsh-notify-status[data-tone=error]::before{background:var(--dsw-alias-state-error-primary,#dc2626)}
.dsh-notify-toggle{align-items:flex-start;cursor:pointer;display:flex;font-size:13px;gap:10px;line-height:1.45}
.dsh-notify-toggle input{accent-color:var(--dsw-alias-state-business-primary);flex:none;height:18px;margin:1px 0 0;min-height:18px;min-width:18px;width:18px}
.dsh-notify-field{display:grid;font-size:13px;font-weight:600;gap:8px;min-width:0}
.dsh-notify-select{background:var(--dsw-specific-input-major,var(--dsw-alias-bg-layer-2));border:1px solid var(--dsw-alias-border-l2);border-radius:8px;color:inherit;font:inherit;font-weight:400;max-width:100%;min-height:40px;min-width:0;padding:0 10px;width:100%}
.dsh-notify-actions{align-items:center;display:flex;flex-wrap:wrap;gap:8px;min-width:0}
.dsh-notify-action{background:var(--dsw-alias-button-floating-fill);border:1px solid var(--dsw-alias-border-l2);border-radius:8px;color:inherit;cursor:pointer;font:inherit;font-size:12px;line-height:30px;max-width:100%;min-height:32px;padding:0 10px;touch-action:manipulation}
.dsh-notify-action:hover:not(:disabled){background:var(--dsw-alias-button-floating-hover)}
.dsh-notify-action:disabled{cursor:not-allowed;opacity:.55}
.dsh-notify-action[data-variant=danger]{background:transparent;border-color:var(--dsw-alias-state-error-primary,#dc2626);color:var(--dsw-alias-state-error-primary,#dc2626)}
.dsh-notify-action:focus-visible,.dsh-notify-select:focus-visible,.dsh-notify-toggle input:focus-visible,.dsh-notify-details>summary:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:2px}
.dsh-notify-tests{display:grid;gap:10px;grid-template-columns:repeat(auto-fit,minmax(min(260px,100%),1fr))}
.dsh-notify-test{background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l2);border-radius:10px;display:flex;flex-direction:column;gap:8px;min-width:0;padding:12px}
.dsh-notify-test-head{align-items:center;display:flex;gap:8px;min-width:0}
.dsh-notify-test-badge{align-items:center;background:var(--dsw-alias-label-primary,#111);border-radius:5px;color:var(--dsw-alias-label-primary-inverted,#fff);display:inline-flex;flex:none;font-family:var(--ds-font-family-code,ui-monospace,SFMono-Regular,Menlo,monospace);font-size:10px;font-weight:650;height:18px;justify-content:center;line-height:1;min-width:18px;padding:0 5px}
.dsh-notify-test-title{font-size:13px;font-weight:650;line-height:1.4;min-width:0}
.dsh-notify-result{color:var(--dsw-alias-label-secondary);font-size:11px;line-height:1.5;margin:0;overflow-wrap:anywhere}
.dsh-notify-result[data-tone=passed]{color:var(--dsw-alias-state-success-primary,#16a36a)}
.dsh-notify-result[data-tone=failed]{color:var(--dsw-alias-state-error-primary,#dc2626)}
.dsh-notify-result[data-tone=active]{color:var(--dsw-alias-state-business-primary)}
.dsh-notify-details{border-top:1px solid var(--dsw-alias-border-l2);padding-top:10px}
.dsh-notify-details>summary{cursor:pointer;font-size:12px;font-weight:650;color:var(--dsw-alias-label-secondary)}
.dsh-notify-details[open]>summary{color:var(--dsw-alias-label-primary);margin-bottom:4px}
.dsh-notify-confirm{border-left:2px solid var(--dsw-alias-state-warn-primary,#d97706);display:grid;gap:8px;min-width:0;padding-left:10px}
@media (hover:none) and (pointer:coarse){.dsh-notify-action{line-height:42px;min-height:44px}.dsh-notify-select{min-height:44px}.dsh-notify-toggle input{height:22px;min-height:22px;min-width:22px;width:22px}}`;
/**
 * Toast presentation: a stack anchored in the top-right corner. Each card is one row of
 * [tone icon][title + text + actions][close X]; the stack container owns the position, and every card
 * sits in an absolutely positioned slot whose `transform` is computed from the cards above it — that
 * is what makes a new card push the others down smoothly instead of re-flowing them. Cards enter with
 * a spring scale + fade and leave by sliding out to the right. The stack is promoted to the browser
 * top layer (see ToastOverlay) so a self-test fired from 设置 stays visible above the settings modal.
 */
export const TOAST_CSS = `.dsh-notify-stack{overflow:visible;pointer-events:none;position:fixed;width:min(360px,calc(100vw - 32px));z-index:1100}
.dsh-notify-slot{inset-inline:0;pointer-events:none;position:absolute;top:0;transform-origin:top center;transition:transform 320ms cubic-bezier(.22,1,.36,1)}
.dsh-notify-stack[data-expanded=true]{display:flex;flex-direction:column;gap:12px;max-height:min(70vh,calc(100vh - 88px));overflow-y:auto;overscroll-behavior:contain;pointer-events:auto;padding:0 2px 2px;scrollbar-width:thin}
.dsh-notify-stack[data-expanded=true]>.dsh-notify-slot{inset-inline:auto;pointer-events:auto;position:static;transform:none}
.dsh-notify-stack[data-expanded=true]>.dsh-notify-slot>.dsh-notify-toast{box-shadow:var(--dsw-elevation-panel,0 6px 20px rgb(0 0 0 / 18%))}
/* The layers behind the front card are edges, not cards: a taller notification further down the
deck would otherwise leak a line of its own text out from under the card in front of it. */
.dsh-notify-stack[data-decked=true]>.dsh-notify-slot[data-depth]:not([data-depth="0"])>.dsh-notify-toast>*{visibility:hidden}
.dsh-notify-toast{align-items:flex-start;animation:dsh-notify-card-in 380ms cubic-bezier(.21,1.02,.73,1);background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l2);border-radius:10px;box-shadow:var(--dsw-elevation-panel,0 6px 20px rgb(0 0 0 / 18%));box-sizing:border-box;color:var(--dsw-alias-label-primary);cursor:pointer;display:flex;gap:10px;margin:0;overflow:hidden;padding:12px 34px 12px 12px;pointer-events:auto;position:relative;width:100%}
.dsh-notify-toast[data-leaving=true]{animation:dsh-notify-card-out 200ms ease-in forwards;pointer-events:none}
@keyframes dsh-notify-card-in{0%{opacity:0;transform:translateY(-10px) scale(.9)}62%{opacity:1;transform:translateY(0) scale(1.02)}100%{opacity:1;transform:none}}
@keyframes dsh-notify-card-out{to{opacity:0;transform:translateX(115%)}}
@keyframes dsh-notify-spin{to{transform:rotate(360deg)}}
.dsh-notify-toast-icon{color:var(--dsw-alias-label-tertiary,#7a8494);flex:none;margin-top:1px}
.dsh-notify-toast-icon[data-spin=true]{animation:dsh-notify-spin .9s linear infinite}
.dsh-notify-toast[data-tone=success] .dsh-notify-toast-icon{color:var(--dsw-alias-state-success-primary,#16a36a)}
.dsh-notify-toast[data-tone=error] .dsh-notify-toast-icon{color:var(--dsw-alias-state-error-primary,#dc2626)}
.dsh-notify-toast[data-tone=warning] .dsh-notify-toast-icon{color:var(--dsw-alias-state-warn-primary,#d97706)}
.dsh-notify-toast[data-tone=info] .dsh-notify-toast-icon{color:var(--dsw-alias-state-business-primary,#2563eb)}
.dsh-notify-toast-body{display:grid;gap:2px;min-width:0;flex:1 1 auto}
.dsh-notify-toast-head{align-items:center;display:flex;gap:6px;min-width:0}
.dsh-notify-toast-source{color:var(--dsw-alias-label-tertiary,#7a8494);font-size:11px;line-height:1.4;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-notify-toast-more{background:var(--dsw-alias-interactive-bg-hover-solid,var(--dsw-alias-bg-layer-3,rgb(0 0 0 / 6%)));border:0;border-radius:999px;color:var(--dsw-alias-label-secondary);cursor:pointer;flex:none;font:inherit;font-size:11px;line-height:18px;margin-inline-start:auto;padding:0 8px}
.dsh-notify-toast-more:hover{color:var(--dsw-alias-label-primary)}
.dsh-notify-toast-title{font-size:13px;font-weight:650;line-height:1.45}
.dsh-notify-toast-text{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:1.5;margin:0;overflow-wrap:anywhere}
.dsh-notify-toast-answers{align-items:center;display:flex;flex-wrap:wrap;gap:6px;margin-top:2px}
.dsh-notify-toast-answer{background:var(--dsw-alias-button-floating-fill);border:1px solid var(--dsw-alias-border-l2);border-radius:8px;color:inherit;cursor:pointer;font:inherit;font-size:12px;line-height:26px;max-width:100%;min-height:28px;overflow:hidden;padding:0 10px;text-overflow:ellipsis;touch-action:manipulation;white-space:nowrap}
.dsh-notify-toast-answer:hover{background:var(--dsw-alias-button-floating-hover)}
.dsh-notify-toast-answer:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:2px}
.dsh-notify-toast-answer[data-variant=quiet]{background:transparent;color:var(--dsw-alias-label-secondary)}
.dsh-notify-toast-answer:disabled{cursor:progress;opacity:.6}
.dsh-notify-toast-error{color:var(--dsw-alias-state-error-primary,#dc2626);font-size:11px;line-height:1.45}
.dsh-notify-toast-hint{color:var(--dsw-alias-label-secondary);font-size:11px;line-height:1.45}
.dsh-notify-toast-close{align-items:center;background:transparent;border:0;border-radius:6px;color:var(--dsw-alias-label-secondary);cursor:pointer;display:inline-flex;font-size:15px;height:22px;inset-inline-end:6px;justify-content:center;line-height:1;padding:0;position:absolute;top:6px;width:22px}
.dsh-notify-toast-close:hover{background:var(--dsw-alias-button-floating-hover);color:var(--dsw-alias-label-primary)}
.dsh-notify-toast-close:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:2px}
@media (hover:none) and (pointer:coarse){.dsh-notify-toast{padding:12px 44px 12px 12px}.dsh-notify-toast-close{font-size:17px;height:32px;width:32px}}
@media (prefers-reduced-motion:reduce){.dsh-notify-toast{animation:none}.dsh-notify-toast[data-leaving=true]{animation:none}.dsh-notify-slot{transition:none}.dsh-notify-toast-icon[data-spin=true]{animation:none}}`;
export const CLIENT_CSS = `${SETTINGS_CSS}\n${TOAST_CSS}`;
export function installClientStyles({ document: doc = globalThis.document } = {}) {
  const head = doc?.head;
  if (!head?.append || !doc.createElement) return () => {};
  const style = doc.createElement('style');
  style.dataset.plugin = 'dsh-notify';
  style.textContent = CLIENT_CSS;
  head.append(style);
  return () => style.remove();
}

export function layoutFor({ width = 1024, coarse = false } = {}) { return { narrow: width < 760, hitTarget: coarse ? 44 : 32 }; }
/** A page-local notification, used by the settings self-test: it never touches the host. */
export function createLocalSelfTestRecord({ now = Date.now(), randomUUID = () => globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2) } = {}) {
  const id = `self-test:${randomUUID()}`;
  return { eventId: id, mergeKey: id, kind: 'test', title: '自测：页面浮层', body: '只显示在当前页面，不会发送系统通知', at: now, phase: 'settled', localOnly: true };
}
/**
 * One of each tone and of the kinds that actually reach a page, so a single click shows what the
 * stack does: cards entering, the collapse past five with its +N count, the scrollable expand, and
 * every icon and accent a notification can carry. A group is also the only honest way to look at the
 * layout — one card says nothing about stacking. Eight of them are what "more notifications than the
 * window holds" looks like.
 */
export const SELF_TEST_BATCH = Object.freeze([
  { kind: 'completed', title: '任务完成', body: '修复插件本机访问布局问题' },
  { kind: 'approval', title: '需要审批', body: 'escalate sandbox to danger-full-access' },
  { kind: 'question', title: '需要回复', body: '通道范围：浏览器通知要怎么处理？' },
  { kind: 'failed', title: '运行失败', body: 'OpenAI API error (503): Service temporarily unavailable' },
  { kind: 'job-end', title: '后台任务结束', body: 'pnpm build' },
  { kind: 'subagent-end', title: '子任务结束', body: '审计 test/client-dom.test.js 的悬浮行为' },
  { kind: 'workflow-end', title: '工作流结束', body: '3 个阶段，8 个文件，0 个失败' },
  { kind: 'plan-review', title: '计划待确认', body: '迁移执行计划：5 步，含回滚' },
]);
/**
 * `count` exists so the settings buttons can fire a window-sized group and an overflowing one: the
 * difference between five cards lying flat and eight cards behind a `+3` count is the whole point of
 * looking at a group at all. Cards are distinct records — reusing one would merge into a single card.
 */
export function createLocalSelfTestBatch({ count = SELF_TEST_BATCH.length, now = Date.now(), randomUUID = () => globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2) } = {}) {
  const wanted = Math.max(1, Math.min(SELF_TEST_BATCH.length, Math.trunc(Number(count)) || SELF_TEST_BATCH.length));
  return SELF_TEST_BATCH.slice(0, wanted).map((entry, index) => {
    const id = `self-test:${randomUUID()}-${index}`;
    return { ...entry, eventId: id, mergeKey: id, at: now + index, phase: 'settled', localOnly: true };
  });
}
export function publishLocalSelfTest(record, dispatch = (event) => globalThis.dispatchEvent(event)) {
  dispatch(typeof CustomEvent === 'function' ? new CustomEvent(LOCAL_TEST_EVENT, { detail: record }) : { type: LOCAL_TEST_EVENT, detail: record });
}
function validSessionId(value) { return typeof value === 'string' && value.length > 0 && value.length <= 256 && /^[A-Za-z0-9._:-]+$/.test(value); }
/**
 * Reveal one turn inside the session the user just opened. The chat renders every turn as a flow item
 * carrying `data-chat-turn` (a semantic hook, not a hashed class), so a notification that knows its
 * turn lands on that exact turn instead of the bottom of a long conversation. The first attempt can
 * miss because the session is still mounting, so this retries briefly and gives up silently.
 */
export function revealTurn(turn, { document: doc = globalThis.document, attempts = 24, intervalMs = 80, timers = {} } = {}) {
  const setTimer = timers.setTimeout ?? globalThis.setTimeout;
  const clearTimer = timers.clearTimeout ?? globalThis.clearTimeout;
  if (!doc?.querySelector || typeof setTimer !== 'function' || !Number.isSafeInteger(turn) || turn <= 0) return () => {};
  let done = false; let timer = null; let left = attempts;
  const clear = () => { if (timer !== null) { clearTimer(timer); timer = null; } done = true; };
  const attempt = () => {
    if (done) return;
    const element = doc.querySelector(`[data-chat-turn="${turn}"]`);
    if (element) {
      try { element.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch { /* jsdom and older engines */ }
      element.setAttribute('data-dsh-notify-turn', 'highlight');
      timer = setTimer(() => { try { element.removeAttribute('data-dsh-notify-turn'); } catch { /* gone */ } }, 2400);
      done = true;
      return;
    }
    if (--left <= 0) { done = true; return; }
    timer = setTimer(attempt, intervalMs);
  };
  timer = setTimer(attempt, 0);
  return clear;
}
export async function navigateNotificationRecord(record, { sessions, acknowledge } = {}) {
  const sessionId = record?.sessionId;
  // A record with nowhere to go — a self-test artefact (`sessionId: null`), or a session that has
  // since been deleted — must still be dismissible. Refusing to acknowledge it used to leave the
  // unread badge stuck red forever, so "open" degrades to "mark read" and says so.
  const snapshot = sessions?.list?.getSnapshot?.();
  const goneFromList = Boolean(snapshot?.byId) && !snapshot.byId[sessionId];
  if (!validSessionId(sessionId) || goneFromList) {
    await acknowledge?.(record);
    return { status: 'acknowledged-without-session' };
  }
  if (!sessions?.binding?.(sessionId)) return { status: 'navigation-failed' };
  try {
    const opened = sessions.open(sessionId);
    if (opened === false || sessions.list?.getSnapshot?.().current !== sessionId) return { status: 'navigation-failed' };
    if (Number.isSafeInteger(record.turn) && record.turn > 0) revealTurn(record.turn);
    await acknowledge?.(record);
    return { status: 'acknowledged' };
  } catch (error) { return { status: 'failed', error }; }
}
export function installAudioUnlock({ document: doc = globalThis.document, player = soundPlayer } = {}) {
  if (!doc?.addEventListener) return () => {};
  const unlock = () => { void player.unlock(); };
  doc.addEventListener('pointerdown', unlock, { passive: true });
  doc.addEventListener('keydown', unlock);
  return () => { doc.removeEventListener('pointerdown', unlock); doc.removeEventListener('keydown', unlock); };
}
async function fetchJson(path, init) {
  const response = await fetch(`${BASE}${path}`, { credentials: 'same-origin', ...init });
  if (!response.ok) { const error = new Error(`notify request failed: ${response.status}`); error.status = response.status; throw error; }
  return response.json();
}
/**
 * Clicking a card opens the session (and the exact turn) it is about. There is nothing else to write:
 * the card disappearing is the entire record of the interaction.
 */
const navigateRecord = (record, sessions) => (record?.localOnly ? Promise.resolve({ status: 'local' }) : navigateNotificationRecord(record, { sessions }));
function mergeRecords(previous, items) {
  const merged = new Map(previous.map((record) => [record.eventId, record]));
  for (const record of items) if (record?.eventId) merged.set(record.eventId, record);
  // No history is kept anywhere, so a page only needs the recent tail: what can still be on screen,
  // plus enough to know that the same record arriving twice is not news.
  return [...merged.values()].sort((a, b) => Number(b.at || 0) - Number(a.at || 0)).slice(0, RECORD_MEMORY);
}
/** How many delivered records a page keeps: the stack shows five, and a record can be updated in place. */
const RECORD_MEMORY = 60;
/**
 * The whole transport: ask the host for everything after the sequence this page already has. The first
 * poll is a snapshot of whatever is still buffered, and the toast layer treats that snapshot as
 * history it was not there for — so loading the page never replays a pile of old notifications.
 */
function useNotificationState() {
  const [state, setState] = React.useState({ records: [], seq: 0, primed: false, offline: false, revision: 0 });
  const warned = React.useRef(false);
  React.useEffect(() => {
    const local = (event) => { const record = event?.detail; if (record?.localOnly) setState((old) => ({ ...old, records: mergeRecords(old.records, [record]), revision: old.revision + 1 })); };
    globalThis.addEventListener?.(LOCAL_TEST_EVENT, local);
    return () => globalThis.removeEventListener?.(LOCAL_TEST_EVENT, local);
  }, []);
  React.useEffect(() => {
    let alive = true;
    const pull = async () => {
      try {
        const data = await fetchJson(`/pull?since=${state.seq}`);
        if (!alive) return;
        // An older host answers the old cursor protocol: it has no sequence to advance, so it re-sends
        // its whole buffer on every poll. Say so once instead of pretending the page is up to date.
        if (!Number.isSafeInteger(data?.seq) && !warned.current) {
          warned.current = true;
          globalThis.console?.warn?.('[dsh-notify] the host did not report a delivery sequence — restart DSH so the current plugin is loaded; until then this page only sees records it has not seen before.');
        }
        const seq = Number.isSafeInteger(data?.seq) ? data.seq : state.seq;
        setState((old) => ({ records: mergeRecords(old.records, Array.isArray(data?.items) ? data.items : []), seq, primed: true, offline: false, revision: old.revision + 1 }));
      } catch { if (alive) setState((old) => ({ ...old, offline: true })); }
    };
    pull(); const timer = setInterval(pull, 1500);
    return () => { alive = false; clearInterval(timer); };
  }, [state.seq]);
  return state;
}
export function toastOrder(records = []) { return [...records.filter((record) => record?.phase === 'open'), ...records.filter((record) => record?.phase !== 'open')]; }
const TOAST_TONE_BY_KIND = Object.freeze({ approval: 'warning', question: 'info', 'plan-review': 'info', completed: 'success', failed: 'error', 'job-end': 'neutral', 'workflow-end': 'neutral', test: 'neutral' });
export function toastTone(kind) { return TOAST_TONE_BY_KIND[kind] ?? 'neutral'; }
/** 20px line-art icon per tone (react-toastify's per-result icon, drawn in the DSH stroke style). */
export function toastIcon(tone, status = 'idle') {
  const shared = { 'aria-hidden': true, focusable: false, width: 20, height: 20, viewBox: '0 0 20 20', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', className: 'dsh-notify-toast-icon' };
  // An in-flight action owns the icon: it is the only signal that says "this click is being sent".
  if (status === 'loading') return React.createElement('svg', { ...shared, 'data-spin': 'true' }, React.createElement('path', { d: 'M10 3.4a6.6 6.6 0 1 1-6.6 6.6', opacity: '.9' }));
  if (status === 'success') return React.createElement('svg', shared, React.createElement('path', { d: 'M4.5 10.4l3.6 3.6 7.4-8' }));
  if (status === 'error') return React.createElement('svg', shared, React.createElement('circle', { cx: 10, cy: 10, r: 7 }), React.createElement('path', { d: 'M10 6.4v4.4M10 13.6h.01' }));
  if (tone === 'success') return React.createElement('svg', shared, React.createElement('path', { d: 'M4.5 10.4l3.6 3.6 7.4-8' }));
  if (tone === 'error') return React.createElement('svg', shared, React.createElement('path', { d: 'M5.6 5.6l8.8 8.8M14.4 5.6l-8.8 8.8' }));
  if (tone === 'warning') return React.createElement('svg', shared, React.createElement('path', { d: 'M10 3.6l7 12.4H3z' }), React.createElement('path', { d: 'M10 8.6v3.1M10 14.3h.01' }));
  if (tone === 'info') return React.createElement('svg', shared, React.createElement('circle', { cx: 10, cy: 10, r: 7 }), React.createElement('path', { d: 'M10 9.2v4M10 6.7h.01' }));
  return React.createElement('svg', shared, React.createElement('path', { d: 'M10 3.2a4.3 4.3 0 0 0-4.3 4.3c0 3.2-1.2 4.2-1.2 4.2h11s-1.2-1-1.2-4.2A4.3 4.3 0 0 0 10 3.2z' }), React.createElement('path', { d: 'M8.6 14.4a1.6 1.6 0 0 0 2.8 0' }));
}
let toastConfig = { toastPosition: 'conversation', toastEnabled: true, soundEnabled: true, sound: 'chime' };
export function createSoundPlayer({ audio = globalThis, AudioContextClass, AudioElementClass } = {}) {
  let context = null; let unlocked = false; const elements = new Set();
  // Resolved lazily: the bundle may be evaluated before the page exposes these, and tests inject fakes.
  const contextClass = () => AudioContextClass ?? audio?.AudioContext ?? audio?.webkitAudioContext;
  const elementClass = () => AudioElementClass ?? audio?.Audio;
  const create = () => { if (context) return context; const Klass = contextClass(); if (typeof Klass !== 'function') return null; try { context = new Klass(); } catch { context = null; } return context; };
  const unlock = async () => {
    const target = create();
    if (!target) return false;
    try { if (target.state === 'suspended') await target.resume(); } catch { return false; }
    unlocked = target.state === 'running';
    return unlocked;
  };
  const playPreset = (id) => {
    const notes = SOUND_PRESETS[id] ?? SOUND_PRESETS.chime;
    if (notes.length === 0) return { played: false, reason: 'silent' };
    const target = create();
    if (!target) return { played: false, reason: 'unsupported' };
    if (target.state !== 'running') return { played: false, reason: 'locked' };
    try {
      const start = target.currentTime;
      for (const note of notes) {
        const oscillator = target.createOscillator(); const gain = target.createGain();
        oscillator.type = note.type; oscillator.frequency.value = note.freq;
        gain.gain.setValueAtTime(0, start + note.at);
        gain.gain.linearRampToValueAtTime(note.gain, start + note.at + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + note.at + note.dur);
        oscillator.connect(gain); gain.connect(target.destination);
        oscillator.start(start + note.at); oscillator.stop(start + note.at + note.dur + 0.02);
      }
      return { played: true, reason: 'played' };
    } catch { return { played: false, reason: 'failed' }; }
  };
  const playCustom = async (name) => {
    const Klass = elementClass(); if (typeof Klass !== 'function') return { played: false, reason: 'unsupported' };
    try {
      const element = new Klass(`${BASE}/sound?name=${encodeURIComponent(name)}`);
      elements.add(element);
      element.addEventListener?.('ended', () => elements.delete(element), { once: true });
      await element.play();
      return { played: true, reason: 'played' };
    } catch (error) { return { played: false, reason: error?.name === 'NotAllowedError' ? 'locked' : 'failed' }; }
  };
  return {
    unlock,
    get unlocked() { return unlocked; },
    get locked() { return Boolean(create()) && !unlocked; },
    /**
     * Play the configured sound. This deliberately plays while the page is in the background: the
     * whole point of the cue is the case where the user is in another app (a movie, an editor) and
     * cannot see the tab title flash or a browser banner. Muting a hidden page made the cue useless
     * exactly when it mattered, so visibility is no longer part of the decision.
     */
    async play(choice = toastConfig.sound, { enabled = toastConfig.soundEnabled } = {}) {
      if (!enabled) return { played: false, reason: 'disabled' };
      const parsed = parseSoundChoice(choice);
      return parsed.kind === 'custom' ? playCustom(parsed.name) : playPreset(parsed.id);
    },
    stop() { for (const element of elements) { try { element.pause?.(); } catch { /* already gone */ } } elements.clear(); },
  };
}
const soundPlayer = createSoundPlayer();
const ATTENTION_DOT = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><circle cx="8" cy="8" r="7" fill="#e5484d"/></svg>')}`;
/**
 * Tab attention indicator: while the DSH tab is in the background and something is still unread, the
 * title and favicon alternate so the user notices without a sound. It stops the moment the tab is
 * looked at again, or as soon as nothing is unread (toast closed / handled / deleted), so it can
 * never nag someone who is already looking at the page.
 */
export function createAttentionIndicator({ document: doc = globalThis.document, timers = {}, intervalMs = 900, reducedMotion = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches === true } = {}) {
  const setTimer = timers.setInterval ?? globalThis.setInterval;
  const clearTimer = timers.clearInterval ?? globalThis.clearInterval;
  let timer = null; let active = false; let baseTitle = null; let baseIcon = null; let iconNode = null; let phase = false;
  const paint = () => {
    // `phase` alone carries the flash state: with reduced motion it simply never toggles, so the
    // marker stays visible without animating.
    const marked = active && phase;
    if (doc && baseTitle !== null) doc.title = marked ? `🔔 ${baseTitle}` : baseTitle;
    if (iconNode) iconNode.href = marked ? ATTENTION_DOT : baseIcon;
  };
  const stop = () => {
    if (timer !== null) { clearTimer(timer); timer = null; }
    if (!active) return;
    active = false; phase = false;
    if (doc && baseTitle !== null) doc.title = baseTitle;
    if (iconNode && baseIcon !== null) iconNode.href = baseIcon;
    if (iconNode && baseIcon === null) { try { iconNode.remove(); } catch { /* gone */ } }
    iconNode = null; baseTitle = null; baseIcon = null;
  };
  return {
    get active() { return active; },
    /** Flashing is worth it only for a background tab with something still unread. */
    update({ unread = 0, visible = true } = {}) {
      const wanted = Boolean(unread > 0 && !visible);
      if (wanted === active) return;
      if (!wanted) { stop(); return; }
      if (!doc) return;
      baseTitle = doc.title ?? '';
      iconNode = doc.querySelector?.('link[rel~="icon"]') ?? null;
      if (iconNode) baseIcon = iconNode.getAttribute?.('href') ?? iconNode.href ?? null;
      active = true; phase = true; paint();
      if (reducedMotion || typeof setTimer !== 'function') return;
      timer = setTimer(() => { phase = !phase; paint(); }, intervalMs);
    },
    stop,
  };
}
const attentionIndicator = createAttentionIndicator();
export function setToastConfig(config = {}) { toastConfig = { ...toastConfig, ...config }; globalThis.dispatchEvent?.(new Event('dsh-notify:toast-config')); }
/** How many cards the corner shows at once, and how long the page-scoped queue behind them may grow. */
export const TOAST_STACK_VISIBLE = 5;
export const TOAST_QUEUE_MAX = 50;
export const TOAST_DEPTH_OFFSET = 10;
export const TOAST_DEPTH_SCALE = 0.04;
export const TOAST_DEPTH_MIN_SCALE = 0.82;
/** Must match the `dsh-notify-card-out` animation; the card is dropped from the DOM when it ends. */
export const TOAST_EXIT_MS = 200;
export const TOAST_SUCCESS_MS = 900;
const TOAST_HOVER_GRACE_MS = 120;
/**
 * The order the page keeps its notifications in: anything still waiting on the user first (newest
 * first), then everything else (newest first), capped so a runaway stream cannot grow without bound.
 *
 * Nothing is dropped to make room. A page holds on to what happened while it was open — a refresh
 * loses the lot, which is the deal this plugin makes — and the cap only exists so a stuck producer
 * cannot fill memory. Because pending cards are ordered first, they are the last thing that could
 * ever fall off it.
 */
export function queueCards(cards = [], max = TOAST_QUEUE_MAX) {
  const pending = cards.filter((card) => card?.record?.phase === 'open');
  const finished = cards.filter((card) => card?.record?.phase !== 'open');
  return [...pending, ...finished].slice(0, Math.max(1, max));
}
/**
 * The cards the corner renders while it is collapsed: everything waiting on the user, plus finished
 * cards filling the remaining slots. A second question hidden behind a `+N` count would defeat the
 * point of the stack, so the window grows past `visible` rather than hiding one.
 */
export function visibleCards(cards = [], { expanded = false, visible = TOAST_STACK_VISIBLE } = {}) {
  if (expanded) return cards;
  return cards.filter((card, index) => card?.record?.phase === 'open' || index < Math.max(1, visible));
}
/**
 * Where each rendered card sits while the corner is collapsed. Flat while they fit, and a deck once
 * some of them are hidden behind the count: the front card keeps the top slot and the ones behind it
 * peek out below at a smaller scale, which is what makes "there is more here" visible without a label.
 */
export function toastStackPlan({ heights = [], decked = false, gap = 12 } = {}) {
  let cursor = 0;
  return heights.map((height, index) => {
    const depth = decked && index > 0 ? index : 0;
    const plan = depth
      ? { offsetY: depth * TOAST_DEPTH_OFFSET, scale: Math.max(TOAST_DEPTH_MIN_SCALE, 1 - depth * TOAST_DEPTH_SCALE), depth }
      : { offsetY: cursor, scale: 1, depth: 0 };
    cursor += (Number(height) || 0) + gap;
    return plan;
  });
}
function ToastOverlay({ sessions, pendingInteractions } = {}) {
  const state = useNotificationState(); const [, refresh] = React.useState(0); const [cards, setCards] = React.useState([]); const [anchor, setAnchor] = React.useState(() => toastAnchor()); const [hovering, setHovering] = React.useState(false); const [, rerender] = React.useState(0); const toasted = React.useRef(new Set()); const primed = React.useRef(false);
  // useSyncExternalStore keeps the hook order stable whether or not the host exposes the service.
  const pendingStore = React.useMemo(() => ({ subscribe: (listener) => pendingInteractions?.subscribe?.(listener) ?? (() => {}), getSnapshot: () => pendingInteractions?.getSnapshot?.() ?? null }), [pendingInteractions]);
  const pending = React.useSyncExternalStore(pendingStore.subscribe, pendingStore.getSnapshot, () => null);
  // One ref per piece of per-card runtime state: the exit/success timers and each card's measured
  // height. Nothing here retires a card on a clock — a toast leaves when the user says so.
  const stackRef = React.useRef(null); const exits = React.useRef(new Map()); const successes = React.useRef(new Map()); const heights = React.useRef(new Map()); const hoverTimer = React.useRef(null); const unseen = React.useRef(new Set()); const sawPending = React.useRef(new Set()); const cardsRef = React.useRef(cards);
  const anyCard = cards.length > 0; const rerenderNow = () => rerender((value) => value + 1);
  // The ref mirrors every write so two pushes in the same tick (a self-test and a poll, say) cannot
  // race each other through a stale render.
  const commit = (next) => { cardsRef.current = next; setCards(next); };
  const forget = (eventId) => { heights.current.delete(eventId); };
  /** Retire a card: the DOM node stays for the slide-out animation and is dropped when it ends. */
  /** Watch a card leave: the node stays for the animation, and the timer takes it out of the stack. */
  const retire = (eventId) => {
    const previous = exits.current.get(eventId); if (previous) clearTimeout(previous);
    exits.current.set(eventId, setTimeout(() => { exits.current.delete(eventId); forget(eventId); commit(cardsRef.current.filter((card) => card.record.eventId !== eventId)); }, TOAST_EXIT_MS));
  };
  const dismiss = (eventId, { animate = true } = {}) => {
    const success = successes.current.get(eventId); if (success) { clearTimeout(success); successes.current.delete(eventId); }
    if (!animate) { forget(eventId); commit(cardsRef.current.filter((card) => card.record.eventId !== eventId)); return; }
    commit(cardsRef.current.map((card) => (card.record.eventId === eventId ? { ...card, leaving: true } : card)));
    retire(eventId);
  };
  const patchCard = (eventId, patch) => commit(cardsRef.current.map((card) => (card.record.eventId === eventId ? { ...card, ...patch } : card)));
  const measure = (eventId) => (node) => {
    if (!node) return;
    const height = Math.ceil(node.offsetHeight || node.getBoundingClientRect?.().height || 0);
    if (!height || heights.current.get(eventId) === height) return;
    heights.current.set(eventId, height);
    rerenderNow();
  };
  React.useEffect(() => { const onConfig = () => refresh((n) => n + 1); globalThis.addEventListener?.('dsh-notify:toast-config', onConfig); return () => globalThis.removeEventListener?.('dsh-notify:toast-config', onConfig); }, []);
  React.useEffect(() => {
    const update = () => setAnchor(toastAnchor());
    update();
    globalThis.addEventListener?.('resize', update);
    let observer;
    if (typeof ResizeObserver === 'function') {
      observer = new ResizeObserver(update);
      const target = globalThis.document?.querySelector?.('[data-conversation-scroll]') ?? globalThis.document?.body;
      if (target) observer.observe(target);
    }
    return () => { globalThis.removeEventListener?.('resize', update); observer?.disconnect(); };
  }, []);
  React.useEffect(() => { setAnchor(toastAnchor()); }, [cards.length]);
  React.useEffect(() => () => {
    for (const id of exits.current.values()) clearTimeout(id);
    for (const id of successes.current.values()) clearTimeout(id);
    clearTimeout(hoverTimer.current);
  }, []);
  // The shell.overlay seat lives inside the official overlayLayer (z-index 20), so no z-index of
  // ours can clear the settings modal (z-index 1000). Promoting the whole stack to the browser top
  // layer is what actually keeps a self-test fired from 设置 visible and closable; without Popover
  // support the stack stays a normal fixed element and simply degrades to the old stacking.
  React.useEffect(() => {
    const element = stackRef.current;
    if (!anyCard || !element || typeof element.showPopover !== 'function') return undefined;
    try {
      if (!element.hasAttribute('popover')) element.setAttribute('popover', 'manual');
      if (!element.matches?.(':popover-open')) element.showPopover();
    } catch { return undefined; }
    return () => { try { element.hidePopover?.(); } catch { /* already detached */ } };
  }, [anyCard]);
  /** A new card takes its place in the queue: waiting work first, then newest first. Nothing is dropped. */
  const showToast = (record) => {
    if (!record?.eventId) return;
    if (globalThis.document?.hidden) unseen.current.add(record.eventId);
    toasted.current.add(record.eventId);
    const incoming = [{ record, status: 'idle', error: null, lastLabel: null, leaving: false }, ...cardsRef.current.filter((card) => card.record.eventId !== record.eventId)];
    const next = queueCards(incoming);
    for (const card of incoming) if (!next.includes(card)) forget(card.record.eventId);   // only the runaway-stream cap can reach this
    commit(next);
    void soundPlayer.play();
  };
  React.useEffect(() => {
    const local = (event) => { if (event?.detail?.localOnly) showToast(event.detail); };
    globalThis.addEventListener?.(LOCAL_TEST_EVENT, local);
    return () => globalThis.removeEventListener?.(LOCAL_TEST_EVENT, local);
  }, []);
  // Hovering the stack expands it; leaving waits a beat first. Both halves live on the container and
  // never on a card: the container's box spans the whole column (gaps included), so crossing the gap
  // between two cards stays "inside". A card watching its own pointer left the stack there, which
  // collapsed it — and because collapsing slides the cards back under the cursor, that flickered.
  const enterStack = () => {
    if (hoverTimer.current) { clearTimeout(hoverTimer.current); hoverTimer.current = null; }
    setHovering(true);
  };
  const leaveStack = () => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    hoverTimer.current = setTimeout(() => { hoverTimer.current = null; setHovering(false); }, TOAST_HOVER_GRACE_MS);
  };
  // An open toast must not outlive the thing it asks about. The user can answer in the composer, in
  // another browser, or through the official modal, and none of those paths touch this element: the
  // toast is a snapshot, so it has to watch the two authoritative signals itself. The same watch keeps
  // a card from becoming a ghost: a record the Host has dropped (cleared, deleted, evicted) takes its
  // card with it, because nothing else could ever retire it now that toasts do not expire.
  React.useEffect(() => {
    const open = new Set(cards.map((card) => card.record.eventId));
    for (const id of sawPending.current) if (!open.has(id)) sawPending.current.delete(id);
    for (const card of cards) {
      if (card.leaving || card.record.phase !== 'open') continue;
      if (pendingInteractionFor(pending, card.record.sessionId)) { sawPending.current.add(card.record.eventId); continue; }
      if (sawPending.current.has(card.record.eventId)) dismiss(card.record.eventId);
    }
  }, [pending, cards]);
  React.useEffect(() => {
    if (!state.primed) return;   // nothing has been delivered yet, so there is nothing to prime
    const seen = toasted.current;
    const ids = new Set(state.records.map((record) => record.eventId));
    for (const id of seen) if (!ids.has(id)) seen.delete(id);   // keep the set bounded by live records
    // The first poll of a page is what the host still had buffered: history the user was not there for.
    // It is never replayed as a stack of old cards — but it is that snapshot which gets marked seen,
    // not the empty state that precedes it.
    if (!primed.current) { primed.current = true; for (const id of ids) seen.add(id); return; }
    // A record that is already on screen can arrive again. Exactly ONE repeat is news: the record was
    // waiting on the user and the host has now settled it (an approval, asked and then decided), which
    // retires the card. Every other repeat — a host that re-sends what it has already delivered, a
    // duplicate delivery — is the same notification, and treating it as an update made the card flash
    // and vanish the moment it appeared.
    for (const card of cardsRef.current) {
      const live = state.records.find((record) => record.eventId === card.record.eventId);
      if (!live || live === card.record) continue;
      const wasWaiting = card.record.phase === 'open';
      patchCard(card.record.eventId, { record: live });
      if (wasWaiting && live.phase !== 'open') dismiss(card.record.eventId);
    }
    const next = toastOrder(state.records).find((record) => !seen.has(record.eventId));
    if (!next) return;
    showToast(next);
  }, [state.records, state.primed]);
  // The tab flash is the only signal left for something that arrived while the page was in the
  // background: the cards wait for the user, and the title says so until the tab is looked at.
  React.useEffect(() => {
    const sync = () => {
      const hidden = Boolean(globalThis.document?.hidden);
      if (!hidden) unseen.current.clear();
      attentionIndicator.update({ unread: hidden && toastConfig.toastPosition !== 'off' ? unseen.current.size : 0, visible: !hidden });
    };
    sync();
    globalThis.document?.addEventListener?.('visibilitychange', sync);
    return () => globalThis.document?.removeEventListener?.('visibilitychange', sync);
  }, [cards.length, state.records]);
  if (!anyCard || !toastConfig.toastEnabled || toastConfig.toastPosition === 'off') return null;
  const narrow = layoutFor({ width: globalThis.innerWidth }).narrow;
  // Contract: clicking a card jumps to the session it is about and retires the card. There is no
  // "seen" flag to write anywhere — the card leaving is the whole record of the interaction.
  const activate = async (card) => { dismiss(card.record.eventId); await navigateRecord(card.record, sessions); };
  // Answering here and answering in the composer mutate the same PendingQuestion. The card reports the
  // click as loading until the host confirms, then settles on success (✓, then it retires) or error.
  const submitAnswer = async (card, label) => {
    const interaction = pendingInteractionFor(pending, card.record.sessionId);
    const answer = toastAnswer(card.record, interaction);
    if (!answer) { patchCard(card.record.eventId, { status: 'error', error: '这条已经不能在这里回答了，请到会话里处理', lastLabel: label }); return; }
    patchCard(card.record.eventId, { status: 'loading', error: null, lastLabel: label });
    try {
      await interaction.answer(answerBatch(answer.id, label));
      patchCard(card.record.eventId, { status: 'success', error: null });
      const previous = successes.current.get(card.record.eventId); if (previous) clearTimeout(previous);
      successes.current.set(card.record.eventId, setTimeout(() => { successes.current.delete(card.record.eventId); dismiss(card.record.eventId); }, TOAST_SUCCESS_MS));
    } catch (error) {
      patchCard(card.record.eventId, { status: 'error', error: error?.message || '回答失败，请到会话里回答', lastLabel: label });
    }
  };
  const actionRow = (card) => {
    const record = card.record; const busy = card.status === 'loading'; const buttons = [];
    // A question/plan-review notification always offers the way into its session, even when this page
    // holds no pending interaction (already answered elsewhere, or asked in another browser).
    if (record.kind === 'question' || record.kind === 'plan-review') {
      const answer = toastAnswer(record, pendingInteractionFor(pending, record.sessionId));
      if (answer) for (const option of answer.options) buttons.push(React.createElement('button', { key: option.label, type: 'button', className: 'dsh-notify-toast-answer', title: option.description, disabled: busy, onClick: (event) => { event.stopPropagation(); void submitAnswer(card, option.label); } }, option.label));
      buttons.push(React.createElement('button', { key: 'session', type: 'button', className: 'dsh-notify-toast-answer', 'data-variant': 'quiet', disabled: busy, onClick: (event) => { event.stopPropagation(); void activate(card); } }, '去会话里回答'));
    }
    if (card.status === 'error' && card.lastLabel) buttons.push(React.createElement('button', { key: 'retry', type: 'button', className: 'dsh-notify-toast-answer', onClick: (event) => { event.stopPropagation(); void submitAnswer(card, card.lastLabel); } }, '重试'));
    const note = card.status === 'error' ? React.createElement('span', { className: 'dsh-notify-toast-error', role: 'status' }, card.error || '操作失败')
      : card.status === 'loading' ? React.createElement('span', { className: 'dsh-notify-toast-hint', role: 'status' }, '正在提交…')
        : card.status === 'success' ? React.createElement('span', { className: 'dsh-notify-toast-hint', role: 'status' }, '已完成') : null;
    if (!buttons.length && !note) return null;
    return React.createElement('div', { className: 'dsh-notify-toast-answers' }, buttons, note);
  };
  const cardView = (card, index, plan, expanded, depth) => {
    const record = card.record; const status = card.status;
    const tone = status === 'error' ? 'error' : status === 'success' ? 'success' : toastTone(record.kind);
    const source = sessionLabel(sessions, record.sessionId);
    const more = record.eventId === frontLive ? chip : 0;
    // Expanded, the cards are laid out by the stylesheet in a scrollable column: an inline transform
    // would fight the flow, so the slot carries no positioning of its own.
    const slotStyle = expanded ? undefined : { transform: `translateY(${plan.offsetY}px) scale(${plan.scale})`, zIndex: depth - index };
    return React.createElement('div', { key: record.eventId, className: 'dsh-notify-slot', 'data-depth': String(plan.depth), style: slotStyle },
      React.createElement('aside', { ref: measure(record.eventId), role: 'status', 'aria-live': 'polite', className: 'dsh-notify-toast', 'data-tone': tone, 'data-status': status, 'data-leaving': card.leaving ? 'true' : 'false',
        onClick: () => { if (!card.leaving) void activate(card); },
        // Only the keyboard half of the hover gesture lives here: the pointer half belongs to the
        // container, whose box spans the whole column. A card that watched its own pointer would
        // collapse the stack every time the pointer crossed the gap between two cards — and because
        // collapsing moves the cards under the cursor, that flicks back and forth.
        onFocus: enterStack, onBlur: leaveStack },
        toastIcon(tone, status),
        React.createElement('div', { className: 'dsh-notify-toast-body' },
          React.createElement('span', { className: 'dsh-notify-toast-head' },
            source ? React.createElement('span', { className: 'dsh-notify-toast-source', title: record.sessionId }, source) : null,
            more > 0 ? React.createElement('button', { type: 'button', className: 'dsh-notify-toast-more', 'aria-label': `展开其余 ${more} 条通知`, onClick: (event) => { event.stopPropagation(); enterStack(); } }, `+${more}`) : null),
          React.createElement('strong', { className: 'dsh-notify-toast-title' }, record.title),
          record.body ? React.createElement('p', { className: 'dsh-notify-toast-text' }, record.body) : null,
          actionRow(card)),
        React.createElement('button', { type: 'button', className: 'dsh-notify-toast-close', 'aria-label': '关闭通知', onClick: (event) => { event.stopPropagation(); dismiss(record.eventId); } }, '\u00d7')));
  };
  // A card on its way out is no longer part of the stack: it must not be counted by the +N chip, must
  // not make the stack look taller, and must not take a slot in the collapsed deck. It keeps its last
  // position while the slide-out animation plays, then its own timer takes the node away.
  const liveCards = cards.filter((card) => !card.leaving);
  // The window is a property of the queue, not of the pointer: it is what the corner shows at rest.
  const collapsedWindow = visibleCards(liveCards);
  const hidden = Math.max(0, liveCards.length - collapsedWindow.length);
  // Hovering only means something when the window hides a card. Expanding a queue that already fits
  // would swap the flat layout for the scrolled column for no visual gain, so it stays collapsed.
  const expanded = hovering && hidden > 0;
  const shown = expanded ? liveCards : collapsedWindow;
  // The deck is the look of "there is more behind this card", so it appears exactly when something is
  // hidden; while everything fits, the cards lie flat.
  const decked = !expanded && hidden > 0;
  const livePlans = toastStackPlan({ heights: shown.map((card) => heights.current.get(card.record.eventId) ?? 0), decked });
  const planById = new Map(shown.map((card, index) => [card.record.eventId, livePlans[index]]));
  const lastWindowed = shown[shown.length - 1];
  const trailingPlan = { offsetY: lastWindowed ? (planById.get(lastWindowed.record.eventId).offsetY + (heights.current.get(lastWindowed.record.eventId) ?? 0)) : 0, scale: 1, depth: 0 };
  const chip = decked ? hidden : 0;
  const frontLive = shown[0]?.record.eventId ?? null;
  // A card on its way out is no longer part of the stack (it must not be counted, sized or slotted),
  // but it still has to be RENDERED for its slide-out to play: it trails the stack for its 200ms.
  const rendered = [...shown, ...cards.filter((card) => card.leaving)];
  return React.createElement('div', { ref: stackRef, popover: 'manual', className: 'dsh-notify-stack', 'data-expanded': expanded ? 'true' : 'false', 'data-decked': decked ? 'true' : 'false',
    onPointerEnter: enterStack, onPointerLeave: leaveStack,
    style: { inset: 'auto', insetInlineEnd: narrow ? 12 : toastConfig.toastPosition === 'viewport' ? 16 : anchor, insetInlineStart: 'auto', bottom: 'auto', top: 'calc(env(safe-area-inset-top, 0px) + var(--dsh-toast-top-offset, 56px))', width: narrow ? 'calc(100vw - 24px)' : 'min(360px, calc(100vw - 32px))', height: 'auto', margin: 0, padding: 0, border: 0, background: 'transparent' } },
    rendered.map((card, index) => cardView(card, index, planById.get(card.record.eventId) ?? trailingPlan, expanded, rendered.length)));
}
export function sessionLabel(sessions, sessionId) {
  if (typeof sessionId !== 'string' || sessionId === '') return null;
  try {
    const summary = sessions?.list?.getSnapshot?.()?.byId?.[sessionId];
    const title = summary && summary.blank !== true && typeof summary.displayTitle === 'string' ? summary.displayTitle.trim() : '';
    if (title) return title;
  } catch { /* fall through to the id */ }
  return sessionId.length > 12 ? `${sessionId.slice(0, 8)}…` : sessionId;
}
/**
 * The official question surface. `dsh-client-ui-session` publishes
 * `pendingInteractions` as a `HostObservable<ReadonlyMap<SessionId, SessionPendingInteraction>>`,
 * and the interaction for a question is the very `PendingQuestion` the in-chat composer renders.
 * Answering that same object resolves the Host waterfall, so the toast and the composer stay in
 * sync for free: whichever one answers first makes the other disappear.
 */
/**
 * Should an open toast close by itself? Two authoritative signals say yes: the record is no longer
 * open (the host settled it, seen through a pull), or this page watched it wait and the official
 * pending interaction is gone (answered in the composer, another browser or the official modal).
 * Never on an empty pending map alone — before the interaction arrives that means "not yet".
 */
export function pendingInteractionFor(pending, sessionId) {
  if (!pending || typeof pending.get !== 'function' || typeof sessionId !== 'string') return null;
  return pending.get(sessionId) ?? null;
}
/**
 * A 360px toast can only answer honestly when the request is ONE single-select question with a
 * short option list. Everything else (multi-question, multi-select, free text) must go to the
 * session, because guessing a partial batch would answer the Host with something the user never
 * chose. Returns null whenever the toast must not pretend to answer.
 */
export function toastAnswer(record, interaction) {
  if (!interaction || typeof interaction.answer !== 'function') return null;
  if (record?.kind !== 'question' && record?.kind !== 'plan-review') return null;
  const questions = Array.isArray(interaction.questions) ? interaction.questions : [];
  if (questions.length !== 1) return null;
  const question = questions[0] ?? {};
  if (question.multiSelect === true) return null;
  const options = (Array.isArray(question.options) ? question.options : []).filter((option) => option && typeof option.label === 'string' && option.label);
  if (options.length === 0 || options.length > 4) return null;
  return { id: typeof question.id === 'string' ? question.id : String(question.id ?? ''), options: options.map((option) => ({ label: option.label, description: typeof option.description === 'string' ? option.description : undefined })) };
}
/** The answer batch shape the official composer sends; an option is selected by its label. */
export function answerBatch(questionId, label) { return { answers: [{ id: questionId, selected: [label] }] }; }
// Answering in the toast acknowledges, and the auto-close that follows would acknowledge again: one
// record is acknowledged at most once per page session.
export function statusTone(text = '') {
  const value = String(text);
  if (/失败|错误/.test(value)) return 'error';
  if (/不可用|未配置/.test(value)) return 'warn';
  if (/已连接|已保存|已清空|已订阅|已退订/.test(value)) return 'ok';
  return 'idle';
}
/** Result-line tone for one self-test dimension. */
export function resultTone(status) {
  if (status === 'passed') return 'passed';
  if (status === 'failed') return 'failed';
  if (status === 'running' || status === 'submitted') return 'active';
  return 'idle';
}
const action = (label, onClick, extra = {}) => React.createElement('button', { className: 'dsh-notify-action', type: 'button', onClick, ...extra }, label);
const hint = (children) => React.createElement('p', { className: 'dsh-notify-hint' }, children);
/** The one self-test that still means something: does a page-level card actually appear here? */
export function NotificationSelfTests() {
  const [state, setState] = React.useState(null);
  const fireOne = () => { publishLocalSelfTest(createLocalSelfTestRecord()); setState({ status: 'passed', reason: '页面浮层已渲染（一条）' }); };
  const fire = (count) => { for (const record of createLocalSelfTestBatch({ count })) publishLocalSelfTest(record); setState({ status: 'passed', reason: `页面浮层已渲染（${Math.min(count, SELF_TEST_BATCH.length)} 条）` }); };
  return React.createElement('section', { className: 'dsh-notify-card', 'aria-label': '通知自测' },
    React.createElement('h3', { className: 'dsh-notify-card-title' }, '自测'),
    hint('只有页面里这一条通道：右上角浮层 + 提示音 + 后台标签页闪动。这里发出的卡片只渲染在当前页面，不会外发系统通知。'),
    React.createElement('div', { className: 'dsh-notify-actions' },
      action('测试一条', fireOne),
      action(`测试 ${TOAST_STACK_VISIBLE} 条`, () => fire(TOAST_STACK_VISIBLE)),
      action(`测试 ${SELF_TEST_BATCH.length} 条`, () => fire(SELF_TEST_BATCH.length))),
    hint(`「测试 ${TOAST_STACK_VISIBLE} 条」正好填满角上那一窗，可以看到它们平铺的样子；「测试 ${SELF_TEST_BATCH.length} 条」多出 ${SELF_TEST_BATCH.length - TOAST_STACK_VISIBLE} 条，会折成「+${SELF_TEST_BATCH.length - TOAST_STACK_VISIBLE}」，鼠标移上去展开成完整一列。`),
    state ? React.createElement('p', { className: 'dsh-notify-result', role: 'status', 'data-tone': resultTone(state.status) }, `${state.status}: ${state.reason}`) : null);
}
function SettingsSection() {
  const [config, setConfig] = React.useState(null); const [status, setStatus] = React.useState('正在加载…');
  const [customSounds, setCustomSounds] = React.useState([]); const [soundNotice, setSoundNotice] = React.useState(null);
  const loadSounds = () => fetchJson('/sounds').then((value) => setCustomSounds(Array.isArray(value?.custom) ? value.custom : [])).catch(() => setCustomSounds([]));
  const uploadSound = async (file) => {
    setSoundNotice(`正在上传 ${file.name}…`);
    try {
      const bytes = await file.arrayBuffer();
      const result = await fetchJson('/sounds', { method: 'POST', headers: { 'x-sound-name': file.name, 'content-type': 'application/octet-stream' }, body: bytes });
      setSoundNotice(result?.ok ? `已上传 ${result.name}` : `上传失败（${result?.error || 'unknown'}）`);
      await loadSounds();
    } catch (error) { setSoundNotice(error?.status === 413 ? '文件超过 1 MB' : '上传失败：仅支持 mp3 / m4a / aac / wav / ogg / flac，且不能超过 1 MB'); }
  };
  const removeSound = async (name) => {
    try { await fetchJson('/sounds/delete', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ confirm: true, name }) }); setSoundNotice(`已删除 ${name}`); } catch { setSoundNotice('删除失败'); }
    await loadSounds();
  };
  // Every button in this card must answer in the card itself: the section-level status line sits far
  // above them, so a click used to look like nothing happened at all.
  React.useEffect(() => {
    fetchJson('/config').then((value) => {
      setConfig(value); setToastConfig(value ?? {});
      setStatus(value?.storage?.preferences === 'session' ? '通知已连接（设置不落盘）' : '通知已连接');
    }).catch(() => setStatus('通知同步不可用'));
    void loadSounds();
  }, []);
  const update = async (patch) => { setToastConfig(patch); try { const next = await fetchJson('/config', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(patch) }); setConfig(next); setStatus('设置已保存'); } catch { setStatus('设置保存失败'); } };
  return React.createElement('section', { className: 'dsh-notify-settings', 'aria-label': '通知设置' },
    React.createElement('h2', { className: 'dsh-notify-heading' }, '通知'),
    React.createElement('p', { className: 'dsh-notify-status', role: 'status', 'data-tone': statusTone(status) }, status),
    config && React.createElement('div', { className: 'dsh-notify-card' },
      React.createElement('h3', { className: 'dsh-notify-card-title' }, '提示通道'),
      React.createElement('label', { className: 'dsh-notify-field' }, React.createElement('span', null, 'Toast位置'), React.createElement('select', { className: 'dsh-notify-select', 'aria-label': 'Toast位置', value: config.toastPosition || 'conversation', onChange: (event) => update({ toastPosition: event.target.value }) }, React.createElement('option', { value: 'conversation' }, '会话区右上（默认）'), React.createElement('option', { value: 'viewport' }, '屏幕右上'), React.createElement('option', { value: 'off' }, '关闭（什么都不提示）'))),
      hint('浮层只是页内提示。关掉之后不再弹卡、也不再闪动标签页——「任务完成时告诉我」这件事就没有别的通道了。'),
      React.createElement('label', { className: 'dsh-notify-toggle' }, React.createElement('input', { type: 'checkbox', checked: Boolean(config.subtaskNotify), onChange: (event) => update({ subtaskNotify: event.target.checked }) }), React.createElement('span', null, '子任务 / 后台任务完成时通知')),
      hint('默认关闭：每个子代理、后台任务结束都会各弹一条（标题常常是命令原文），开久了会很乱。需要时再打开。'),
      hint('不保存历史：卡片就是你看到的那一条，关掉即结束。页面没打开时发生的通知不会补发——这是去掉存储换来的简化。')),
    config && React.createElement(NotificationSelfTests),
    config && React.createElement('div', { className: 'dsh-notify-card' },
      React.createElement('h3', { className: 'dsh-notify-card-title' }, '提示音'),
      React.createElement('label', { className: 'dsh-notify-toggle' }, React.createElement('input', { type: 'checkbox', checked: config.soundEnabled !== false, onChange: (event) => update({ soundEnabled: event.target.checked }) }), React.createElement('span', null, '页内提示音（窗口不在最前也会响）')),
      React.createElement('label', { className: 'dsh-notify-field' }, React.createElement('span', null, '声音'),
        React.createElement('select', { className: 'dsh-notify-select', 'aria-label': '提示音', value: config.sound || 'chime', onChange: (event) => update({ sound: event.target.value }) },
          BUILTIN_SOUNDS.map((id) => React.createElement('option', { key: id, value: id }, SOUND_LABELS[id] ?? id)),
          ...customSounds.map((sound) => React.createElement('option', { key: `custom:${sound.name}`, value: `custom:${sound.name}` }, `自定义：${sound.name}`)))),
      React.createElement('div', { className: 'dsh-notify-actions' },
        React.createElement('button', { className: 'dsh-notify-action', type: 'button', onClick: () => { void soundPlayer.unlock().then(() => soundPlayer.play(config.sound || 'chime', { enabled: true })).then((result) => setSoundNotice(result?.reason === 'locked' ? '浏览器要求先点一下页面才能出声：请再点一次「试听」' : result?.played ? '已试听' : `没出声（${result?.reason || 'unknown'}）`)); } }, '试听'),
        React.createElement('label', { className: 'dsh-notify-action', style: { cursor: 'pointer' } }, '上传声音…', React.createElement('input', { type: 'file', accept: 'audio/*,.mp3,.m4a,.wav,.ogg,.flac', style: { display: 'none' }, onChange: (event) => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void uploadSound(file); } }))),
      hint('窗口不在最前、标签在后台时也会响——这是「浏览器被别的应用挡住」时唯一能提醒你的方式。内置音由浏览器合成（不下载任何文件）；自定义音上传到本 profile 的数据目录，重装插件不会丢。上传上限 1 MB，仅支持 mp3 / m4a / aac / wav / ogg / flac。'),
      soundNotice ? React.createElement('p', { className: 'dsh-notify-result', role: 'status' }, soundNotice) : null,
      customSounds.length > 0 && React.createElement('div', { className: 'dsh-notify-actions' }, customSounds.map((sound) => React.createElement('button', { key: sound.name, type: 'button', className: 'dsh-notify-action', 'data-variant': 'danger', onClick: () => void removeSound(sound.name) }, `删除 ${sound.name}`)))));
}
export const CLIENT_COMPOSITION = Object.freeze({ service: 'slots', modules: Object.freeze(['@deepseek-ai/dsh-client-ui-renderer', '@deepseek-ai/dsh-client-ui-layout', '@deepseek-ai/dsh-client-ui-settings', '@deepseek-ai/dsh-client-ui-settings-general']), seats: Object.freeze(['settings.section', 'shell.overlay']) });
export function mountNotifyClient({ slots, sessions, getSessions, getUiSession } = {}) {
  const status = { service: slots?.inject && slots?.register ? 'available' : 'unavailable', seats: {} };
  if (status.service === 'unavailable') return { status, destroy() {} };
  // Resolved lazily: the host may not expose the question surface at all, and the toast degrades to
  // "go to the session" without it.
  const pendingInteractions = () => getUiSession?.()?.pendingInteractions;
  const disposers = [installClientStyles(), installAudioUnlock()];
  const activate = (name, options, Component) => { status.seats[name] = 'active'; const dispose = slots.register({ name, ...options }, Component); return () => { status.seats[name] = 'waiting'; dispose?.(); }; };
  status.seats['settings.section'] = 'waiting';
  try { disposers.push(slots.inject('settings.section', () => activate('settings.section', { id: 'dsh-notify', order: 100, label: '通知', inject: () => ({ sessions: sessions ?? getSessions?.() }) }, SettingsSection))); } catch { status.seats['settings.section'] = 'unavailable'; }
  status.seats['shell.overlay'] = 'waiting';
  try { disposers.push(slots.inject('shell.overlay', () => activate('shell.overlay', { id: 'dsh-notify-toast', order: 100, inject: () => ({ sessions: sessions ?? getSessions?.(), pendingInteractions: pendingInteractions() }) }, ToastOverlay))); } catch { status.seats['shell.overlay'] = 'unavailable'; }
  return { status, destroy() { for (const dispose of disposers.reverse()) dispose?.(); } };
}
export function apply(ctx) { return mountNotifyClient({ slots: ctx?.slots, getSessions: () => ctx?.get?.('sessions'), getUiSession: () => ctx?.get?.('uiSession') }); }
