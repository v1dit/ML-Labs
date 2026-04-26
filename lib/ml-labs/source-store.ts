import { promises as fs } from "node:fs";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type {
  PythonInspectResult,
  ResolvedSourceFile,
  ResolvedSourceKind,
  SourceResolveResult,
  TargetSuggestion,
} from "@/lib/ml-labs/types";

const SOURCE_ROOT = path.join(os.tmpdir(), "ml-labs-source-bundles");
const SOURCE_METADATA_FILE = "source-metadata.json";
const SOURCE_TTL_MS = 2 * 60 * 60 * 1000;
const MAX_SOURCE_BUNDLES = 20;

type SourceMetadata = {
  createdAtEpochMs: number;
  sourceKind: ResolvedSourceKind;
  sourceLabel: string;
  normalizedKaggleDataset?: string;
  selectedFilePath?: string;
  candidateFiles: ResolvedSourceFile[];
  headers: string[];
  previewRows: string[][];
  targetSuggestions: TargetSuggestion[];
  messages: SourceResolveResult["messages"];
  csvPath?: string;
};

export class SourceBundleExpiredError extends Error {
  constructor(sourceToken: string) {
    super(`Source token '${sourceToken}' has expired. Resolve the dataset again.`);
    this.name = "SourceBundleExpiredError";
  }
}

export class SourceBundleMissingError extends Error {
  constructor(sourceToken: string) {
    super(`Source token '${sourceToken}' was not found.`);
    this.name = "SourceBundleMissingError";
  }
}

export async function createSourceBundle(): Promise<{
  sourceToken: string;
  sourceDir: string;
}> {
  await ensureSourceRoot();
  await cleanupSourceBundles();

  const sourceToken = `source-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const sourceDir = getSourceBundleDir(sourceToken);
  await fs.mkdir(sourceDir, { recursive: true });

  return { sourceToken, sourceDir };
}

export async function saveSourceBundle(
  sourceToken: string,
  inspectResult: PythonInspectResult,
): Promise<SourceResolveResult> {
  await ensureSourceRoot();
  const sourceDir = getSourceBundleDir(sourceToken);
  const metadata: SourceMetadata = {
    createdAtEpochMs: Date.now(),
    sourceKind: inspectResult.sourceKind,
    sourceLabel: inspectResult.sourceLabel,
    normalizedKaggleDataset: inspectResult.normalizedKaggleDataset,
    selectedFilePath: inspectResult.selectedFilePath,
    candidateFiles: inspectResult.candidateFiles,
    headers: inspectResult.headers,
    previewRows: inspectResult.previewRows,
    targetSuggestions: inspectResult.targetSuggestions,
    messages: inspectResult.messages,
    csvPath: inspectResult.csvPath,
  };

  await fs.writeFile(
    path.join(sourceDir, SOURCE_METADATA_FILE),
    JSON.stringify(metadata, null, 2),
    "utf8",
  );

  return {
    sourceToken,
    sourceKind: metadata.sourceKind,
    sourceLabel: metadata.sourceLabel,
    normalizedKaggleDataset: metadata.normalizedKaggleDataset,
    selectedFilePath: metadata.selectedFilePath,
    candidateFiles: metadata.candidateFiles,
    headers: metadata.headers,
    previewRows: metadata.previewRows,
    targetSuggestions: metadata.targetSuggestions,
    messages: metadata.messages,
  };
}

export async function resolveSourceBundle(sourceToken: string): Promise<SourceMetadata> {
  await ensureSourceRoot();
  await cleanupSourceBundles();

  const sourceDir = getSourceBundleDir(sourceToken);
  if (!existsSync(sourceDir)) {
    throw new SourceBundleMissingError(sourceToken);
  }

  const metadataPath = path.join(sourceDir, SOURCE_METADATA_FILE);
  if (!existsSync(metadataPath)) {
    throw new SourceBundleMissingError(sourceToken);
  }

  const metadata = JSON.parse(await fs.readFile(metadataPath, "utf8")) as SourceMetadata;
  if (Date.now() - metadata.createdAtEpochMs > SOURCE_TTL_MS) {
    await fs.rm(sourceDir, { recursive: true, force: true });
    throw new SourceBundleExpiredError(sourceToken);
  }

  return metadata;
}

export function sourceBundleHasRunnableCsv(metadata: SourceMetadata): boolean {
  return typeof metadata.csvPath === "string" && metadata.csvPath.trim().length > 0;
}

function getSourceBundleDir(sourceToken: string): string {
  return path.join(SOURCE_ROOT, sourceToken);
}

async function ensureSourceRoot(): Promise<void> {
  await fs.mkdir(SOURCE_ROOT, { recursive: true });
}

async function cleanupSourceBundles(): Promise<void> {
  if (!existsSync(SOURCE_ROOT)) {
    return;
  }

  const entries = await fs.readdir(SOURCE_ROOT, { withFileTypes: true });
  const bundleInfos = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map(async (entry) => {
        const sourceDir = path.join(SOURCE_ROOT, entry.name);
        const metadataPath = path.join(sourceDir, SOURCE_METADATA_FILE);
        let createdAtEpochMs = 0;

        if (existsSync(metadataPath)) {
          try {
            const metadata = JSON.parse(await fs.readFile(metadataPath, "utf8")) as SourceMetadata;
            createdAtEpochMs = metadata.createdAtEpochMs;
          } catch {
            createdAtEpochMs = 0;
          }
        }

        if (!createdAtEpochMs) {
          const stats = await fs.stat(sourceDir);
          createdAtEpochMs = stats.mtimeMs;
        }

        return { sourceDir, createdAtEpochMs };
      }),
  );

  const freshBundles = bundleInfos.filter(
    (bundleInfo) => Date.now() - bundleInfo.createdAtEpochMs <= SOURCE_TTL_MS,
  );
  const expiredBundles = bundleInfos.filter(
    (bundleInfo) => Date.now() - bundleInfo.createdAtEpochMs > SOURCE_TTL_MS,
  );

  await Promise.all(
    expiredBundles.map((bundleInfo) =>
      fs.rm(bundleInfo.sourceDir, { recursive: true, force: true }),
    ),
  );

  const overflowBundles = freshBundles
    .sort((left, right) => right.createdAtEpochMs - left.createdAtEpochMs)
    .slice(MAX_SOURCE_BUNDLES);

  await Promise.all(
    overflowBundles.map((bundleInfo) =>
      fs.rm(bundleInfo.sourceDir, { recursive: true, force: true }),
    ),
  );
}
