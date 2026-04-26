import { NextResponse } from "next/server";
import { getDemoLabRunResult } from "@/lib/ml-labs/demo-result";

type ChatRole = "user" | "assistant" | "system";

type ChatMessage = {
  role: ChatRole;
  content: string;
};

type ChatRequest = {
  messages?: ChatMessage[];
};

type ChatBackendResponse = {
  message?: ChatMessage;
  messages?: ChatMessage[];
  content?: string;
};

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as ChatRequest;
    const messages = normalizeMessages(body.messages);
    const backendUrl = process.env.ML_LABS_CHAT_BACKEND_URL;

    if (backendUrl) {
      const backendResponse = await fetch(backendUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ messages }),
      });

      const data = (await backendResponse.json()) as ChatBackendResponse;

      if (!backendResponse.ok) {
        return NextResponse.json(data, { status: backendResponse.status });
      }

      return NextResponse.json({
        message: normalizeBackendMessage(data),
      });
    }

    return NextResponse.json({
      message: {
        id: crypto.randomUUID(),
        role: "assistant",
        content: createLocalReply(messages),
      },
    });
  } catch (error) {
    const details = error instanceof Error ? error.message : "Unknown error";

    return NextResponse.json(
      {
        error: "Chat request could not be completed.",
        details,
      },
      { status: 400 },
    );
  }
}

function normalizeMessages(messages: ChatRequest["messages"]): ChatMessage[] {
  if (!Array.isArray(messages) || messages.length === 0) {
    throw new Error("Expected a non-empty messages array.");
  }

  return messages.map((message) => {
    if (
      !message ||
      !["user", "assistant", "system"].includes(message.role) ||
      typeof message.content !== "string"
    ) {
      throw new Error("Each message must include role and content.");
    }

    return {
      role: message.role,
      content: message.content,
    };
  });
}

function normalizeBackendMessage(data: ChatBackendResponse): ChatMessage {
  const lastMessage = data.messages?.at(-1);
  const message = data.message ?? lastMessage;

  if (message?.role && typeof message.content === "string") {
    return message;
  }

  if (typeof data.content === "string") {
    return {
      role: "assistant",
      content: data.content,
    };
  }

  throw new Error("Backend response did not include a compatible assistant message.");
}

function createLocalReply(messages: ChatMessage[]) {
  const lastUserMessage = [...messages]
    .reverse()
    .find((message) => message.role === "user")
    ?.content.toLowerCase();

  if (!lastUserMessage) {
    return "Send a prompt and I will map it to the ML-Labs backend contract.";
  }

  if (lastUserMessage.includes("demo")) {
    const demo = getDemoLabRunResult("Frontend chat shell demo request");
    const best = demo.bestModel;

    return [
      `Demo run ${demo.runId} is ready.`,
      `${best.modelName} leads the leaderboard with ${best.metricName} ${best.score.toFixed(3)}.`,
      `Use GET /api/lab/demo to fetch the full agent trace, artifacts, visualizations, and report markdown.`,
    ].join(" ");
  }

  if (lastUserMessage.includes("upload") || lastUserMessage.includes("csv")) {
    return [
      "Upload flow contract: POST /api/lab/run as multipart/form-data.",
      "Required fields are file and targetColumn; intentPrompt is optional.",
      "The response returns a LabRunResult with datasetProfile, agentTrace, leaderboard, bestModel, criticReport, visualizations, artifacts, and finalReportMarkdown.",
    ].join(" ");
  }

  if (lastUserMessage.includes("predict")) {
    return [
      "Prediction contract: POST /api/lab/predict with JSON fields age, sex, bmi, children, smoker, and region.",
      "The response includes prediction, unit, explanation, and topFactors for the demo insurance model.",
    ].join(" ");
  }

  return [
    "I am running in local adapter mode because ML_LABS_CHAT_BACKEND_URL is not set.",
    "The frontend already posts OpenAI-style messages to /api/chat, so a future backend can accept the same messages array and return either message, messages, or content.",
  ].join(" ");
}
