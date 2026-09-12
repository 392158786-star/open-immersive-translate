import browser from "webextension-polyfill";

import { sendToBackground } from "../../shared/messages";
import type { FeatureContext } from "./context";

export const FLOAT_BALL_POSITION_KEY = "floatBallPos";

interface FloatBallPosition {
  x: number;
  y: number;
}

function isPosition(value: unknown): value is FloatBallPosition {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<FloatBallPosition>;
  return Number.isFinite(candidate.x) && Number.isFinite(candidate.y);
}

function clampPosition(position: FloatBallPosition): FloatBallPosition {
  return {
    x: Math.max(0, Math.min(window.innerWidth - 36, position.x)),
    y: Math.max(0, Math.min(window.innerHeight - 36, position.y)),
  };
}

/** Mount the draggable page translation control. */
export function init(ctx: FeatureContext): () => void {
  if (!ctx.config.floatBall.enabled) return () => undefined;

  const host = document.createElement("div");
  host.dataset.imt = "float-ball";
  host.style.cssText = [
    "position:fixed",
    "top:50%",
    ctx.config.floatBall.position === "left" ? "left:12px" : "right:12px",
    "transform:translateY(-50%)",
    "z-index:2147483647",
  ].join(";");

  const shadow = host.attachShadow({ mode: "open" });
  shadow.innerHTML = `
    <style>
      :host { color-scheme: light; font-family: system-ui, sans-serif; }
      button { font: inherit; }
      .ball {
        width: 36px;
        height: 36px;
        border: 0;
        border-radius: 50%;
        color: white;
        background: #2563eb;
        box-shadow: 0 3px 12px rgb(0 0 0 / 28%);
        cursor: grab;
        display: grid;
        place-items: center;
        font-size: 17px;
        line-height: 1;
        padding: 0;
        user-select: none;
      }
      .ball:active { cursor: grabbing; }
      .ball[aria-pressed="true"] { background: #1d4ed8; }
      .menu {
        position: absolute;
        right: 42px;
        top: 0;
        min-width: 144px;
        padding: 4px;
        border: 1px solid rgb(0 0 0 / 10%);
        border-radius: 8px;
        background: white;
        box-shadow: 0 6px 20px rgb(0 0 0 / 20%);
      }
      :host([data-side="left"]) .menu { left: 42px; right: auto; }
      .menu[hidden] { display: none; }
      .menu button {
        display: block;
        width: 100%;
        border: 0;
        border-radius: 5px;
        padding: 7px 9px;
        color: #111827;
        background: transparent;
        text-align: left;
        cursor: pointer;
        white-space: nowrap;
      }
      .menu button:hover { background: #f3f4f6; }
      .menu button[data-active="true"] {
        color: #1d4ed8;
        background: #eff6ff;
        font-weight: 600;
      }
      @media print { :host { display: none !important; } }
    </style>
    <button class="ball" type="button" title="Toggle translation" aria-label="Toggle translation"></button>
    <div class="menu" role="menu" hidden>
      <button type="button" role="menuitem" data-action="settings">设置</button>
      <button type="button" role="menuitem" data-action="original">原网页</button>
      <button type="button" role="menuitem" data-action="translation-only">仅中文</button>
      <button type="button" role="menuitem" data-action="dual">中英对照</button>
      <button type="button" role="menuitem" data-action="academic">学术助手</button>
      <button type="button" role="menuitem" data-action="never-site">从不翻译此站</button>
    </div>
  `;

  const button = shadow.querySelector<HTMLButtonElement>(".ball")!;
  const menu = shadow.querySelector<HTMLElement>(".menu")!;
  button.textContent = "译";
  button.setAttribute("aria-pressed", String(ctx.isTranslated()));
  host.dataset.side = ctx.config.floatBall.position;
  document.documentElement.append(host);

  let disposed = false;
  let positionTouched = false;
  let drag:
    | {
        pointerId: number;
        startX: number;
        startY: number;
        left: number;
        top: number;
        moved: boolean;
      }
    | undefined;
  let suppressClick = false;

  const setPosition = (position: FloatBallPosition): void => {
    const clamped = clampPosition(position);
    host.style.left = `${clamped.x}px`;
    host.style.top = `${clamped.y}px`;
    host.style.right = "auto";
    host.style.transform = "none";
    host.dataset.side = clamped.x < window.innerWidth / 2 ? "left" : "right";
  };

  void browser.storage.local
    .get(FLOAT_BALL_POSITION_KEY)
    .then((stored) => {
      const position = stored[FLOAT_BALL_POSITION_KEY];
      if (!disposed && !positionTouched && isPosition(position)) {
        setPosition(position);
      }
    })
    .catch(() => undefined);

  const closeMenu = (): void => {
    menu.hidden = true;
  };
  const refreshMenuState = (): void => {
    const activeMode =
      ctx.config.translationMode === "translation" ? "translation-only" : "dual";
    for (const item of menu.querySelectorAll<HTMLButtonElement>("button")) {
      const action = item.dataset.action;
      item.dataset.active = String(
        (!ctx.isTranslated() && action === "original") ||
          (ctx.isTranslated() && action === activeMode) ||
          (action === "academic" &&
            ctx.config.academic?.enabled === true),
      );
    }
  };

  const onPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0) return;
    positionTouched = true;
    const rect = button.getBoundingClientRect();
    drag = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      left: rect.left,
      top: rect.top,
      moved: false,
    };
    button.setPointerCapture?.(event.pointerId);
  };

  const onPointerMove = (event: PointerEvent): void => {
    if (!drag || drag.pointerId !== event.pointerId) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (Math.abs(dx) + Math.abs(dy) >= 4) drag.moved = true;
    if (drag.moved) setPosition({ x: drag.left + dx, y: drag.top + dy });
  };

  const onPointerUp = (event: PointerEvent): void => {
    if (!drag || drag.pointerId !== event.pointerId) return;
    const completedDrag = drag;
    drag = undefined;
    button.releasePointerCapture?.(event.pointerId);
    if (!completedDrag.moved) return;

    suppressClick = true;
    const left = completedDrag.left + event.clientX - completedDrag.startX;
    const top = completedDrag.top + event.clientY - completedDrag.startY;
    const position = clampPosition({ x: left, y: top });
    setPosition(position);
    void browser.storage.local
      .set({ [FLOAT_BALL_POSITION_KEY]: position })
      .catch(() => undefined);
  };

  const onClick = (): void => {
    if (suppressClick) {
      suppressClick = false;
      return;
    }
    menu.hidden = !menu.hidden;
    refreshMenuState();
    button.setAttribute("aria-pressed", String(ctx.isTranslated()));
  };

  const onContextMenu = (event: MouseEvent): void => {
    event.preventDefault();
    menu.hidden = !menu.hidden;
    refreshMenuState();
  };

  const onMenuClick = (event: Event): void => {
    const target = event.target as HTMLElement | null;
    const action = target?.dataset.action;
    if (!action) return;
    closeMenu();

    if (action === "settings") {
      void sendToBackground({ type: "openOptions" }).catch(() => undefined);
      return;
    }

    if (action === "original") {
      if (ctx.isTranslated()) ctx.toggleTranslate();
      button.setAttribute("aria-pressed", "false");
      return;
    }

    if (action === "translation-only" || action === "dual") {
      void sendToBackground({
        type: "setConfig",
        patch: {
          translateMainOnly: false,
          translationMode:
            action === "translation-only" ? "translation" : "dual",
        },
      }).catch(() => undefined);
      if (!ctx.isTranslated()) ctx.toggleTranslate("whole");
      button.setAttribute("aria-pressed", "true");
      return;
    }

    if (action === "academic") {
      const academic = ctx.config.academic;
      if (!academic) return;
      void sendToBackground({
        type: "setConfig",
        patch: {
          academic: {
            ...academic,
            enabled: !academic.enabled,
          },
        },
      }).catch(() => undefined);
      return;
    }

    if (action === "never-site") {
      const hostname = window.location.hostname;
      const neverTranslateSites = Array.from(
        new Set([...ctx.config.neverTranslateSites, hostname]),
      );
      void sendToBackground({
        type: "setConfig",
        patch: { neverTranslateSites },
      }).catch(() => undefined);
      if (ctx.isTranslated()) ctx.toggleTranslate();
      button.setAttribute("aria-pressed", "false");
    }
  };

  const onDocumentPointerDown = (event: PointerEvent): void => {
    if (event.target === host || event.composedPath().includes(host)) return;
    closeMenu();
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === "Escape") closeMenu();
  };

  button.addEventListener("pointerdown", onPointerDown);
  button.addEventListener("click", onClick);
  button.addEventListener("contextmenu", onContextMenu);
  menu.addEventListener("click", onMenuClick);
  window.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointerup", onPointerUp);
  document.addEventListener("pointerdown", onDocumentPointerDown);
  document.addEventListener("keydown", onKeyDown);
  refreshMenuState();

  return () => {
    disposed = true;
    button.removeEventListener("pointerdown", onPointerDown);
    button.removeEventListener("click", onClick);
    button.removeEventListener("contextmenu", onContextMenu);
    menu.removeEventListener("click", onMenuClick);
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
    document.removeEventListener("pointerdown", onDocumentPointerDown);
    document.removeEventListener("keydown", onKeyDown);
    host.remove();
  };
}
