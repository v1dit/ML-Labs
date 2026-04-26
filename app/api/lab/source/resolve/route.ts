import { NextResponse } from "next/server";
import {
  resolveLabSource,
  SourceBundleExpiredError,
  SourceBundleMissingError,
} from "@/lib/ml-labs/lab-runner";
import type { LabRunError } from "@/lib/ml-labs/types";

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file");
    const kaggleInput = formData.get("kaggleInput");
    const selectedFilePath = formData.get("selectedFilePath");
    const hasUpload = file instanceof File && file.size > 0;
    const hasKaggleInput =
      typeof kaggleInput === "string" && kaggleInput.trim().length > 0;

    if (hasUpload && hasKaggleInput) {
      return NextResponse.json<LabRunError>(
        {
          error: "Provide either a CSV upload or Kaggle input for source resolution, but not both.",
        },
        { status: 400 },
      );
    }

    if (!hasUpload && !hasKaggleInput) {
      return NextResponse.json<LabRunError>(
        {
          error: "Provide a CSV file under `file` or a Kaggle reference under `kaggleInput`.",
        },
        { status: 400 },
      );
    }

    const result = await resolveLabSource({
      file: hasUpload ? file : undefined,
      kaggleInput: typeof kaggleInput === "string" ? kaggleInput : undefined,
      selectedFilePath:
        typeof selectedFilePath === "string" ? selectedFilePath.trim() : undefined,
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
    return NextResponse.json<LabRunError>(
      {
        error: "ML-Labs could not resolve the dataset source.",
        details,
      },
      { status: 400 },
    );
  }
}
