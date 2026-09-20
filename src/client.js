import React from 'react';
import { BUILTIN_SOUNDS, SOUND_LABELS, SOUND_PRESETS, parseSoundChoice } from './sound-choices.js';

const BASE = '/plugins/dsh-notify';
const LOCAL_TEST_EVENT = 'dsh-notify:self-test-local';
const LOCAL_TEST_CLEAR_EVENT = 'dsh-notify:self-test-clear';
const LOCAL_TEST_FOLD_EVENT = 'dsh-notify:self-test-fold';
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
 * Nodes whose size or grid track changes when a sidebar opens or closes. The AppFrame itself does
 * not resize — it animates `grid-template-columns` — so a ResizeObserver on the window or the
 * frame misses the toggle. The conversation node can also be replaced on session switch; callers
 * must re-query rather than hold the first node forever.
 */
export function toastAnchorWatchTargets(doc = globalThis.document) {
  const nodes = [];
  const seen = new Set();
  const add = (node) => { if (node && !seen.has(node)) { seen.add(node); nodes.push(node); } };
  add(doc?.querySelector?.('[data-conversation-scroll]'));
  add(doc?.querySelector?.('[data-conversation-content]'));
  const frame = doc?.querySelector?.('[data-rightbar-col]')?.parentElement
    ?? doc?.querySelector?.('[data-conversation-content]')?.parentElement;
  add(frame);
  return nodes;
}
/** Follow the conversation's right edge through a sidebar grid animation (~slow duration). */
const TOAST_ANCHOR_FOLLOW_MS = 450;
export function watchToastAnchor(onChange, { document: doc = globalThis.document, window: win = globalThis } = {}) {
  if (typeof onChange !== 'function') return () => {};
  let raf = 0;
  let followingUntil = 0;
  const observed = new Set();
  const measure = () => onChange(toastAnchor({ document: doc, innerWidth: win.innerWidth }));
  const tick = () => {
    measure();
    const now = typeof win.performance?.now === 'function' ? win.performance.now() : Date.now();
    raf = now < followingUntil && typeof win.requestAnimationFrame === 'function' ? win.requestAnimationFrame(tick) : 0;
  };
  const follow = () => {
    const now = typeof win.performance?.now === 'function' ? win.performance.now() : Date.now();
    followingUntil = now + TOAST_ANCHOR_FOLLOW_MS;
    if (!raf && typeof win.requestAnimationFrame === 'function') raf = win.requestAnimationFrame(tick);
    else if (!raf) measure();
  };
  const observer = typeof win.ResizeObserver === 'function' ? new win.ResizeObserver(() => { measure(); follow(); }) : null;
  const mo = typeof win.MutationObserver === 'function' ? new win.MutationObserver(() => { retarget(); measure(); follow(); }) : null;
  const styleTargets = new Set();
  const frameOf = () => doc?.querySelector?.('[data-rightbar-col]')?.parentElement
    ?? doc?.querySelector?.('[data-conversation-content]')?.parentElement;
  const retarget = () => {
    for (const node of toastAnchorWatchTargets(doc)) {
      if (observer && !observed.has(node)) { observer.observe(node); observed.add(node); }
    }
    const frame = frameOf();
    if (mo && frame && !styleTargets.has(frame)) {
      mo.observe(frame, { attributes: true, attributeFilter: ['style', 'data-sidebar-collapsed', 'data-rightbar-collapsed', 'data-rightbar-fullscreen'] });
      styleTargets.add(frame);
    }
  };
  const update = () => { retarget(); measure(); follow(); };
  win.addEventListener?.('resize', update);
  doc.addEventListener?.('transitionstart', update, true);
  doc.addEventListener?.('transitionend', update, true);
  mo?.observe(doc.documentElement, { subtree: true, attributes: true, attributeFilter: ['data-sidebar-collapsed', 'data-rightbar-collapsed', 'data-rightbar-fullscreen'] });
  retarget();
  measure();
  return () => {
    win.removeEventListener?.('resize', update);
    doc.removeEventListener?.('transitionstart', update, true);
    doc.removeEventListener?.('transitionend', update, true);
    observer?.disconnect();
    mo?.disconnect();
    if (raf && typeof win.cancelAnimationFrame === 'function') win.cancelAnimationFrame(raf);
  };
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
export const SETTINGS_CSS = `.dsh-notify-settings{display:grid;gap:15px;max-width:790px;min-width:0;padding:4px 0;color:var(--dsw-alias-label-primary)}
.dsh-notify-heading{font-size:16px;font-weight:650;margin:0}
.dsh-notify-card{background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l2);border-radius:12px;min-width:0;padding:16px 18px}
/* The rhythm inside a card. It has to be scoped to the settings section, because as a bare
   .dsh-notify-card>*+* selector it had the same specificity as the .dsh-notify-hint{margin:0} reset
   further down and lost to it — the reset comes later — so every paragraph in a card sat flush against
   the control above it. The gaps inside 提示通道 measured 10, 0, 10, 0, 0: only text was affected, which
   is exactly what made the card look crammed. */
.dsh-notify-settings .dsh-notify-card>*+*{margin-top:10px}
/* A note belongs to the control it explains rather than to the next block, so it sits closer to that
   control. Written out per case instead of as one class-equals-hint rule, so the lead sentence of a card
   — the hint that follows the title — and the gap between two separate notes both keep the full 10px. */
.dsh-notify-settings .dsh-notify-card>.dsh-notify-field+.dsh-notify-hint,
.dsh-notify-settings .dsh-notify-card>.dsh-notify-toggle+.dsh-notify-hint,
.dsh-notify-settings .dsh-notify-card>.dsh-notify-actions+.dsh-notify-hint{margin-top:6px}
.dsh-notify-card-title{font-size:13px;font-weight:650;margin:0}
.dsh-notify-hint{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:1.6;margin:0}
.dsh-notify-status{align-items:center;display:flex;gap:8px;font-size:12px;line-height:1.45;margin:0;color:var(--dsw-alias-label-secondary)}
.dsh-notify-status::before{background:var(--dsw-alias-label-tertiary,#98a1ad);border-radius:50%;content:"";flex:none;height:8px;width:8px}
.dsh-notify-status[data-tone=ok]::before{background:var(--dsw-alias-state-success-primary,#16a36a)}
.dsh-notify-status[data-tone=warn]::before{background:var(--dsw-alias-state-warn-primary,#d97706)}
.dsh-notify-status[data-tone=error]::before{background:var(--dsw-alias-state-error-primary,#dc2626)}
.dsh-notify-toggle{align-items:flex-start;cursor:pointer;display:flex;font-size:13px;gap:10px;line-height:1.45}
/* The host's mobile stylesheet (bridge-mobile-styles, max-width 767px) stretches every input and select
   inside the settings options pane to width:100%. That is right for our select and wrong for the
   checkbox, which took the whole row and pushed its label past the card edge — the host's selector is
   div[class*=...] input, which outranks a bare .dsh-notify-toggle input. Scoping the rule to the
   settings section wins the cascade back, and the size is pinned three ways (width, max-width and a
   flex basis) so no width rule from outside can stretch it again. The label may shrink, so a cramped
   pane wraps the text rather than overflowing. */
.dsh-notify-settings .dsh-notify-toggle input{accent-color:var(--dsw-alias-state-business-primary);flex:0 0 18px;height:18px;margin:1px 0 0;max-width:18px;min-height:18px;min-width:18px;width:18px}
.dsh-notify-settings .dsh-notify-toggle>span{min-width:0;overflow-wrap:anywhere}
.dsh-notify-field{display:grid;font-size:13px;font-weight:600;gap:8px;min-width:0}
.dsh-notify-select{background:var(--dsw-specific-input-major,var(--dsw-alias-bg-layer-2));border:1px solid var(--dsw-alias-border-l2);border-radius:8px;color:inherit;font:inherit;font-weight:400;max-width:100%;min-height:36px;min-width:0;padding:0 10px;width:100%}
.dsh-notify-actions{align-items:center;display:flex;flex-wrap:wrap;gap:8px;min-width:0}
.dsh-notify-action{background:var(--dsw-alias-button-floating-fill);border:1px solid var(--dsw-alias-border-l2);border-radius:8px;color:inherit;cursor:pointer;font:inherit;font-size:12px;line-height:30px;max-width:100%;min-height:32px;padding:0 10px;touch-action:manipulation}
.dsh-notify-action:hover:not(:disabled){background:var(--dsw-alias-button-floating-hover)}
.dsh-notify-action:disabled{cursor:not-allowed;opacity:.55}
.dsh-notify-action[data-variant=danger]{background:transparent;border-color:var(--dsw-alias-state-error-primary,#dc2626);color:var(--dsw-alias-state-error-primary,#dc2626)}
.dsh-notify-action:focus-visible,.dsh-notify-select:focus-visible,.dsh-notify-toggle input:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:2px}
.dsh-notify-result{color:var(--dsw-alias-label-secondary);font-size:11px;line-height:1.6;margin:0;overflow-wrap:anywhere}
.dsh-notify-result[data-tone=passed]{color:var(--dsw-alias-state-success-primary,#16a36a)}
.dsh-notify-result[data-tone=failed]{color:var(--dsw-alias-state-error-primary,#dc2626)}
.dsh-notify-result[data-tone=active]{color:var(--dsw-alias-state-business-primary)}
.dsh-notify-settings{gap:15px;max-width:790px}.dsh-notify-heading{font-size:26px;letter-spacing:-.4px;line-height:1.25}.dsh-notify-settings-head{align-items:flex-start;display:flex;gap:16px;justify-content:space-between}.dsh-notify-settings-intro{color:var(--dsw-alias-label-secondary);font-size:13px;line-height:1.55;margin:8px 0 0}.dsh-notify-settings-status{align-items:center;background:color-mix(in srgb,var(--dsw-alias-state-success-primary,#07865a) 10%,var(--dsw-alias-bg-layer-2));border:1px solid color-mix(in srgb,var(--dsw-alias-state-success-primary,#07865a) 40%,var(--dsw-alias-border-l2));border-radius:999px;color:var(--dsw-alias-state-success-primary,#07865a);display:flex;font-size:12px;gap:7px;line-height:1;padding:8px 10px;white-space:nowrap}.dsh-notify-settings-status::before{background:currentColor;border-radius:50%;content:"";height:7px;width:7px}.dsh-notify-card{border-radius:13px;box-shadow:0 2px 7px rgb(29 41 57 / 6%);padding:19px 20px}.dsh-notify-card-head{align-items:flex-start;display:flex;gap:12px;margin-bottom:17px}.dsh-notify-card-icon{align-items:center;background:color-mix(in srgb,var(--dsw-alias-state-business-primary,#315ee8) 10%,var(--dsw-alias-bg-layer-2));border-radius:9px;color:var(--dsw-alias-state-business-primary,#315ee8);display:flex;flex:none;font-size:16px;height:31px;justify-content:center;width:31px}.dsh-notify-card-head .dsh-notify-card-title{font-size:15px}.dsh-notify-card-head .dsh-notify-hint{margin-top:4px}.dsh-notify-rows{border-top:1px solid var(--dsw-alias-border-l2)}.dsh-notify-setting-row{align-items:center;border-bottom:1px solid var(--dsw-alias-border-l2);display:flex;gap:16px;min-width:0;padding:15px 0}.dsh-notify-setting-row:last-child{border-bottom:0;padding-bottom:0}.dsh-notify-setting-copy{flex:1;min-width:0}.dsh-notify-setting-label{font-size:13px;font-weight:650}.dsh-notify-setting-help{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:1.55;margin:3px 0 0}.dsh-notify-setting-field{align-items:center;border-bottom:1px solid var(--dsw-alias-border-l2);display:grid;gap:20px;grid-template-columns:minmax(0,1fr) 210px;padding:15px 0}.dsh-notify-setting-field:last-child{border-bottom:0;padding-bottom:0}.dsh-notify-segmented{background:var(--dsw-alias-bg-layer-3,var(--dsw-alias-bg-layer-2));border:1px solid var(--dsw-alias-border-l2);border-radius:10px;display:flex;gap:4px;padding:4px}.dsh-notify-segmented button{background:transparent;border:0;border-radius:7px;color:var(--dsw-alias-label-secondary);cursor:pointer;flex:1;font:600 12px inherit;padding:8px 11px;white-space:nowrap}.dsh-notify-segmented button[data-active=true]{background:var(--dsw-alias-bg-layer-2);box-shadow:0 1px 3px rgb(0 0 0 / 10%);color:var(--dsw-alias-state-business-primary,#315ee8)}.dsh-notify-preview{align-items:center;background:var(--dsw-alias-bg-layer-3,var(--dsw-alias-bg-layer-2));border-radius:9px;color:var(--dsw-alias-label-secondary);display:flex;font-size:12px;gap:10px;margin-top:14px;padding:12px}.dsh-notify-preview::before{background:var(--dsw-alias-state-success-primary,#07865a);border-radius:50%;box-shadow:0 0 0 3px color-mix(in srgb,var(--dsw-alias-state-success-primary,#07865a) 14%,transparent);content:"";flex:none;height:9px;width:9px}.dsh-notify-preview strong{color:var(--dsw-alias-label-primary);display:block;font-size:12px}.dsh-notify-settings .dsh-notify-toggle{align-items:center;cursor:default}.dsh-notify-settings .dsh-notify-toggle input{appearance:none;background:#aeb8c7;border:0;border-radius:999px;cursor:pointer;flex:0 0 42px;height:24px;margin:0;max-width:42px;min-height:24px;min-width:42px;position:relative;width:42px}.dsh-notify-settings .dsh-notify-toggle input::after{background:#fff;border-radius:50%;box-shadow:0 1px 2px rgb(0 0 0 / 22%);content:"";height:18px;left:3px;position:absolute;top:3px;transition:left .18s;width:18px}.dsh-notify-settings .dsh-notify-toggle input:checked{background:var(--dsw-alias-state-business-primary,#315ee8)}.dsh-notify-settings .dsh-notify-toggle input:checked::after{left:21px}.dsh-notify-settings .dsh-notify-toggle>span{display:none}.dsh-notify-settings .dsh-notify-card>*+*{margin-top:0}
.dsh-notify-test-panel{display:grid;gap:14px}.dsh-notify-test-caption{font-size:13px;font-weight:650;margin:0}.dsh-notify-test-grid{display:grid;gap:8px;grid-template-columns:repeat(4,minmax(0,1fr))}.dsh-notify-test-action{align-items:center;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l2);border-radius:9px;color:var(--dsw-alias-label-primary);cursor:pointer;display:flex;font:600 13px inherit;gap:7px;justify-content:center;min-height:40px;padding:6px 8px;white-space:nowrap}.dsh-notify-test-action:hover{background:var(--dsw-alias-button-floating-hover)}.dsh-notify-test-action::before{background:var(--dsh-test-tone,var(--dsw-alias-label-tertiary));border-radius:50%;content:"";height:8px;width:8px}.dsh-notify-test-action[data-tone=success]{--dsh-test-tone:var(--dsw-alias-state-success-primary,#07865a)}.dsh-notify-test-action[data-tone=warning]{--dsh-test-tone:var(--dsw-alias-state-warn-primary,#bc6508)}.dsh-notify-test-action[data-tone=error]{--dsh-test-tone:var(--dsw-alias-state-error-primary,#cf3044)}.dsh-notify-test-action[data-tone=info]{--dsh-test-tone:var(--dsw-alias-state-business-primary,#2862db)}.dsh-notify-test-primary{background:var(--dsw-alias-state-business-primary,#315ee8);border:0;border-radius:9px;color:#fff;cursor:pointer;font:700 13px inherit;justify-self:start;min-height:40px;min-width:238px;padding:7px 14px;width:auto}.dsh-notify-test-primary:hover{filter:brightness(1.06)}.dsh-notify-test-secondary{background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l2);border-radius:9px;color:var(--dsw-alias-label-primary);cursor:pointer;font:600 13px inherit;justify-self:start;min-height:38px;min-width:205px;padding:6px 14px;width:auto}.dsh-notify-test-secondary:hover{background:var(--dsw-alias-button-floating-hover)}
@media (hover:none) and (pointer:coarse){.dsh-notify-action{line-height:42px;min-height:44px}.dsh-notify-select{min-height:44px}.dsh-notify-settings .dsh-notify-toggle input{flex:0 0 42px;height:24px;max-width:42px;min-height:24px;min-width:42px;width:42px}}@media(max-width:620px){.dsh-notify-settings-head{display:block}.dsh-notify-settings-status{display:inline-flex;margin-top:14px}.dsh-notify-setting-field{grid-template-columns:1fr;gap:11px}.dsh-notify-card{padding:16px}.dsh-notify-test-grid{gap:8px;grid-template-columns:repeat(2,minmax(0,1fr))}.dsh-notify-test-action{min-height:44px;padding:8px}.dsh-notify-test-primary,.dsh-notify-test-secondary{justify-self:stretch;min-width:0;width:100%}}`;
/**
 * Toast presentation: a window anchored in the top-right corner. Each card is one row of
 * [tone icon][title + text + actions][close X]. The container is a scroll box exactly as tall as the
 * cards it shows, and every card sits in an absolutely positioned slot whose `transform` is computed
 * from the cards above it — that is what makes a new card push the others down smoothly instead of
 * re-flowing them. A queue longer than the window waits below the fold: the user scrolls the corner,
 * and a sliver of the next card shows that there is something to scroll to. Cards enter with a spring
 * scale + fade and leave by sliding out to the right, from where they were. The window is promoted to
 * the browser top layer (see ToastOverlay) so a self-test fired from 设置 stays visible above the
 * settings modal.
 */
export const TOAST_CSS = `.dsh-notify-frame{position:fixed;z-index:1100;transition:height 390ms cubic-bezier(.16,1,.3,1)}
.dsh-notify-stack{height:100%;overflow-x:hidden;overflow-y:auto;overscroll-behavior:contain;scrollbar-width:thin}
.dsh-notify-stack[data-collapsed=true]{overflow:hidden}
.dsh-notify-stack-inner{pointer-events:none;position:relative}
.dsh-notify-slot{inset-inline:0;pointer-events:none;position:absolute;top:0;transform-origin:top center;transition:transform 360ms cubic-bezier(.16,1,.3,1)}
.dsh-notify-stack[data-collapsed=true] .dsh-notify-slot{transition:top 340ms cubic-bezier(.22,.88,.38,1),transform 340ms cubic-bezier(.22,.88,.38,1)}
.dsh-notify-count{background:var(--dsw-alias-interactive-bg-hover-solid,var(--dsw-alias-bg-layer-3,rgb(0 0 0 / 6%)));border:0;border-radius:999px;color:var(--dsw-alias-label-secondary);cursor:pointer;font:inherit;font-size:11px;inset-inline-end:35px;line-height:18px;padding:0 8px;position:absolute;top:13px;z-index:102}
.dsh-notify-count:hover{color:var(--dsw-alias-label-primary)}
.dsh-notify-toast{align-items:flex-start;animation:dsh-notify-card-in 380ms cubic-bezier(.21,1.02,.73,1);background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l2);border-radius:11px;box-shadow:0 2px 7px rgb(29 41 57 / 10%),0 1px 2px rgb(29 41 57 / 6%);box-sizing:border-box;color:var(--dsw-alias-label-primary);cursor:pointer;display:flex;gap:11px;margin:0;overflow:hidden;padding:14px 34px 17px 14px;pointer-events:auto;position:relative;width:100%}
.dsh-notify-toast[data-style=strong]{background:color-mix(in srgb,var(--dsh-notify-tone) 7%,var(--dsw-alias-bg-layer-2));border-color:color-mix(in srgb,var(--dsh-notify-tone) 62%,var(--dsw-alias-border-l2))}
.dsh-notify-toast[data-style=soft]{box-shadow:0 2px 7px rgb(29 41 57 / 7%),0 1px 2px rgb(29 41 57 / 4%)}
.dsh-notify-toast[data-leaving=true]{animation:dsh-notify-card-out 200ms ease-in forwards;pointer-events:none}
.dsh-notify-toast[data-style=strong][data-attention=true]::after{background:var(--dsh-notify-tone);bottom:0;content:"";height:4px;inset-inline:0;position:absolute;transform-origin:left;animation:dsh-notify-attention 4000ms linear forwards}
@keyframes dsh-notify-card-in{0%{opacity:0;transform:translateY(-10px) scale(.9)}62%{opacity:1;transform:translateY(0) scale(1.02)}100%{opacity:1;transform:none}}
@keyframes dsh-notify-card-out{to{opacity:0;transform:translateX(115%)}}
@keyframes dsh-notify-attention{to{transform:scaleX(0);opacity:0}}
@keyframes dsh-notify-spin{to{transform:rotate(360deg)}}
.dsh-notify-toast-icon{color:var(--dsw-alias-label-tertiary,#7a8494);flex:none;margin-top:1px}
.dsh-notify-toast[data-tone=success]{--dsh-notify-tone:var(--dsw-alias-state-success-primary,#07865a)}.dsh-notify-toast[data-tone=error]{--dsh-notify-tone:var(--dsw-alias-state-error-primary,#cf3044)}.dsh-notify-toast[data-tone=warning]{--dsh-notify-tone:var(--dsw-alias-state-warn-primary,#bc6508)}.dsh-notify-toast[data-tone=info]{--dsh-notify-tone:var(--dsw-alias-state-business-primary,#2862db)}.dsh-notify-toast[data-tone=neutral]{--dsh-notify-tone:var(--dsw-alias-label-tertiary,#6f7c91)}
.dsh-notify-toast[data-style=strong] .dsh-notify-toast-icon{color:var(--dsh-notify-tone)}.dsh-notify-toast[data-style=soft][data-tone=success] .dsh-notify-toast-icon{color:var(--dsh-notify-tone)}.dsh-notify-toast[data-style=soft][data-tone=error] .dsh-notify-toast-icon{color:var(--dsh-notify-tone)}.dsh-notify-toast[data-style=soft][data-tone=warning] .dsh-notify-toast-icon{color:var(--dsh-notify-tone)}.dsh-notify-toast[data-style=soft][data-tone=info] .dsh-notify-toast-icon{color:var(--dsh-notify-tone)}
.dsh-notify-toast-icon[data-spin=true]{animation:dsh-notify-spin .9s linear infinite}
.dsh-notify-toast-body{display:grid;gap:2px;min-width:0;flex:1 1 auto}.dsh-notify-toast-head{align-items:center;display:flex;gap:6px;min-width:0}.dsh-notify-toast-source{color:var(--dsw-alias-label-tertiary,#7a8494);flex:1 1 auto;font-size:11px;line-height:1.4;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.dsh-notify-toast-time{color:var(--dsw-alias-label-tertiary,#7a8494);flex:none;font-size:11px;font-variant-numeric:tabular-nums;line-height:1.4;white-space:nowrap}.dsh-notify-toast-title{font-size:14px;font-weight:700;line-height:1.45}.dsh-notify-toast-text{color:var(--dsw-alias-label-primary);font-size:12px;line-height:1.6;margin:5px 0 0;overflow-wrap:anywhere}.dsh-notify-toast[data-style=soft] .dsh-notify-toast-text{color:var(--dsw-alias-label-secondary)}.dsh-notify-toast-answers{align-items:center;display:flex;flex-wrap:wrap;gap:6px;margin-top:5px}.dsh-notify-toast-answer{background:var(--dsw-alias-button-floating-fill);border:1px solid var(--dsw-alias-border-l2);border-radius:8px;color:inherit;cursor:pointer;font:inherit;font-size:12px;line-height:26px;max-width:100%;min-height:28px;overflow:hidden;padding:0 10px;text-overflow:ellipsis;touch-action:manipulation;white-space:nowrap}.dsh-notify-toast-answer:hover{background:var(--dsw-alias-button-floating-hover)}.dsh-notify-toast-answer:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:2px}.dsh-notify-toast-answer[data-variant=quiet]{background:transparent;color:var(--dsw-alias-label-secondary)}.dsh-notify-toast-answer:disabled{cursor:progress;opacity:.6}.dsh-notify-toast-error{color:var(--dsw-alias-state-error-primary,#dc2626);font-size:11px;line-height:1.45}.dsh-notify-toast-hint{color:var(--dsw-alias-label-secondary);font-size:11px;line-height:1.45}.dsh-notify-toast-close{align-items:center;background:transparent;border:0;border-radius:6px;color:var(--dsw-alias-label-secondary);cursor:pointer;display:inline-flex;font-size:18px;height:27px;inset-inline-end:5px;justify-content:center;line-height:1;padding:0;position:absolute;top:5px;width:27px}.dsh-notify-toast-close:hover{background:var(--dsw-alias-button-floating-hover);color:var(--dsw-alias-label-primary)}.dsh-notify-toast-close:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:2px}
@media (hover:none) and (pointer:coarse){.dsh-notify-toast{padding:14px 44px 17px 14px}.dsh-notify-toast-close{font-size:18px;height:32px;width:32px}}
@media (prefers-reduced-motion:reduce){.dsh-notify-toast,.dsh-notify-toast[data-leaving=true]{animation:none}.dsh-notify-toast[data-attention=true]::after{display:none}.dsh-notify-frame,.dsh-notify-slot,.dsh-notify-stack[data-collapsed=true] .dsh-notify-slot{transition:none}.dsh-notify-toast-icon[data-spin=true]{animation:none}}`;
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
export function createLocalSelfTestRecord({ tone = 'success', now = Date.now(), randomUUID = () => globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2) } = {}) {
  const id = `self-test:${randomUUID()}`;
  const examples = {
    success: { kind: 'completed', title: '程序修复已完成', body: '验证通过。提醒条结束后，这条通知仍会保留。' },
    warning: { kind: 'approval', title: '需要你确认下一步', body: '修复方案已准备好，请确认后再继续。' },
    error: { kind: 'failed', title: '验证未通过', body: '发现一项阻断问题，请查看错误详情后再重试。' },
    info: { kind: 'question', title: '后台任务有新结果', body: '代码检查结果已返回，报告已就绪。' },
  };
  return { ...(examples[tone] ?? examples.success), eventId: id, mergeKey: id, at: now, phase: 'settled', localOnly: true };
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
 *
 * The group is spread over the last few seconds rather than all stamped at the same millisecond, so a
 * self-test shows what a real burst looks like: eight cards, eight readable times, newest on top.
 */
export const SELF_TEST_STEP_MS = 6_000;
export function createLocalSelfTestBatch({ count = SELF_TEST_BATCH.length, now = Date.now(), randomUUID = () => globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2) } = {}) {
  const wanted = Math.max(1, Math.min(SELF_TEST_BATCH.length, Math.trunc(Number(count)) || SELF_TEST_BATCH.length));
  return SELF_TEST_BATCH.slice(0, wanted).map((entry, index) => {
    const id = `self-test:${randomUUID()}-${index}`;
    return { ...entry, eventId: id, mergeKey: id, at: now - (wanted - 1 - index) * SELF_TEST_STEP_MS, phase: 'settled', localOnly: true };
  });
}
export function publishLocalSelfTest(record, dispatch = (event) => globalThis.dispatchEvent(event)) {
  dispatch(typeof CustomEvent === 'function' ? new CustomEvent(LOCAL_TEST_EVENT, { detail: record }) : { type: LOCAL_TEST_EVENT, detail: record });
}
export function clearLocalSelfTests(dispatch = (event) => globalThis.dispatchEvent(event)) { dispatch(typeof Event === 'function' ? new Event(LOCAL_TEST_CLEAR_EVENT) : { type: LOCAL_TEST_CLEAR_EVENT }); }
export function foldLocalSelfTests(dispatch = (event) => globalThis.dispatchEvent(event)) { dispatch(typeof Event === 'function' ? new Event(LOCAL_TEST_FOLD_EVENT) : { type: LOCAL_TEST_FOLD_EVENT }); }
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
function isMainView(sessions, sessionId) {
  const snap = sessions?.list?.getSnapshot?.();
  if (snap?.current === sessionId) return true;
  return (snap?.byId?.[sessionId]?.retainedBy?.mainView ?? 0) > 0;
}
/**
 * `openSession()` updates the main view before React has necessarily committed the matching entry in
 * the left session tree. The tree already exposes the committed selection semantically, so do not
 * depend on its generated CSS-module class names or on a title that may be duplicated. Wait briefly
 * for `[role=treeitem][aria-selected=true]`, then center only that session row. This intentionally
 * uses `scrollIntoView`: it finds the host-owned scrolling ancestor even when the sidebar structure
 * changes, and `nearest` prevents horizontal sidebar movement.
 */
export function revealSelectedSidebarSession({ document: doc = globalThis.document, setTimer = globalThis.setTimeout, clearTimer = globalThis.clearTimeout, attempts = 8, intervalMs = 50 } = {}) {
  let timer = null;
  let cancelled = false;
  let remaining = Math.max(1, attempts);
  const before = doc?.querySelector?.('[role="treeitem"][aria-selected="true"]') ?? null;
  const reveal = () => {
    if (cancelled) return;
    const selected = doc?.querySelector?.('[role="treeitem"][aria-selected="true"]');
    // A row from the previous session may still be selected during React's commit. Only follow a new
    // selected row, otherwise a cross-workspace click could scroll the sidebar to the wrong project.
    if (selected && selected !== before) {
      try { selected.scrollIntoView?.({ block: 'center', inline: 'nearest', behavior: 'smooth' }); } catch { /* jsdom and old DOMs */ }
      return;
    }
    if (--remaining > 0) timer = setTimer?.(reveal, intervalMs);
  };
  // Allow the host selection render to commit first; scrolling a previous selected row is worse than
  // waiting one frame when a notification crosses workspaces.
  timer = setTimer?.(reveal, 80);
  return () => { cancelled = true; if (timer !== null) clearTimer?.(timer); };
}
export async function navigateNotificationRecord(record, { sessions, uiWorkspace, acknowledge } = {}) {
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
  // Current DSH: view selection is `uiWorkspace.openSession` and "current" is
  // `retainedBy.mainView`. `sessions.open` / `list.current` / a pre-existing
  // `binding()` are the older host. `binding()` in particular is only live
  // after the main view has already retained the session, so requiring it
  // first made every other card report 没能打开这个会话.
  try {
    if (typeof uiWorkspace?.openSession === 'function') uiWorkspace.openSession(sessionId);
    else if (typeof sessions?.open === 'function') {
      const opened = sessions.open(sessionId);
      if (opened === false) return { status: 'navigation-failed' };
      if (opened && typeof opened.then === 'function') await opened;
    } else if (!isMainView(sessions, sessionId) && !sessions?.binding?.(sessionId)) {
      return { status: 'navigation-failed' };
    }
    if (!isMainView(sessions, sessionId)) return { status: 'navigation-failed' };
    revealSelectedSidebarSession();
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
const navigateRecord = (record, { sessions, uiWorkspace } = {}) => (record?.localOnly ? Promise.resolve({ status: 'local' }) : navigateNotificationRecord(record, { sessions, uiWorkspace }));
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
let toastConfig = { toastPosition: 'conversation', toastEnabled: true, notificationStyle: 'strong', stackCollapsed: true, soundEnabled: true, sound: 'chime' };
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
/** A phone has no room for five of these; the window shrinks rather than covering the conversation. */
export const TOAST_STACK_VISIBLE_NARROW = 3;
export const TOAST_STACK_GAP = 12;
/** How much of the next card shows below the window: the affordance that there is more to scroll to. */
export const TOAST_STACK_PEEK = 10;
export const TOAST_QUEUE_MAX = 50;
/** In collapsed mode each older card exposes exactly this much of its lower edge. */
export const TOAST_STACK_COLLAPSED_PEEK = 18;
/** A just-arrived card gets one short attention sweep; it never controls dismissal. */
export const TOAST_ATTENTION_MS = 4000;
/** Must match the `dsh-notify-card-out` animation; the card is dropped from the DOM when it ends. */
export const TOAST_EXIT_MS = 200;
export const TOAST_SUCCESS_MS = 900;
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
 * When a card happened, in the smallest form that still answers "which one was this".
 *
 * A page only holds what arrived while it was open, so the usual case is today and the clock alone
 * says it. Seconds are kept because parallel tasks finish seconds apart — that is exactly when the
 * user is trying to tell two cards apart — and the full date is always in the tooltip for the rare
 * card that arrives after the tab was asleep across midnight. Relative wording ("3 分钟前") is
 * deliberately not used: it would need a timer redrawing the stack to stay true, and reconstructing
 * *when* something happened is the whole point of the field.
 */
export function toastTime(at, now = Date.now()) {
  const stamp = Number(at);
  if (!Number.isFinite(stamp) || stamp <= 0) return null;
  const date = new Date(stamp);
  if (Number.isNaN(date.getTime())) return null;
  const pad = (value) => String(value).padStart(2, '0');
  const clock = `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
  const today = new Date(Number.isFinite(Number(now)) ? Number(now) : Date.now());
  const sameDay = date.getFullYear() === today.getFullYear() && date.getMonth() === today.getMonth() && date.getDate() === today.getDate();
  return { label: sameDay ? clock : `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${clock.slice(0, 5)}`, title: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${clock}`, iso: date.toISOString() };
}
/**
 * Where each card sits. Every card keeps its own slot in one flat column — a new one takes the top and
 * pushes the rest down by exactly its own measured height — and the window below decides how much of
 * that column is on screen.
 */
export function toastStackPlan({ heights = [], gap = TOAST_STACK_GAP } = {}) {
  let cursor = 0;
  return heights.map((height) => {
    const plan = { offsetY: cursor };
    cursor += (Number(height) || 0) + gap;
    return plan;
  });
}
/** A folded pile keeps complete older cards bottom-aligned behind the newest card. */
export function collapsedStackPlan({ heights = [], peek = TOAST_STACK_COLLAPSED_PEEK } = {}) {
  const list = (Array.isArray(heights) ? heights : []).map((height) => Number(height) || 0);
  const first = list[0] ?? 0;
  return list.map((height, index) => ({ offsetY: index === 0 ? 0 : first + (index * peek) - height }));
}
/**
 * The corner is a window, not a pile. `visible` cards fit — measured, not assumed, because a card with
 * a body and answer buttons is not the height of a one-line one — and everything older waits below
 * the fold, where the user scrolls to it. The window is a little taller than those cards when there is
 * more, so the next card shows its edge: "there is more here" is something to see, not only to count.
 *
 * The count is the whole queue, not what is hidden behind it: eight notifications are eight
 * notifications, whether five of them are on screen or not.
 */
export function stackWindow({ heights = [], visible = TOAST_STACK_VISIBLE, gap = TOAST_STACK_GAP, peek = TOAST_STACK_PEEK } = {}) {
  const list = (Array.isArray(heights) ? heights : []).map((height) => Number(height) || 0);
  const count = Math.max(1, visible);
  const onScreen = list.slice(0, count);
  const sum = (values) => values.reduce((total, height) => total + height, 0) + gap * Math.max(0, values.length - 1);
  const hidden = Math.max(0, list.length - onScreen.length);
  const windowHeight = sum(onScreen);
  return { total: list.length, hidden, windowHeight: windowHeight + (hidden > 0 ? peek : 0), contentHeight: sum(list), overflow: hidden > 0 };
}
function ToastOverlay({ sessions, uiWorkspace, pendingInteractions } = {}) {
  const state = useNotificationState(); const [, refresh] = React.useState(0); const [cards, setCards] = React.useState([]); const [anchor, setAnchor] = React.useState(() => toastAnchor()); const [expanded, setExpanded] = React.useState(false); const [forcedCollapsed, setForcedCollapsed] = React.useState(false); const [, rerender] = React.useState(0); const toasted = React.useRef(new Set()); const primed = React.useRef(false);
  // useSyncExternalStore keeps the hook order stable whether or not the host exposes the service.
  const pendingStore = React.useMemo(() => ({ subscribe: (listener) => pendingInteractions?.subscribe?.(listener) ?? (() => {}), getSnapshot: () => pendingInteractions?.getSnapshot?.() ?? null }), [pendingInteractions]);
  const pending = React.useSyncExternalStore(pendingStore.subscribe, pendingStore.getSnapshot, () => null);
  // One ref per piece of per-card runtime state: the exit/success timers and each card's measured
  // height. Nothing here retires a card on a clock — a toast leaves when the user says so.
  const frameRef = React.useRef(null); const stackRef = React.useRef(null); const exits = React.useRef(new Map()); const successes = React.useRef(new Map()); const heights = React.useRef(new Map()); const nodes = React.useRef(new Map()); const slots = React.useRef(new Map()); const unseen = React.useRef(new Set()); const sawPending = React.useRef(new Set()); const cardsRef = React.useRef(cards);
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
  const measureOne = (eventId, node) => {
    const height = Math.ceil(node.offsetHeight || node.getBoundingClientRect?.().height || 0);
    if (!height || heights.current.get(eventId) === height) return false;
    heights.current.set(eventId, height);
    return true;
  };
  const measure = (eventId) => (node) => {
    if (!node) { nodes.current.delete(eventId); return; }
    nodes.current.set(eventId, node);
    if (measureOne(eventId, node)) rerenderNow();
  };
  /**
   * Measure every mounted card again — the fix for a batch that arrives before the corner is on screen.
   *
   * The first measurement of a batch happens in the ref callback, during the commit that creates the
   * cards. At that moment the frame is still `display:none`, because a `popover` that has not been
   * shown yet is not laid out: every card reports a height of 0, and the window is built out of those
   * zeros — five slots twelve pixels apart, a single card-tall sliver of overlapping edges on screen.
   * It then stays that way until some unrelated re-render (the next poll, a resize) measures it again.
   * Reading the heights once the frame is really on screen is what makes the first painted frame the
   * finished one; a layout effect applies that re-render before the browser paints.
   */
  const measureAll = () => {
    let changed = false;
    for (const [eventId, node] of nodes.current) if (measureOne(eventId, node)) changed = true;
    if (changed) rerenderNow();
  };
  React.useEffect(() => { const onConfig = () => refresh((n) => n + 1); globalThis.addEventListener?.('dsh-notify:toast-config', onConfig); return () => globalThis.removeEventListener?.('dsh-notify:toast-config', onConfig); }, []);
  React.useEffect(() => watchToastAnchor((next) => setAnchor((prev) => (prev === next ? prev : next))), []);
  React.useEffect(() => { setAnchor(toastAnchor()); }, [cards.length]);
  React.useEffect(() => () => {
    for (const id of exits.current.values()) clearTimeout(id);
    for (const id of successes.current.values()) clearTimeout(id);
  }, []);
  // The shell.overlay seat lives inside the official overlayLayer (z-index 20), so no z-index of
  // ours can clear the settings modal (z-index 1000). Promoting the whole stack to the browser top
  // layer is what actually keeps a self-test fired from 设置 visible and closable; without Popover
  // support the stack stays a normal fixed element and simply degrades to the old stacking.
  //
  // A layout effect, not a passive one, and it re-measures after showing: the cards were measured
  // while this frame was still hidden, so their heights all came back 0 and the window was built out
  // of zeros. Both the promotion and the reading of the real heights have to happen before the first
  // paint, or the user sees a sliver of overlapping card edges until something else re-renders.
  React.useLayoutEffect(() => {
    const element = frameRef.current;
    if (!anyCard || !element) return undefined;
    if (typeof element.showPopover === 'function') {
      try {
        if (!element.hasAttribute('popover')) element.setAttribute('popover', 'manual');
        if (!element.matches?.(':popover-open')) element.showPopover();
      } catch { /* a browser without the Popover API keeps the plain fixed element below */ }
    }
    measureAll();
    return () => { try { element.hidePopover?.(); } catch { /* already detached */ } };
  }, [anyCard]);
  /** A new card takes its place in the queue: waiting work first, then newest first. Nothing is dropped. */
  const showToast = (record) => {
    if (!record?.eventId) return;
    if (globalThis.document?.hidden) unseen.current.add(record.eventId);
    toasted.current.add(record.eventId);
    const incoming = [{ record, status: 'idle', error: null, lastLabel: null, leaving: false, attention: true }, ...cardsRef.current.filter((card) => card.record.eventId !== record.eventId)];
    const next = queueCards(incoming);
    for (const card of incoming) if (!next.includes(card)) forget(card.record.eventId);   // only the runaway-stream cap can reach this
    commit(next);
    void soundPlayer.play();
  };
  React.useEffect(() => {
    const local = (event) => { if (event?.detail?.localOnly) { setForcedCollapsed(false); setExpanded(false); showToast(event.detail); } };
    const clearLocal = () => { for (const card of cardsRef.current) forget(card.record.eventId); commit([]); setForcedCollapsed(false); setExpanded(false); };
    const foldLocal = () => { if (cardsRef.current.length > 1) { setExpanded(false); setForcedCollapsed(true); } };
    globalThis.addEventListener?.(LOCAL_TEST_EVENT, local); globalThis.addEventListener?.(LOCAL_TEST_CLEAR_EVENT, clearLocal); globalThis.addEventListener?.(LOCAL_TEST_FOLD_EVENT, foldLocal);
    return () => { globalThis.removeEventListener?.(LOCAL_TEST_EVENT, local); globalThis.removeEventListener?.(LOCAL_TEST_CLEAR_EVENT, clearLocal); globalThis.removeEventListener?.(LOCAL_TEST_FOLD_EVENT, foldLocal); };
  }, []);
  // Nothing about the stack changes on hover any more: the window is a fixed size and the rest of the
  // queue is below the fold. The mouse wheel scrolls it (the container is the scroll box), and the
  // count on the front card is a button for the times a wheel is not at hand: it jumps to the other
  // end of the queue, and back.
  const scrollWindow = () => {
    const element = stackRef.current;
    if (!element || typeof element.scrollTo !== 'function') return;
    const atEnd = element.scrollTop + element.clientHeight >= (element.scrollHeight ?? 0) - 2;
    element.scrollTo({ top: atEnd ? 0 : element.scrollHeight, behavior: 'smooth' });
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
    // Everything the host delivered since the last poll is news, and it is presented in one pass. This
    // used to take only the *next* unseen record, which was right when a poll carried a single event;
    // now that a poll returns everything after a sequence, that shape made a burst of parallel tasks
    // trickle in one card per poll — and it is the batch, not the single event, that is worth seeing all
    // at once. Oldest first, because showing a card puts it on top: the newest still ends up highest.
    const fresh = toastOrder(state.records).filter((record) => !seen.has(record.eventId));
    for (const record of fresh.reverse()) showToast(record);
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
  /**
   * Clicking a card is a request to go there, and it is only finished once the host has really selected
   * the session. Dismissing first — which is what this did — made every outcome look the same: the card
   * slid away and, when the jump could not happen, nothing said so. The four outcomes do differ, and now
   * so does the screen: `acknowledged` and `local` (a self-test card, which has no session on purpose)
   * end the card, while the other two leave it in place with a line saying why, so it can be clicked again.
   */
  const activate = async (card) => {
    const eventId = card.record.eventId;
    const result = await navigateRecord(card.record, { sessions, uiWorkspace });
    if (result?.status === 'acknowledged' || result?.status === 'local') { dismiss(eventId); return; }
    const error = !validSessionId(card.record.sessionId) ? '这条通知没有可以打开的会话'
      : result?.status === 'acknowledged-without-session' ? '这个会话已经不在了，无法打开'
        : '没能打开这个会话，再点一次试试';
    // lastLabel is cleared on purpose: it belongs to a failed *answer*, and its 重试 button would be about
    // something else entirely.
    patchCard(eventId, { status: 'error', error, lastLabel: null });
  };
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
  const cardView = (card, plan, index) => {
    const record = card.record; const status = card.status;
    const tone = status === 'error' ? 'error' : status === 'success' ? 'success' : toastTone(record.kind);
    const source = sessionLabel(sessions, record.sessionId);
    const stamp = toastTime(record.at);
    // The slot is absolutely positioned and moved by its transform; that is what lets the cards below
    // a new one slide down instead of jumping.
    const pileHidden = collapsed && index > 0;
    const slotStyle = { transform: `translateY(${plan.offsetY}px)`, zIndex: 100 - (index < 0 ? 99 : index) };
    return React.createElement('div', { key: record.eventId, className: 'dsh-notify-slot', style: slotStyle },
      React.createElement('aside', { ref: measure(record.eventId), role: 'status', 'aria-live': pileHidden ? 'off' : 'polite', 'aria-hidden': pileHidden ? 'true' : undefined, inert: pileHidden ? '' : undefined, className: 'dsh-notify-toast', 'data-tone': tone, 'data-style': toastConfig.notificationStyle === 'soft' ? 'soft' : 'strong', 'data-attention': card.attention ? 'true' : 'false', 'data-status': status, 'data-leaving': card.leaving ? 'true' : 'false',
        onAnimationEnd: (event) => { if (event.animationName === 'dsh-notify-attention' && card.attention) patchCard(record.eventId, { attention: false }); }, onClick: () => { if (!card.leaving) void activate(card); } },
        toastIcon(tone, status),
        React.createElement('div', { className: 'dsh-notify-toast-body' },
          React.createElement('span', { className: 'dsh-notify-toast-head' },
            // The time leads the metadata row the session name already occupies: no new line, no third
            // column, and fixed-width digits line the clocks up down the stack. It must not take the
            // right end of that row — the `+N` chip and the close button live there, and the chip is
            // pinned to the corner rather than to a card, so anything right-aligned would slide under it.
            stamp ? React.createElement('time', { className: 'dsh-notify-toast-time', dateTime: stamp.iso, title: stamp.title }, stamp.label) : null,
            source ? React.createElement('span', { className: 'dsh-notify-toast-source', title: record.sessionId }, source) : null),
          React.createElement('strong', { className: 'dsh-notify-toast-title' }, record.title),
          record.body ? React.createElement('p', { className: 'dsh-notify-toast-text' }, record.body) : null,
          actionRow(card)),
        React.createElement('button', { type: 'button', className: 'dsh-notify-toast-close', 'aria-label': '关闭通知', onClick: (event) => { event.stopPropagation(); dismiss(record.eventId); } }, '\u00d7')));
  };
  // A card on its way out is no longer part of the stack: it must not be counted by the +N chip and
  // must not make the window taller. It keeps the slot it had while the slide-out plays, then its own
  // timer takes the node away.
  const liveCards = cards.filter((card) => !card.leaving);
  const liveHeights = liveCards.map((card) => heights.current.get(card.record.eventId) ?? 0);
  const collapsed = (forcedCollapsed || toastConfig.stackCollapsed !== false) && !expanded && liveCards.length > 1;
  const expandedPlans = toastStackPlan({ heights: liveHeights });
  const firstHeight = liveHeights[0] ?? 0;
  const collapsedPlans = collapsedStackPlan({ heights: liveHeights });
  const expandedFrame = stackWindow({ heights: liveHeights, visible: narrow ? TOAST_STACK_VISIBLE_NARROW : TOAST_STACK_VISIBLE });
  const collapsedHeight = firstHeight + (Math.min(Math.max(0, liveCards.length - 1), 3) * TOAST_STACK_COLLAPSED_PEEK) + 4;
  const frame = collapsed ? { total: liveCards.length, hidden: Math.max(0, liveCards.length - 4), windowHeight: collapsedHeight, contentHeight: collapsedHeight, overflow: false } : expandedFrame;
  const plans = collapsed ? collapsedPlans : expandedPlans;
  const planById = new Map(liveCards.map((card, index) => [card.record.eventId, plans[index]]));
  // Remember where every live card sits: a card that leaves slides out from where the user last saw it,
  // not from wherever the column happens to have moved on to.
  for (const [eventId, plan] of planById) slots.current.set(eventId, plan);
  const queueCount = frame.overflow ? frame.total : 0;
  const onScreenCount = Math.max(0, frame.total - frame.hidden);
  const rendered = [...liveCards, ...cards.filter((card) => card.leaving)];
  // The count belongs to the window, not to whichever card happens to be on top: it is pinned to the
  // corner outside the scroll box, so it stays put (and stays the same number) once the user scrolls.
  return React.createElement('div', { ref: frameRef, popover: 'manual', className: 'dsh-notify-frame',
    style: { inset: 'auto', insetInlineEnd: narrow ? 12 : toastConfig.toastPosition === 'viewport' ? 16 : anchor, insetInlineStart: 'auto', bottom: 'auto', top: 'calc(env(safe-area-inset-top, 0px) + var(--dsh-toast-top-offset, 56px))', width: narrow ? 'calc(100vw - 24px)' : 'min(360px, calc(100vw - 32px))', height: `${frame.windowHeight}px`, margin: 0, padding: 0, border: 0, background: 'transparent', overflow: 'visible' } },
    queueCount > 0 ? React.createElement('button', { type: 'button', className: 'dsh-notify-count', 'aria-label': `本页共 ${queueCount} 条通知`, title: `共 ${queueCount} 条，已显示 ${onScreenCount} 条，点击在队列两端之间跳转`, onClick: (event) => { event.stopPropagation(); scrollWindow(); } }, `+${queueCount}`) : null,
    React.createElement('div', { ref: stackRef, className: 'dsh-notify-stack', 'data-overflow': frame.overflow ? 'true' : 'false', 'data-collapsed': collapsed ? 'true' : 'false', onPointerEnter: () => { if (collapsed) setExpanded(true); }, onFocusCapture: () => { if (collapsed) setExpanded(true); } },
      React.createElement('div', { className: 'dsh-notify-stack-inner', style: { height: `${frame.contentHeight}px` } },
        rendered.map((card) => cardView(card, planById.get(card.record.eventId) ?? slots.current.get(card.record.eventId) ?? { offsetY: frame.contentHeight }, liveCards.findIndex((live) => live.record.eventId === card.record.eventId))))));
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
/** Page-only visual checks: each button uses the same ToastOverlay path as a real delivered record. */
export function NotificationSelfTests() {
  const [state, setState] = React.useState(null);
  const single = (tone) => { publishLocalSelfTest(createLocalSelfTestRecord({ tone })); setState({ status: 'passed', reason: `已发送${({ success: '完成', warning: '确认', error: '失败', info: '信息' })[tone]}模拟通知` }); };
  const replayAll = () => { clearLocalSelfTests(); for (const record of createLocalSelfTestBatch({ count: 4 })) publishLocalSelfTest(record); setState({ status: 'passed', reason: '已重播四种状态与增强版提醒动效' }); };
  const fold = () => { foldLocalSelfTests(); setState({ status: 'passed', reason: '已切换通知堆叠；移入通知区即可展开' }); };
  const clear = () => { clearLocalSelfTests(); setState({ status: 'passed', reason: '已清空本页模拟通知' }); };
  const testButton = (tone, label) => React.createElement('button', { type: 'button', className: 'dsh-notify-test-action', 'data-tone': tone, onClick: () => single(tone) }, label);
  return React.createElement('div', { className: 'dsh-notify-test-panel', 'aria-label': '通知自测' },
    React.createElement('p', { className: 'dsh-notify-test-caption' }, '点击发送一条模拟通知'),
    React.createElement('div', { className: 'dsh-notify-test-grid' }, testButton('success', '完成'), testButton('warning', '确认'), testButton('error', '失败'), testButton('info', '信息')),
    React.createElement('button', { type: 'button', className: 'dsh-notify-test-primary', onClick: replayAll }, '查看四种状态 / 重播动效'),
    React.createElement('button', { type: 'button', className: 'dsh-notify-test-secondary', onClick: fold }, '折叠通知为一摞'),
    React.createElement('button', { type: 'button', className: 'dsh-notify-test-secondary', onClick: clear }, '清空通知，先看文档'),
    hint('所有测试通知只渲染在当前页面，不发送系统通知，也不影响真实任务。增强版会显示对应状态色和短暂提醒条。'),
    state ? React.createElement('p', { className: 'dsh-notify-result', role: 'status', 'data-tone': resultTone(state.status) }, state.reason) : null);
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
  const card = (icon, title, description, content) => React.createElement('div', { className: 'dsh-notify-card' }, React.createElement('div', { className: 'dsh-notify-card-head' }, React.createElement('span', { className: 'dsh-notify-card-icon', 'aria-hidden': true }, icon), React.createElement('div', null, React.createElement('h3', { className: 'dsh-notify-card-title' }, title), hint(description))), content);
  const copy = (label, description) => React.createElement('div', { className: 'dsh-notify-setting-copy' }, React.createElement('div', { className: 'dsh-notify-setting-label' }, label), React.createElement('p', { className: 'dsh-notify-setting-help' }, description));
  const toggle = (label, description, checked, onChange, ariaLabel) => React.createElement('div', { className: 'dsh-notify-setting-row' }, copy(label, description), React.createElement('label', { className: 'dsh-notify-toggle' }, React.createElement('input', { type: 'checkbox', checked, onChange, 'aria-label': ariaLabel }), React.createElement('span', null, label)));
  const style = config?.notificationStyle === 'soft' ? 'soft' : 'strong'; const collapsed = config?.stackCollapsed !== false;
  return React.createElement('section', { className: 'dsh-notify-settings', 'aria-label': '通知设置' },
    React.createElement('div', { className: 'dsh-notify-settings-head' }, React.createElement('div', null, React.createElement('div', { className: 'dsh-notify-eyebrow' }, 'NOTIFICATIONS'), React.createElement('h2', { className: 'dsh-notify-heading' }, '通知'), React.createElement('p', { className: 'dsh-notify-settings-intro' }, '决定什么时候提醒你，以及通知在页面中如何显示。')), React.createElement('p', { className: 'dsh-notify-settings-status', role: 'status' }, status)),
    config && card('◉', '通知显示', '显示位置、视觉样式与多条通知的呈现方式。', React.createElement(React.Fragment, null,
      React.createElement('div', { className: 'dsh-notify-rows' },
        React.createElement('div', { className: 'dsh-notify-setting-field' }, copy('通知位置', '默认出现在会话区右上角，不遮住侧栏。'), React.createElement('select', { className: 'dsh-notify-select', 'aria-label': '通知位置', value: config.toastPosition || 'conversation', onChange: (event) => update({ toastPosition: event.target.value }) }, React.createElement('option', { value: 'conversation' }, '会话区右上（推荐）'), React.createElement('option', { value: 'viewport' }, '屏幕右上'), React.createElement('option', { value: 'off' }, '关闭页面通知'))),
        React.createElement('div', { className: 'dsh-notify-setting-field' }, copy('通知样式', '增强版使用清晰状态色与短暂提醒条；柔和版更接近当前风格。'), React.createElement('div', { className: 'dsh-notify-segmented', role: 'group', 'aria-label': '通知样式' }, ...['strong', 'soft'].map((value) => React.createElement('button', { key: value, type: 'button', 'data-active': style === value ? 'true' : 'false', onClick: () => update({ notificationStyle: value }) }, value === 'strong' ? '增强版' : '柔和版')))),
        toggle('多条通知折叠显示', '有多条未关闭通知时，最新一条完整显示，其余通知在下方等距露边；移入后展开。', collapsed, (event) => update({ stackCollapsed: event.target.checked }), '多条通知折叠显示')),
      React.createElement('div', { className: 'dsh-notify-preview' }, React.createElement('span', null, React.createElement('strong', null, `${style === 'strong' ? '增强版' : '柔和版'} · 折叠显示${collapsed ? '已开启' : '已关闭'}`), collapsed ? '状态色清晰，提醒条结束后通知仍会保留。' : '多条通知会依次完整显示。')))),
    config && card('♬', '提示音', '在你阅读其他内容或切到后台时，用声音提醒你有新结果。', React.createElement(React.Fragment, null, React.createElement('div', { className: 'dsh-notify-rows' }, toggle('页内提示音', '窗口不在最前、标签在后台时也会播放。', config.soundEnabled !== false, (event) => update({ soundEnabled: event.target.checked }), '页内提示音'), React.createElement('div', { className: 'dsh-notify-setting-field' }, copy('提示音', '可试听、上传或删除自定义声音。'), React.createElement('select', { className: 'dsh-notify-select', 'aria-label': '提示音', value: config.sound || 'chime', onChange: (event) => update({ sound: event.target.value }) }, BUILTIN_SOUNDS.map((id) => React.createElement('option', { key: id, value: id }, SOUND_LABELS[id] ?? id)), ...customSounds.map((sound) => React.createElement('option', { key: `custom:${sound.name}`, value: `custom:${sound.name}` }, `自定义：${sound.name}`))))), React.createElement('div', { className: 'dsh-notify-actions', style: { marginTop: '15px' } }, action('试听', () => { void soundPlayer.unlock().then(() => soundPlayer.play(config.sound || 'chime', { enabled: true })).then((result) => setSoundNotice(result?.reason === 'locked' ? '浏览器要求先点一下页面才能出声：请再点一次「试听」' : result?.played ? '已试听' : `没出声（${result?.reason || 'unknown'}）`)); }), React.createElement('label', { className: 'dsh-notify-action', style: { cursor: 'pointer' } }, '上传声音…', React.createElement('input', { type: 'file', accept: 'audio/*,.mp3,.m4a,.wav,.ogg,.flac', style: { display: 'none' }, onChange: (event) => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void uploadSound(file); } }))), soundNotice ? React.createElement('p', { className: 'dsh-notify-result', role: 'status' }, soundNotice) : null, customSounds.length > 0 && React.createElement('div', { className: 'dsh-notify-actions' }, customSounds.map((sound) => action(`删除 ${sound.name}`, () => void removeSound(sound.name), { 'data-variant': 'danger' }))))),
    config && card('✓', '任务提醒', '选择哪些任务结果会主动出现在你的通知列表中。', React.createElement('div', { className: 'dsh-notify-rows' }, toggle('子任务 / 后台任务完成时通知', '默认关闭。开启后，每个子代理或后台任务结束时都会通知你。', Boolean(config.subtaskNotify), (event) => update({ subtaskNotify: event.target.checked }), '子任务 / 后台任务完成时通知'))),
    config && card('↗', '预览与自测', '仅在当前页面展示模拟通知，不发送系统通知，也不影响真实任务。', React.createElement(NotificationSelfTests)));

}
export const CLIENT_COMPOSITION = Object.freeze({ service: 'slots', modules: Object.freeze(['@deepseek-ai/dsh-client-ui-renderer', '@deepseek-ai/dsh-client-ui-layout', '@deepseek-ai/dsh-client-ui-settings', '@deepseek-ai/dsh-client-ui-settings-general']), seats: Object.freeze(['settings.section', 'shell.overlay']) });
export function mountNotifyClient({ slots, sessions, uiWorkspace, getSessions, getUiSession, getUiWorkspace } = {}) {
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
  try { disposers.push(slots.inject('shell.overlay', () => activate('shell.overlay', { id: 'dsh-notify-toast', order: 100, inject: () => ({ sessions: sessions ?? getSessions?.(), uiWorkspace: uiWorkspace ?? getUiWorkspace?.(), pendingInteractions: pendingInteractions() }) }, ToastOverlay))); } catch { status.seats['shell.overlay'] = 'unavailable'; }
  return { status, destroy() { for (const dispose of disposers.reverse()) dispose?.(); } };
}
export function apply(ctx) { return mountNotifyClient({ slots: ctx?.slots, getSessions: () => ctx?.get?.('sessions'), getUiSession: () => ctx?.get?.('uiSession'), getUiWorkspace: () => ctx?.get?.('uiWorkspace') }); }
