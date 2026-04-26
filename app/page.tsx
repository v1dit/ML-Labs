"use client";

import { FormEvent, useMemo, useRef, useState } from "react";

type Role = "user" | "assistant" | "system";

type ChatMessage = {
  id: string;
  role: Role;
  content: string;
};

type ChatResponse = {
  message?: ChatMessage;
  error?: string;
};

const starterMessages: ChatMessage[] = [
  {
    id: "system-ready",
    role: "system",
    content:
      "Coding agent shell is connected to /api/chat.",
  },
  {
    id: "assistant-ready",
    role: "assistant",
    content: "Tell me what to build or inspect.",
  },
];

export default function HomePage() {
  const [messages, setMessages] = useState<ChatMessage[]>(starterMessages);
  const [draft, setDraft] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const visibleMessages = useMemo(
    () => messages.filter((message) => message.role !== "system"),
    [messages],
  );
  const output = [...messages].reverse().find((message) => message.role === "assistant");

  async function sendMessage(content: string) {
    const trimmed = content.trim();

    if (!trimmed || isSending) {
      return;
    }

    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: trimmed,
    };

    const nextMessages = [...messages, userMessage];
    setMessages(nextMessages);
    setDraft("");
    setIsSending(true);
    setError(null);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messages: nextMessages.map(({ role, content }) => ({ role, content })),
        }),
      });

      const data = (await response.json()) as ChatResponse;

      if (!response.ok || !data.message) {
        throw new Error(data.error ?? "The chat backend did not return a message.");
      }

      setMessages((current) => [...current, data.message as ChatMessage]);
    } catch (caughtError) {
      const message =
        caughtError instanceof Error ? caughtError.message : "Unknown chat error.";
      setError(message);
    } finally {
      setIsSending(false);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void sendMessage(draft);
  }

  return (
    <main className="app-shell">
      <section className="agent-panel" aria-label="Agent panel">
        <div className="message-list" aria-live="polite">
          {visibleMessages.map((message) => (
            <article className={`message ${message.role}`} key={message.id}>
              <p>{message.content}</p>
            </article>
          ))}

          {isSending ? (
            <article className="message assistant pending">
              <p>Thinking...</p>
            </article>
          ) : null}
        </div>

        {error ? <p className="error-banner">{error}</p> : null}

        <form className="composer" onSubmit={handleSubmit}>
          <textarea
            ref={inputRef}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }
            }}
            placeholder="Ask the agent..."
            rows={3}
          />
          <button type="submit" disabled={isSending || draft.trim().length === 0}>
            Send
          </button>
        </form>
      </section>

      <section className="output-panel" aria-label="Output panel">
        <div className="output-surface">
          <p>{output?.content ?? ""}</p>
        </div>
      </section>
    </main>
  );
}
