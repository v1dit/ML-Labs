# ML-Labs

Backend-first MVP for an autonomous machine-learning lab demo.

## What is implemented

- `GET /api/lab/demo?scenario=classification|regression` returns stable real-backed demo snapshots
- `POST /api/lab/run` accepts either CSV uploads or Kaggle dataset URL/slug inputs and runs a lightweight sklearn experiment sweep
- `POST /api/lab/predict` scores either a saved real run or one of the bundled demo run IDs
- Report and artifact generation live in shared backend utilities for the frontend to consume

## Local setup

```bash
npm install
python3 -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt
npm run dev
```

## Example requests

Fetch the deterministic demo payload:

```bash
curl "http://localhost:3000/api/lab/demo?scenario=classification"
curl "http://localhost:3000/api/lab/demo?scenario=regression"
```

Run a real CSV experiment:

```bash
curl -X POST http://localhost:3000/api/lab/run \
  -F "file=@public/data/demo-churn.csv" \
  -F "targetColumn=churn" \
  -F "intentPrompt=Create a model to predict churn"
```

Run a Kaggle-backed experiment:

```bash
curl -X POST http://localhost:3000/api/lab/run \
  -F "kaggleUrl=https://www.kaggle.com/datasets/waddahali/kaggle-competition-graph-dataset" \
  -F "targetColumn=type" \
  -F "intentPrompt=Create a model that predicts graph node type"
```

If multiple CSVs exist, ML-Labs will auto-select the one file that uniquely contains the target column.

If a Kaggle dataset contains multiple CSV files, you can pin one explicitly:

```bash
curl -X POST http://localhost:3000/api/lab/run \
  -F "kaggleDataset=waddahali/kaggle-competition-graph-dataset" \
  -F "kaggleFilePath=nodes.csv" \
  -F "targetColumn=type"
```

Score a demo or real run:

```bash
curl -X POST http://localhost:3000/api/lab/predict \
  -H "Content-Type: application/json" \
  -d '{
    "runId": "demo-classification-churn-001",
    "input": {
      "tenure_months": 8,
      "monthly_charges": 109.5,
      "support_tickets": 4,
      "contract_type": "monthly",
      "autopay": "no",
      "internet_service": "fiber"
    }
  }'
```
