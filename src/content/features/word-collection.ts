import browser from "webextension-polyfill";

import type { SavedWord } from "../../shared/learning-types";
import { normalizeWord } from "../../shared/learning-identity";
import { sendToBackground } from "../../shared/messages";
import { onUrlChange } from "../observe/url-change";

const MIN_SUPPORTED_WIDTH = 900;

/** Data and IO surface the drawer depends on. */
export interface WordCollectionAdapter {
  currentHostname(): Promise<string>;
  listWords(hostname: string): Promise<SavedWord[]>;
  removeWords(wordIds: string[]): Promise<void>;
  onChanged(listener: () => void): () => void;
  onUrlChange(listener: (url: string) => void): () => void;
  isSupported(): boolean;
}

interface WordGroup {
  key: string;
  word: string;
  words: SavedWord[];
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

const TEMPLATE = `
  <style>
    :host { all: initial; color-scheme: light; }
    .handle {
      position: fixed;
      right: 0;
      top: 50%;
      transform: translateY(-50%);
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 2px;
      width: 32px;
      padding: 8px 0;
      border: 1px solid #d0d5dd;
      border-right: 0;
      border-radius: 8px 0 0 8px;
      background: #ffffff;
      color: #175cd3;
      box-shadow: -2px 0 10px rgb(15 23 42 / 14%);
      cursor: pointer;
      font: 12px/1 system-ui, sans-serif;
      z-index: 2147483646;
    }
    .handle[hidden] { display: none; }
    .handle-chevrons { font-size: 14px; line-height: 1; }
    .handle-count { font-weight: 700; }
    .drawer {
      position: fixed;
      top: 0;
      right: 0;
      width: 340px;
      max-width: calc(100vw - 8px);
      max-height: 70vh;
      display: flex;
      flex-direction: column;
      border: 1px solid #d0d5dd;
      border-right: 0;
      border-radius: 8px 0 0 8px;
      background: #ffffff;
      color: #101828;
      box-shadow: -6px 0 24px rgb(15 23 42 / 22%);
      font: 13px/1.45 system-ui, sans-serif;
      z-index: 2147483646;
    }
    .drawer[hidden] { display: none; }
    .drawer-head {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px 12px;
      border-bottom: 1px solid #eaecf0;
    }
    .drawer-title { margin: 0; font-size: 15px; font-weight: 700; }
    .drawer-total {
      margin-left: auto;
      min-width: 20px;
      padding: 1px 7px;
      border-radius: 999px;
      background: #eff4ff;
      color: #175cd3;
      font-weight: 700;
      text-align: center;
    }
    .drawer-close {
      border: 0;
      background: transparent;
      color: #667085;
      cursor: pointer;
      font-size: 18px;
      line-height: 1;
      padding: 0 2px;
    }
    .drawer-body { overflow-y: auto; flex: 1; padding: 8px; }
    .word-card {
      border: 1px solid #eaecf0;
      border-radius: 8px;
      padding: 8px 10px;
      margin-bottom: 8px;
      cursor: pointer;
    }
    .word-card:hover { border-color: #175cd3; }
    .word-head { display: flex; align-items: baseline; gap: 8px; }
    .word-head strong { font-size: 14px; }
    .word-pos { color: #667085; font-size: 11px; }
    .word-translation { color: #175cd3; font-weight: 600; }
    .word-definition { color: #475467; margin-top: 2px; }
    .word-remove {
      margin-top: 6px;
      border: 1px solid #d0d5dd;
      border-radius: 5px;
      background: #ffffff;
      color: #b42318;
      cursor: pointer;
      font: 12px/1.2 system-ui, sans-serif;
      padding: 4px 8px;
    }
    .drawer-empty { color: #667085; padding: 24px 8px; text-align: center; }
    .knowledge-back {
      border: 0;
      background: transparent;
      color: #175cd3;
      cursor: pointer;
      font: 12px/1.2 system-ui, sans-serif;
      padding: 0 0 8px;
    }
    .knowledge-head { display: flex; align-items: baseline; gap: 8px; }
    .knowledge-head strong { font-size: 16px; }
    .knowledge-translation { color: #175cd3; font-weight: 600; margin-top: 4px; }
    .knowledge-definition { color: #344054; margin-top: 6px; }
    .knowledge-source { color: #175cd3; font-size: 12px; }
    @media print { :host { display: none !important; } }
  </style>
  <button class="handle" type="button" data-action="toggle" aria-label="本站收藏">
    <span class="handle-chevrons">&gt;&gt;</span>
    <span class="handle-count">0</span>
  </button>
  <aside class="drawer" hidden>
    <header class="drawer-head">
      <h2 class="drawer-title">本站收藏</h2>
      <span class="drawer-total">0</span>
      <button class="drawer-close" type="button" data-action="close" aria-label="关闭">×</button>
    </header>
    <div class="drawer-body">
      <div class="drawer-list"></div>
      <p class="drawer-empty">本站还没有收藏的词语</p>
      <div class="drawer-knowledge" hidden></div>
    </div>
  </aside>
`;

/** Site-scoped word collection drawer rendered inside a Shadow DOM. */
export class WordCollectionDrawer {
  private host?: HTMLElement;
  private shadow?: ShadowRoot;
  private groups: WordGroup[] = [];
  private expanded = false;
  private knowledgeKey?: string;
  private disposed = false;
  private lastHostname?: string;
  private refreshSequence = 0;
  private repositionTimer?: ReturnType<typeof setTimeout>;
  private readonly disposers: Array<() => void> = [];

  constructor(private readonly adapter: WordCollectionAdapter) {}

  mount(): void {
    if (this.disposed || this.host) return;
    if (!this.adapter.isSupported()) return;
    this.host = document.createElement("div");
    this.host.dataset.imt = "word-collection";
    this.shadow = this.host.attachShadow({ mode: "open" });
    this.shadow.innerHTML = TEMPLATE;
    document.documentElement.append(this.host);
    this.bindEvents();
    this.disposers.push(
      this.adapter.onChanged(() => void this.refresh()),
      this.adapter.onUrlChange(() => {
        this.close();
        this.knowledgeKey = undefined;
        void this.refresh();
      }),
    );
    this.disposers.push(this.observeViewport());
    this.reposition();
    this.scheduleReposition();
    void this.refresh();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const dispose of this.disposers) dispose();
    this.disposers.length = 0;
    if (this.repositionTimer !== undefined) {
      clearTimeout(this.repositionTimer);
      this.repositionTimer = undefined;
    }
    this.host?.remove();
    this.host = undefined;
    this.shadow = undefined;
  }

  private observeViewport(): () => void {
    const onViewport = (): void => this.scheduleReposition();
    window.addEventListener("resize", onViewport);
    window.visualViewport?.addEventListener("resize", onViewport);
    document.addEventListener("fullscreenchange", onViewport);
    const observer = new MutationObserver((records) => {
      if (
        records.some(
          (record) =>
            record.type === "childList" ||
            (record.target instanceof Element &&
              record.target.matches('[data-imt="float-ball"]')),
        )
      ) {
        this.scheduleReposition();
      }
    });
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["class", "data-side", "style"],
    });
    return () => {
      window.removeEventListener("resize", onViewport);
      window.visualViewport?.removeEventListener("resize", onViewport);
      document.removeEventListener("fullscreenchange", onViewport);
      observer.disconnect();
    };
  }

  private scheduleReposition(): void {
    if (this.repositionTimer !== undefined) return;
    this.repositionTimer = setTimeout(() => {
      this.repositionTimer = undefined;
      this.reposition();
    }, 0);
  }

  private reposition(): void {
    if (!this.shadow) return;
    const handle = this.shadow.querySelector<HTMLElement>(".handle");
    if (!handle || handle.hidden || this.expanded) return;
    handle.style.top = "";
    handle.style.transform = "";
    const ball = document.querySelector<HTMLElement>(
      '[data-imt="float-ball"]',
    );
    if (!ball || ball.dataset.side !== "right") return;
    const ballRect = ball.getBoundingClientRect();
    const handleRect = handle.getBoundingClientRect();
    const overlaps =
      ballRect.bottom > handleRect.top && ballRect.top < handleRect.bottom;
    if (!overlaps) return;
    const gap = 10;
    const below = ballRect.bottom + gap;
    const above = ballRect.top - handleRect.height - gap;
    const hasRoomBelow =
      below + handleRect.height <= window.innerHeight - 8;
    const hasRoomAbove = above >= 8;
    const shifted = hasRoomBelow
      ? below
      : hasRoomAbove
        ? above
        : Math.max(8, window.innerHeight - handleRect.height - 8);
    handle.style.top = `${shifted}px`;
    handle.style.transform = "none";
  }

  private bindEvents(): void {
    const shadow = this.shadow;
    if (!shadow) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== "Escape" || !this.expanded) return;
      event.preventDefault();
      this.close();
    };
    const onPointerDown = (event: PointerEvent): void => {
      if (!this.expanded || !this.host) return;
      if (!event.composedPath().includes(this.host)) this.close();
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown, true);
    this.disposers.push(
      () => document.removeEventListener("keydown", onKeyDown),
      () => document.removeEventListener("pointerdown", onPointerDown, true),
    );
    shadow.addEventListener("click", (event) => {
      const target = event.target as EventTarget | null;
      const element =
        target instanceof Element
          ? target.closest<HTMLElement>("[data-action], .word-card")
          : null;
      if (!element) return;
      const action = element.dataset.action;
      if (action === "toggle") {
        this.toggle();
        return;
      }
      if (action === "close") {
        this.close();
        return;
      }
      if (action === "remove") {
        const key = element.dataset.key;
        if (key) void this.removeGroup(key);
        return;
      }
      if (action === "back") {
        this.showList();
        return;
      }
      if (element.classList.contains("word-card")) {
        const key = element.dataset.key;
        if (key) this.showKnowledge(key);
      }
    });
  }

  private toggle(): void {
    if (this.expanded) this.close();
    else this.open();
  }

  private open(): void {
    if (!this.shadow) return;
    this.expanded = true;
    this.shadow.querySelector<HTMLElement>(".handle")!.hidden = true;
    this.shadow.querySelector<HTMLElement>(".drawer")!.hidden = false;
  }

  private close(): void {
    if (!this.shadow) return;
    this.expanded = false;
    this.shadow.querySelector<HTMLElement>(".drawer")!.hidden = true;
    this.shadow.querySelector<HTMLElement>(".handle")!.hidden = false;
  }

  private showKnowledge(key: string): void {
    if (!this.groups.some((group) => group.key === key)) return;
    this.knowledgeKey = key;
    this.renderKnowledge();
  }

  private showList(): void {
    this.knowledgeKey = undefined;
    this.renderKnowledge();
  }

  private async removeGroup(key: string): Promise<void> {
    const group = this.groups.find((candidate) => candidate.key === key);
    if (!group) return;
    await this.adapter.removeWords(group.words.map((word) => word.id));
    await this.refresh();
  }

  async refresh(): Promise<void> {
    if (!this.shadow) return;
    const refreshSequence = ++this.refreshSequence;
    let groups: WordGroup[];
    try {
      const hostname = await this.adapter.currentHostname();
      if (refreshSequence !== this.refreshSequence) return;
      if (hostname !== this.lastHostname) {
        this.lastHostname = hostname;
        this.groups = [];
        this.renderList();
      }
      const words = await this.adapter.listWords(hostname);
      if (refreshSequence !== this.refreshSequence) return;
      groups = groupWords(words);
    } catch {
      if (refreshSequence !== this.refreshSequence) return;
      groups = [];
    }
    if (!this.shadow) return;
    this.groups = groups;
    this.renderList();
  }

  private renderList(): void {
    if (!this.shadow) return;
    const count = String(this.groups.length);
    const countNodes = this.shadow.querySelectorAll<HTMLElement>(".handle-count, .drawer-total");
    for (const node of countNodes) node.textContent = count;
    const list = this.shadow.querySelector<HTMLElement>(".drawer-list");
    const empty = this.shadow.querySelector<HTMLElement>(".drawer-empty");
    if (!list || !empty) return;
    list.innerHTML = this.groups.map((group) => this.cardHtml(group)).join("");
    list.hidden = this.groups.length === 0;
    empty.hidden = this.groups.length !== 0;
  }

  private renderKnowledge(): void {
    if (!this.shadow) return;
    const list = this.shadow.querySelector<HTMLElement>(".drawer-list");
    const empty = this.shadow.querySelector<HTMLElement>(".drawer-empty");
    const knowledge = this.shadow.querySelector<HTMLElement>(
      ".drawer-knowledge",
    );
    if (!list || !empty || !knowledge) return;
    const group = this.knowledgeKey
      ? this.groups.find((candidate) => candidate.key === this.knowledgeKey)
      : undefined;
    if (group) {
      knowledge.innerHTML = this.knowledgeHtml(group);
      knowledge.hidden = false;
      list.hidden = true;
      empty.hidden = true;
    } else {
      knowledge.hidden = true;
      knowledge.innerHTML = "";
      list.hidden = this.groups.length === 0;
      empty.hidden = this.groups.length !== 0;
    }
  }

  private cardHtml(group: WordGroup): string {
    const first = group.words[0];
    const pos = first.partOfSpeech
      ? `<span class="word-pos">${escapeHtml(first.partOfSpeech)}</span>`
      : "";
    const translation = first.translation
      ? `<div class="word-translation">${escapeHtml(first.translation)}</div>`
      : "";
    const definition = first.definition
      ? `<div class="word-definition">${escapeHtml(first.definition)}</div>`
      : "";
    return `<article class="word-card" data-key="${escapeHtml(group.key)}">
      <header class="word-head"><strong>${escapeHtml(group.word)}</strong>${pos}</header>
      ${translation}${definition}
      <button type="button" class="word-remove" data-action="remove" data-key="${escapeHtml(group.key)}" aria-label="移除 ${escapeHtml(group.word)}">移除</button>
    </article>`;
  }

  private knowledgeHtml(group: WordGroup): string {
    const first = group.words[0];
    const pos = first.partOfSpeech
      ? `<span class="word-pos">${escapeHtml(first.partOfSpeech)}</span>`
      : "";
    const translation = first.translation
      ? `<div class="knowledge-translation">${escapeHtml(first.translation)}</div>`
      : "";
    const definition = first.definition
      ? `<p class="knowledge-definition">${escapeHtml(first.definition)}</p>`
      : "";
    const source = first.sourceUrl
      ? `<a class="knowledge-source" href="${escapeHtml(first.sourceUrl)}" target="_blank" rel="noopener noreferrer">查看原文出处</a>`
      : "";
    return `<div class="knowledge">
      <button type="button" class="knowledge-back" data-action="back">← 返回</button>
      <header class="knowledge-head"><strong>${escapeHtml(group.word)}</strong>${pos}</header>
      ${translation}${definition}${source}
    </div>`;
  }
}

function groupWords(words: SavedWord[]): WordGroup[] {
  const map = new Map<string, WordGroup>();
  for (const word of words) {
    const key = word.normalizedKey || normalizeWord(word.word);
    const existing = map.get(key);
    if (existing) {
      existing.words.push(word);
    } else {
      map.set(key, { key, word: word.word, words: [word] });
    }
  }
  return [...map.values()];
}

/** Mount the site-scoped word collection drawer with real dependencies. */
export function initWordCollection(): () => void {
  const drawer = new WordCollectionDrawer({
    currentHostname: async () => window.location.hostname,
    listWords: async (hostname) => {
      const response = await sendToBackground({
        type: "learningListWords",
        hostname,
      });
      return response.words;
    },
    removeWords: async (wordIds) => {
      for (const wordId of wordIds) {
        await sendToBackground({ type: "learningRemoveWord", wordId });
      }
    },
    onChanged: (listener) => {
      const handler = (message: unknown): void => {
        if (
          typeof message === "object" &&
          message !== null &&
          (message as { type?: unknown }).type === "learningChanged"
        ) {
          listener();
        }
      };
      browser.runtime.onMessage?.addListener(handler);
      return () => browser.runtime.onMessage?.removeListener(handler);
    },
    onUrlChange,
    isSupported: () => {
      const protocol = window.location.protocol;
      if (
        protocol === "chrome:" ||
        protocol === "edge:" ||
        protocol === "about:" ||
        protocol === "moz-extension:" ||
        protocol === "chrome-extension:"
      ) {
        return false;
      }
      return window.innerWidth >= MIN_SUPPORTED_WIDTH;
    },
  });
  drawer.mount();
  return () => drawer.dispose();
}
