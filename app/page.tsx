const curlExample = `curl -X POST http://localhost:3000/api/lab/run \\
  -F "file=@public/data/demo-churn.csv" \\
  -F "targetColumn=churn" \\
  -F "intentPrompt=Create a model to predict churn"`;

const kaggleCurlExample = `curl -X POST http://localhost:3000/api/lab/run \\
  -F "kaggleUrl=https://www.kaggle.com/datasets/waddahali/kaggle-competition-graph-dataset" \\
  -F "targetColumn=type" \\
  -F "intentPrompt=Create a model that predicts graph node type"`;

export default function HomePage() {
  return (
    <main className="shell">
      <section className="hero">
        <span className="eyebrow">ML-Labs Backend</span>
        <h1>Autonomous ML pipeline APIs are ready for the frontend pass.</h1>
        <p>
          This scaffold intentionally keeps the UI minimal and puts the weight on the
          backend: deterministic classification/regression demo snapshots, real CSV
          training, report generation, and post-run prediction contracts.
        </p>
      </section>

      <section className="grid">
        <article className="panel">
          <h2 className="card-title">Available routes</h2>
          <div className="endpoint">
            <strong>GET /api/lab/demo</strong>
            <p>Returns a complete classification or regression demo run from committed real-backed snapshots.</p>
          </div>
          <div className="endpoint">
            <strong>POST /api/lab/run</strong>
            <p>
              Accepts <code>multipart/form-data</code> with either a CSV upload or a
              Kaggle dataset URL/slug, plus the target column and optional research
              intent prompt. If a Kaggle dataset has multiple CSV files, the backend
              auto-selects the one file that uniquely contains the target column.
            </p>
          </div>
          <div className="endpoint">
            <strong>POST /api/lab/predict</strong>
            <p>Scores inputs against either a saved real run or a bundled demo scenario via `runId`.</p>
          </div>
        </article>

        <article className="panel">
          <h2 className="card-title">What the frontend can trust</h2>
          <ul>
            <li>Shared `LabRunResult` schema for both demo and real runs.</li>
            <li>Rich agent trace with many visible pipeline stages.</li>
            <li>Inline artifact export content for `train.py`, `evaluate.py`, `predict.py`, and `report.md`.</li>
            <li>Both classification and regression demo paths plus a live prediction contract.</li>
          </ul>
        </article>
      </section>

      <section className="panel">
        <h2 className="card-title">Smoke test</h2>
        <pre>{curlExample}</pre>
        <pre>{kaggleCurlExample}</pre>
      </section>
    </main>
  );
}
