import type {
  Paragraph,
  ReadingMode,
  Rule,
  TranslationMode,
} from "../../shared/types";

import themeCss from "./themes.css?raw";

export type TranslationTheme =
  | "none"
  | "underline"
  | "dashed"
  | "dotted"
  | "highlight"
  | "mask"
  | "opacity"
  | "blockquote"
  | "paper"
  | "bold"
  | "italic"
  | "grey"
  | "dividingLine"
  | "wavy"
  | "marker"
  | "dashedBorder"
  | "solidBorder"
  | "thinDashed"
  | "nativeUnderline"
  | "nativeDashed"
  | "nativeDotted"
  | "weakening"
  | "blur";

export interface TargetStyleOptions {
  font?: string;
  fontSize?: string | number;
  color?: string;
  lineHeight?: string | number;
}

export interface RenderTranslationOptions {
  mode: TranslationMode;
  readingMode?: ReadingMode;
  theme: string;
  wrapperTag: "font";
  prefix: "smart" | "block" | "inline";
  style?: TargetStyleOptions;
  automaticColor?: boolean;
  preformatted?: boolean;
  academicTerms?: string[];
  translatedSegments?: string[];
}

export interface RenderedScrollAnchor {
  x: number;
  y: number;
}

interface SourceElementState {
  element: Element;
  wasHidden: boolean;
  hadClassAttribute: boolean;
}

interface SourceTextState {
  node: Text;
  wrapper: HTMLSpanElement;
}

interface LayoutStyleAdjustment {
  element: HTMLElement;
  property: string;
  value: string;
  priority: string;
}

interface RgbaColor {
  r: number;
  g: number;
  b: number;
  a: number;
}

interface RenderState {
  paragraph: Paragraph;
  injected: Element[];
  sourceElements: SourceElementState[];
  sourceTexts: SourceTextState[];
  layoutAdjustments: LayoutStyleAdjustment[];
  interactiveTarget?: Element;
  target?: HTMLElement;
  readingToggle?: HTMLButtonElement;
  readingMode?: ReadingMode;
  translationExpanded?: boolean;
  researchDisplay?: string;
  researchDisplayPriority?: string;
  paired?: boolean;
}

interface AdoptedStyleState {
  kind: "sheet";
  sheet: CSSStyleSheet;
}

interface ElementStyleState {
  kind: "element";
  element: HTMLStyleElement;
}

const BLOCK_TAGS = new Set([
  "ADDRESS",
  "ARTICLE",
  "ASIDE",
  "BLOCKQUOTE",
  "BODY",
  "BR",
  "BUTTON",
  "CANVAS",
  "DD",
  "DETAILS",
  "DIV",
  "DL",
  "DT",
  "FIELDSET",
  "FIGCAPTION",
  "FIGURE",
  "FOOTER",
  "FORM",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "HEADER",
  "HGROUP",
  "HR",
  "LI",
  "MAIN",
  "NAV",
  "NOSCRIPT",
  "OL",
  "OPTION",
  "P",
  "PICTURE",
  "PRE",
  "SECTION",
  "SELECT",
  "SOURCE",
  "SUMMARY",
  "TABLE",
  "TBODY",
  "TD",
  "TFOOT",
  "TH",
  "TR",
  "UL",
  "VIDEO",
]);

const BLOCK_DISPLAYS = new Set([
  "block",
  "flex",
  "flow-root",
  "grid",
  "list-item",
  "table",
  "table-caption",
  "table-cell",
  "table-footer-group",
  "table-header-group",
  "table-row",
  "table-row-group",
]);

const states = new Set<RenderState>();
const statesByContainer = new WeakMap<Element, RenderState>();
const styleStates = new WeakMap<
  Document | ShadowRoot,
  AdoptedStyleState | ElementStyleState
>();
const SCROLL_ANCHOR_LOCK_CLASS = "imt-translation-scroll-lock";

/** Disable browser scroll anchoring while translated content changes height. */
export function setScrollAnchorSuppression(suppressed: boolean): void {
  if (typeof document === "undefined") return;
  document.documentElement.classList.toggle(
    SCROLL_ANCHOR_LOCK_CLASS,
    suppressed,
  );
}

function belongsToRoot(root: Node, element: Element): boolean {
  return root === element || root.contains(element);
}

function isBlockContainer(container: Element): boolean {
  const display =
    container.ownerDocument.defaultView?.getComputedStyle(container).display;
  return BLOCK_TAGS.has(container.tagName) || BLOCK_DISPLAYS.has(display ?? "");
}

function appendTarget(
  paragraph: Paragraph,
  target: HTMLElement,
  prefix: RenderTranslationOptions["prefix"],
  state: RenderState,
): void {
  const targetContainer = state.interactiveTarget ?? paragraph.container;
  const useBlockPrefix =
    prefix === "block" ||
    (prefix === "smart" && isBlockContainer(targetContainer));
  if (useBlockPrefix) {
    target.classList.add("imt-target-block");
    target.style.setProperty("display", "block", "important");
    target.style.setProperty("width", "100%", "important");
    target.style.setProperty("max-width", "100%", "important");
    target.style.setProperty("min-width", "0", "important");
    target.style.setProperty("overflow-wrap", "anywhere", "important");
    target.style.setProperty("white-space", "normal", "important");
    target.style.setProperty("margin-top", "0.2em", "important");
  } else {
    target.classList.remove("imt-target-block");
  }
  if (isInteractiveElement(targetContainer)) {
    target.classList.add("imt-target-interactive");
    target.style.setProperty("display", "inline-block", "important");
  }

  for (const existing of [...states]) {
    if (
      existing !== state &&
      existing.injected.some(
        (element) =>
          element.parentElement === targetContainer &&
          (element as HTMLElement).dataset.imt === "target",
      )
    ) {
      clearState(existing);
    }
  }
  for (const existing of targetContainer.querySelectorAll(
    ':scope > [data-imt="target"]',
  )) {
    existing.remove();
  }
  targetContainer.append(target);
  state.injected.push(target);
}

function newState(paragraph: Paragraph): RenderState {
  removeTranslation(paragraph);
  const state: RenderState = {
    paragraph,
    injected: [],
    sourceElements: [],
    sourceTexts: [],
    layoutAdjustments: [],
  };
  states.add(state);
  statesByContainer.set(paragraph.container, state);
  return state;
}

function topLevelSourceNodes(nodes: readonly Node[]): Node[] {
  const unique = [...new Set(nodes)];
  return unique.filter(
    (node) =>
      !unique.some(
        (candidate) =>
          candidate !== node &&
          candidate.nodeType === Node.ELEMENT_NODE &&
          candidate.contains(node),
      ),
  );
}

const INTERACTIVE_SELECTOR =
  "a[href], button, input, select, textarea, summary, [role='button'], [onclick]";

function isInteractiveElement(element: Element): boolean {
  return element.matches(INTERACTIVE_SELECTOR);
}

function textNodesInside(element: Element): Text[] {
  const nodes: Text[] = [];
  const walker = element.ownerDocument.createTreeWalker(
    element,
    NodeFilter.SHOW_TEXT,
  );
  let node = walker.nextNode();
  while (node) {
    const text = node as Text;
    if (
      text.nodeValue?.trim() &&
      !text.parentElement?.closest("[data-imt]")
    ) {
      nodes.push(text);
    }
    node = walker.nextNode();
  }
  return nodes;
}

function dominantInteractiveTarget(
  container: Element,
  sourceText: string,
): Element | undefined {
  if (isInteractiveElement(container)) return container;
  const source = sourceText.trim();
  if (!source) return undefined;
  const candidates = [
    ...container.querySelectorAll(INTERACTIVE_SELECTOR),
  ].filter((element) => !element.closest("[data-imt]"));
  const dominant = candidates.filter((element) => {
    const text = (element.textContent ?? "").trim();
    if (!text) return false;
    return text.length / source.length >= 0.7;
  });
  return dominant.length === 1 ? dominant[0] : undefined;
}

function selectInteractiveTarget(state: RenderState): void {
  if (state.interactiveTarget) return;
  state.interactiveTarget = dominantInteractiveTarget(
    state.paragraph.container,
    state.paragraph.text,
  );
}

function wrapSourceText(state: RenderState, text: Text): void {
  const parent = text.parentNode;
  if (!parent) return;
  const wrapper = text.ownerDocument.createElement("span");
  wrapper.dataset.imt = "source";
  parent.insertBefore(wrapper, text);
  wrapper.append(text);
  state.sourceTexts.push({ node: text, wrapper });
}

function markInteractiveSource(
  state: RenderState,
  interactive: Element,
): void {
  state.interactiveTarget = interactive;
  for (const text of textNodesInside(interactive)) {
    wrapSourceText(state, text);
  }
}

function ensureSourceMarkers(state: RenderState): void {
  if (state.interactiveTarget) {
    markInteractiveSource(state, state.interactiveTarget);
    return;
  }

  const nodes = topLevelSourceNodes(state.paragraph.nodes);
  const interactive = dominantInteractiveTarget(
    state.paragraph.container,
    state.paragraph.text,
  );
  if (interactive) {
    markInteractiveSource(state, interactive);
    return;
  }

  for (const node of nodes) {
    if (node.nodeType === Node.ELEMENT_NODE) {
      const element = node as Element;
      if (
        state.sourceElements.some(
          (source) => source.element === element,
        )
      ) {
        continue;
      }
      state.sourceElements.push({
        element,
        wasHidden: element.classList.contains("imt-source-hidden"),
        hadClassAttribute: element.hasAttribute("class"),
      });
      continue;
    }

    if (node.nodeType !== Node.TEXT_NODE || !node.parentNode) {
      continue;
    }

    const text = node as Text;
    if (text.parentElement?.dataset.imt === "source") {
      continue;
    }
    const parent = text.parentNode;
    if (!parent) {
      continue;
    }
    const wrapper = text.ownerDocument.createElement("span");
    wrapper.dataset.imt = "source";
    parent.insertBefore(wrapper, text);
    wrapper.append(text);
    state.sourceTexts.push({ node: text, wrapper });
  }
}

function applyMode(state: RenderState, mode: TranslationMode): void {
  const hideSource =
    mode === "translation" || (mode === "dual" && state.paired === true);
  if (hideSource) {
    ensureSourceMarkers(state);
  }

  for (const element of state.injected) {
    if ((element as HTMLElement).dataset.imt === "target") {
      element.classList.toggle("imt-target-replace", mode === "translation");
    }
  }

  for (const { element, wasHidden } of state.sourceElements) {
    element.classList.toggle(
      "imt-source-hidden",
      hideSource || wasHidden,
    );
  }
  for (const { wrapper } of state.sourceTexts) {
    wrapper.classList.toggle("imt-source-hidden", hideSource);
  }
}

function ensureReadingToggle(
  state: RenderState,
  target: HTMLElement,
): HTMLButtonElement {
  if (state.readingToggle?.isConnected) return state.readingToggle;
  const button = target.ownerDocument.createElement("button");
  button.type = "button";
  button.className = "imt-reading-toggle";
  button.dataset.imt = "reading-toggle";
  button.setAttribute("aria-label", "Show translation");
  button.title = "Show translation";
  button.textContent = "T";
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (state.readingMode !== "research") return;
    state.translationExpanded = !state.translationExpanded;
    applyReadingMode(state, "research");
  });
  target.insertAdjacentElement("beforebegin", button);
  state.injected.push(button);
  state.readingToggle = button;
  return button;
}

function applyReadingMode(state: RenderState, mode: ReadingMode): void {
  state.readingMode = mode;
  const target = state.target;
  applyMode(state, mode === "quick" ? "translation" : "dual");
  if (!target) return;

  target.dataset.imtReading = mode;
  const alwaysVisible = false;
  const visible =
    mode !== "research" || alwaysVisible || state.translationExpanded === true;
  target.classList.toggle("imt-research-translation", mode === "research");
  target.classList.toggle("imt-research-hidden", !visible);
  if (mode === "research" && !visible) {
    if (state.researchDisplay === undefined) {
      state.researchDisplay = target.style.getPropertyValue("display");
      state.researchDisplayPriority =
        target.style.getPropertyPriority("display");
    }
    target.style.setProperty("display", "none", "important");
  } else if (state.researchDisplay !== undefined) {
    if (state.researchDisplay) {
      target.style.setProperty(
        "display",
        state.researchDisplay,
        state.researchDisplayPriority,
      );
    } else {
      target.style.removeProperty("display");
    }
    state.researchDisplay = undefined;
    state.researchDisplayPriority = undefined;
  }

  const toggle =
    mode === "research" && !alwaysVisible
      ? ensureReadingToggle(state, target)
      : state.readingToggle;
  if (!toggle) return;
  toggle.hidden = mode !== "research" || alwaysVisible;
  toggle.dataset.expanded = String(state.translationExpanded === true);
  toggle.setAttribute("aria-expanded", String(state.translationExpanded === true));
  toggle.setAttribute(
    "aria-label",
    state.translationExpanded ? "Hide translation" : "Show translation",
  );
  toggle.title = state.translationExpanded
    ? "Hide translation"
    : "Show translation";
  toggle.textContent = state.translationExpanded ? "-" : "T";
}

function clearState(state: RenderState): void {
  for (const adjustment of state.layoutAdjustments.reverse()) {
    if (adjustment.value) {
      adjustment.element.style.setProperty(
        adjustment.property,
        adjustment.value,
        adjustment.priority,
      );
    } else {
      adjustment.element.style.removeProperty(adjustment.property);
    }
  }
  for (const element of state.injected) {
    element.remove();
  }
  for (const {
    element,
    wasHidden,
    hadClassAttribute,
  } of state.sourceElements) {
    if (!wasHidden) {
      element.classList.remove("imt-source-hidden");
      if (!hadClassAttribute && element.getAttribute("class") === "") {
        element.removeAttribute("class");
      }
    }
  }
  for (const { node, wrapper } of state.sourceTexts) {
    if (wrapper.parentNode) {
      wrapper.parentNode.insertBefore(node, wrapper);
      wrapper.remove();
    }
  }

  state.paragraph.container.removeAttribute("data-imt-id");
  states.delete(state);
  statesByContainer.delete(state.paragraph.container);
}

function setLayoutStyle(
  state: RenderState,
  element: HTMLElement,
  property: string,
  value: string,
): void {
  if (
    element.style.getPropertyValue(property) === value &&
    element.style.getPropertyPriority(property) === "important"
  ) {
    return;
  }
  if (
    !state.layoutAdjustments.some(
      (adjustment) =>
        adjustment.element === element && adjustment.property === property,
    )
  ) {
    state.layoutAdjustments.push({
      element,
      property,
      value: element.style.getPropertyValue(property),
      priority: element.style.getPropertyPriority(property),
    });
  }
  element.style.setProperty(property, value, "important");
}

function parseColorChannel(value: string, maximum = 255): number | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (trimmed.endsWith("%")) {
    return Math.max(
      0,
      Math.min(maximum, (Number.parseFloat(trimmed) / 100) * maximum),
    );
  }
  const parsed = Number.parseFloat(trimmed);
  return Number.isFinite(parsed)
    ? Math.max(0, Math.min(maximum, parsed))
    : undefined;
}

function parseCssColor(value: string): RgbaColor | undefined {
  const match = value.trim().match(/^rgba?\((.*)\)$/iu);
  if (!match?.[1]) return undefined;
  const [channelsSource, alphaSource] = match[1].split("/", 2);
  const channels = channelsSource
    .trim()
    .split(channelsSource.includes(",") ? /\s*,\s*/u : /\s+/u);
  if (channels.length < 3) return undefined;
  const r = parseColorChannel(channels[0] ?? "");
  const g = parseColorChannel(channels[1] ?? "");
  const b = parseColorChannel(channels[2] ?? "");
  if (r === undefined || g === undefined || b === undefined) return undefined;
  const alphaToken =
    alphaSource ?? (channels.length >= 4 ? channels[3] : undefined);
  const a = alphaToken
    ? parseColorChannel(alphaToken, 1)
    : 1;
  return { r, g, b, a: a ?? 1 };
}

function compositeColor(
  foreground: RgbaColor,
  background: RgbaColor,
): RgbaColor {
  const alpha = foreground.a + background.a * (1 - foreground.a);
  if (alpha <= 0) return { r: 255, g: 255, b: 255, a: 1 };
  return {
    r:
      (foreground.r * foreground.a +
        background.r * background.a * (1 - foreground.a)) /
      alpha,
    g:
      (foreground.g * foreground.a +
        background.g * background.a * (1 - foreground.a)) /
      alpha,
    b:
      (foreground.b * foreground.a +
        background.b * background.a * (1 - foreground.a)) /
      alpha,
    a: alpha,
  };
}

function effectiveBackgroundColor(element: Element): RgbaColor {
  const layers: RgbaColor[] = [];
  let current: Element | null = element;
  while (current) {
    const view = current.ownerDocument.defaultView;
    if (!view) break;
    const parsed = parseCssColor(
      view.getComputedStyle(current).backgroundColor,
    );
    if (parsed && parsed.a > 0) {
      layers.push(parsed);
      if (parsed.a >= 0.999) break;
    }
    current = current.parentElement;
  }

  let result: RgbaColor = { r: 255, g: 255, b: 255, a: 1 };
  for (let index = layers.length - 1; index >= 0; index -= 1) {
    const layer = layers[index];
    if (layer) result = compositeColor(layer, result);
  }
  return result;
}

function relativeLuminance(color: RgbaColor): number {
  const channel = (value: number): number => {
    const normalized = value / 255;
    return normalized <= 0.03928
      ? normalized / 12.92
      : ((normalized + 0.055) / 1.055) ** 2.4;
  };
  return (
    0.2126 * channel(color.r) +
    0.7152 * channel(color.g) +
    0.0722 * channel(color.b)
  );
}

function isBlueText(color: RgbaColor): boolean {
  const maximum = Math.max(color.r, color.g, color.b);
  const minimum = Math.min(color.r, color.g, color.b);
  const saturation =
    maximum <= 0 ? 0 : (maximum - minimum) / maximum;
  return (
    color.b >= 90 &&
    color.b > color.r * 1.25 &&
    color.b >= color.g * 1.08 &&
    saturation >= 0.32
  );
}

/** Choose a readable target color from the source text and page background. */
export function resolveAutomaticTranslationColor(element: Element): string {
  const background = effectiveBackgroundColor(element);
  const view = element.ownerDocument.defaultView;
  const foreground = view
    ? parseCssColor(view.getComputedStyle(element).color)
    : undefined;

  // Blue source text gets a neutral translation so the two layers stay
  // distinguishable.
  if (foreground && isBlueText(foreground)) return "#000000";

  const sourceIsDark = foreground
    ? relativeLuminance(foreground) < 0.34
    : false;
  const backgroundIsDark = relativeLuminance(background) < 0.24;
  if (sourceIsDark || backgroundIsDark) return "#4da3ff";

  return "#000000";
}

/** Capture the exact scroll position before rendering translations. */
export function captureRenderedScrollAnchor(): RenderedScrollAnchor | undefined {
  if (typeof window === "undefined") return undefined;
  return { x: window.scrollX, y: window.scrollY };
}

/** Hold the viewport at exactly the same position after a render batch. */
export function restoreRenderedScrollAnchor(
  anchor: RenderedScrollAnchor | undefined,
): void {
  if (!anchor) return;
  if (
    Math.abs(window.scrollX - anchor.x) < 0.5 &&
    Math.abs(window.scrollY - anchor.y) < 0.5
  ) {
    return;
  }
  window.scrollTo(anchor.x, anchor.y);
}

function applyAutomaticTargetColor(
  target: HTMLElement,
  sourceContainer: Element,
): void {
  target.classList.add("imt-target-auto-color");
  target.style.setProperty(
    "--imt-target-color",
    resolveAutomaticTranslationColor(sourceContainer),
    "important",
  );
}

let layoutRefreshTimer: ReturnType<typeof setTimeout> | undefined;
let translationScrollActive = false;

function settleRenderedTarget(
  state: RenderState,
  target: HTMLElement,
): void {
  for (let pass = 0; pass < 3; pass += 1) {
    const previousSignature = target.dataset.imtSegmentSignature;
    fitConstrainedDualLayout(state, target, state.paragraph);
    segmentReadableTranslation(
      target,
      state.paragraph.container as HTMLElement,
    );
    if (target.dataset.imtSegmentSignature === previousSignature) break;
  }
}

function refreshRenderedLayouts(): void {
  layoutGuideFrames();
  layoutHeadingFrames();
  refreshAutomaticTargetColors();
  for (const state of [...states]) {
    const target = state.injected.find(
      (element): element is HTMLElement =>
        element instanceof HTMLElement &&
        element.dataset.imt === "target",
    );
    if (target?.isConnected) {
      settleRenderedTarget(state, target);
    }
  }
}

function refreshAutomaticTargetColors(): void {
  for (const state of [...states]) {
    const target = state.injected.find(
      (element): element is HTMLElement =>
        element instanceof HTMLElement &&
        element.dataset.imt === "target",
    );
    if (target?.isConnected) {
      if (target.classList.contains("imt-target-auto-color")) {
        applyAutomaticTargetColor(target, state.paragraph.container);
      }
    }
  }
}

function isHeadingFrame(
  container: HTMLElement,
  target: HTMLElement,
): boolean {
  if (target.classList.contains("imt-target-interactive")) return false;
  if (
    /^(H[1-6]|DT)$/.test(container.tagName) ||
    container.getAttribute("role") === "heading"
  ) {
    return true;
  }
  const className =
    typeof container.className === "string" ? container.className : "";
  const fingerprint = `${container.id} ${className}`;
  const source = (stateForTargetText(container) ?? "").trim();
  const translated = (target.textContent ?? "").trim();
  if (
    /(?:title|headline|heading|subhead|subject|caption|section|column|label)/iu.test(
      fingerprint,
    ) &&
    source.length <= 120 &&
    translated.length <= 80
  ) {
    return true;
  }
  const style = getComputedStyle(container);
  const words = source.split(/\s+/).filter(Boolean);
  return (
    source.length <= 90 &&
    words.length <= 12 &&
    translated.length <= 60 &&
    (Number.parseFloat(style.fontWeight) || 400) >= 600 &&
    Number.parseFloat(style.fontSize) <= 28
  );
}

function stateForTargetText(container: HTMLElement): string {
  const clone = container.cloneNode(true) as HTMLElement;
  clone.querySelectorAll("[data-imt]").forEach((element) => element.remove());
  return (clone.textContent ?? "").replace(/\s+/g, " ").trim();
}

export function layoutHeadingFrames(): void {
  for (const state of [...states]) {
    const target = state.injected.find(
      (element): element is HTMLElement =>
        element instanceof HTMLElement &&
        element.dataset.imt === "target" &&
        element.isConnected,
    );
    const container = state.paragraph.container as HTMLElement;
    if (!target || !isHeadingFrame(container, target)) continue;
    if (
      container.dataset.imtHeadingSignature ===
      `${container.clientWidth}x${container.clientHeight}`
    ) {
      continue;
    }
    const containerStyle = getComputedStyle(container);
    if (!container.dataset.imtHeadingBaseFontSize) {
      container.dataset.imtHeadingBaseFontSize = containerStyle.fontSize;
    }
    if (!target.dataset.imtHeadingBaseFontSize) {
      target.dataset.imtHeadingBaseFontSize = getComputedStyle(target).fontSize;
    }
    const baseSource =
      Number.parseFloat(container.dataset.imtHeadingBaseFontSize) || 16;
    const baseTarget =
      Number.parseFloat(target.dataset.imtHeadingBaseFontSize) || baseSource;
    const sourceSize = Math.max(7, baseSource * 0.9);
    const targetSize = Math.max(7, baseTarget * 0.96);
    setLayoutStyle(
      state,
      container,
      "font-size",
      `${Math.round(sourceSize * 10) / 10}px`,
    );
    setLayoutStyle(
      state,
      target,
      "font-size",
      `${Math.round(targetSize * 10) / 10}px`,
    );
    setLayoutStyle(state, target, "display", "block");
    setLayoutStyle(state, target, "width", "100%");
    setLayoutStyle(state, target, "max-width", "100%");
    setLayoutStyle(state, target, "white-space", "normal");
    setLayoutStyle(state, target, "word-break", "normal");
    setLayoutStyle(state, target, "overflow-wrap", "anywhere");
    setLayoutStyle(state, target, "writing-mode", "horizontal-tb");
    setLayoutStyle(state, target, "text-orientation", "mixed");
    for (const element of container.querySelectorAll<HTMLElement>("*")) {
      if (element === target || element.closest('[data-imt="target"]')) continue;
      setLayoutStyle(
        state,
        element,
        "font-size",
        `${Math.round(sourceSize * 10) / 10}px`,
      );
    }
    target.dataset.imtHeadingFrame = "true";
    container.dataset.imtHeadingSignature = `${container.clientWidth}x${container.clientHeight}`;
  }
}

export function layoutGuideFrames(): void {
  const groups = new Map<
    Element,
    Array<{ state: RenderState; target: HTMLElement; interactive: HTMLElement }>
  >();
  for (const state of states) {
    const target = state.injected.find(
      (element): element is HTMLElement =>
        element instanceof HTMLElement &&
        element.classList.contains("imt-target-interactive") &&
        element.isConnected,
    );
    const interactive = target?.closest<HTMLElement>(INTERACTIVE_SELECTOR);
    if (!target || !interactive?.parentElement) continue;
    const members = groups.get(interactive.parentElement) ?? [];
    members.push({ state, target, interactive });
    groups.set(interactive.parentElement, members);
  }

  for (const members of groups.values()) {
    const frameSignature = members
      .map(({ interactive }) => {
        const rect = interactive.getBoundingClientRect();
        return `${Math.round(rect.width)}x${Math.round(rect.height)}`;
      })
      .join("|");
    if (
      members.every(
        ({ interactive }) =>
          interactive.dataset.imtGuideFrameSignature === frameSignature,
      )
    ) {
      continue;
    }
    for (const { state, target, interactive } of members) {
      if (!interactive.dataset.imtGuideBaseFontSize) {
        interactive.dataset.imtGuideBaseFontSize =
          getComputedStyle(interactive).fontSize;
      }
      if (!target.dataset.imtGuideBaseFontSize) {
        target.dataset.imtGuideBaseFontSize =
          getComputedStyle(target).fontSize;
      }
      setLayoutStyle(state, interactive, "display", "flex");
      setLayoutStyle(state, interactive, "flex-direction", "column");
      setLayoutStyle(state, interactive, "align-items", "center");
      setLayoutStyle(state, interactive, "justify-content", "center");
      setLayoutStyle(state, interactive, "text-align", "center");
      setLayoutStyle(state, interactive, "line-height", "normal");
      setLayoutStyle(state, interactive, "overflow", "hidden");
      setLayoutStyle(state, target, "display", "block");
      setLayoutStyle(state, target, "margin", "0.08em 0 0");
      setLayoutStyle(state, target, "writing-mode", "horizontal-tb");
      setLayoutStyle(state, target, "text-orientation", "mixed");
      const interactiveRect = interactive.getBoundingClientRect();
      const targetRect = target.getBoundingClientRect();
      const availableWidth =
        interactive.clientWidth || interactiveRect.width;
      const targetWidth = target.scrollWidth || targetRect.width;
      const targetText = (target.textContent ?? "").trim();
      const needsWrap =
        targetText.length > 1 &&
        availableWidth > 0 &&
        (targetWidth >= availableWidth * 0.8 ||
          targetRect.right >= interactiveRect.right - 2);
      target.dataset.imtGuideWrapped = needsWrap ? "true" : "false";
      setLayoutStyle(
        state,
        target,
        "white-space",
        needsWrap ? "normal" : "nowrap",
      );
      setLayoutStyle(
        state,
        target,
        "word-break",
        needsWrap ? "normal" : "keep-all",
      );
      setLayoutStyle(
        state,
        target,
        "overflow-wrap",
        needsWrap ? "anywhere" : "normal",
      );
      setLayoutStyle(state, target, "width", needsWrap ? "100%" : "auto");
      setLayoutStyle(state, target, "max-width", "100%");
    }

    const scales = members.map(({ interactive }) => {
      const rect = interactive.getBoundingClientRect();
      const width = interactive.clientWidth || rect.width;
      const height = interactive.clientHeight || rect.height;
      if (width <= 0 || height <= 0) return 1;
      return Math.min(
        1,
        width / Math.max(1, interactive.scrollWidth),
        height / Math.max(1, interactive.scrollHeight),
      );
    });
    const scale = Math.max(0.65, Math.min(...scales));

    for (const { state, target, interactive } of members) {
      const sourceSize =
        Number.parseFloat(interactive.dataset.imtGuideBaseFontSize ?? "") ||
        14;
      const targetSize =
        Number.parseFloat(target.dataset.imtGuideBaseFontSize ?? "") ||
        sourceSize;
      const nextSourceSize = Math.max(7, sourceSize * scale * 0.9);
      const nextTargetSize = Math.max(7, targetSize * scale);
      setLayoutStyle(
        state,
        interactive,
        "font-size",
        `${Math.round(nextSourceSize * 10) / 10}px`,
      );
      setLayoutStyle(
        state,
        target,
        "font-size",
        `${Math.round(nextTargetSize * 10) / 10}px`,
      );
      setLayoutStyle(
        state,
        target,
        "line-height",
        `${Math.max(8, nextTargetSize * 1.05)}px`,
      );
      interactive.dataset.imtGuideFrameSignature = frameSignature;
    }
  }
}

/** Recheck dual-layout constraints after fonts, images, and dynamic rows settle. */
export function scheduleRenderedLayoutRefresh(): void {
  if (translationScrollActive) return;
  if (layoutRefreshTimer !== undefined) return;
  layoutRefreshTimer = setTimeout(() => {
    layoutRefreshTimer = undefined;
    if (translationScrollActive) return;
    refreshRenderedLayouts();
  }, 180);
}

/** Suppress layout corrections while the reader is scrolling. */
export function setTranslationScrollActive(active: boolean): void {
  translationScrollActive = active;
}

if (typeof window !== "undefined") {
  window.addEventListener("resize", scheduleRenderedLayoutRefresh, {
    passive: true,
  });
  const colorScheme = window.matchMedia?.("(prefers-color-scheme: dark)");
  colorScheme?.addEventListener?.("change", scheduleRenderedLayoutRefresh);

  if (typeof MutationObserver !== "undefined") {
    const observer = new MutationObserver(refreshAutomaticTargetColors);
    const observeThemeAttributes = (element: Element | null): void => {
      if (!element) return;
      observer.observe(element, {
        attributes: true,
        attributeFilter: ["class", "style", "data-theme", "data-color-mode"],
      });
    };
    observeThemeAttributes(document.documentElement);
    if (document.body) {
      observeThemeAttributes(document.body);
    } else {
      document.addEventListener(
        "DOMContentLoaded",
        () => observeThemeAttributes(document.body),
        { once: true },
      );
    }
  }
}

function fitConstrainedDualLayout(
  state: RenderState,
  target: HTMLElement,
  paragraph: Paragraph,
): void {
  const container = paragraph.container as HTMLElement;
  const view = container.ownerDocument.defaultView;
  if (!view || !container.isConnected) return;
  const layoutSignature = [
    container.clientWidth,
    container.clientHeight,
    container.scrollWidth,
    container.scrollHeight,
    target.textContent?.length ?? 0,
  ].join(":");
  if (target.dataset.imtLayoutSignature === layoutSignature) return;
  target.dataset.imtLayoutSignature = layoutSignature;

  setLayoutStyle(state, target, "writing-mode", "horizontal-tb");
  setLayoutStyle(state, target, "text-orientation", "mixed");
  const interactiveTarget = target.classList.contains(
    "imt-target-interactive",
  );
  const interactiveWrap =
    interactiveTarget && target.dataset.imtGuideWrapped === "true";
  setLayoutStyle(
    state,
    target,
    "white-space",
    interactiveTarget && !interactiveWrap ? "nowrap" : "normal",
  );
  setLayoutStyle(
    state,
    target,
    "word-break",
    interactiveTarget && !interactiveWrap ? "keep-all" : "normal",
  );
  setLayoutStyle(
    state,
    target,
    "overflow-wrap",
    interactiveTarget && !interactiveWrap ? "normal" : "anywhere",
  );

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const containerRect = container.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    if (containerRect.width <= 0 || containerRect.height <= 0) return;
    const availableWidth = container.clientWidth || containerRect.width;
    const availableHeight = container.clientHeight || containerRect.height;
    const overflowX = Math.max(
      0,
      container.scrollWidth - availableWidth,
      targetRect.right - containerRect.right,
    );
    const overflowY = Math.max(
      0,
      container.scrollHeight - availableHeight,
      targetRect.bottom - containerRect.bottom,
    );
    if (overflowX <= 1 && overflowY <= 1) {
      if (interactiveTarget) return;
      if (target.dataset.imtHeadingFrame === "true") return;
      const containerStyle = view.getComputedStyle(container);
      if (!container.dataset.imtBaseFontSize) {
        container.dataset.imtBaseFontSize = containerStyle.fontSize;
      }
      if (!target.dataset.imtBaseFontSize) {
        target.dataset.imtBaseFontSize = view.getComputedStyle(target).fontSize;
      }
      const baseSourceSize =
        Number.parseFloat(container.dataset.imtBaseFontSize) || 14;
      const baseTargetSize =
        Number.parseFloat(target.dataset.imtBaseFontSize) || baseSourceSize;
      const currentSourceSize =
        Number.parseFloat(containerStyle.fontSize) || baseSourceSize;
      const currentTargetSize =
        Number.parseFloat(view.getComputedStyle(target).fontSize) ||
        baseTargetSize;
      if (currentSourceSize >= baseSourceSize * 1.19) return;
      const contentHeight = Math.max(
        container.scrollHeight,
        targetRect.bottom - containerRect.top,
      );
      const blankY = availableHeight - contentHeight;
      if (blankY < 6) return;
      const scale = Math.min(
        1.15,
        (availableHeight - 3) / Math.max(1, contentHeight),
      );
      if (scale <= 1.03) return;
      const nextSourceSize = Math.min(
        baseSourceSize * 1.2,
        currentSourceSize * scale,
      );
      const nextTargetSize = Math.min(
        baseTargetSize * 1.2,
        currentTargetSize * scale,
      );
      setLayoutStyle(
        state,
        container,
        "font-size",
        `${Math.round(nextSourceSize * 10) / 10}px`,
      );
      setLayoutStyle(
        state,
        target,
        "font-size",
        `${Math.round(nextTargetSize * 10) / 10}px`,
      );
      setLayoutStyle(
        state,
        target,
        "line-height",
        "normal",
      );
      return;
    }

    const widthRatio =
      overflowX > 0 ? availableWidth / (availableWidth + overflowX) : 1;
    const heightRatio =
      overflowY > 0 ? availableHeight / (availableHeight + overflowY) : 1;
    const ratio = Math.max(0.7, Math.min(0.9, widthRatio, heightRatio));
    const containerStyle = view.getComputedStyle(container);
    const sourceFontSize = Number.parseFloat(containerStyle.fontSize) || 14;
    const targetFontSize =
      Number.parseFloat(view.getComputedStyle(target).fontSize) || sourceFontSize;
    const minimumFontSize = interactiveTarget ? 7 : 8;
    const nextSourceFontSize = Math.max(
      minimumFontSize,
      sourceFontSize * ratio,
    );
    const nextTargetFontSize = Math.max(
      minimumFontSize,
      targetFontSize * ratio,
    );
    if (
      Math.abs(nextSourceFontSize - sourceFontSize) < 0.15 &&
      Math.abs(nextTargetFontSize - targetFontSize) < 0.15
    ) {
      return;
    }
    const sourceLineHeight = Math.max(nextSourceFontSize * 1.15, 10);
    const targetLineHeight = Math.max(nextTargetFontSize * 1.15, 10);
    setLayoutStyle(
      state,
      container,
      "font-size",
      `${Math.round(nextSourceFontSize * 10) / 10}px`,
    );
    setLayoutStyle(
      state,
      container,
      "line-height",
      `${Math.round(sourceLineHeight * 10) / 10}px`,
    );
    setLayoutStyle(
      state,
      target,
      "font-size",
      `${Math.round(nextTargetFontSize * 10) / 10}px`,
    );
    setLayoutStyle(
      state,
      target,
      "line-height",
      `${Math.round(targetLineHeight * 10) / 10}px`,
    );
    for (const element of container.querySelectorAll<HTMLElement>("*")) {
      if (element === target || element.closest('[data-imt="target"]')) continue;
      setLayoutStyle(
        state,
        element,
        "font-size",
        `${Math.round(nextSourceFontSize * 10) / 10}px`,
      );
      setLayoutStyle(
        state,
        element,
        "line-height",
        `${Math.round(sourceLineHeight * 10) / 10}px`,
      );
    }
  }
}

function createTarget(paragraph: Paragraph, dataImt: string): HTMLElement {
  const target = paragraph.container.ownerDocument.createElement("font");
  target.classList.add("imt-target");
  target.dataset.imt = dataImt;
  return target;
}

function cssValue(
  value: string | number | undefined,
  numberUnit = "",
): string | undefined {
  if (value === undefined || value === "") return undefined;
  return typeof value === "number" ? `${value}${numberUnit}` : value;
}

export function segmentRenderedText(target: HTMLElement): void {
  segmentReadableTranslation(
    target,
    target.parentElement instanceof HTMLElement
      ? target.parentElement
      : target,
  );
}

function segmentReadableTranslation(
  target: HTMLElement,
  container: HTMLElement,
): void {
  if (target.dataset.imtPaired === "true") {
    return;
  }
  const fullText = (target.textContent ?? "").replace(/\s+/g, " ").trim();
  if (
    target.dataset.imtHeadingFrame === "true" &&
    fullText.length <= 80
  ) {
    return;
  }
  const sentenceEnd = /[\u3002\uFF01\uFF1F!?\uFF1B;.]/u;
  const sentenceCloser = /["'\u2019\u201D)\]]/u;
  const style = getComputedStyle(target);
  const width = Math.max(
    120,
    target.getBoundingClientRect().width ||
      container.getBoundingClientRect().width ||
      640,
  );
  const fontSize = Number.parseFloat(style.fontSize) || 16;
  const signature = `${Math.round(width)}:${fontSize.toFixed(1)}:${fullText.length}`;
  if (
    target.dataset.imtSegmented === "true" &&
    target.dataset.imtSegmentSignature === signature
  ) {
    return;
  }
  const measure = (value: string): number => {
    let measured = 0;
    for (const character of value) {
      if (/\s/u.test(character)) {
        measured += fontSize * 0.33;
      } else if (
        /[\u2E80-\u9FFF\uF900-\uFAFF\uFF00-\uFFEF]/u.test(character)
      ) {
        measured += fontSize;
      } else {
        measured += fontSize * 0.55;
      }
    }
    return measured;
  };
  const wrapLines = (value: string): string[] => {
    const lines: string[] = [];
    let remaining = value.trim();
    while (remaining) {
      let low = 1;
      let high = remaining.length;
      let best = 1;
      while (low <= high) {
        const middle = Math.floor((low + high) / 2);
        if (measure(remaining.slice(0, middle)) <= width) {
          best = middle;
          low = middle + 1;
        } else {
          high = middle - 1;
        }
      }
      let end = Math.min(best, remaining.length);
      if (end < remaining.length) {
        let boundary = -1;
        for (const separator of [" ", ",", "\uFF0C", "\u3002", "\uFF1B", ";"]) {
          boundary = Math.max(boundary, remaining.lastIndexOf(separator, end));
        }
        if (boundary >= Math.floor(end * 0.55)) end = boundary + 1;
      }
      lines.push(remaining.slice(0, end).trim());
      remaining = remaining.slice(end).trim();
    }
    return lines;
  };
  if (wrapLines(fullText).length < 2) return;
  if (target.dataset.imtSegmented === "true") {
    for (const segment of Array.from(
      target.querySelectorAll(":scope > .imt-target-segment"),
    )) {
      segment.replaceWith(...Array.from(segment.childNodes));
    }
  }

  const splitSentences = (value: string): string[] => {
    const sentences: string[] = [];
    let start = 0;
    for (let index = 0; index < value.length; index += 1) {
      if (!sentenceEnd.test(value[index] ?? "")) continue;
      let end = index + 1;
      while (end < value.length && sentenceCloser.test(value[end] ?? "")) {
        end += 1;
      }
      const sentence = value.slice(start, end).trim();
      if (sentence) sentences.push(sentence);
      start = end;
      index = end - 1;
    }
    const remainder = value.slice(start).trim();
    if (remainder) sentences.push(remainder);
    return sentences.length ? sentences : [value.trim()].filter(Boolean);
  };
  const splitClauses = (value: string): string[] => {
    const clauses: string[] = [];
    let start = 0;
    for (let index = 0; index < value.length; index += 1) {
      if (!/[,;\uFF0C\uFF1B]/u.test(value[index] ?? "")) continue;
      const clause = value.slice(start, index + 1).trim();
      if (clause) clauses.push(clause);
      start = index + 1;
    }
    const remainder = value.slice(start).trim();
    if (remainder) clauses.push(remainder);
    return clauses;
  };

  const parts: Array<{
    fragment: DocumentFragment;
    lineCount: number;
  }> = [];
  const appendTextParts = (value: string): void => {
    for (const sentence of splitSentences(value)) {
      const sentenceLines = wrapLines(sentence);
      const lineCount = sentenceLines.length;
      let readableParts =
        lineCount >= 2 ? splitClauses(sentence) : [sentence];
      if (readableParts.length === 1 && lineCount >= 2) {
        readableParts = [];
        for (let index = 0; index < sentenceLines.length; index += 2) {
          readableParts.push(
            sentenceLines.slice(index, index + 2).join(" "),
          );
        }
      }
      for (const part of readableParts.length ? readableParts : [sentence]) {
        const fragment = target.ownerDocument.createDocumentFragment();
        fragment.append(part);
        parts.push({
          fragment,
          lineCount: Math.max(1, wrapLines(part).length),
        });
      }
    }
  };

  for (const child of Array.from(target.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) {
      appendTextParts(child.nodeValue ?? "");
      continue;
    }
    if (child.nodeType !== Node.ELEMENT_NODE) continue;
    const value = (child.textContent ?? "").replace(/\s+/g, " ").trim();
    if (!value) continue;
    const fragment = target.ownerDocument.createDocumentFragment();
    fragment.append(child);
    parts.push({
      fragment,
      lineCount: Math.max(1, wrapLines(value).length),
    });
  }
  if (parts.length < 2) return;

  const groups: DocumentFragment[] = [];
  let current = target.ownerDocument.createDocumentFragment();
  let currentLines = 0;
  const flush = (): void => {
    if (current.childNodes.length) groups.push(current);
    current = target.ownerDocument.createDocumentFragment();
    currentLines = 0;
  };

  for (const part of parts) {
    if (part.lineCount > 3) {
      flush();
      const group = target.ownerDocument.createDocumentFragment();
      group.append(part.fragment);
      groups.push(group);
      continue;
    }
    if (currentLines > 0 && currentLines + part.lineCount > 3) flush();
    current.append(part.fragment);
    currentLines += part.lineCount;
    if (currentLines >= 2) flush();
  }
  flush();
  if (groups.length < 2) {
    target.dataset.imtSegmented = "false";
    delete target.dataset.imtSegmentSignature;
    return;
  }

  const fragment = target.ownerDocument.createDocumentFragment();
  groups.forEach((group, index) => {
    const segment = target.ownerDocument.createElement("span");
    segment.className = "imt-target-segment";
    segment.style.setProperty("display", "block", "important");
    segment.style.setProperty("overflow-wrap", "anywhere", "important");
    if (index > 0) {
      segment.style.setProperty("margin-top", "0.18em", "important");
    }
    segment.append(group);
    fragment.append(segment);
  });
  target.replaceChildren(fragment);
  target.dataset.imtSegmented = "true";
  target.dataset.imtSegmentSignature = signature;
}

function canBuildReadablePairs(
  paragraph: Paragraph,
  translated: string,
): boolean {
  const container = paragraph.container;
  if (
    isInteractiveElement(container) ||
    Boolean(container.querySelector(INTERACTIVE_SELECTOR)) ||
    /^(H[1-6]|TITLE|A|BUTTON|OPTION|LABEL|NAV)$/.test(container.tagName) ||
    container.closest("nav, [role='navigation']")
  ) {
    return false;
  }
  const source = (stateForTargetText(container as HTMLElement) ?? "")
    .replace(/\s+/g, " ")
    .trim();
  const target = translated.replace(/\s+/g, " ").trim();
  return source.length >= 40 && target.length >= 12;
}

export function groupEnglishByReadableLines(
  text: string,
  container: Element,
): string[] {
  const view = container.ownerDocument.defaultView;
  const style = view?.getComputedStyle(container);
  const fontSize = Number.parseFloat(style?.fontSize ?? "") || 16;
  const width = Math.max(
    160,
    (container.getBoundingClientRect().width || 640) * 0.8,
  );
  const font =
    style?.font ||
    `${fontSize}px ${style?.fontFamily ?? "sans-serif"}`;
  const canvas = container.ownerDocument.createElement("canvas");
  let context: CanvasRenderingContext2D | null = null;
  let contextCanMeasure = false;
  try {
    context = canvas.getContext("2d");
    contextCanMeasure = Number.isFinite(context?.measureText("x").width);
  } catch {
    context = null;
  }
  if (context && contextCanMeasure) context.font = font;
  const measure = (value: string): number =>
    context && contextCanMeasure
      ? context.measureText(value).width
      : value.length * Math.max(7, fontSize * 0.55);

  const wrapLines = (value: string): string[] => {
    const lines: string[] = [];
    let remaining = value.trim();
    while (remaining) {
      let low = 1;
      let high = remaining.length;
      let best = 1;
      while (low <= high) {
        const middle = Math.floor((low + high) / 2);
        if (measure(remaining.slice(0, middle)) <= width) {
          best = middle;
          low = middle + 1;
        } else {
          high = middle - 1;
        }
      }
      let end = Math.min(best, remaining.length);
      if (end < remaining.length) {
        const boundary = Math.max(
          remaining.lastIndexOf(" ", end),
          remaining.lastIndexOf("，", end),
          remaining.lastIndexOf("。", end),
          remaining.lastIndexOf("；", end),
        );
        if (boundary >= Math.floor(end * 0.55)) end = boundary + 1;
      }
      lines.push(remaining.slice(0, end).trim());
      remaining = remaining.slice(end).trim();
    }
    return lines;
  };

  const sentences =
    text.match(
      /[^.!?。！？]+(?:[.!?。！？]+["'”’)\]]*|$)/gu,
    ) ?? [text];
  const groups: string[] = [];
  let currentSentences: string[] = [];
  let currentLineCount = 0;

  const flush = (): void => {
    const lines = currentSentences.flatMap((sentence) =>
      wrapLines(sentence),
    );
    if (lines.length) groups.push(lines.join("\n"));
    currentSentences = [];
    currentLineCount = 0;
  };

  for (const sentence of sentences) {
    const normalized = sentence.trim();
    if (!normalized) continue;
    const sentenceLines = wrapLines(normalized);

    if (sentenceLines.length > 3) {
      flush();
      const chunks: string[][] = [];
      for (let index = 0; index < sentenceLines.length; index += 3) {
        chunks.push(sentenceLines.slice(index, index + 3));
      }
      const last = chunks.at(-1);
      const previous = chunks.at(-2);
      if (last?.length === 1 && previous && previous.length > 1) {
        last.unshift(previous.pop()!);
      }
      groups.push(...chunks.map((lines) => lines.join("\n")));
      continue;
    }

    if (currentLineCount > 0 && currentLineCount + sentenceLines.length > 3) {
      flush();
    }
    currentSentences.push(normalized);
    currentLineCount += sentenceLines.length;
    if (currentLineCount >= 2) flush();
  }
  flush();
  return groups;
}

export function splitTextIntoGroups(text: string, count: number): string[] {
  if (count <= 1) return [text];
  const groups: string[] = [];
  let start = 0;
  for (let index = 1; index <= count; index += 1) {
    if (index === count) {
      groups.push(text.slice(start).trim());
      break;
    }
    const expected = Math.floor((text.length * index) / count);
    const lower = Math.max(start + 1, expected - 12);
    const upper = Math.min(text.length - 1, expected + 12);
    const punctuation = ["。", "！", "？", "；", ".", "!", "?", ";"];
    let boundary = expected;
    for (let cursor = upper; cursor >= lower; cursor -= 1) {
      if (punctuation.includes(text[cursor] ?? "")) {
        boundary = cursor + 1;
        break;
      }
    }
    while (
      boundary > lower &&
      /[A-Za-z0-9]/u.test(text[boundary - 1] ?? "") &&
      /[A-Za-z0-9]/u.test(text[boundary] ?? "")
    ) {
      boundary -= 1;
    }
    if (boundary <= start) {
      const nextWhitespace = text.slice(upper).search(/\s/u);
      boundary =
        nextWhitespace >= 0
          ? upper + nextWhitespace + 1
          : Math.min(text.length, upper);
    }
    groups.push(text.slice(start, boundary).trim());
    start = boundary;
  }
  return groups;
}

function splitSentenceText(value: string): string[] {
  const decimalMarker = "\uE100";
  const protectedValue = value.replace(
    /(\d)\.(?=\d)/gu,
    `$1${decimalMarker}`,
  );
  const sentences =
    protectedValue.match(
      /[^.!?。！？；;\n]+(?:[.!?。！？；;\n]+["'\u2019\u201D)\]]*|$)/gu,
    ) ?? [protectedValue];
  return sentences
    .map((sentence) => sentence.split(decimalMarker).join(".").trim())
    .filter(Boolean);
}

function estimateReadableLines(text: string, container: Element): number {
  const style = getComputedStyle(container);
  const fontSize = Number.parseFloat(style.fontSize) || 16;
  const width = Math.max(
    160,
    (container.getBoundingClientRect().width || 640) * 0.8,
  );
  let estimatedWidth = 0;
  for (const character of text) {
    if (/\s/u.test(character)) {
      estimatedWidth += fontSize * 0.33;
    } else if (
      /[\u2E80-\u9FFF\uF900-\uFAFF\uFF00-\uFFEF]/u.test(character)
    ) {
      estimatedWidth += fontSize;
    } else {
      estimatedWidth += fontSize * 0.55;
    }
  }
  return Math.max(1, Math.ceil(estimatedWidth / width));
}

export function buildReadablePairs(
  paragraph: Paragraph,
  translated: string,
  target: HTMLElement,
  translatedSegments?: string[],
): boolean {
  if (!canBuildReadablePairs(paragraph, translated)) return false;
  const source = (stateForTargetText(paragraph.container as HTMLElement) ?? "")
    .replace(/\s+/g, " ")
    .trim();
  const normalizedTranslation = translated.replace(/\s+/g, " ").trim();
  const sourceSentences = splitSentenceText(source);
  const providedTargetSentences =
    translatedSegments?.map((segment) => segment.trim()).filter(Boolean) ?? [];
  const targetSentences =
    providedTargetSentences.length > 1
      ? providedTargetSentences
      : splitSentenceText(normalizedTranslation);
  if (!sourceSentences.length || !targetSentences.length) return false;

  const sentencePairs =
    targetSentences.length < sourceSentences.length
      ? targetSentences.map((targetSentence, index, targets) => {
          const chunkSize = Math.ceil(
            sourceSentences.length / targets.length,
          );
          return {
            source: sourceSentences
              .slice(index * chunkSize, (index + 1) * chunkSize)
              .join(" "),
            target: targetSentence,
          };
        })
      : sourceSentences.map((sourceSentence, index) => {
          const start = Math.floor(
            (index * targetSentences.length) / sourceSentences.length,
          );
          const end = Math.max(
            start + 1,
            Math.floor(
              ((index + 1) * targetSentences.length) /
                sourceSentences.length,
            ),
          );
          return {
            source: sourceSentence,
            target: targetSentences.slice(start, end).join(" "),
          };
        });
  const sourceGroups: string[] = [];
  const targetGroups: string[] = [];
  let sourceGroup = "";
  let targetGroup = "";
  let sourceLines = 0;
  let targetLines = 0;
  const flush = (): void => {
    if (!sourceGroup && !targetGroup) return;
    sourceGroups.push(sourceGroup.trim());
    targetGroups.push(targetGroup.trim());
    sourceGroup = "";
    targetGroup = "";
    sourceLines = 0;
    targetLines = 0;
  };
  for (const pair of sentencePairs) {
    const nextSourceLines = estimateReadableLines(
      pair.source,
      paragraph.container,
    );
    const nextTargetLines = estimateReadableLines(
      pair.target,
      paragraph.container,
    );
    if (
      (sourceLines > 0 || targetLines > 0) &&
      (sourceLines + nextSourceLines > 3 ||
        targetLines + nextTargetLines > 3)
    ) {
      flush();
    }
    sourceGroup += `${sourceGroup ? " " : ""}${pair.source}`;
    targetGroup += `${targetGroup ? " " : ""}${pair.target}`;
    sourceLines += nextSourceLines;
    targetLines += nextTargetLines;
    if (sourceLines >= 2 || targetLines >= 2) flush();
  }
  flush();
  const groupCount = sourceGroups.length;
  if (groupCount < 2) return false;
  const sourceColor = getComputedStyle(paragraph.container).color;

  target.replaceChildren();
  target.classList.add("imt-pair-layout");
  target.dataset.imtPaired = "true";
  for (let index = 0; index < groupCount; index += 1) {
    const pair = paragraph.container.ownerDocument.createElement("span");
    pair.className = "imt-target-pair";
    const sourceBlock = paragraph.container.ownerDocument.createElement("span");
    sourceBlock.className = "imt-pair-source-block";
    sourceBlock.textContent = sourceGroups[index] ?? "";
    sourceBlock.style.setProperty("display", "block", "important");
    sourceBlock.style.setProperty("color", sourceColor, "important");
    const targetBlock = paragraph.container.ownerDocument.createElement("span");
    targetBlock.className = "imt-pair-target-block";
    targetBlock.textContent = targetGroups[index] ?? "";
    targetBlock.style.setProperty("display", "block", "important");
    pair.append(sourceBlock, targetBlock);
    target.append(pair);
  }
  return true;
}

/** Apply user-controlled target typography through extension CSS variables. */
export function applyTargetStyle(
  target: HTMLElement,
  options: TargetStyleOptions = {},
): void {
  const values: Array<[string, string | undefined]> = [
    ["--imt-target-font", cssValue(options.font)],
    ["--imt-target-font-size", cssValue(options.fontSize, "px")],
    ["--imt-target-color", cssValue(options.color)],
    ["--imt-target-line-height", cssValue(options.lineHeight)],
  ];
  for (const [property, value] of values) {
    if (value !== undefined) target.style.setProperty(property, value);
  }
}

/** Insert a translated fragment at the end of its paragraph container. */
export function renderTranslation(
  paragraph: Paragraph,
  fragment: DocumentFragment,
  options: RenderTranslationOptions,
): HTMLElement {
  const state = newState(paragraph);
  const target = paragraph.container.ownerDocument.createElement(
    options.wrapperTag,
  );
  state.target = target;
  target.classList.add("imt-target", `imt-theme-${options.theme}`);
  if (options.mode === "translation") {
    target.classList.add("imt-target-replace");
  }
  if (options.preformatted) target.classList.add("imt-preformatted");
  target.dataset.imt = "target";
  if (options.academicTerms?.length) {
    target.dataset.imtAcademicTerms = JSON.stringify(options.academicTerms);
  }
  target.append(fragment);
  applyTargetStyle(target, options.style);
  if (options.mode === "translation") {
    ensureSourceMarkers(state);
  }
  selectInteractiveTarget(state);
  appendTarget(paragraph, target, options.prefix, state);
  if (
    options.mode === "dual" &&
    options.readingMode !== "research" &&
    buildReadablePairs(
      paragraph,
      target.textContent ?? "",
      target,
      options.translatedSegments,
    )
  ) {
    state.paired = true;
  }
  if (options.readingMode) {
    applyReadingMode(state, options.readingMode);
  } else {
    state.readingMode =
      options.mode === "translation" ? "quick" : "professional";
    applyMode(state, options.mode);
  }
  if (!state.paired) {
    segmentReadableTranslation(target, paragraph.container as HTMLElement);
  }
  if (options.mode === "dual") {
    settleRenderedTarget(state, target);
    scheduleRenderedLayoutRefresh();
  }
  if (options.automaticColor) {
    applyAutomaticTargetColor(target, paragraph.container);
  }
  return target;
}

/** Replace the current result with a loading indicator. */
export function setLoading(paragraph: Paragraph): void {
  const state = newState(paragraph);
  const target = createTarget(paragraph, "loading");
  target.classList.add("imt-loading");
  target.setAttribute("aria-label", "Translating");
  appendTarget(paragraph, target, "smart", state);
}

/** Replace the current result with an error message and retry button. */
export function setError(
  paragraph: Paragraph,
  message: string,
  retry: () => void,
): void {
  const state = newState(paragraph);
  const target = createTarget(paragraph, "error");
  target.classList.add("imt-error");
  target.append(`${message} `);

  const retryButton = paragraph.container.ownerDocument.createElement("button");
  retryButton.type = "button";
  retryButton.className = "imt-retry";
  retryButton.dataset.imt = "retry";
  retryButton.title = "Retry";
  retryButton.setAttribute("aria-label", "Retry translation");
  retryButton.textContent = "↻";
  retryButton.addEventListener("click", retry);
  target.append(retryButton);
  appendTarget(paragraph, target, "smart", state);
}

/** Remove the rendered state for one paragraph and restore its source DOM. */
export function removeTranslation(paragraph: Paragraph): void {
  const state = statesByContainer.get(paragraph.container);
  if (state) {
    clearState(state);
  } else {
    paragraph.container.removeAttribute("data-imt-id");
  }
}

function queryElements(
  root: Document | ShadowRoot | Element,
  selector: string,
): Element[] {
  const matches =
    root instanceof Element && root.matches(selector) ? [root] : [];
  return [...matches, ...root.querySelectorAll(selector)];
}

function removeInjectedStyles(root: Document | ShadowRoot): void {
  const styleState = styleStates.get(root);
  if (!styleState) {
    return;
  }
  if (styleState.kind === "sheet") {
    root.adoptedStyleSheets = root.adoptedStyleSheets.filter(
      (sheet) => sheet !== styleState.sheet,
    );
  } else {
    styleState.element.remove();
  }
  styleStates.delete(root);
}

/** Remove every rendered translation below a root and restore source nodes. */
export function removeAll(root: Document | ShadowRoot | Element): void {
  for (const state of [...states]) {
    if (belongsToRoot(root, state.paragraph.container)) {
      clearState(state);
    }
  }

  for (const wrapper of queryElements(root, '[data-imt="source"]')) {
    wrapper.replaceWith(...wrapper.childNodes);
  }
  for (const element of queryElements(
    root,
    '[data-imt="target"], [data-imt="loading"], [data-imt="error"], [data-imt="reading-toggle"], [data-imt="br"]',
  )) {
    element.remove();
  }
  for (const element of queryElements(root, "[data-imt-id]")) {
    element.removeAttribute("data-imt-id");
  }

  if (root instanceof Document || root instanceof ShadowRoot) {
    removeInjectedStyles(root);
  }
}

/** Switch rendered paragraphs below a root between dual and translation-only mode. */
export function setMode(
  root: Document | ShadowRoot | Element,
  mode: TranslationMode,
): void {
  for (const state of states) {
    if (belongsToRoot(root, state.paragraph.container)) {
      applyReadingMode(
        state,
        mode === "translation" ? "quick" : "professional",
      );
    }
  }
}

/** Switch rendered paragraphs between the three reading experiences. */
export function setReadingMode(
  root: Document | ShadowRoot | Element,
  mode: ReadingMode,
): void {
  for (const state of states) {
    if (belongsToRoot(root, state.paragraph.container)) {
      applyReadingMode(state, mode);
    }
  }
}

/** Toggle learning-mode blur without changing the selected translation theme. */
export function setMask(root: Document | ShadowRoot | Element, enabled: boolean): void {
  const element =
    root instanceof Document
      ? root.documentElement
      : root instanceof ShadowRoot
        ? root.host
        : root;
  element.classList.toggle("imt-translation-mask", enabled);
}

/** Store the paragraph id on its source container. */
export function markTranslated(container: Element, id: string): void {
  container.setAttribute("data-imt-id", id);
}

/** Report whether a source container has a translation marker. */
export function isTranslated(container: Element): boolean {
  return container.hasAttribute("data-imt-id");
}

/** Inject base themes and optional site CSS into a document or shadow root. */
export function injectStyles(
  root: Document | ShadowRoot,
  extraCss: readonly string[] = [],
): void {
  const css = [themeCss, ...extraCss].join("\n");
  const current = styleStates.get(root);
  if (current?.kind === "sheet") {
    current.sheet.replaceSync(css);
    return;
  }
  if (current?.kind === "element") {
    current.element.textContent = css;
    return;
  }

  const view =
    root instanceof Document
      ? root.defaultView
      : root.ownerDocument.defaultView;
  const StyleSheet = view?.CSSStyleSheet;
  const canAdopt =
    "adoptedStyleSheets" in root &&
    typeof StyleSheet === "function" &&
    typeof StyleSheet.prototype.replaceSync === "function";

  if (canAdopt && StyleSheet) {
    const sheet = new StyleSheet();
    sheet.replaceSync(css);
    root.adoptedStyleSheets = [...root.adoptedStyleSheets, sheet];
    styleStates.set(root, { kind: "sheet", sheet });
    return;
  }

  const document = root instanceof Document ? root : root.ownerDocument;
  const style = document.createElement("style");
  style.dataset.imt = "style";
  style.textContent = css;
  if (root instanceof Document) {
    (root.head ?? root.documentElement).append(style);
  } else {
    root.append(style);
  }
  styleStates.set(root, { kind: "element", element: style });
}

/** Phase-0 adapter for callers that still pass plain text and a rule. */
export function injectTranslation(
  paragraph: Paragraph,
  translatedText: string,
  rule: Rule,
): HTMLElement {
  const fragment = paragraph.container.ownerDocument.createDocumentFragment();
  fragment.append(translatedText);
  const prefix =
    rule.wrapperPrefix === "block" || rule.wrapperPrefix === "inline"
      ? rule.wrapperPrefix
      : "smart";

  return renderTranslation(paragraph, fragment, {
    mode: rule.translationMode ?? "dual",
    theme: rule.theme ?? "none",
    wrapperTag: "font",
    prefix,
  });
}
