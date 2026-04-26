import { NextResponse } from "next/server";
import {
  runLab,
  SourceBundleExpiredError,
  SourceBundleMissingError,
} from "@/lib/ml-labs/lab-runner";
import type { LabRunError } from "@/lib/ml-labs/types";

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file");
    const kaggleDataset = formData.get("kaggleDataset");
    const kaggleFilePath = formData.get("kaggleFilePath");
    const kaggleUrl = formData.get("kaggleUrl");
    const sourceToken = formData.get("sourceToken");
    const targetColumn = formData.get("targetColumn");
    const intentPrompt = formData.get("intentPrompt");
    const hasUpload = file instanceof File && file.size > 0;
    const hasKaggleDataset =
      typeof kaggleDataset === "string" && kaggleDataset.trim().length > 0;
    const hasKaggleUrl = typeof kaggleUrl === "string" && kaggleUrl.trim().length > 0;
    const hasSourceToken =
      typeof sourceToken === "string" && sourceToken.trim().length > 0;

    if (Number(hasUpload) + Number(hasKaggleDataset || hasKaggleUrl) + Number(hasSourceToken) > 1) {
      return NextResponse.json<LabRunError>(
        {
          error:
            "Provide one dataset source per run: source token, CSV upload, or Kaggle reference.",
        },
        { status: 400 },
      );
    }

    if (typeof targetColumn !== "string" || targetColumn.trim().length === 0) {
      return NextResponse.json<LabRunError>(
        { error: "A non-empty `targetColumn` field is required." },
        { status: 400 },
      );
    }

    if (!hasUpload && !hasKaggleDataset && !hasKaggleUrl && !hasSourceToken) {
      return NextResponse.json<LabRunError>(
        {
          error:
            "Provide a source token, a CSV file under `file`, or a Kaggle dataset under `kaggleDataset` or `kaggleUrl`.",
        },
        { status: 400 },
      );
    }

    const result = await runLab({
      file: hasUpload ? file : undefined,
      kaggleDataset: typeof kaggleDataset === "string" ? kaggleDataset.trim() : undefined,
      kaggleFilePath: typeof kaggleFilePath === "string" ? kaggleFilePath.trim() : undefined,
      kaggleUrl: typeof kaggleUrl === "string" ? kaggleUrl.trim() : undefined,
      sourceToken: typeof sourceToken === "string" ? sourceToken.trim() : undefined,
      targetColumn,
      intentPrompt: typeof intentPrompt === "string" ? intentPrompt : undefined,
    });

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof SourceBundleMissingError) {
      return NextResponse.json<LabRunError>(
        {
          error: "Unknown source token.",
          details: error.message,
        },
        { status: 404 },
      );
    }

    if (error instanceof SourceBundleExpiredError) {
      return NextResponse.json<LabRunError>(
        {
          error: "Source token expired.",
          details: error.message,
        },
        { status: 410 },
      );
    }

    const details = error instanceof Error ? error.message : "Unknown error";
    const normalizedDetails = details.toLowerCase();
    const status =
      normalizedDetails.includes("only csv") ||
      normalizedDetails.includes("provide one dataset source") ||
      normalizedDetails.includes("provide a source token") ||
      normalizedDetails.includes("kaggle") ||
      normalizedDetails.includes("target column") ||
      normalizedDetails.includes("choose a kaggle csv table") ||
      normalizedDetails.includes("must contain at least one feature") ||
      normalizedDetails.includes("contains only missing values")
        ? 400
        : 500;

    return NextResponse.json<LabRunError>(
      {
        error: "ML-Labs could not complete the requested run.",
        details,
      },
      { status },
    );
  }
}
