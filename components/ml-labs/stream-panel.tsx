import type { WorkbenchMessage } from "@/lib/ml-labs/workbench-normalizer";

type StreamPanelProps = {
  title: string;
  status: string;
  messages: WorkbenchMessage[];
  streamLines: string[];
  isVisible: boolean;
  isFocused: boolean;
};

export function StreamPanel({
  title,
  status,
  messages,
  streamLines,
  isVisible,
  isFocused,
}: StreamPanelProps) {
  return (
    <section
      className={[
        "workbench-panel",
        "stream-panel",
        isVisible ? "panel-visible" : "panel-hidden",
        isFocused ? "panel-focused" : "panel-background",
      ].join(" ")}
    >
      <div className="panel-header">
        <div>
          <span className="panel-kicker">Panel 02</span>
          <h2>{title}</h2>
        </div>
        <span className="status-pill">{status}</span>
      </div>

      <div className="stream-layout">
        <div className="agent-rail">
          <div className="section-heading compact">
            <span className="section-kicker">Agent Rail</span>
            <h3>Inference log</h3>
          </div>

          <div className="agent-message-list" aria-live="polite">
            {messages.length ? (
              messages.map((message) => (
                <article key={message.id} className={`agent-message tone-${message.tone}`}>
                  <span className="agent-label">{message.label}</span>
                  <p>{message.text}</p>
                </article>
              ))
            ) : (
              <article className="agent-message tone-neutral">
                <span className="agent-label">System</span>
                <p>Waiting for source selection.</p>
              </article>
            )}
          </div>
        </div>

        <div className="stream-console">
          <div className="section-heading compact">
            <span className="section-kicker">Streaming Surface</span>
            <h3>Rows and schema</h3>
          </div>

          <div className="stream-lines" aria-live="polite">
            {streamLines.length ? (
              streamLines.map((line, index) => (
                <div key={`${line}-${index}`} className="stream-line">
                  <span className="stream-index">{String(index + 1).padStart(2, "0")}</span>
                  <p>{line}</p>
                </div>
              ))
            ) : (
              <div className="stream-line">
                <span className="stream-index">00</span>
                <p>The ingestion stream will appear here once a dataset source is loaded.</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
