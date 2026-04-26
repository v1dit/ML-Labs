"use client";

import { startTransition, useEffect, useRef, useState } from "react";
import Papa, { type ParseResult } from "papaparse";
import { ResultPanel } from "@/components/ml-labs/result-panel";
import { SourcePanel } from "@/components/ml-labs/source-panel";
import { StreamPanel } from "@/components/ml-labs/stream-panel";
import {
  buildAnalyzingMessages,
  buildArtifactTabs,
  buildCriticBlocks,
  buildDatasetMetricCards,
  buildInitialMessages,
  buildLeaderboardRows,
  buildSchemaStreamLines,
  buildTraceReplay,
  buildVisualizationViewModels,
  previewRowsToLines,
  type DatasetPreview,
  type SourceMode,
  type WorkbenchMessage,
} from "@/lib/ml-labs/workbench-normalizer";
import type { LabRunError, LabRunResult } from "@/lib/ml-labs/types";

type RunStage = "idle" | "source_ready" | "ingesting" | "analyzing" | "complete" | "error";

const DEFAULT_INTENT =
  "Build a reliable model, surface the strongest signals, and package the outcome like an agentic research pass.";
const DEMO_DATASET_PATH = "/data/demo-churn.csv";
const DEMO_TARGET_COLUMN = "churn";
const DEMO_KAGGLE_REFERENCE = "waddahali/kaggle-competition-graph-dataset";
const STATIC_SCHEMA_LINES = [
  "{",
  '  "runId": "pending",',
  '  "datasetProfile": { "rows": "...", "columns": "...", "problemType": "..." },',
  '  "leaderboard": [ "baseline", "linear", "tree", "boosted" ],',
  '  "bestModel": { "modelName": "...", "score": "..." },',
  '  "visualizations": [ "pending" ],',
  '  "artifacts": [ "pending" ]',
  "}",
];

export function MlWorkbench() {
  const [sourceMode, setSourceMode] = useState<SourceMode>("demo");
  const [runStage, setRunStage] = useState<RunStage>("idle");
  const [intentPrompt, setIntentPrompt] = useState(DEFAULT_INTENT);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<DatasetPreview | null>(null);
  const [targetColumn, setTargetColumn] = useState("");
  const [kaggleReference, setKaggleReference] = useState(DEMO_KAGGLE_REFERENCE);
  const [kaggleFilePath, setKaggleFilePath] = useState("");
  const [messages, setMessages] = useState<WorkbenchMessage[]>([]);
  const [streamLines, setStreamLines] = useState<string[]>([]);
  const [result, setResult] = useState<LabRunResult | null>(null);
  const [selectedArtifactId, setSelectedArtifactId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const scheduledWork = useRef<number[]>([]);

  useEffect(() => () => clearScheduledWork(scheduledWork.current), []);

  const metricCards = result ? buildDatasetMetricCards(result) : [];
  const visualizations = result ? buildVisualizationViewModels(result) : [];
  const artifactTabs = result ? buildArtifactTabs(result) : [];
  const criticBlocks = result ? buildCriticBlocks(result) : [];
  const leaderboard = result ? buildLeaderboardRows(result) : [];

  const canRun =
    sourceMode === "kaggle"
      ? Boolean(kaggleReference.trim() && targetColumn.trim())
      : Boolean(selectedFile && targetColumn.trim());

  const statusLabel = resolveSourceStatus(runStage, sourceMode);
  const streamTitle = runStage === "complete" ? "Experiment trace" : "Ingestion stream";

  async function handleFileSelected(file: File | null) {
    clearScheduledWork(scheduledWork.current);
    setErrorMessage(null);
    setResult(null);
    setSelectedArtifactId(null);
    setSelectedFile(file);
    setMessages([]);
    setStreamLines([]);
    setPreview(null);

    if (!file) {
      setTargetColumn("");
      setRunStage("idle");
      return;
    }

    setRunStage("ingesting");
    setMessages(buildInitialMessages("upload"));

    try {
      const parsedPreview = await parsePreview(file);
      setPreview(parsedPreview);
      setStreamLines(previewRowsToLines(parsedPreview));
      setTargetColumn((currentTarget) => currentTarget || parsedPreview.headers[parsedPreview.headers.length - 1] || "");
      scheduleSourceReady();
    } catch (error) {
      const details = error instanceof Error ? error.message : "Failed to parse the selected CSV.";
      setErrorMessage(details);
      setMessages([
        {
          id: "upload-error",
          label: "Parser",
          text: details,
          tone: "warning",
        },
      ]);
      setRunStage("error");
    }
  }

  async function handleLoadDemoCsv() {
    clearScheduledWork(scheduledWork.current);
    setErrorMessage(null);
    setResult(null);
    setSelectedArtifactId(null);
    setRunStage("ingesting");
    setMessages(buildInitialMessages("demo"));

    try {
      const response = await fetch(DEMO_DATASET_PATH);
      const blob = await response.blob();
      const file = new File([blob], "demo-churn.csv", { type: "text/csv" });
      const parsedPreview = await parsePreview(file);

      setSelectedFile(file);
      setPreview(parsedPreview);
      setTargetColumn(DEMO_TARGET_COLUMN);
      setStreamLines(previewRowsToLines(parsedPreview));
      scheduleSourceReady();
    } catch (error) {
      const details = error instanceof Error ? error.message : "Failed to load the demo CSV.";
      setErrorMessage(details);
      setMessages([
        {
          id: "demo-error",
          label: "Loader",
          text: details,
          tone: "warning",
        },
      ]);
      setRunStage("error");
    }
  }

  function handleSourceModeChange(mode: SourceMode) {
    clearScheduledWork(scheduledWork.current);
    setSourceMode(mode);
    setRunStage("idle");
    setSelectedFile(null);
    setPreview(null);
    setMessages([]);
    setStreamLines([]);
    setResult(null);
    setSelectedArtifactId(null);
    setErrorMessage(null);
    setKaggleFilePath("");
    setTargetColumn(mode === "demo" ? DEMO_TARGET_COLUMN : "");
  }

  function handleKaggleReferenceChange(value: string) {
    setKaggleReference(value);

    if (!value.trim()) {
      if (runStage !== "analyzing") {
        setRunStage("idle");
        setMessages([]);
        setStreamLines([]);
      }
      return;
    }

    if (runStage !== "analyzing") {
      setRunStage("source_ready");
      setMessages(buildInitialMessages("kaggle"));
      setStreamLines([
        "connector.pending = true",
        `source.reference = "${value.trim()}"`,
        'source.mode = "kaggle"',
      ]);
    }
  }

  async function handleRun() {
    if (!canRun) {
      return;
    }

    clearScheduledWork(scheduledWork.current);
    setErrorMessage(null);
    setResult(null);
    setSelectedArtifactId(null);
    setRunStage("analyzing");
    setMessages(buildAnalyzingMessages(sourceMode));
    setStreamLines(sourceMode === "kaggle" ? buildKagglePendingLines() : [...previewRowsToLines(preview ?? emptyPreview()), "---", ...STATIC_SCHEMA_LINES]);

    scheduleStaticSchemaReplay();

    try {
      const response = await fetch("/api/lab/run", {
        method: "POST",
        body: buildRunRequest({
          sourceMode,
          selectedFile,
          targetColumn,
          intentPrompt,
          kaggleReference,
          kaggleFilePath,
        }),
      });

      const payload = (await response.json()) as LabRunResult | LabRunError;
      if (!response.ok) {
        throw new Error(payload.details ?? payload.error ?? "Dataset run failed.");
      }

      const labRunResult = payload as LabRunResult;
      startTransition(() => {
        setResult(labRunResult);
        const initialArtifact = buildArtifactTabs(labRunResult)[0];
        setSelectedArtifactId(initialArtifact?.id ?? null);
      });
      replayBackendResult(labRunResult);
    } catch (error) {
      const details = error instanceof Error ? error.message : "Dataset run failed unexpectedly.";
      setErrorMessage(details);
      setRunStage("error");
      setMessages((current) => [
        ...current,
        {
          id: `run-error-${current.length + 1}`,
          label: "Runner",
          text: details,
          tone: "warning",
        },
      ]);
      setStreamLines((current) => [...current, `error.details = "${details}"`]);
    }
  }

  function replayBackendResult(labRunResult: LabRunResult) {
    const traceMessages = buildTraceReplay(labRunResult);
    const schemaLines = buildSchemaStreamLines(labRunResult);

    clearScheduledWork(scheduledWork.current);
    setStreamLines([]);

    schemaLines.forEach((line, index) => {
      schedule(() => {
        setStreamLines((current) => [...current, line]);
      }, 80 * (index + 1));
    });

    traceMessages.forEach((message, index) => {
      schedule(() => {
        setMessages((current) => [...current, message]);
      }, 180 * (index + 1));
    });

    schedule(() => {
      setRunStage("complete");
    }, Math.max(schemaLines.length * 80, traceMessages.length * 180) + 280);
  }

  function scheduleStaticSchemaReplay() {
    setStreamLines(sourceMode === "kaggle" ? buildKagglePendingLines() : previewRowsToLines(preview ?? emptyPreview()));

    STATIC_SCHEMA_LINES.forEach((line, index) => {
      schedule(() => {
        setStreamLines((current) => [...current, line]);
      }, 90 * (index + 1));
    });
  }

  function scheduleSourceReady() {
    schedule(() => {
      setRunStage("source_ready");
    }, 420);
  }

  function schedule(callback: () => void, delayMs: number) {
    const handle = window.setTimeout(callback, delayMs);
    scheduledWork.current.push(handle);
  }

  return (
    <main className="ide-shell">
      <section className="hero-shell">
        <div className="hero-copy">
          <span className="hero-kicker">ML-Labs</span>
          <h1>Autonomous dataset workbench</h1>
          <p>
            Load a dataset source, watch the ingestion surface come alive, then let the
            lab snap into a structured profile with models, evidence, and reusable
            artifacts.
          </p>
        </div>
        <div className="hero-summary">
          <article>
            <span>Source modes</span>
            <strong>Upload · Demo · Kaggle</strong>
          </article>
          <article>
            <span>Run contract</span>
            <strong>Shared with real backend</strong>
          </article>
          <article>
            <span>Current stage</span>
            <strong>{statusLabel}</strong>
          </article>
        </div>
      </section>

      <section className="workbench-shell">
        <div className={runStage === "idle" ? "panel-shell active" : "panel-shell background"}>
          <SourcePanel
            sourceMode={sourceMode}
            preview={preview}
            intentPrompt={intentPrompt}
            kaggleReference={kaggleReference}
            kaggleFilePath={kaggleFilePath}
            targetColumn={targetColumn}
            statusLabel={statusLabel}
            isBusy={runStage === "analyzing"}
            canRun={canRun}
            onSourceModeChange={handleSourceModeChange}
            onIntentPromptChange={setIntentPrompt}
            onKaggleReferenceChange={handleKaggleReferenceChange}
            onKaggleFilePathChange={setKaggleFilePath}
            onTargetColumnChange={setTargetColumn}
            onFileSelected={handleFileSelected}
            onLoadDemoCsv={handleLoadDemoCsv}
            onRun={handleRun}
          />
        </div>

        <div
          className={
            runStage === "idle" ? "panel-shell hidden" : runStage === "complete" ? "panel-shell background" : "panel-shell active"
          }
        >
          <StreamPanel
            title={streamTitle}
            status={runStage === "analyzing" ? "analyzing ..." : statusLabel}
            messages={messages}
            streamLines={streamLines}
            isVisible={runStage !== "idle"}
            isFocused={runStage !== "complete"}
          />
        </div>

        <div className={runStage === "complete" ? "panel-shell active" : "panel-shell hidden"}>
          <ResultPanel
            result={result}
            metricCards={metricCards}
            leaderboard={leaderboard}
            criticBlocks={criticBlocks}
            artifactTabs={artifactTabs}
            selectedArtifactId={selectedArtifactId}
            onArtifactSelect={setSelectedArtifactId}
            visualizations={visualizations}
            isVisible={runStage === "complete"}
            isFocused={runStage === "complete"}
          />
        </div>
      </section>

      {errorMessage ? (
        <section className="error-banner">
          <span>Error</span>
          <p>{errorMessage}</p>
        </section>
      ) : null}
    </main>
  );
}

async function parsePreview(file: File): Promise<DatasetPreview> {
  return new Promise((resolve, reject) => {
    Papa.parse<string[]>(file, {
      preview: 31,
      skipEmptyLines: true,
      complete: (results: ParseResult<string[]>) => {
        const rows = results.data.filter((row) => Array.isArray(row) && row.some((cell) => `${cell}`.trim().length > 0));
        const headers = rows[0] ?? [];
        const previewRows = rows.slice(1, 31).map((row) => headers.map((_, index) => `${row[index] ?? ""}`));

        if (!headers.length) {
          reject(new Error("The CSV preview did not contain any readable headers."));
          return;
        }

        resolve({
          filename: file.name,
          headers: headers.map((header) => `${header}`),
          rows: previewRows,
        });
      },
      error: (error) => reject(error),
    });
  });
}

function buildRunRequest({
  sourceMode,
  selectedFile,
  targetColumn,
  intentPrompt,
  kaggleReference,
  kaggleFilePath,
}: {
  sourceMode: SourceMode;
  selectedFile: File | null;
  targetColumn: string;
  intentPrompt: string;
  kaggleReference: string;
  kaggleFilePath: string;
}) {
  const formData = new FormData();
  formData.set("targetColumn", targetColumn.trim());
  formData.set("intentPrompt", intentPrompt.trim());

  if (sourceMode === "kaggle") {
    if (kaggleReference.includes("kaggle.com/")) {
      formData.set("kaggleUrl", kaggleReference.trim());
    } else {
      formData.set("kaggleDataset", kaggleReference.trim());
    }

    if (kaggleFilePath.trim()) {
      formData.set("kaggleFilePath", kaggleFilePath.trim());
    }

    return formData;
  }

  if (selectedFile) {
    formData.set("file", selectedFile, selectedFile.name);
  }

  return formData;
}

function clearScheduledWork(handles: number[]) {
  handles.forEach((handle) => window.clearTimeout(handle));
  handles.length = 0;
}

function resolveSourceStatus(runStage: RunStage, sourceMode: SourceMode): string {
  if (runStage === "ingesting") {
    return "ingesting ...";
  }

  if (runStage === "analyzing") {
    return sourceMode === "kaggle" ? "searching ..." : "analyzing ...";
  }

  if (runStage === "complete") {
    return "complete";
  }

  if (runStage === "error") {
    return "error";
  }

  if (runStage === "source_ready") {
    return sourceMode === "kaggle" ? "connector staged" : "ready";
  }

  return "ready";
}

function buildKagglePendingLines(): string[] {
  return [
    'connector.state = "searching"',
    'source.kind = "kaggle"',
    "source.files = resolving",
    "schema.preview = deferred_to_backend",
  ];
}

function emptyPreview(): DatasetPreview {
  return {
    filename: "pending.csv",
    headers: [],
    rows: [],
  };
}
