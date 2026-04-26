# ML-Labs

Backend-first MVP for an autonomous machine-learning lab demo.

## What is implemented

- `GET /api/lab/demo` returns a deterministic regression-focused `LabRunResult`
- `POST /api/lab/run` accepts CSV uploads and runs a lightweight sklearn experiment sweep
- `POST /api/lab/predict` scores demo-playground insurance inputs
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
curl http://localhost:3000/api/lab/demo
```

Run a real CSV experiment:

```bash
curl -X POST http://localhost:3000/api/lab/run \
  -F "file=@public/data/demo-insurance.csv" \
  -F "targetColumn=charges" \
  -F "intentPrompt=Create a model to predict insurance charges"
```

Score the demo playground:

```bash
curl -X POST http://localhost:3000/api/lab/predict \
  -H "Content-Type: application/json" \
  -d '{"age":43,"sex":"male","bmi":31.2,"children":2,"smoker":true,"region":"southeast"}'
```
