import browser from "webextension-polyfill";

import { sendToBackground } from "../../shared/messages";
import type { FeatureContext } from "./context";

export const FLOAT_BALL_POSITION_KEY = "floatBallPos";
const FLOAT_BALL_SIZE = 36;
const FLOAT_BALL_MARGIN = 8;

interface FloatBallPosition {
  x: number;
  y: number;
  xRatio?: number;
  yRatio?: number;
}

function isPosition(value: unknown): value is FloatBallPosition {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<FloatBallPosition>;
  return Number.isFinite(candidate.x) && Number.isFinite(candidate.y);
}

interface FloatBallViewport {
  left: number;
  top: number;
  width: number;
  height: number;
}

function viewportBounds(): FloatBallViewport {
  const viewport = window.visualViewport;
  return {
    left: viewport?.offsetLeft ?? 0,
    top: viewport?.offsetTop ?? 0,
    width: viewport?.width ?? window.innerWidth,
    height: viewport?.height ?? window.innerHeight,
  };
}

function clampPosition(position: FloatBallPosition): FloatBallPosition {
  const viewport = viewportBounds();
  const maxX = Math.max(
    viewport.left,
    viewport.left + viewport.width - FLOAT_BALL_SIZE - FLOAT_BALL_MARGIN,
  );
  const maxY = Math.max(
    viewport.top,
    viewport.top + viewport.height - FLOAT_BALL_SIZE - FLOAT_BALL_MARGIN,
  );
  return {
    x: Math.max(viewport.left + FLOAT_BALL_MARGIN, Math.min(maxX, position.x)),
    y: Math.max(viewport.top + FLOAT_BALL_MARGIN, Math.min(maxY, position.y)),
    ...(Number.isFinite(position.xRatio) ? { xRatio: position.xRatio } : {}),
    ...(Number.isFinite(position.yRatio) ? { yRatio: position.yRatio } : {}),
  };
}

function positionFromRatios(
  xRatio: number,
  yRatio: number,
): FloatBallPosition {
  const viewport = viewportBounds();
  const travelX = Math.max(
    0,
    viewport.width - FLOAT_BALL_SIZE - FLOAT_BALL_MARGIN * 2,
  );
  const travelY = Math.max(
    0,
    viewport.height - FLOAT_BALL_SIZE - FLOAT_BALL_MARGIN * 2,
  );
  return clampPosition({
    x: viewport.left + FLOAT_BALL_MARGIN + Math.min(1, Math.max(0, xRatio)) * travelX,
    y: viewport.top + FLOAT_BALL_MARGIN + Math.min(1, Math.max(0, yRatio)) * travelY,
    xRatio,
    yRatio,
  });
}

function ratiosFromPosition(position: FloatBallPosition): {
  xRatio: number;
  yRatio: number;
} {
  const viewport = viewportBounds();
  const travelX = Math.max(
    1,
    viewport.width - FLOAT_BALL_SIZE - FLOAT_BALL_MARGIN * 2,
  );
  const travelY = Math.max(
    1,
    viewport.height - FLOAT_BALL_SIZE - FLOAT_BALL_MARGIN * 2,
  );
  return {
    xRatio: Math.min(1, Math.max(0, (position.x - viewport.left - FLOAT_BALL_MARGIN) / travelX)),
    yRatio: Math.min(1, Math.max(0, (position.y - viewport.top - FLOAT_BALL_MARGIN) / travelY)),
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
  let currentRatio = {
    xRatio: ctx.config.floatBall.position === "left" ? 0 : 1,
    yRatio: 0.5,
  };

  const setPosition = (position: FloatBallPosition): FloatBallPosition => {
    const clamped = clampPosition(position);
    const ratio =
      Number.isFinite(position.xRatio) && Number.isFinite(position.yRatio)
        ? {
            xRatio: position.xRatio as number,
            yRatio: position.yRatio as number,
          }
        : ratiosFromPosition(clamped);
    currentRatio = ratio;
    const resolved = positionFromRatios(ratio.xRatio, ratio.yRatio);
    host.style.left = `${resolved.x}px`;
    host.style.top = `${resolved.y}px`;
    host.style.right = "auto";
    host.style.transform = "none";
    const viewport = viewportBounds();
    host.dataset.side =
      resolved.x < viewport.left + viewport.width / 2 ? "left" : "right";
    return resolved;
  };

  const onViewportChange = (): void => {
    setPosition(positionFromRatios(currentRatio.xRatio, currentRatio.yRatio));
  };

  void browser.storage.local
    .get(FLOAT_BALL_POSITION_KEY)
    .then((stored) => {
      const position = stored[FLOAT_BALL_POSITION_KEY];
      if (!disposed && !positionTouched && isPosition(position)) {
        setPosition(
          Number.isFinite(position.xRatio) && Number.isFinite(position.yRatio)
            ? positionFromRatios(
                position.xRatio as number,
                position.yRatio as number,
              )
            : position,
        );
      }
    })
    .catch(() => undefined);

  setPosition(positionFromRatios(currentRatio.xRatio, currentRatio.yRatio));

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
    const position = setPosition({ x: left, y: top });
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
  window.addEventListener("resize", onViewportChange);
  window.visualViewport?.addEventListener("resize", onViewportChange);
  window.visualViewport?.addEventListener("scroll", onViewportChange);
  document.addEventListener("fullscreenchange", onViewportChange);
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
    window.removeEventListener("resize", onViewportChange);
    window.visualViewport?.removeEventListener("resize", onViewportChange);
    window.visualViewport?.removeEventListener("scroll", onViewportChange);
    document.removeEventListener("fullscreenchange", onViewportChange);
    document.removeEventListener("pointerdown", onDocumentPointerDown);
    document.removeEventListener("keydown", onKeyDown);
    host.remove();
  };
}
