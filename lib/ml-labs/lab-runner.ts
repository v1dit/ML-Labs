import { promises as fs } from "node:fs";
import { existsSync } from "node:fs";
import { execFile } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import JSZip from "jszip";
import { buildCompleteRun } from "@/lib/ml-labs/report-generator";
import {
  prepareRuntimeBundle,
  removeRuntimeBundle,
  resolveRuntimeBundle,
  RuntimeBundleExpiredError,
  RuntimeBundleMissingError,
} from "@/lib/ml-labs/runtime-store";
import {
  createSourceBundle,
  resolveSourceBundle,
  saveSourceBundle,
  SourceBundleExpiredError,
  SourceBundleMissingError,
  sourceBundleHasRunnableCsv,
} from "@/lib/ml-labs/source-store";
import type {
  AgentTraceItem,
  CriticReport,
  DatasetProfile,
  LabPredictionResponse,
  LabRunResult,
  LeaderboardEntry,
  ProblemType,
  PythonInspectResult,
  PythonRunnerResult,
  SourceResolveResult,
  Visualization,
} from "@/lib/ml-labs/types";

const execFileAsync = promisify(execFile);

type BuildRunOptions = {
  runId: string;
  scenario?: ProblemType;
  intentPrompt?: string;
  sourceDescription?: string;
};

export async function runLab({
  file,
  kaggleDataset,
  kaggleFilePath,
  kaggleUrl,
  sourceToken,
  targetColumn,
  intentPrompt,
}: {
  file?: File;
  kaggleDataset?: string;
  kaggleFilePath?: string;
  kaggleUrl?: string;
  sourceToken?: string;
  targetColumn: string;
  intentPrompt?: string;
}): Promise<LabRunResult> {
  if (!targetColumn.trim()) {
    throw new Error("A target column is required.");
  }

  if (!file && !kaggleDataset && !kaggleUrl && !sourceToken) {
    throw new Error("Provide a source token, CSV file upload, or a Kaggle dataset URL/slug.");
  }

  if (file && !file.name.toLowerCase().endsWith(".csv")) {
    throw new Error("Only CSV uploads are supported in this MVP.");
  }

  const runId = buildRunId(targetColumn);
  const resolvedSource = sourceToken ? await resolveSourceBundle(sourceToken) : null;
  if (resolvedSource && !sourceBundleHasRunnableCsv(resolvedSource)) {
    throw new Error("Choose a Kaggle CSV table before starting the run.");
  }
  const tempDir = file ? await fs.mkdtemp(path.join(os.tmpdir(), "ml-labs-")) : null;
  const tempFilePath = file && tempDir ? path.join(tempDir, sanitizeFilename(file.name)) : null;
  const bundleDir = await prepareRuntimeBundle(runId);

  try {
    if (file && tempFilePath) {
      const fileBuffer = Buffer.from(await file.arrayBuffer());
      await fs.writeFile(tempFilePath, fileBuffer);
    }

    const runnerResult = await executePythonTrain({
      bundleDir,
      csvPath: resolvedSource?.csvPath ?? tempFilePath ?? undefined,
      intentPrompt,
      kaggleDataset,
      kaggleFilePath,
      kaggleUrl,
      runId,
      targetColumn,
    });

    return buildLabRunFromRunnerResult(runnerResult, {
      runId,
      scenario: runnerResult.datasetProfile.problemType,
      intentPrompt,
      sourceDescription:
        resolvedSource?.sourceLabel ??
        runnerResult.metadata?.sourceLabel ??
        describeSource({
          file,
          kaggleDataset,
          kaggleFilePath,
          kaggleUrl,
        }),
    });
  } catch (error) {
    await removeRuntimeBundle(runId);
    throw error;
  } finally {
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  }
}

export async function predictLabRun({
  input,
  runId,
}: {
  input: Record<string, unknown>;
  runId: string;
}): Promise<LabPredictionResponse> {
  const bundleDir = await resolveRuntimeBundle(runId);
  return executePythonPredict({ bundleDir, input, runId });
}

export async function resolveLabSource({
  file,
  kaggleInput,
  selectedFilePath,
}: {
  file?: File;
  kaggleInput?: string;
  selectedFilePath?: string;
}): Promise<SourceResolveResult> {
  if (!file && !kaggleInput?.trim()) {
    throw new Error("Provide either a CSV file upload or a Kaggle reference to resolve.");
  }

  if (file && !isSupportedSourceUpload(file.name)) {
    throw new Error("Only CSV or ZIP uploads are supported for source resolution.");
  }

  const { sourceToken, sourceDir } = await createSourceBundle();
  let sourceFilePath = file ? path.join(sourceDir, sanitizeFilename(file.name)) : undefined;

  try {
    if (file && sourceFilePath) {
      if (file.name.toLowerCase().endsWith(".zip")) {
        sourceFilePath = await extractLargestCsvFromZip(file, sourceDir);
      } else {
        const fileBuffer = Buffer.from(await file.arrayBuffer());
        await fs.writeFile(sourceFilePath, fileBuffer);
      }
    }

    const inspectResult = await executePythonInspect({
      csvPath: sourceFilePath,
      kaggleInput,
      selectedFilePath,
    });

    return saveSourceBundle(sourceToken, inspectResult);
  } catch (error) {
    await fs.rm(sourceDir, { recursive: true, force: true });
    throw error;
  }
}

export function buildLabRunFromRunnerResult(
  runnerResult: PythonRunnerResult,
  options: BuildRunOptions,
): LabRunResult {
  const leaderboard = normalizeLeaderboard(runnerResult.leaderboard);
  const visualizations = ensureProfileVisualizations(
    runnerResult.datasetProfile,
    normalizeVisualizations(runnerResult.visualizations),
  );
  const agentTrace = buildAgentTrace(
    runnerResult.datasetProfile,
    leaderboard,
    runnerResult.criticReport,
    runnerResult.metadata?.modelFailures ?? [],
    options.sourceDescription ?? runnerResult.metadata?.sourceLabel ?? "the dataset source",
  );

  return buildCompleteRun(
    {
      runId: options.runId,
      scenario: options.scenario ?? runnerResult.datasetProfile.problemType,
      intentPrompt: options.intentPrompt,
      datasetProfile: runnerResult.datasetProfile,
      leaderboard,
      criticReport: runnerResult.criticReport,
      predictionInputSchema: runnerResult.predictionInputSchema,
      targetCardinality: runnerResult.metadata?.targetCardinality,
    },
    {
      agentTrace,
      visualizations,
    },
  );
}

export {
  RuntimeBundleExpiredError,
  RuntimeBundleMissingError,
  SourceBundleExpiredError,
  SourceBundleMissingError,
};

async function executePythonTrain({
  bundleDir,
  csvPath,
  intentPrompt,
  kaggleDataset,
  kaggleFilePath,
  kaggleUrl,
  runId,
  targetColumn,
}: {
  bundleDir: string;
  csvPath?: string;
  intentPrompt?: string;
  kaggleDataset?: string;
  kaggleFilePath?: string;
  kaggleUrl?: string;
  runId: string;
  targetColumn: string;
}): Promise<PythonRunnerResult> {
  const args = ["train", "--target", targetColumn, "--run-id", runId, "--bundle-dir", bundleDir];

  if (csvPath) {
    args.push("--csv", csvPath);
  }

  if (kaggleDataset) {
    args.push("--kaggle-dataset", kaggleDataset);
  }

  if (kaggleUrl) {
    args.push("--kaggle-url", kaggleUrl);
  }

  if (kaggleFilePath) {
    args.push("--kaggle-file-path", kaggleFilePath);
  }

  if (intentPrompt) {
    args.push("--intent", intentPrompt);
  }

  return executePythonCommand<PythonRunnerResult>(args);
}

async function executePythonInspect({
  csvPath,
  kaggleInput,
  selectedFilePath,
}: {
  csvPath?: string;
  kaggleInput?: string;
  selectedFilePath?: string;
}): Promise<PythonInspectResult> {
  const args = ["inspect"];

  if (csvPath) {
    args.push("--csv", csvPath);
  }

  if (kaggleInput) {
    args.push("--kaggle-input", kaggleInput);
  }

  if (selectedFilePath) {
    args.push("--selected-file-path", selectedFilePath);
  }

  return executePythonCommand<PythonInspectResult>(args);
}

async function executePythonPredict({
  bundleDir,
  input,
  runId,
}: {
  bundleDir: string;
  input: Record<string, unknown>;
  runId: string;
}): Promise<LabPredictionResponse> {
  const response = await executePythonCommand<LabPredictionResponse>([
    "predict",
    "--bundle-dir",
    bundleDir,
    "--run-id",
    runId,
    "--input-json",
    JSON.stringify(input),
  ]);

  return response;
}

async function executePythonCommand<T>(args: string[]): Promise<T> {
  const projectRoot = process.cwd();
  const pythonExecutable = process.env.ML_LABS_PYTHON || preferredPythonBinary(projectRoot);
  const scriptPath = path.join(projectRoot, "scripts", "ml_labs_runner.py");

  try {
    const { stdout } = await execFileAsync(pythonExecutable, [scriptPath, ...args], {
      cwd: projectRoot,
      env: process.env,
      maxBuffer: 10 * 1024 * 1024,
    });

    return JSON.parse(stdout) as T;
  } catch (error) {
    const stderr =
      typeof error === "object" && error !== null && "stderr" in error
        ? String(error.stderr ?? "")
        : "";
    const cleanedStderr = extractPythonFailure(stderr);
    const message =
      cleanedStderr ||
      (error instanceof Error ? error.message : "The Python experiment engine failed unexpectedly.");
    throw new Error(`ML-Labs Python runner failed: ${message}`);
  }
}

function normalizeLeaderboard(entries: LeaderboardEntry[]): LeaderboardEntry[] {
  const sorted = [...entries].sort((left, right) => right.score - left.score);
  const baseline =
    sorted.find((entry) => entry.family.toLowerCase() === "baseline") ?? sorted[sorted.length - 1];

  return sorted.map((entry) => ({
    ...entry,
    score: round(entry.score),
    trainScore: entry.trainScore !== undefined ? round(entry.trainScore) : undefined,
    testScore: entry.testScore !== undefined ? round(entry.testScore) : undefined,
    improvementOverBaseline: round(entry.score - baseline.score),
  }));
}

function buildAgentTrace(
  datasetProfile: DatasetProfile,
  leaderboard: LeaderboardEntry[],
  criticReport: CriticReport,
  modelFailures: string[],
  sourceDescription: string,
): AgentTraceItem[] {
  const bestModel = leaderboard[0];
  const warningStatus = criticReport.warnings.length > 0 ? "warning" : "complete";

  const trace: AgentTraceItem[] = [
    {
      agent: "Data Intake Agent",
      stageId: "source-intake",
      status: "complete",
      message: `Ingested ${datasetProfile.rows} rows across ${datasetProfile.columns} columns from ${sourceDescription}.`,
    },
    {
      agent: "Source Resolution Agent",
      stageId: "source-resolution",
      status: "complete",
      message: `Resolved the dataset source and validated the working table before training on target "${datasetProfile.targetColumn}".`,
    },
    {
      agent: "Data Profiling Agent",
      stageId: "schema-profiling",
      status: "complete",
      message: `Separated ${datasetProfile.numericColumns.length} numeric and ${datasetProfile.categoricalColumns.length} categorical features.`,
    },
    {
      agent: "Problem Framing Agent",
      stageId: "target-framing",
      status: "complete",
      message: `Selected ${metricDescription(datasetProfile.problemType)} as the primary evaluation frame for the lab run.`,
    },
    {
      agent: "Feature Planning Agent",
      stageId: "preprocessing",
      status: "complete",
      message:
        "Prepared numeric median imputation and categorical one-hot encoding inside a consistent train-test pipeline.",
    },
    {
      agent: "Baseline Agent",
      stageId: "baseline",
      status: "complete",
      message: "Benchmarked the baseline before the broader model family sweep.",
    },
  ];

  leaderboard
    .filter((entry) => entry.family.toLowerCase() !== "baseline")
    .forEach((entry) => {
      trace.push({
        agent: `${entry.family} Agent`,
        stageId: familyToStageId(entry.family),
        status: "complete",
        message: `${entry.modelName} finished with ${entry.metricName} ${entry.score.toFixed(3)} on held-out data.`,
      });
    });

  modelFailures.forEach((failure) => {
    trace.push({
      agent: "Fallback Modeling Agent",
      stageId: "fallback",
      status: "warning",
      message: failure,
    });
  });

  trace.push(
    {
      agent: "Evaluation Agent",
      stageId: "evaluation",
      status: "complete",
      message: `${bestModel.modelName} won the leaderboard and anchors the final summary.`,
    },
    {
      agent: "Critic Agent",
      stageId: "critic",
      status: warningStatus,
      message:
        criticReport.nextExperiments[0] ??
        "The critic found no severe blockers and produced a clean export package.",
    },
    {
      agent: "Report Agent",
      stageId: "export",
      status: "complete",
      message: "Generated report markdown plus runnable code artifacts for export.",
    },
  );

  return trace;
}

function normalizeVisualizations(visualizations: Visualization[]): Visualization[] {
  return visualizations.map((visualization, index) => ({
    ...visualization,
    id: visualization.id || `viz-${index + 1}`,
    stageId: normalizeVisualizationStageId(visualization.stageId),
    data: visualization.data,
  }));
}

function ensureProfileVisualizations(
  datasetProfile: DatasetProfile,
  visualizations: Visualization[],
): Visualization[] {
  const hasFeatureBreakdown = visualizations.some(
    (visualization) => visualization.type === "feature_type_breakdown",
  );

  if (hasFeatureBreakdown) {
    return visualizations;
  }

  return [
    {
      id: "feature-type-breakdown",
      stageId: "schema-profiling",
      type: "feature_type_breakdown",
      title: "Feature family breakdown",
      data: [
        {
          label: "numeric",
          count: datasetProfile.numericColumns.length,
          ratio:
            datasetProfile.columns > 1
              ? datasetProfile.numericColumns.length / (datasetProfile.columns - 1)
              : 0,
        },
        {
          label: "categorical",
          count: datasetProfile.categoricalColumns.length,
          ratio:
            datasetProfile.columns > 1
              ? datasetProfile.categoricalColumns.length / (datasetProfile.columns - 1)
              : 0,
        },
      ],
    },
    ...visualizations,
  ];
}

function preferredPythonBinary(projectRoot: string): string {
  const localPython = path.join(projectRoot, ".venv", "bin", "python");
  return existsSync(localPython) ? localPython : "python3";
}

function buildRunId(targetColumn: string): string {
  return `lab-${targetColumn.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${Date.now()}`;
}

function sanitizeFilename(filename: string): string {
  return filename.replace(/[^a-zA-Z0-9._-]/g, "_");
}

function isSupportedSourceUpload(filename: string): boolean {
  const lowered = filename.toLowerCase();
  return lowered.endsWith(".csv") || lowered.endsWith(".zip");
}

async function extractLargestCsvFromZip(file: File, sourceDir: string): Promise<string> {
  const zip = await JSZip.loadAsync(Buffer.from(await file.arrayBuffer()));
  const csvEntries = Object.values(zip.files).filter(
    (entry) => !entry.dir && entry.name.toLowerCase().endsWith(".csv"),
  );

  if (!csvEntries.length) {
    throw new Error("The uploaded ZIP does not contain any CSV files.");
  }

  const rankedEntries = await Promise.all(
    csvEntries.map(async (entry) => ({
      entry,
      size: (await entry.async("uint8array")).byteLength,
    })),
  );
  const largest = rankedEntries.sort((left, right) => right.size - left.size)[0];
  const basename = path.basename(largest.entry.name);
  const outputPath = path.join(sourceDir, `zip-${sanitizeFilename(basename)}`);
  await fs.writeFile(outputPath, Buffer.from(await largest.entry.async("uint8array")));
  return outputPath;
}

function describeSource({
  file,
  kaggleDataset,
  kaggleFilePath,
  kaggleUrl,
}: {
  file?: File;
  kaggleDataset?: string;
  kaggleFilePath?: string;
  kaggleUrl?: string;
}): string {
  if (file) {
    return "the uploaded CSV";
  }

  const datasetIdentifier = kaggleDataset ?? kaggleUrl;
  if (!datasetIdentifier) {
    return "the dataset source";
  }

  const fileSuffix = kaggleFilePath ? ` (${kaggleFilePath})` : "";
  return `Kaggle dataset "${datasetIdentifier}"${fileSuffix}`;
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function familyToStageId(family: string): string {
  const normalized = family.toLowerCase();
  if (normalized.includes("linear")) {
    return "linear-model";
  }

  if (normalized.includes("boost")) {
    return "boosted-model";
  }

  if (normalized.includes("tree") || normalized.includes("forest")) {
    return "tree-model";
  }

  return "modeling";
}

function metricDescription(problemType: ProblemType): string {
  return problemType === "classification"
    ? "classification accuracy and ranking diagnostics"
    : "regression fit and residual diagnostics";
}

function extractPythonFailure(stderr: string): string {
  const normalized = stderr.trim();
  if (!normalized) {
    return "";
  }

  const lines = normalized
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const labeledLine = [...lines]
    .reverse()
    .find((line) => /^(Key|Runtime|Type|Value)Error:/.test(line));

  if (labeledLine) {
    return labeledLine.replace(/^[A-Za-z]+Error:\s*/, "");
  }

  return lines[lines.length - 1] ?? normalized;
}

function normalizeVisualizationStageId(stageId?: string): string | undefined {
  if (!stageId) {
    return undefined;
  }

  const mapping: Record<string, string> = {
    profiling: "schema-profiling",
    framing: "target-framing",
    evaluation: "evaluation",
    packaging: "export",
    "schema-validation": "source-resolution",
  };

  return mapping[stageId] ?? stageId;
}
