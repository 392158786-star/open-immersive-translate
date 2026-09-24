import type { AcademicTermKnowledge } from "../../shared/types";

const HOVER_DELAY_MS = 500;
const CARD_MARGIN = 10;

export interface HoverContextRequest {
  word: string;
  sentence: string;
  previousSentence: string;
  nextSentence: string;
  paragraphTheme: string;
  title: string;
  domain: string;
  clientX: number;
  clientY: number;
}

export type BookmarkState = "collected" | "uncollected";

export interface DirectHoverOptions {
  delayMs?: number;
  getBookmarkState?(
    request: HoverContextRequest,
    knowledge: AcademicTermKnowledge,
  ): BookmarkState | Promise<BookmarkState>;
  onBookmarkWord?(
    request: HoverContextRequest,
    knowledge: AcademicTermKnowledge,
  ): void | Promise<BookmarkState>;
  onOpenSource?(knowledge: AcademicTermKnowledge): void;
}

type KnowledgeResolver = (
  request: HoverContextRequest,
) => Promise<AcademicTermKnowledge | undefined>;

interface WordAtPoint {
  node: Text;
  start: number;
  end: number;
  word: string;
}

function isExcluded(target: Element): boolean {
  if (target.closest('[data-imt="target"]')) return true;
  return (
    target.closest(
      "a, button, input, textarea, select, option, pre, code, kbd, samp, [contenteditable='true'], [role='textbox'], [data-imt]:not([data-imt='source'])",
    ) !== null
  );
}

function isCjk(value: string): boolean {
  return /[\u3400-\u9fff\uf900-\ufaff]/u.test(value);
}

function isAsciiWordCharacter(value: string): boolean {
  return /[A-Za-z0-9'-]/u.test(value);
}

function findWordAtPoint(
  doc: Document,
  clientX: number,
  clientY: number,
): WordAtPoint | undefined {
  let node: Node | null;
  let offset: number;
  const caret = doc.caretPositionFromPoint?.(clientX, clientY);
  if (caret) {
    node = caret.offsetNode;
    offset = caret.offset;
  } else {
    const range = doc.caretRangeFromPoint?.(clientX, clientY);
    if (!range) return undefined;
    node = range.startContainer;
    offset = range.startOffset;
  }
  if (!(node instanceof Text) || !node.parentElement) return undefined;
  if (isExcluded(node.parentElement)) return undefined;

  const text = node.data;
  if (!text) return undefined;
  const nearOffset = Math.max(0, Math.min(text.length, offset));
  const after = text[nearOffset] ?? "";
  const before = text[nearOffset - 1] ?? "";
  const at = after || before;
  const predicate = isCjk(at) ? isCjk : isAsciiWordCharacter;
  const index = predicate(after)
    ? nearOffset
    : predicate(before)
      ? nearOffset - 1
      : -1;
  if (index < 0) return undefined;

  let start = index;
  let end = index + 1;
  while (start > 0 && predicate(text[start - 1] ?? "")) start -= 1;
  while (end < text.length && predicate(text[end] ?? "")) end += 1;
  const word = text.slice(start, end).replace(/^['-]+|['-]+$/gu, "");
  if (word.length < 2 || /^\d+$/u.test(word)) return undefined;
  return { node, start, end, word };
}

function sentenceAround(
  text: string,
  offset: number,
  length: number,
): { current: string; previous: string; next: string } {
  const boundary = /[\u3002\uff01\uff1f!?.;\u3002\uff1b;]/u;
  let start = Math.max(0, offset);
  while (start > 0 && !boundary.test(text[start - 1] ?? "")) start -= 1;
  let end = Math.min(text.length, offset + length);
  while (end < text.length && !boundary.test(text[end] ?? "")) end += 1;
  if (end < text.length) end += 1;
  const before = text.slice(0, start).trim();
  const after = text.slice(end).trim();
  const previousMatch = before.match(
    /([^.!?\u3002\uff01\uff1f\u3002\uff1b;]+[.!?\u3002\uff01\uff1f\u3002\uff1b;]?)\s*$/u,
  );
  const nextMatch = after.match(/^(.+?[.!?\u3002\uff01\uff1f\u3002\uff1b;])/u);
  return {
    current: text.slice(start, end).replace(/\s+/gu, " ").trim(),
    previous: previousMatch?.[1]?.replace(/\s+/gu, " ").trim() ?? "",
    next:
      nextMatch?.[1]?.replace(/\s+/gu, " ").trim() ??
      after.slice(0, 180).replace(/\s+/gu, " ").trim(),
  };
}

function sectionTitle(container: Element): string {
  let current: Element | null = container;
  while (current) {
    const heading = current.querySelector(
      "h1, h2, h3, h4, h5, h6, [role='heading']",
    );
    if (heading?.textContent?.trim()) return heading.textContent.trim();
    current = current.previousElementSibling;
  }
  return "";
}

function inferDomain(text: string): string {
  const value = text.toLowerCase();
  const domains: Array<[string, string[]]> = [
    ["Artificial intelligence", ["ai", "model", "neural", "learning", "language"]],
    ["Finance and trade", ["bank", "market", "payment", "trade", "finance"]],
    ["Computer science", ["software", "algorithm", "javascript", "database", "code"]],
    ["Life sciences", ["clinical", "medical", "health", "protein", "gene"]],
    ["Law and policy", ["law", "policy", "regulation", "court", "government"]],
  ];
  return (
    domains.find(([, keywords]) =>
      keywords.some((keyword) => value.includes(keyword)),
    )?.[0] ?? "General reading"
  );
}

export function buildHoverContext(
  doc: Document,
  point: WordAtPoint,
  clientX: number,
  clientY: number,
): HoverContextRequest {
  const parent = point.node.parentElement;
  const block =
    parent?.closest(
      "p, li, blockquote, td, th, dd, dt, h1, h2, h3, h4, h5, h6, article",
    ) ?? parent;
  const paragraphText = block?.textContent?.replace(/\s+/gu, " ").trim() ?? "";
  let offset = 0;
  if (block) {
    const range = doc.createRange();
    range.setStart(block, 0);
    range.setEnd(point.node, point.start);
    offset = range.toString().length;
  }
  const context = sentenceAround(paragraphText, offset, point.word.length);
  const heading =
    doc.querySelector("article h1, main h1, h1")?.textContent?.trim() ?? "";
  const title = heading || doc.title.trim();
  const domain = inferDomain(
    `${title} ${block?.textContent ?? ""} ${doc.location?.href ?? ""}`,
  );
  return {
    word: point.word,
    sentence: context.current || paragraphText.slice(0, 320),
    previousSentence: context.previous,
    nextSentence: context.next,
    paragraphTheme:
      sectionTitle(block ?? parent ?? doc.body) ||
      context.current.slice(0, 120),
    title,
    domain,
    clientX,
    clientY,
  };
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

const BOOKMARK_OUTLINE_ICON =
  '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M6 3h12a1 1 0 0 1 1 1v17l-7-4-7 4V4a1 1 0 0 1 1-1z" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>';
const BOOKMARK_FILLED_ICON =
  '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M6 3h12a1 1 0 0 1 1 1v17l-7-4-7 4V4a1 1 0 0 1 1-1z" fill="currentColor"/></svg>';

function setBookmarkButton(
  button: HTMLButtonElement,
  state: BookmarkState | "saving",
): void {
  if (state === "saving") {
    button.dataset.state = "saving";
    button.disabled = true;
    button.setAttribute("aria-label", "保存中");
    button.innerHTML = `${BOOKMARK_OUTLINE_ICON}<span>保存中…</span>`;
    return;
  }
  button.disabled = false;
  if (state === "collected") {
    button.dataset.state = "collected";
    button.setAttribute("aria-label", "已收藏");
    button.innerHTML = `${BOOKMARK_FILLED_ICON}<span>已收藏</span>`;
    return;
  }
  button.dataset.state = "uncollected";
  button.setAttribute("aria-label", "收藏词语");
  button.innerHTML = `${BOOKMARK_OUTLINE_ICON}<span>收藏词语</span>`;
}

function renderCard(
  host: HTMLElement,
  request: HoverContextRequest,
  knowledge: AcademicTermKnowledge,
  pending = false,
): void {
  const shadow = host.shadowRoot;
  if (!shadow) return;
  const source = knowledge.sources[0];
  shadow.innerHTML = `
    <style>
      :host { all: initial; position: fixed; z-index: 2147483647; color-scheme: light; }
      .card {
        width: min(360px, calc(100vw - 24px));
        box-sizing: border-box;
        border: 1px solid #d0d5dd;
        border-radius: 8px;
        background: #ffffff;
        color: #101828;
        box-shadow: 0 10px 30px rgb(15 23 42 / 24%);
        font: 13px/1.45 system-ui, sans-serif;
        padding: 10px 12px;
        cursor: pointer;
      }
      header { display: flex; align-items: baseline; gap: 8px; }
      strong { font-size: 15px; }
      .translation { color: #175cd3; font-weight: 600; }
      .domain { margin-top: 2px; color: #667085; font-size: 11px; }
      .definition { margin-top: 7px; }
      .details { display: none; margin-top: 8px; }
      .card[data-expanded="true"] .details { display: block; }
      .summary { color: #475467; }
      .source { margin-top: 6px; color: #475467; font-size: 12px; }
      .source a { color: #175cd3; }
      .actions { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 9px; }
      button {
        border: 1px solid #d0d5dd;
        border-radius: 5px;
        background: #ffffff;
        color: #344054;
        cursor: pointer;
        font: 12px/1.2 system-ui, sans-serif;
        padding: 5px 7px;
      }
      button:hover { border-color: #175cd3; color: #175cd3; }
      button[data-state] { display: inline-flex; align-items: center; gap: 4px; }
      button[disabled] { opacity: 0.6; cursor: default; }
      button[data-state="collected"] { color: #175cd3; border-color: #175cd3; }
    </style>
    <article class="card" data-expanded="false" role="dialog" aria-label="${escapeHtml(request.word)}">
      <header>
        <strong>${escapeHtml(knowledge.term || request.word)}</strong>
        <span class="translation">${escapeHtml(pending ? "解析中…" : knowledge.translation || request.word)}</span>
      </header>
      <div class="domain">${escapeHtml(knowledge.domain || request.domain)}</div>
      <div class="definition">${escapeHtml(pending ? "正在结合上下文查询释义…" : knowledge.definition || request.sentence)}</div>
      <div class="details">
        <div class="summary">${escapeHtml(knowledge.summary)}</div>
        ${
          source
            ? `<div class="source">Source: <a href="${escapeHtml(source.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(source.title)}</a></div>`
            : ""
        }
        <div class="actions">
          <button type="button" data-action="bookmark-word" data-state="uncollected" aria-label="收藏词语">${BOOKMARK_OUTLINE_ICON}<span>收藏词语</span></button>
          <button type="button" data-action="open-source">查看原文出处</button>
        </div>
      </div>
    </article>
  `;
}

function placeCard(host: HTMLElement, x: number, y: number): void {
  const rect = host.getBoundingClientRect();
  const left = Math.min(
    Math.max(CARD_MARGIN, x + 14),
    Math.max(CARD_MARGIN, window.innerWidth - rect.width - CARD_MARGIN),
  );
  const top = Math.min(
    Math.max(CARD_MARGIN, y + 18),
    Math.max(CARD_MARGIN, window.innerHeight - rect.height - CARD_MARGIN),
  );
  host.style.left = `${left}px`;
  host.style.top = `${top}px`;
}

/** Install word-level context hover translation without a modifier key. */
export function installDirectHoverTranslation(
  resolve: KnowledgeResolver,
  options: DirectHoverOptions = {},
): () => void {
  const delay = options.delayMs ?? HOVER_DELAY_MS;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let point: { x: number; y: number; key: string } | undefined;
  let host: HTMLElement | undefined;
  let sequence = 0;

  const closeCard = (): void => {
    sequence += 1;
    host?.remove();
    host = undefined;
  };

  const clearTimer = (): void => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    point = undefined;
  };

  const showCard = (
    request: HoverContextRequest,
    knowledge: AcademicTermKnowledge,
    pending = false,
  ): void => {
    host?.remove();
    host = document.createElement("div");
    host.dataset.imt = "context-card";
    const shadow = host.attachShadow({ mode: "open" });
    document.documentElement.append(host);
    renderCard(host, request, knowledge, pending);
    placeCard(host, request.clientX, request.clientY);
    const card = shadow.querySelector<HTMLElement>(".card");
    card?.addEventListener("click", (event) => {
      const target = event.target as HTMLElement | null;
      const actionElement =
        target?.closest<HTMLElement>("[data-action]") ?? null;
      const action = actionElement?.dataset.action;
      if (action === "bookmark-word") {
        const button = actionElement as HTMLButtonElement;
        if (button.disabled) return;
        setBookmarkButton(button, "saving");
        const result = options.onBookmarkWord?.(request, knowledge);
        if (result instanceof Promise) {
          void result
            .then((state) => {
              if (button.isConnected) setBookmarkButton(button, state);
            })
            .catch(() => {
              if (button.isConnected) setBookmarkButton(button, "uncollected");
            });
        } else if (result) {
          setBookmarkButton(button, result);
        }
        return;
      }
      if (action === "open-source") {
        options.onOpenSource?.(knowledge);
        return;
      }
      if (!card) return;
      const next = card.dataset.expanded !== "true";
      card.dataset.expanded = String(next);
      placeCard(host!, request.clientX, request.clientY);
    });

    if (options.getBookmarkState) {
      const bookmarkButton = shadow.querySelector<HTMLButtonElement>(
        'button[data-action="bookmark-word"]',
      );
      if (bookmarkButton) {
        void Promise.resolve(options.getBookmarkState(request, knowledge))
          .then((state) => {
            if (bookmarkButton.isConnected) {
              setBookmarkButton(bookmarkButton, state);
            }
          })
          .catch(() => undefined);
      }
    }
  };

  const onMouseMove = (event: MouseEvent): void => {
    if (event.composedPath().some((target) => target === host)) return;
    const target =
      document.elementFromPoint?.(event.clientX, event.clientY) ??
      (event.target instanceof Element ? event.target : null);
    if (!(target instanceof Element) || isExcluded(target)) {
      clearTimer();
      closeCard();
      return;
    }
    const found = findWordAtPoint(document, event.clientX, event.clientY);
    if (!found) {
      clearTimer();
      closeCard();
      return;
    }
    const key = `${found.word}:${event.clientX}:${event.clientY}`;
    if (point?.key === key) return;
    clearTimer();
    closeCard();
    point = { x: event.clientX, y: event.clientY, key };
    const localPoint = point;
    timer = setTimeout(() => {
      timer = undefined;
      point = undefined;
      const word = findWordAtPoint(document, localPoint.x, localPoint.y);
      if (!word || word.word !== found.word) return;
      const request = buildHoverContext(
        document,
        word,
        localPoint.x,
        localPoint.y,
      );
      const requestSequence = ++sequence;
      showCard(
        request,
        {
          id: "",
          term: word.word,
          translation: "",
          definition: "",
          domain: request.domain,
          aliases: [],
          summary: "",
          confidence: 0,
          sources: [],
          contexts: [request.sentence],
          updatedAt: Date.now(),
        },
        true,
      );
      void resolve(request)
        .then((knowledge) => {
          if (requestSequence !== sequence || !knowledge) return;
          showCard(request, knowledge, false);
        })
        .catch(() => undefined);
    }, delay);
  };

  const onPointerDown = (event: PointerEvent): void => {
    if (!event.composedPath().some((target) => target === host)) closeCard();
  };
  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === "Escape") closeCard();
  };
  const onScroll = (): void => closeCard();

  document.addEventListener("mousemove", onMouseMove, true);
  document.addEventListener("pointerdown", onPointerDown, true);
  document.addEventListener("keydown", onKeyDown, true);
  document.addEventListener("scroll", onScroll, true);

  return () => {
    clearTimer();
    closeCard();
    document.removeEventListener("mousemove", onMouseMove, true);
    document.removeEventListener("pointerdown", onPointerDown, true);
    document.removeEventListener("keydown", onKeyDown, true);
    document.removeEventListener("scroll", onScroll, true);
  };
}
