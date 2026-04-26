const curlExample = `curl -X POST http://localhost:3000/api/lab/run \\
  -F "file=@public/data/demo-insurance.csv" \\
  -F "targetColumn=charges" \\
  -F "intentPrompt=Create a model to predict insurance charges"`;

export default function HomePage() {
  return (
    <main className="shell">
      <section className="hero">
        <span className="eyebrow">ML-Labs Backend</span>
        <h1>Autonomous ML pipeline APIs are ready for the frontend pass.</h1>
        <p>
          This scaffold intentionally keeps the UI minimal and puts the weight on the
          backend: deterministic demo runs, real CSV training, report generation, and
          a demo prediction playground contract.
        </p>
      </section>

      <section className="grid">
        <article className="panel">
          <h2 className="card-title">Available routes</h2>
          <div className="endpoint">
            <strong>GET /api/lab/demo</strong>
            <p>Returns a complete deterministic regression run for the live demo.</p>
          </div>
          <div className="endpoint">
            <strong>POST /api/lab/run</strong>
            <p>
              Accepts <code>multipart/form-data</code> with a CSV, target column, and
              optional research intent prompt.
            </p>
          </div>
          <div className="endpoint">
            <strong>POST /api/lab/predict</strong>
            <p>Scores demo-playground inputs against the bundled insurance model logic.</p>
          </div>
        </article>

        <article className="panel">
          <h2 className="card-title">What the frontend can trust</h2>
          <ul>
            <li>Shared `LabRunResult` schema for both demo and real runs.</li>
            <li>Rich agent trace with many visible pipeline stages.</li>
            <li>Inline artifact export content for `train.py`, `evaluate.py`, and `report.md`.</li>
            <li>Regression-first demo payload plus a live prediction contract.</li>
          </ul>
        </article>
      </section>

      <section className="panel">
        <h2 className="card-title">Smoke test</h2>
        <pre>{curlExample}</pre>
      </section>
    </main>
  );
}

