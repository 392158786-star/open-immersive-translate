import { render } from "preact";
import { useEffect, useMemo, useState } from "preact/hooks";

import {
  createAssistantClient,
  runAssistant,
  type AssistantChatMessage,
} from "../shared/k-assistant";
import { sendToBackground } from "../shared/messages";
import type {
  AcademicSource,
  AcademicTermKnowledge,
  Config,
} from "../shared/types";
import "./index.css";

interface ChatMessage extends AssistantChatMessage {
  error?: boolean;
}

function queryTerm(): string {
  return new URLSearchParams(window.location.search).get("term")?.trim() ?? "";
}

function firstAiService(config: Config): string | undefined {
  if (config.academic.service && config.services[config.academic.service]?.enabled) {
    return config.academic.service;
  }
  return Object.entries(config.services).find(
    ([, service]) =>
      service.enabled &&
      [
        "openai-compatible",
        "chatgpt",
        "claude",
        "gemini",
        "azure-openai",
      ].includes(service.kind),
  )?.[0];
}

function sourceLabel(source: AcademicSource): string {
  const parts = [
    source.venue,
    source.year ? String(source.year) : undefined,
    source.authors?.slice(0, 3).join(", "),
  ].filter(Boolean);
  return parts.join(" · ");
}

function KnowledgeSource({ source }: { source: AcademicSource }): preact.JSX.Element {
  return (
    <article class="source">
      <a href={source.url} target="_blank" rel="noreferrer">
        {source.title}
      </a>
      <div class="source-meta">{sourceLabel(source)}</div>
      {source.snippet ? <p>{source.snippet}</p> : null}
    </article>
  );
}

function App(): preact.JSX.Element {
  const term = useMemo(queryTerm, []);
  const [knowledge, setKnowledge] = useState<AcademicTermKnowledge>();
  const [config, setConfig] = useState<Config>();
  const [error, setError] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [question, setQuestion] = useState("");
  const [chatting, setChatting] = useState(false);

  useEffect(() => {
    const resolveKnowledge = async (): Promise<
      AcademicTermKnowledge | undefined
    > => {
      if (!term) return undefined;
      const cached = await sendToBackground({ type: "academicGet", term });
      if (cached) return cached;
      return sendToBackground({ type: "academicResolve", term, context: "" });
    };
    void Promise.all([resolveKnowledge(), sendToBackground({ type: "getConfig" })])
      .then(([nextKnowledge, nextConfig]) => {
        setKnowledge(nextKnowledge);
        setConfig(nextConfig);
      })
      .catch((reason: unknown) => {
        setError(reason instanceof Error ? reason.message : String(reason));
      });
  }, [term]);

  const sendQuestion = async (): Promise<void> => {
    const text = question.trim();
    if (!text || !knowledge || !config) return;
    const service = firstAiService(config);
    const nextMessages: ChatMessage[] = [
      ...messages,
      { role: "user", content: text },
    ];
    setMessages(nextMessages);
    setQuestion("");
    if (!service) {
      setMessages([
        ...nextMessages,
        {
          role: "assistant",
          content: "请先在扩展设置中启用一个 AI 服务。",
          error: true,
        },
      ]);
      return;
    }

    setChatting(true);
    try {
      const context = [
        `术语：${knowledge.term}`,
        `语境译名：${knowledge.translation}`,
        `定义：${knowledge.definition}`,
        `领域：${knowledge.domain}`,
        `检索摘要：${knowledge.summary}`,
        `来源：${knowledge.sources
          .map((source) => `${source.title} (${source.url})`)
          .join("; ")}`,
      ].join("\n");
      const answer = await runAssistant(createAssistantClient(), {
        kind: "chat",
        service,
        text: `${context}\n\n用户问题：${text}`,
        instruction:
          "你是中文学术词助手。根据给定的术语、上下文和公开来源回答。不得编造来源；无法确认时明确说明。",
        history: messages,
      });
      setMessages([
        ...nextMessages,
        { role: "assistant", content: answer },
      ]);
    } catch (reason) {
      setMessages([
        ...nextMessages,
        {
          role: "assistant",
          content: reason instanceof Error ? reason.message : String(reason),
          error: true,
        },
      ]);
    } finally {
      setChatting(false);
    }
  };

  return (
    <div class="knowledge-layout">
      <main class="knowledge-content">
        <header class="knowledge-header">
          <p class="eyebrow">Academic Term Knowledge</p>
          <h1>{knowledge?.term ?? (term || "学术词知识站")}</h1>
          {knowledge ? (
            <div class="term-summary">
              <strong>{knowledge.translation}</strong>
              <span>{knowledge.domain}</span>
              <span>可信度 {Math.round(knowledge.confidence * 100)}%</span>
            </div>
          ) : null}
        </header>

        {error ? <p class="error">{error}</p> : null}
        {!knowledge && !error ? <p>正在整理术语与公开文献...</p> : null}

        {knowledge ? (
          <>
            <section class="panel">
              <h2>当前语境</h2>
              <p>{knowledge.summary}</p>
              <p>{knowledge.definition}</p>
              {knowledge.aliases.length ? (
                <p class="aliases">
                  常见别名：{knowledge.aliases.join("、")}
                </p>
              ) : null}
            </section>

            <section class="panel">
              <h2>出现过的上下文</h2>
              {knowledge.contexts.length ? (
                <ul class="context-list">
                  {knowledge.contexts.map((context, index) => (
                    <li key={`${context.slice(0, 18)}-${index}`}>{context}</li>
                  ))}
                </ul>
              ) : (
                <p>当前还没有保存更多上下文。</p>
              )}
            </section>

            <section class="panel">
              <h2>学术来源</h2>
              <div class="sources">
                {knowledge.sources.length ? (
                  knowledge.sources.map((source) => (
                    <KnowledgeSource key={source.id} source={source} />
                  ))
                ) : (
                  <p>没有检索到公开来源。</p>
                )}
              </div>
            </section>
          </>
        ) : null}
      </main>

      <aside class="assistant-panel">
        <div class="assistant-header">
          <div>
            <p class="eyebrow">Context Assistant</p>
            <h2>AI 对话</h2>
          </div>
          <span class="status-dot" />
        </div>
        <div class="chat-messages">
          {messages.length === 0 ? (
            <p class="empty-chat">
              可以继续询问这个术语在具体段落中的含义、不同学派的解释或相关概念。
            </p>
          ) : (
            messages.map((message, index) => (
              <div
                key={`${message.role}-${index}`}
                class={`chat-message ${message.role} ${
                  message.error ? "error" : ""
                }`}
              >
                {message.content}
              </div>
            ))
          )}
        </div>
        <div class="chat-compose">
          <textarea
            value={question}
            placeholder="继续询问这个术语..."
            onInput={(event) =>
              setQuestion((event.currentTarget as HTMLTextAreaElement).value)
            }
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void sendQuestion();
              }
            }}
          />
          <button
            type="button"
            disabled={chatting || !question.trim()}
            onClick={() => void sendQuestion()}
          >
            {chatting ? "回答中..." : "发送"}
          </button>
        </div>
      </aside>
    </div>
  );
}

render(<App />, document.getElementById("app")!);
