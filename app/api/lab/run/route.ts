import { NextResponse } from "next/server";
import { runLab } from "@/lib/ml-labs/lab-runner";
import type { LabRunError } from "@/lib/ml-labs/types";

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file");
    const kaggleDataset = formData.get("kaggleDataset");
    const kaggleFilePath = formData.get("kaggleFilePath");
    const kaggleUrl = formData.get("kaggleUrl");
    const targetColumn = formData.get("targetColumn");
    const intentPrompt = formData.get("intentPrompt");
    const hasUpload = file instanceof File && file.size > 0;
    const hasKaggleDataset =
      typeof kaggleDataset === "string" && kaggleDataset.trim().length > 0;
    const hasKaggleUrl = typeof kaggleUrl === "string" && kaggleUrl.trim().length > 0;

    if (hasUpload && (hasKaggleDataset || hasKaggleUrl)) {
      return NextResponse.json<LabRunError>(
        {
          error:
            "Provide either a CSV upload or a Kaggle dataset reference, but not both in the same run.",
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

    if (!hasUpload && !hasKaggleDataset && !hasKaggleUrl) {
      return NextResponse.json<LabRunError>(
        {
          error:
            "Provide a CSV file under `file`, or a Kaggle dataset under `kaggleDataset` or `kaggleUrl`.",
        },
        { status: 400 },
      );
    }

    const result = await runLab({
      file: hasUpload ? file : undefined,
      kaggleDataset: typeof kaggleDataset === "string" ? kaggleDataset.trim() : undefined,
      kaggleFilePath: typeof kaggleFilePath === "string" ? kaggleFilePath.trim() : undefined,
      kaggleUrl: typeof kaggleUrl === "string" ? kaggleUrl.trim() : undefined,
      targetColumn,
      intentPrompt: typeof intentPrompt === "string" ? intentPrompt : undefined,
    });

    return NextResponse.json(result);
  } catch (error) {
    const details = error instanceof Error ? error.message : "Unknown error";
    const normalizedDetails = details.toLowerCase();
    const status =
      normalizedDetails.includes("only csv") ||
      normalizedDetails.includes("provide either a csv") ||
      normalizedDetails.includes("kaggle") ||
      normalizedDetails.includes("target column") ||
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
