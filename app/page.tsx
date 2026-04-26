"use client";

import {
  Bot,
  Braces,
  CirclePlay,
  Database,
  FileText,
  Loader2,
  MessageCircle,
  Send,
  Terminal,
  Upload,
} from "lucide-react";
import {
  ChangeEvent,
  DragEvent,
  FormEvent,
  useMemo,
  useRef,
  useState,
} from "react";

type Role = "user" | "assistant" | "system";
type UploadStatus = "idle" | "searching" | "reading" | "running" | "complete" | "failed";
type IngestionPanel = "source" | "stream" | "profile";

type ChatMessage = {
  id: string;
  role: Role;
  content: string;
};

type ChatResponse = {
  message?: ChatMessage;
  error?: string;
};

type DatasetProfile = {
  rows?: number;
  columns?: number;
  targetColumn?: string;
  problemType?: string;
};

type AgentTraceItem = {
  agent?: string;
  status?: string;
  message?: string;
};

type LabRunResponse = {
  runId?: string;
  scenario?: string;
  datasetProfile?: DatasetProfile;
  agentTrace?: AgentTraceItem[];
  leaderboard?: unknown[];
  bestModel?: {
    modelName?: string;
    metricName?: string;
    score?: number;
  };
  criticReport?: unknown;
  visualizations?: unknown[];
  predictionInputSchema?: unknown;
  artifacts?: unknown[];
  finalReportMarkdown?: string;
  error?: string;
  details?: string;
};

type NormalizedRun = {
  runId: string;
  scenario: string;
  problemType: string;
  rows: number | null;
  columns: number | null;
  targetColumn: string;
  bestModel: string;
  metric: string;
  score: number | null;
  visualizations: number;
  artifacts: number;
  schemaFields: number;
  trace: AgentTraceItem[];
};

type DatasetPreview = {
  headers: string[];
  rows: string[][];
  rowCount: number;
  columnCount: number;
};

const starterMessages: ChatMessage[] = [
  {
    id: "system-ready",
    role: "system",
    content: "ML-Labs local agent shell is attached to /api/chat and /api/lab/run.",
  },
  {
    id: "assistant-ready",
    role: "assistant",
    content:
      "Ready for dataset ingestion. Drop a CSV, set the target column, then I will replay the backend trace as it comes online.",
  },
];

const pendingStages = [
  "analyzing ...",
  "parsing dataset ...",
  "profiling schema ...",
  "replaying LabRunResult ...",
];

const panelOrder: IngestionPanel[] = ["source", "stream", "profile"];

const labRunContractLines = [
  "{",
  '  "runId": "demo-classification-churn-001",',
  '  "scenario": "classification",',
  '  "datasetProfile": { "problemType": "classification", "...": "..." },',
  '  "agentTrace": [ "...stages..." ],',
  '  "leaderboard": [ "...models..." ],',
  '  "bestModel": { "...": "..." },',
  '  "criticReport": { "...": "..." },',
  '  "visualizations": [ "...charts..." ],',
  '  "predictionInputSchema": { "...fields for Try Here..." },',
  '  "artifacts": [ "train.py", "evaluate.py", "predict.py", "report.md" ],',
  '  "finalReportMarkdown": "..."',
  "}",
];

export default function HomePage() {
  const [messages, setMessages] = useState<ChatMessage[]>(starterMessages);
  const [draft, setDraft] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [targetColumn, setTargetColumn] = useState("");
  const [intentPrompt, setIntentPrompt] = useState("");
  const [kaggleSlug, setKaggleSlug] = useState("");
  const [uploadStatus, setUploadStatus] = useState<UploadStatus>("idle");
  const [uploadResult, setUploadResult] = useState<NormalizedRun | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [activePanel, setActivePanel] = useState<IngestionPanel>("source");
  const [datasetPreview, setDatasetPreview] = useState<DatasetPreview | null>(null);
  const [streamLines, setStreamLines] = useState<string[]>([
    "$ waiting for dataset",
    "source: csv upload | kaggle connector pending",
  ]);
  const [activeStageIndex, setActiveStageIndex] = useState(0);
  const [iconFailed, setIconFailed] = useState(false);
  const [wordmarkFailed, setWordmarkFailed] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const streamTimerRef = useRef<number | null>(null);
  const schemaTimerRef = useRef<number | null>(null);
  const stageTimerRef = useRef<number | null>(null);

  const visibleMessages = useMemo(
    () => messages.filter((message) => message.role !== "system"),
    [messages],
  );
  const canRunDataset = Boolean(selectedFile && targetColumn.trim() && uploadStatus !== "running");
  const panelIndex = panelOrder.indexOf(activePanel);
  const profileRows = uploadResult?.rows ?? datasetPreview?.rowCount ?? null;
  const profileColumns = uploadResult?.columns ?? datasetPreview?.columnCount ?? null;
  const featureFamilies = useMemo(
    () => inferFeatureFamilies(datasetPreview, targetColumn),
    [datasetPreview, targetColumn],
  );
  const activeStageLabel =
    uploadStatus === "running"
      ? pendingStages[activeStageIndex]
      : uploadStatus === "searching"
        ? "searching ..."
      : uploadStatus === "reading"
        ? "ingesting ..."
        : uploadStatus === "complete"
          ? "profile ready"
          : uploadStatus === "failed"
            ? "blocked"
            : selectedFile
              ? "ready"
              : "idle";

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
    setChatError(null);

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

      appendAssistantMessage(data.message.content);
    } catch (caughtError) {
      const message =
        caughtError instanceof Error ? caughtError.message : "Unknown chat error.";
      setChatError(message);
    } finally {
      setIsSending(false);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }

  async function runDataset(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await submitDatasetRun();
  }

  async function submitDatasetRun() {
    if (!selectedFile && kaggleSlug.trim()) {
      showKagglePending();
      return;
    }

    if (!selectedFile || !targetColumn.trim()) {
      return;
    }

    const formData = new FormData();
    formData.append("file", selectedFile);
    formData.append("targetColumn", targetColumn.trim());

    if (intentPrompt.trim()) {
      formData.append("intentPrompt", intentPrompt.trim());
    }

    setUploadStatus("running");
    setUploadError(null);
    setUploadResult(null);
    setActivePanel("stream");
    clearStreamTimer();
    startStageLoop();
    startSchemaReplay();
    appendAssistantMessage(`Data Intake Agent: ingesting ${selectedFile.name}`);

    try {
      const response = await fetch("/api/lab/run", {
        method: "POST",
        body: formData,
      });
      const data = (await response.json()) as LabRunResponse;

      if (!response.ok) {
        throw new Error(data.details ?? data.error ?? "Dataset run failed.");
      }

      const normalized = normalizeLabRunResult(data, targetColumn);
      setUploadResult(normalized);
      setUploadStatus("complete");
      stopStageLoop();
      stopSchemaReplay();
      appendTraceMessages(normalized.trace);
      setStreamLines((current) => [
        ...current.slice(-28),
        ...createResultSchemaLines(normalized),
      ]);
      window.setTimeout(() => setActivePanel("profile"), 650);
    } catch (caughtError) {
      const message =
        caughtError instanceof Error ? caughtError.message : "Unknown dataset error.";
      setUploadError(message);
      setUploadStatus("failed");
      setActivePanel("stream");
      stopStageLoop();
      stopSchemaReplay();
      appendAssistantMessage(`Run blocked: ${message}`);
    }
  }

  function handleChatSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void sendMessage(draft);
  }

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    void acceptFile(file);
  }

  function handleDrop(event: DragEvent<HTMLButtonElement>) {
    event.preventDefault();
    const file = event.dataTransfer.files?.[0] ?? null;
    void acceptFile(file);
  }

  async function acceptFile(file: File | null) {
    clearStreamTimer();
    stopSchemaReplay();
    stopStageLoop();
    setSelectedFile(file);
    setUploadResult(null);
    setUploadError(null);
    setActivePanel("source");

    if (!file) {
      setUploadStatus("idle");
      setDatasetPreview(null);
      setStreamLines(["$ waiting for dataset", "source: csv upload | kaggle connector pending"]);
      return;
    }

    setUploadStatus("reading");
    appendAssistantMessage(`Dataset staged: ${file.name}`);

    try {
      const preview = await file.text();
      const parsedPreview = createDatasetPreview(preview);
      setDatasetPreview(parsedPreview);

      ["reading headers", "inferring target candidate", "profiling schema"].forEach(
        (message, index) => {
          window.setTimeout(() => {
            appendAssistantMessage(`Data Intake Agent: ${message}`);
          }, 240 + index * 430);
        },
      );

      window.setTimeout(() => setActivePanel("stream"), 420);
      animateStream([
        `$ open ${file.name}`,
        `bytes: ${file.size}`,
        `headers: ${parsedPreview.headers.join(", ") || "unknown"}`,
        `shape estimate: ${parsedPreview.rowCount} rows x ${parsedPreview.columnCount} columns`,
        "preview:",
        ...preview
          .split(/\r?\n/)
          .filter(Boolean)
          .slice(0, 30)
          .map((line, index) => `${String(index).padStart(3, "0")}  ${line}`),
        "$ inferred input contract",
        ...labRunContractLines,
        "$ ready for target column",
      ]);
    } catch (caughtError) {
      const message =
        caughtError instanceof Error ? caughtError.message : "Could not read CSV preview.";
      setUploadStatus("failed");
      setUploadError(message);
      appendAssistantMessage(`Dataset read blocked: ${message}`);
    }
  }

  async function loadDemoCsv() {
    const response = await fetch("/data/demo-insurance.csv");
    const csv = await response.text();
    const file = new File([csv], "demo-insurance.csv", { type: "text/csv" });
    setTargetColumn((current) => current || "charges");
    setIntentPrompt(
      (current) => current || "Create a model to predict insurance charges from the CSV dataset.",
    );
    await acceptFile(file);
  }

  function showKagglePending() {
    const slug = kaggleSlug.trim();

    clearStreamTimer();
    stopSchemaReplay();
    stopStageLoop();
    setActivePanel("source");
    setUploadStatus("searching");
    setUploadResult(null);
    setUploadError(null);
    appendAssistantMessage(
      slug
        ? `Kaggle connector pending for ${slug}. CSV upload is the active ingestion path in this frontend pass.`
        : "Kaggle connector pending. Enter owner/dataset or upload a CSV.",
    );
    setStreamLines((current) => [
      ...current.slice(-24),
      `$ kaggle pull ${slug || "owner/dataset"}`,
      "searching ...",
      "connector: pending backend credentials",
      "status: waiting for csv fallback",
    ]);
  }

  function guideWithAgent() {
    const prompt = selectedFile
      ? `Help me set up ${selectedFile.name} for an ML-Labs dataset run.`
      : "Help me choose and prepare a CSV dataset for ML-Labs Step 1.";

    void sendMessage(prompt);
  }

  function appendAssistantMessage(content: string) {
    setMessages((current) => [
      ...current,
      {
        id: crypto.randomUUID(),
        role: "assistant",
        content,
      },
    ]);
  }

  function appendTraceMessages(trace: AgentTraceItem[]) {
    const items = trace.length
      ? trace
      : [{ agent: "Report Agent", status: "complete", message: "Run completed." }];

    items.slice(0, 12).forEach((item, index) => {
      window.setTimeout(() => {
        appendAssistantMessage(
          `${item.agent ?? "Agent"} [${item.status ?? "complete"}]: ${item.message ?? "stage complete"}`,
        );
      }, index * 360);
    });
  }

  function animateStream(lines: string[]) {
    clearStreamTimer();
    setStreamLines([]);

    let index = 0;
    streamTimerRef.current = window.setInterval(() => {
      if (index >= lines.length) {
        clearStreamTimer();
        setUploadStatus((current) => (current === "reading" ? "idle" : current));
        return;
      }

      setStreamLines((current) => [...current.slice(-34), lines[index]]);
      index += 1;

      if (index >= lines.length) {
        clearStreamTimer();
        setUploadStatus((current) => (current === "reading" ? "idle" : current));
      }
    }, 55);
  }

  function startSchemaReplay() {
    stopSchemaReplay();
    setStreamLines((current) => [
      ...current.slice(-18),
      "$ analyzing ...",
      "schema: LabRunResult",
    ]);

    let index = 0;
    schemaTimerRef.current = window.setInterval(() => {
      setStreamLines((current) => [
        ...current.slice(-36),
        labRunContractLines[index % labRunContractLines.length],
      ]);
      index += 1;
    }, 90);
  }

  function startStageLoop() {
    stopStageLoop();
    setActiveStageIndex(0);
    stageTimerRef.current = window.setInterval(() => {
      setActiveStageIndex((current) => (current + 1) % pendingStages.length);
    }, 720);
  }

  function clearStreamTimer() {
    if (streamTimerRef.current !== null) {
      window.clearInterval(streamTimerRef.current);
      streamTimerRef.current = null;
    }
  }

  function stopSchemaReplay() {
    if (schemaTimerRef.current !== null) {
      window.clearInterval(schemaTimerRef.current);
      schemaTimerRef.current = null;
    }
  }

  function stopStageLoop() {
    if (stageTimerRef.current !== null) {
      window.clearInterval(stageTimerRef.current);
      stageTimerRef.current = null;
    }
  }

  return (
    <main className="ide-shell">
      <header className="topbar">
        <div className="brand brand-left">
          {iconFailed ? (
            <span className="brand-fallback">ML</span>
          ) : (
            <img
              src="/brand/ml-labs-icon.svg"
              alt="ML-Labs icon"
              onError={() => setIconFailed(true)}
            />
          )}
        </div>
        <div className="brand brand-right">
          {wordmarkFailed ? (
            <span className="brand-fallback">ML-Labs</span>
          ) : (
            <img
              src="/brand/ml-labs-wordmark.svg"
              alt="ML-Labs"
              onError={() => setWordmarkFailed(true)}
            />
          )}
        </div>
      </header>

      <section className="agent-panel" aria-label="Agent panel">
        <div className="pane-toolbar">
          <span className="toolbar-title">
            <Bot size={14} />
            agent
          </span>
          <span className="toolbar-status">local</span>
        </div>

        <div className="message-list" aria-live="polite">
          {visibleMessages.map((message) => (
            <article className={`message ${message.role}`} key={message.id}>
              <p>{message.content}</p>
            </article>
          ))}

          {isSending ? (
            <article className="message assistant pending">
              <p>thinking...</p>
            </article>
          ) : null}
        </div>

        {chatError ? <p className="error-banner">{chatError}</p> : null}

        <form className="composer" onSubmit={handleChatSubmit}>
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
            placeholder="Plan, build, / for commands, @ for context"
            rows={3}
          />
          <button aria-label="Send message" type="submit" disabled={isSending || draft.trim().length === 0}>
            <Send size={15} />
          </button>
        </form>
      </section>

      <section className="workbench-panel" aria-label="Dataset ingestion workbench">
        <div className="pane-toolbar">
          <span className="toolbar-title">
            <Database size={14} />
            dataset ingestion
          </span>
          <span className="toolbar-status">{activeStageLabel}</span>
        </div>

        <div className="panel-stack" aria-live="polite">
          <form
            className={`stage-panel source-panel ${getPanelClass("source", panelIndex)}`}
            onSubmit={runDataset}
          >
            <div className="stage-head">
              <span>01 source</span>
              <strong>{activePanel === "source" ? activeStageLabel : "configured"}</strong>
            </div>

            <div className="source-grid">
              <div className="source-card">
                <input
                  ref={fileInputRef}
                  className="file-input"
                  type="file"
                  accept=".csv,text/csv"
                  onChange={handleFileChange}
                  aria-hidden="true"
                  hidden
                  tabIndex={-1}
                />

                <button
                  className="dropzone"
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={handleDrop}
                >
                  <Upload size={16} />
                  <span>{selectedFile ? selectedFile.name : "select or drop csv"}</span>
                </button>

                <button className="secondary-action full-action" type="button" onClick={loadDemoCsv}>
                  <CirclePlay size={14} />
                  load demo csv
                </button>

                {selectedFile ? (
                  <div className="file-summary">
                    <FileText size={14} />
                    <span>{selectedFile.name}</span>
                    <small>{formatFileSize(selectedFile.size)}</small>
                  </div>
                ) : null}
              </div>

              <div className="source-card">
                <label className="field">
                  <span>kaggle slug</span>
                  <input
                    value={kaggleSlug}
                    onChange={(event) => setKaggleSlug(event.target.value)}
                    placeholder="owner/dataset"
                  />
                </label>

                <label className="field">
                  <span>target column</span>
                  <input
                    value={targetColumn}
                    onChange={(event) => setTargetColumn(event.target.value)}
                    placeholder="charges"
                  />
                </label>

                <label className="field intent-field">
                  <span>intent prompt</span>
                  <textarea
                    value={intentPrompt}
                    onChange={(event) => setIntentPrompt(event.target.value)}
                    placeholder="Create a model to predict the target column."
                    rows={3}
                  />
                </label>
              </div>
            </div>

            <div className="dataset-actions">
              <button className="secondary-action" type="button" onClick={showKagglePending}>
                <Braces size={14} />
                kaggle connector
              </button>
              <button className="secondary-action" type="button" onClick={guideWithAgent}>
                <MessageCircle size={14} />
                ask agent
              </button>
              <button className="primary-action" type="submit" disabled={!canRunDataset}>
                {uploadStatus === "running" ? <Loader2 className="spin" size={14} /> : <Terminal size={14} />}
                run dataset
              </button>
            </div>
          </form>

          <section className={`stage-panel stream-panel ${getPanelClass("stream", panelIndex)}`}>
            <div className="stage-head">
              <span>02 ingestion stream</span>
              <strong>{activePanel === "stream" ? activeStageLabel : "standing by"}</strong>
            </div>
            <div className="stream-status">
              <span>{activeStageLabel}</span>
              <i />
            </div>
            <pre aria-label="CSV ingestion stream">
              {streamLines.filter(Boolean).map((line, index) => (
                <code key={`${line}-${index}`}>{line}</code>
              ))}
            </pre>
            <div className="stream-actions">
              <button className="secondary-action" type="button" onClick={() => setActivePanel("source")}>
                edit source
              </button>
              <button
                aria-label="run streamed dataset"
                className="primary-action"
                type="button"
                disabled={!canRunDataset}
                onClick={submitDatasetRun}
              >
                {uploadStatus === "running" ? <Loader2 className="spin" size={14} /> : <Terminal size={14} />}
                run dataset
              </button>
            </div>
          </section>

          <section className={`stage-panel profile-panel ${getPanelClass("profile", panelIndex)}`}>
            <div className="stage-head">
              <span>03 dataset profile</span>
              <strong>{uploadStatus === "complete" ? "complete" : "awaiting backend"}</strong>
            </div>

            {uploadStatus === "failed" && uploadError ? (
              <p className="run-error">{uploadError}</p>
            ) : null}

            <div className="profile-grid">
              <Metric label="run" value={uploadResult?.runId ?? "pending"} />
              <Metric label="task" value={uploadResult?.problemType ?? "pending"} />
              <Metric
                label="shape"
                value={`${profileRows ?? "?"} x ${profileColumns ?? "?"}`}
              />
              <Metric label="target" value={(uploadResult?.targetColumn ?? targetColumn) || "unset"} />
              <Metric label="best" value={uploadResult?.bestModel ?? "pending"} />
              <Metric label="visuals" value={String(uploadResult?.visualizations ?? 0)} />
              <Metric label="artifacts" value={String(uploadResult?.artifacts ?? 0)} />
              <Metric label="schema" value={String(uploadResult?.schemaFields ?? 0)} />
            </div>

            <div className="feature-row">
              {featureFamilies.map((family) => (
                <span key={family}>{family}</span>
              ))}
            </div>

            <div className="preview-table-wrap">
              {datasetPreview ? (
                <table className="preview-table">
                  <thead>
                    <tr>
                      {datasetPreview.headers.slice(0, 6).map((header) => (
                        <th key={header}>{header}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {datasetPreview.rows.slice(0, 6).map((row, rowIndex) => (
                      <tr key={`${row.join("-")}-${rowIndex}`}>
                        {datasetPreview.headers.slice(0, 6).map((header, columnIndex) => (
                          <td key={`${header}-${columnIndex}`}>{row[columnIndex] ?? ""}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="empty-run">awaiting csv stream or kaggle connector</p>
              )}
            </div>
          </section>
        </div>
      </section>
    </main>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <span className="metric">
      <small>{label}</small>
      <strong>{value}</strong>
    </span>
  );
}

function getPanelClass(panel: IngestionPanel, activeIndex: number) {
  const index = panelOrder.indexOf(panel);

  if (index === activeIndex) {
    return "active";
  }

  return index < activeIndex ? "past" : "future";
}

function createDatasetPreview(csv: string): DatasetPreview {
  const rawRows = csv.split(/\r?\n/).filter((line) => line.trim().length > 0);
  const headers = parseCsvLine(rawRows[0] ?? "").map((value) => value.trim());
  const rows = rawRows.slice(1, 12).map((line) => parseCsvLine(line).map((value) => value.trim()));

  return {
    headers,
    rows,
    rowCount: Math.max(rawRows.length - 1, 0),
    columnCount: headers.length,
  };
}

function parseCsvLine(line: string) {
  const values: string[] = [];
  let current = "";
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    const nextCharacter = line[index + 1];

    if (character === '"' && nextCharacter === '"') {
      current += '"';
      index += 1;
    } else if (character === '"') {
      quoted = !quoted;
    } else if (character === "," && !quoted) {
      values.push(current);
      current = "";
    } else {
      current += character;
    }
  }

  values.push(current);
  return values;
}

function inferFeatureFamilies(preview: DatasetPreview | null, targetColumn: string) {
  if (!preview || preview.headers.length === 0) {
    return ["schema pending", "target pending", "model pending"];
  }

  const target = targetColumn.trim().toLowerCase();
  const featureHeaders = preview.headers.filter((header) => header.toLowerCase() !== target);
  const numericCount = featureHeaders.filter((header) => {
    const columnIndex = preview.headers.indexOf(header);
    return preview.rows
      .slice(0, 8)
      .filter((row) => row[columnIndex])
      .every((row) => !Number.isNaN(Number(row[columnIndex])));
  }).length;
  const categoricalCount = Math.max(featureHeaders.length - numericCount, 0);

  return [
    `${numericCount} numeric features`,
    `${categoricalCount} categorical features`,
    targetColumn.trim() ? `target: ${targetColumn.trim()}` : "target pending",
  ];
}

function createResultSchemaLines(result: NormalizedRun) {
  const score = result.score === null ? "null" : result.score.toFixed(3);

  return [
    "{",
    `  "runId": "${result.runId}",`,
    `  "scenario": "${result.scenario}",`,
    `  "datasetProfile": { "rows": ${result.rows ?? "null"}, "columns": ${
      result.columns ?? "null"
    }, "targetColumn": "${result.targetColumn}", "problemType": "${result.problemType}" },`,
    `  "agentTrace": [ ${result.trace.length} stages ],`,
    `  "leaderboard": [ "...models..." ],`,
    `  "bestModel": { "modelName": "${result.bestModel}", "metricName": "${result.metric}", "score": ${score} },`,
    `  "visualizations": [ ${result.visualizations} charts ],`,
    `  "predictionInputSchema": { "fields": ${result.schemaFields} },`,
    `  "artifacts": [ ${result.artifacts} files ],`,
    '  "finalReportMarkdown": "..."',
    "}",
    "status: backend trace complete",
  ];
}

function normalizeLabRunResult(result: LabRunResponse, fallbackTarget: string): NormalizedRun {
  const profile = result.datasetProfile ?? {};
  const schemaFields = countSchemaFields(result.predictionInputSchema);

  return {
    runId: result.runId ?? "local-run",
    scenario: result.scenario ?? profile.problemType ?? "unknown",
    problemType: profile.problemType ?? result.scenario ?? "unknown",
    rows: typeof profile.rows === "number" ? profile.rows : null,
    columns: typeof profile.columns === "number" ? profile.columns : null,
    targetColumn: profile.targetColumn ?? fallbackTarget,
    bestModel: result.bestModel?.modelName ?? "pending",
    metric: result.bestModel?.metricName ?? "metric",
    score: typeof result.bestModel?.score === "number" ? result.bestModel.score : null,
    visualizations: result.visualizations?.length ?? 0,
    artifacts: result.artifacts?.length ?? 0,
    schemaFields,
    trace: result.agentTrace ?? [],
  };
}

function countSchemaFields(schema: unknown) {
  if (!schema) {
    return 0;
  }

  if (Array.isArray(schema)) {
    return schema.length;
  }

  if (typeof schema === "object") {
    if ("fields" in schema && Array.isArray((schema as { fields?: unknown }).fields)) {
      return (schema as { fields: unknown[] }).fields.length;
    }

    return Object.keys(schema).length;
  }

  return 0;
}

function formatFileSize(bytes: number) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }

  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
