import type { AcademicTermKnowledge } from "../../shared/types";
import { sendToBackground } from "../../shared/messages";
import type { FeatureContext } from "./context";

const PROCESSED_ATTRIBUTE = "data-imt-academic-processed";
const TERM_ID_ATTRIBUTE = "data-imt-academic-term";
const OPEN_DELAY_MS = 220;
const FALLBACK_TERMS: Record<
  string,
  Pick<AcademicTermKnowledge, "translation" | "definition" | "domain">
> = {
  brics: {
    translation: "金砖国家",
    definition:
      "由巴西、俄罗斯、印度、中国和南非等新兴市场国家组成的国际合作机制。",
    domain: "国际组织",
  },
  "global south": {
    translation: "全球南方",
    definition:
      "通常指亚洲、非洲、拉丁美洲和加勒比地区等发展中国家和新兴经济体。",
    domain: "国际关系",
  },
  "artificial intelligence": {
    translation: "人工智能",
    definition:
      "让计算机执行学习、推理、生成和决策等通常需要人类智能的任务的技术领域。",
    domain: "计算机科学",
  },
  "digital economy": {
    translation: "数字经济",
    definition:
      "以数字技术和数据资源为核心生产要素的经济活动及产业形态。",
    domain: "经济学",
  },
  "world bank": {
    translation: "世界银行",
    definition: "为发展中国家提供贷款、知识和技术支持的国际金融机构。",
    domain: "国际组织",
  },
  nato: {
    translation: "北大西洋公约组织",
    definition: "由北美和欧洲国家组成的军事政治联盟。",
    domain: "国际组织",
  },
  eu: {
    translation: "欧洲联盟",
    definition: "由欧洲国家组成的政治与经济一体化组织。",
    domain: "国际组织",
  },
};

const EXTRA_FALLBACK_TERMS: Record<
  string,
  Pick<AcademicTermKnowledge, "translation" | "definition" | "domain">
> = {
  "\u03c4 scaling law": {
    translation: "\u03c4 \u6807\u5ea6\u5b9a\u5f8b",
    definition:
      "\u4ee5\u5ef6\u8fdf \u03c4 \u4e3a\u6838\u5fc3\u53d8\u91cf\u7684\u65f6\u95f4\u6807\u5ea6\u7406\u8bba\uff0c\u7528\u4e8e\u5206\u6790\u82af\u7247\u4e2d\u8ba1\u7b97\u3001\u4f20\u8f93\u548c\u80fd\u8017\u968f\u65f6\u95f4\u5c3a\u5ea6\u7684\u53d8\u5316\u3002",
    domain: "\u534a\u5bfc\u4f53\u4e0e\u82af\u7247\u8bbe\u8ba1",
  },
  kirin: {
    translation: "\u9e92\u9e9f\u82af\u7247",
    definition:
      "\u534e\u4e3a\u9762\u5411\u79fb\u52a8\u7ec8\u7aef\u548c\u667a\u80fd\u8bbe\u5907\u7814\u53d1\u7684\u82af\u7247\u4ea7\u54c1\u7cfb\u5217\uff0c\u7528\u4e8e\u9a8c\u8bc1\u80fd\u8017\u3001\u5c3a\u5ea6\u548c\u96c6\u6210\u5ea6\u7b49\u6027\u80fd\u6307\u6807\u3002",
    domain: "\u534a\u5bfc\u4f53\u4e0e\u82af\u7247\u8bbe\u8ba1",
  },
  logicfolding: {
    translation: "\u903b\u8f91\u6298\u53e0",
    definition:
      "\u901a\u8fc7\u6539\u53d8\u82af\u7247\u903b\u8f91\u4e0e\u4e92\u8fde\u5c42\u7ea7\u7ed3\u6784\u6765\u7f29\u77ed\u4fe1\u53f7\u4f20\u8f93\u8def\u5f84\u3001\u964d\u4f4e\u80fd\u8017\u7684\u96c6\u6210\u65b9\u6cd5\u3002",
    domain: "\u534a\u5bfc\u4f53\u4e0e\u82af\u7247\u8bbe\u8ba1",
  },
  "3d integration": {
    translation: "\u4e09\u7ef4\u96c6\u6210",
    definition:
      "\u5c06\u591a\u5c42\u7535\u5b50\u5668\u4ef6\u6216\u82af\u7247\u5728\u5782\u76f4\u65b9\u5411\u53e0\u52a0\u5e76\u4e92\u8fde\u7684\u5c01\u88c5\u4e0e\u7cfb\u7edf\u96c6\u6210\u6280\u672f\u3002",
    domain: "\u534a\u5bfc\u4f53\u5c01\u88c5",
  },
  "hybrid bonding": {
    translation: "\u6df7\u5408\u952e\u5408",
    definition:
      "\u901a\u8fc7\u91d1\u5c5e\u4e92\u8fde\u548c\u4ecb\u8d28\u5c42\u540c\u65f6\u8fde\u63a5\u7684\u5148\u8fdb\u82af\u7247\u5806\u53e0\u5c01\u88c5\u6280\u672f\u3002",
    domain: "\u534a\u5bfc\u4f53\u5c01\u88c5",
  },
  "low-power design": {
    translation: "\u4f4e\u529f\u8017\u8bbe\u8ba1",
    definition:
      "\u5728\u6ee1\u8db3\u6027\u80fd\u8981\u6c42\u7684\u524d\u63d0\u4e0b\uff0c\u901a\u8fc7\u67b6\u6784\u3001\u7535\u8def\u548c\u5de5\u827a\u4f18\u5316\u964d\u4f4e\u82af\u7247\u80fd\u8017\u7684\u8bbe\u8ba1\u65b9\u6cd5\u3002",
    domain: "\u534a\u5bfc\u4f53\u4e0e\u82af\u7247\u8bbe\u8ba1",
  },
  cnn: {
    translation: "\u5377\u79ef\u795e\u7ecf\u7f51\u7edc",
    definition:
      "\u4e00\u79cd\u901a\u8fc7\u5377\u79ef\u8fd0\u7b97\u63d0\u53d6\u5c40\u90e8\u7279\u5f81\u7684\u6df1\u5ea6\u795e\u7ecf\u7f51\u7edc\u7ed3\u6784\u3002",
    domain: "\u4eba\u5de5\u667a\u80fd",
  },
  doa: {
    translation: "\u5230\u8fbe\u65b9\u5411\u4f30\u8ba1",
    definition:
      "\u6839\u636e\u4f20\u611f\u5668\u9635\u5217\u63a5\u6536\u5230\u7684\u4fe1\u53f7\u4f30\u8ba1\u4fe1\u53f7\u6765\u6e90\u65b9\u4f4d\u7684\u6280\u672f\u3002",
    domain: "\u4fe1\u53f7\u5904\u7406",
  },
  uwb: {
    translation: "\u8d85\u5bbd\u5e26",
    definition:
      "\u5229\u7528\u5bbd\u9891\u5e26\u8109\u51b2\u5b9e\u73b0\u9ad8\u7cbe\u5ea6\u5b9a\u4f4d\u3001\u6d4b\u8ddd\u548c\u901a\u4fe1\u7684\u65e0\u7ebf\u6280\u672f\u3002",
    domain: "\u65e0\u7ebf\u901a\u4fe1",
  },
  upcnn: {
    translation: "UPCNN \u65b9\u6cd5",
    definition:
      "\u5728\u4e0d\u7b49\u529f\u7387\u4fe1\u53f7\u573a\u666f\u4e0b\u7528\u4e8e\u5230\u8fbe\u65b9\u5411\u4f30\u8ba1\u7684\u5377\u79ef\u795e\u7ecf\u7f51\u7edc\u65b9\u6cd5\u3002",
    domain: "\u4fe1\u53f7\u5904\u7406",
  },
  "attention mechanism": {
    translation: "\u6ce8\u610f\u529b\u673a\u5236",
    definition:
      "\u8ba9\u6a21\u578b\u52a8\u6001\u6743\u8861\u4e0d\u540c\u8f93\u5165\u4f4d\u7f6e\u7684\u673a\u5236\uff0c\u662f Transformer \u7b49\u5e8f\u5217\u6a21\u578b\u7684\u6838\u5fc3\u7ec4\u4ef6\u3002",
    domain: "\u4eba\u5de5\u667a\u80fd",
  },
  "attention mechanisms": {
    translation: "\u6ce8\u610f\u529b\u673a\u5236",
    definition:
      "\u8ba9\u6a21\u578b\u52a8\u6001\u6743\u8861\u4e0d\u540c\u8f93\u5165\u4f4d\u7f6e\u7684\u673a\u5236\uff0c\u662f Transformer \u7b49\u5e8f\u5217\u6a21\u578b\u7684\u6838\u5fc3\u7ec4\u4ef6\u3002",
    domain: "\u4eba\u5de5\u667a\u80fd",
  },
  transformer: {
    translation: "Transformer \u67b6\u6784",
    definition:
      "\u4e00\u79cd\u4e3b\u8981\u57fa\u4e8e\u6ce8\u610f\u529b\u673a\u5236\u7684\u795e\u7ecf\u7f51\u7edc\u67b6\u6784\uff0c\u5e7f\u6cdb\u5e94\u7528\u4e8e\u673a\u5668\u7ffb\u8bd1\u548c\u5927\u8bed\u8a00\u6a21\u578b\u3002",
    domain: "\u4eba\u5de5\u667a\u80fd",
  },
  "transformer architecture": {
    translation: "Transformer \u67b6\u6784",
    definition:
      "\u4e00\u79cd\u4e3b\u8981\u57fa\u4e8e\u6ce8\u610f\u529b\u673a\u5236\u7684\u795e\u7ecf\u7f51\u7edc\u67b6\u6784\uff0c\u5e7f\u6cdb\u5e94\u7528\u4e8e\u673a\u5668\u7ffb\u8bd1\u548c\u5927\u8bed\u8a00\u6a21\u578b\u3002",
    domain: "\u4eba\u5de5\u667a\u80fd",
  },
  bleu: {
    translation: "BLEU \u8bc4\u5206",
    definition:
      "\u673a\u5668\u7ffb\u8bd1\u4e2d\u7528\u4e8e\u8861\u91cf\u8bd1\u6587\u4e0e\u53c2\u8003\u8bd1\u6587\u91cd\u5408\u5ea6\u7684\u8bc4\u4f30\u6307\u6807\u3002",
    domain: "\u81ea\u7136\u8bed\u8a00\u5904\u7406",
  },
  wmt: {
    translation: "WMT \u673a\u5668\u7ffb\u8bd1\u8bc4\u6d4b",
    definition:
      "\u56fd\u9645\u673a\u5668\u7ffb\u8bd1\u8bc4\u6d4b\u6d3b\u52a8\uff0c\u63d0\u4f9b\u591a\u8bed\u8a00\u8bed\u6599\u548c\u7edf\u4e00\u7684\u8bd1\u6587\u8d28\u91cf\u6bd4\u8f83\u57fa\u51c6\u3002",
    domain: "\u81ea\u7136\u8bed\u8a00\u5904\u7406",
  },
};

function isEligibleTarget(target: HTMLElement): boolean {
  return !target.closest("[aria-hidden='true'], [hidden], [inert]");
}

function termKey(value: string): string {
  return value.trim().toLowerCase();
}

function fallbackKnowledge(
  term: string,
  context: string,
  translation?: string,
): AcademicTermKnowledge | undefined {
  const key = termKey(term);
  const preset = FALLBACK_TERMS[key] ?? EXTRA_FALLBACK_TERMS[key];
  const resolved = translation?.trim();
  if (!preset && (!resolved || resolved.toLowerCase() === key)) return undefined;
  return {
    id: key.replace(/[^a-z0-9\u4e00-\u9fff-]+/gu, "-"),
    term,
    translation: preset?.translation ?? resolved ?? "",
    definition:
      preset?.definition ??
      `当前上下文中的专业术语，基础释义为“${resolved}”。`,
    domain: preset?.domain ?? "专业术语",
    aliases: [],
    summary:
      "由扩展内置知识保底生成；联网学术检索或 AI 服务恢复后会补充来源与更完整的语境解释。",
    confidence: preset ? 0.75 : 0.4,
    sources: [],
    contexts: context ? [context.slice(0, 1000)] : [],
    updatedAt: Date.now(),
  };
}

function sourceContext(target: HTMLElement): string {
  const container = target.parentElement;
  if (!container) return "";
  return Array.from(container.childNodes)
    .filter((node) => node !== target)
    .map((node) => node.textContent ?? "")
    .join(" ")
    .trim();
}

function knownTerms(target: HTMLElement): string[] {
  const raw = target.dataset.imtAcademicTerms;
  if (raw) {
    try {
      const value = JSON.parse(raw) as unknown;
      if (Array.isArray(value)) {
        return value.filter(
          (item): item is string => typeof item === "string" && item.trim() !== "",
        );
      }
    } catch {
      // Fall back to local detection if the metadata is malformed.
    }
  }
  return [];
}

function createTermSpan(
  term: string,
  knowledge: AcademicTermKnowledge,
): HTMLSpanElement {
  const span = document.createElement("span");
  span.className = "imt-academic-term";
  span.dataset.imt = "academic-term";
  span.setAttribute(TERM_ID_ATTRIBUTE, knowledge.id);
  span.tabIndex = 0;
  span.textContent = term;
  span.title = `${knowledge.translation} · ${knowledge.domain}`;
  return span;
}

function markProcessed(target: HTMLElement): void {
  target.setAttribute(PROCESSED_ATTRIBUTE, "true");
}

function appendInlineMeaning(
  target: HTMLElement,
  term: string,
  knowledge: AcademicTermKnowledge,
  showTranslation: boolean,
): void {
  const span = createTermSpan(term, knowledge);
  target.append(span);
  if (showTranslation && knowledge.translation) {
    const meaning = document.createElement("span");
    meaning.className = "imt-academic-meaning";
    meaning.dataset.imt = "academic-meaning";
    meaning.textContent = `（${knowledge.translation}）`;
    target.append(meaning);
  }
}

function wrapTextOccurrence(
  target: HTMLElement,
  term: string,
  knowledge: AcademicTermKnowledge,
  showTranslation: boolean,
): boolean {
  const walker = document.createTreeWalker(target, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  while (node) {
    const text = node as Text;
    if (
      text.parentElement?.classList.contains("imt-academic-term") ||
      text.parentElement?.classList.contains("imt-academic-meaning") ||
      text.parentElement?.closest(".imt-pair-source-block")
    ) {
      node = walker.nextNode();
      continue;
    }
    const index = text.data.toLowerCase().indexOf(term.toLowerCase());
    if (index < 0) {
      node = walker.nextNode();
      continue;
    }

    const after = text.splitText(index);
    const occurrence = after.data.slice(0, term.length);
    after.splitText(term.length);
    const span = createTermSpan(occurrence, knowledge);
    after.replaceWith(span);
    if (showTranslation && knowledge.translation) {
      const meaning = document.createElement("span");
      meaning.className = "imt-academic-meaning";
      meaning.dataset.imt = "academic-meaning";
      meaning.textContent = `（${knowledge.translation}）`;
      span.after(meaning);
    }
    return true;
  }
  return false;
}

function positionPopover(host: HTMLElement, anchor: Element): void {
  const rect = anchor.getBoundingClientRect();
  const width = 340;
  const gap = 8;
  const left = Math.max(
    8,
    Math.min(window.innerWidth - width - 8, rect.left),
  );
  const top =
    rect.bottom + 220 < window.innerHeight
      ? rect.bottom + gap
      : Math.max(8, rect.top - 220 - gap);
  host.style.left = `${left}px`;
  host.style.top = `${top}px`;
}

function showKnowledgeCard(
  anchor: HTMLElement,
  knowledge: AcademicTermKnowledge,
  onOpenPage: () => void,
): void {
  document.querySelector('[data-imt="academic-card"]')?.remove();
  const host = document.createElement("div");
  host.dataset.imt = "academic-card";
  host.style.cssText =
    "position:fixed;z-index:2147483647;width:340px;pointer-events:auto";
  const shadow = host.attachShadow({ mode: "open" });
  const topSources = knowledge.sources.slice(0, 2);
  shadow.innerHTML = `
    <style>
      :host { color-scheme: light; font: 13px/1.5 system-ui, sans-serif; }
      .card {
        box-sizing: border-box;
        padding: 12px;
        color: #172033;
        background: #fff;
        border: 1px solid #d8dee9;
        border-radius: 10px;
        box-shadow: 0 14px 40px rgb(15 23 42 / 22%);
      }
      .title { display: flex; gap: 8px; align-items: baseline; margin-bottom: 6px; }
      strong { font-size: 15px; }
      .translation { color: #2563eb; font-weight: 600; }
      .domain { color: #64748b; font-size: 12px; }
      .definition { margin: 7px 0; }
      .sources { margin-top: 8px; padding-top: 8px; border-top: 1px solid #e5e7eb; }
      .source { display: block; margin: 4px 0; color: #2563eb; text-decoration: none; }
      .source:hover { text-decoration: underline; }
      button {
        margin-top: 9px;
        border: 0;
        border-radius: 6px;
        padding: 6px 9px;
        color: #fff;
        background: #2563eb;
        cursor: pointer;
      }
      .hint { margin-top: 6px; color: #64748b; font-size: 11px; }
      @media (prefers-color-scheme: dark) {
        .card { color: #e5e7eb; background: #111827; border-color: #374151; }
        .domain, .hint { color: #9ca3af; }
        .sources { border-color: #374151; }
      }
    </style>
    <div class="card" role="dialog" aria-label="学术词知识卡">
      <div class="title">
        <strong>${escapeHtml(knowledge.term)}</strong>
        <span class="translation">${escapeHtml(knowledge.translation)}</span>
      </div>
      <div class="domain">${escapeHtml(knowledge.domain)}</div>
      <div class="definition">${escapeHtml(knowledge.definition)}</div>
      ${
        topSources.length
          ? `<div class="sources">${topSources
              .map(
                (source) =>
                  `<a class="source" target="_blank" rel="noreferrer" href="${escapeAttribute(source.url)}">${escapeHtml(source.title)}</a>`,
              )
              .join("")}</div>`
          : ""
      }
      <button type="button">打开完整知识页</button>
      <div class="hint">双击术语或知识卡可打开完整页面</div>
    </div>
  `;
  positionPopover(host, anchor);
  const openButton = shadow.querySelector("button");
  openButton?.addEventListener("click", onOpenPage);
  host.addEventListener("dblclick", (event) => {
    event.preventDefault();
    onOpenPage();
  });
  document.documentElement.append(host);

  const close = (event: PointerEvent): void => {
    if (!event.composedPath().includes(host) && event.target !== anchor) {
      host.remove();
      document.removeEventListener("pointerdown", close, true);
    }
  };
  document.addEventListener("pointerdown", close, true);
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function escapeAttribute(value: string): string {
  return escapeHtml(value).replaceAll('"', "&quot;");
}

/** Detect and enrich academic terms in rendered translation nodes. */
export function init(ctx: FeatureContext): () => void {
  if (!ctx.config.academic.enabled) return () => undefined;

  const knowledgeByTerm = new Map<string, AcademicTermKnowledge>();
  const pending = new Set<string>();
  const disposers = new Map<HTMLElement, () => void>();

  const openPage = (term: string): void => {
    void sendToBackground({ type: "openAcademic", term }).catch(
      () => undefined,
    );
  };

  const bindTerm = (
    node: HTMLElement,
    term: string,
    knowledge: AcademicTermKnowledge,
  ): void => {
    if (node.dataset.imtAcademicBound === "true") return;
    node.dataset.imtAcademicBound = "true";

    let timer: ReturnType<typeof setTimeout> | undefined;
    const onClick = (event: MouseEvent): void => {
      event.preventDefault();
      event.stopPropagation();
      if (timer !== undefined) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = undefined;
        showKnowledgeCard(node, knowledge, () => openPage(term));
      }, OPEN_DELAY_MS);
    };
    const onDoubleClick = (event: MouseEvent): void => {
      event.preventDefault();
      event.stopPropagation();
      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
      }
      openPage(term);
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        showKnowledgeCard(node, knowledge, () => openPage(term));
      }
    };
    node.addEventListener("click", onClick);
    node.addEventListener("dblclick", onDoubleClick);
    node.addEventListener("keydown", onKeyDown);
    disposers.set(node, () => {
      if (timer !== undefined) clearTimeout(timer);
      node.removeEventListener("click", onClick);
      node.removeEventListener("dblclick", onDoubleClick);
      node.removeEventListener("keydown", onKeyDown);
    });
  };

  const enhance = async (target: HTMLElement): Promise<void> => {
    if (target.getAttribute(PROCESSED_ATTRIBUTE) === "true") return;
    markProcessed(target);
    if (!isEligibleTarget(target)) return;
    const terms = knownTerms(target);
    if (!terms.length) return;
    const context = sourceContext(target);

    for (const term of terms) {
      const key = termKey(term);
      let knowledge =
        knowledgeByTerm.get(key) ?? fallbackKnowledge(term, context);
      if (knowledge) knowledgeByTerm.set(key, knowledge);
      if (!knowledge && !pending.has(key)) {
        pending.add(key);
        try {
          knowledge = await sendToBackground({
            type: "academicResolve",
            term,
            context,
            title: document.title,
            url: window.location.href,
            service: ctx.config.academic.service,
          });
          if (knowledge) knowledgeByTerm.set(key, knowledge);
        } catch {
          // Academic enrichment is optional and must never break translation.
        } finally {
          pending.delete(key);
        }
      }
      if (!knowledge) {
        let translation: string | undefined;
        if (!FALLBACK_TERMS[key]) {
          try {
            translation = await ctx.translateText(
              term,
              ctx.config.sourceLanguage,
              ctx.config.targetLanguage,
            );
          } catch {
            // Keep the term visible even when every translation service fails.
          }
        }
        knowledge = fallbackKnowledge(term, context, translation);
        if (knowledge) knowledgeByTerm.set(key, knowledge);
      }
      if (!knowledge || !target.isConnected) continue;

      if (
        !wrapTextOccurrence(
          target,
          term,
          knowledge,
          ctx.config.academic.showInlineTranslation,
        )
      ) {
        appendInlineMeaning(
          target,
          term,
          knowledge,
          ctx.config.academic.showInlineTranslation,
        );
      }
      for (const node of target.querySelectorAll<HTMLElement>(
        '[data-imt="academic-term"]',
      )) {
        bindTerm(node, node.textContent ?? term, knowledge);
      }
    }
  };

  const scan = (root: ParentNode = document): void => {
    if (root instanceof HTMLElement && root.matches('font[data-imt="target"]')) {
      void enhance(root);
    }
    for (const target of root.querySelectorAll<HTMLElement>(
      'font[data-imt="target"]',
    )) {
      void enhance(target);
    }
  };

  const observer = new MutationObserver((records) => {
    for (const record of records) {
      if (
        record.type === "attributes" &&
        record.attributeName === "data-imt-translation-busy"
      ) {
        if (document.documentElement.dataset.imtTranslationBusy !== "true") {
          scan();
        }
        continue;
      }
      for (const node of record.addedNodes) {
        if (!(node instanceof HTMLElement)) continue;
        scan(node);
      }
    }
  });
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-imt-translation-busy"],
    childList: true,
    subtree: true,
  });
  scan();

  return () => {
    observer.disconnect();
    for (const dispose of disposers.values()) dispose();
    disposers.clear();
    document.querySelector('[data-imt="academic-card"]')?.remove();
    for (const node of document.querySelectorAll(
      '[data-imt="academic-term"], [data-imt="academic-meaning"]',
    )) {
      node.replaceWith(...node.childNodes);
    }
  };
}
