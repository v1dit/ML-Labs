"""
Enerva MCP server — exposes the ml-labs pipeline as durable MCP tools.

Requires Docker + rbt. Start with:
    cd reboot_mcp && uv sync && rbt dev run

Then connect Cursor / Claude Desktop via http://localhost:9991/mcp
"""

import asyncio
import json
import os

import httpx
from reboot.mcp.server import DurableContext, DurableMCP

ENERVA_BASE = os.getenv("ENERVA_BASE_URL", "http://localhost:3001")

mcp = DurableMCP(path="/mcp")


# ── Tool 1: resolve a dataset source ─────────────────────────────────────────

@mcp.tool()
async def resolve_source(
    kaggle_input: str,
    context: DurableContext,
) -> str:
    """
    Resolve a Kaggle dataset slug, URL, or kagglehub snippet into a source
    token that can be passed to run_experiment.

    Returns a JSON string with sourceToken, headers, and target suggestions.
    """
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            f"{ENERVA_BASE}/api/lab/source/resolve",
            data={"kaggleInput": kaggle_input},
            timeout=90.0,
        )

    if not resp.is_success:
        return json.dumps({"error": resp.text})

    data = resp.json()
    return json.dumps({
        "sourceToken": data.get("sourceToken"),
        "headers": data.get("headers", []),
        "targetSuggestions": data.get("targetSuggestions", []),
        "sourceLabel": data.get("sourceLabel"),
    })


# ── Tool 2: run the full autonomous ML pipeline ───────────────────────────────

@mcp.tool()
async def run_experiment(
    source_token: str,
    target_column: str,
    intent_prompt: str,
    context: DurableContext,
) -> str:
    """
    Run the full autonomous ML pipeline against an already-resolved source.
    This takes 1-3 minutes. Reboot keeps the connection alive across any
    disconnections so the result will always be delivered.

    source_token: value from resolve_source.
    target_column: column name to predict.
    intent_prompt: plain-English goal, e.g. 'predict customer churn'.

    Returns a JSON string with runId, bestModel, plainEnglishSummary,
    and predictionInputSchema (field names needed for predict).
    """
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            f"{ENERVA_BASE}/api/lab/run",
            data={
                "sourceToken": source_token,
                "targetColumn": target_column,
                "intentPrompt": intent_prompt,
            },
            timeout=300.0,
        )

    if not resp.is_success:
        return json.dumps({"error": resp.text})

    r = resp.json()
    return json.dumps({
        "runId": r.get("runId"),
        "bestModel": r.get("bestModel"),
        "plainEnglishSummary": r.get("plainEnglishSummary"),
        "problemFraming": r.get("problemFraming"),
        "predictionInputSchema": r.get("predictionInputSchema"),
        "finalReportMarkdown": r.get("finalReportMarkdown", ""),
    })


# ── Tool 3: get a demo result without uploading data ─────────────────────────

@mcp.tool()
async def run_demo(
    scenario: str,
    context: DurableContext,
) -> str:
    """
    Get a pre-built demo result without needing a real dataset.
    scenario: 'classification' or 'regression'.

    Useful for testing the pipeline or showing a sample result to a user.
    Returns the same shape as run_experiment.
    """
    async with httpx.AsyncClient() as client:
        resp = await client.get(
            f"{ENERVA_BASE}/api/lab/demo",
            params={"scenario": scenario},
            timeout=15.0,
        )

    if not resp.is_success:
        return json.dumps({"error": resp.text})

    r = resp.json()
    return json.dumps({
        "runId": r.get("runId"),
        "bestModel": r.get("bestModel"),
        "plainEnglishSummary": r.get("plainEnglishSummary"),
        "predictionInputSchema": r.get("predictionInputSchema"),
    })


# ── Tool 4: predict against a trained model ───────────────────────────────────

@mcp.tool()
async def predict(
    run_id: str,
    input_json: str,
    context: DurableContext,
) -> str:
    """
    Run a prediction on a model trained by run_experiment.

    run_id: value from run_experiment response.
    input_json: JSON string of feature→value pairs matching the
                predictionInputSchema returned by run_experiment.
                Example: '{"tenure": 24, "monthly_charges": 65.5}'

    Returns prediction, probability, explanation, and top factors.
    """
    try:
        input_data = json.loads(input_json)
    except json.JSONDecodeError as exc:
        return json.dumps({"error": f"input_json is not valid JSON: {exc}"})

    async with httpx.AsyncClient() as client:
        resp = await client.post(
            f"{ENERVA_BASE}/api/lab/predict",
            json={"runId": run_id, "input": input_data},
            timeout=30.0,
        )

    if not resp.is_success:
        return json.dumps({"error": resp.text})

    r = resp.json()
    return json.dumps({
        "prediction": r.get("prediction"),
        "probability": r.get("probability"),
        "explanation": r.get("explanation"),
        "topFactors": r.get("topFactors", []),
    })


# ── entrypoint ────────────────────────────────────────────────────────────────

async def main() -> None:
    await mcp.application().run()


if __name__ == "__main__":
    asyncio.run(main())
