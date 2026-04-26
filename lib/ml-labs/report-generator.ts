import type {
  BestModelSummary,
  CriticReport,
  DatasetProfile,
  LabArtifact,
  LabRunResult,
  LeaderboardEntry,
  PlainEnglishSummary,
  PredictionInputSchema,
  ProblemFraming,
  ProblemTaskSubtype,
  ProblemType,
} from "@/lib/ml-labs/types";

const round = (value: number) => Math.round(value * 1000) / 1000;

type ReportBuildInput = {
  runId: string;
  scenario?: ProblemType;
  intentPrompt?: string;
  datasetProfile: DatasetProfile;
  leaderboard: LeaderboardEntry[];
  criticReport: CriticReport;
  predictionInputSchema?: PredictionInputSchema;
  targetCardinality?: number;
};

export function buildBestModelSummary(
  datasetProfile: DatasetProfile,
  leaderboard: LeaderboardEntry[],
): BestModelSummary {
  const sorted = [...leaderboard].sort((a, b) => b.score - a.score);
  const baseline =
    sorted.find((entry) => entry.family.toLowerCase() === "baseline") ?? sorted[sorted.length - 1];
  const winner = sorted[0];
  const absoluteImprovement = round(winner.score - baseline.score);
  const relativeImprovement = round(
    (absoluteImprovement / Math.max(Math.abs(baseline.score), 0.000001)) * 100,
  );

  return {
    modelName: winner.modelName,
    metricName: winner.metricName,
    score: winner.score,
    baselineScore: baseline.score,
    absoluteImprovement,
    relativeImprovement,
    whyItWon: buildWhyItWon(datasetProfile.problemType, winner, baseline),
  };
}

export function buildArtifacts(
  input: ReportBuildInput,
  bestModel: BestModelSummary,
  reportMarkdown: string,
): LabArtifact[] {
  return [
    {
      filename: "train.py",
      type: "code",
      content: buildTrainArtifact(input.datasetProfile, bestModel),
    },
    {
      filename: "evaluate.py",
      type: "code",
      content: buildEvaluateArtifact(input.datasetProfile, bestModel),
    },
    {
      filename: "predict.py",
      type: "code",
      content: buildPredictArtifact(input.datasetProfile, input.predictionInputSchema),
    },
    {
      filename: "report.md",
      type: "report",
      content: reportMarkdown,
    },
  ];
}

export function buildFinalReportMarkdown({
  runId,
  scenario,
  intentPrompt,
  datasetProfile,
  leaderboard,
  criticReport,
  predictionInputSchema,
  targetCardinality,
}: ReportBuildInput): string {
  const bestModel = buildBestModelSummary(datasetProfile, leaderboard);
  const problemFraming = buildProblemFraming(
    datasetProfile,
    leaderboard,
    targetCardinality,
  );
  const leaderboardTable = leaderboard
    .map(
      (entry) =>
        `| ${entry.modelName} | ${entry.family} | ${entry.metricName} | ${entry.score.toFixed(3)} | ${entry.improvementOverBaseline?.toFixed(3) ?? "0.000"} |`,
    )
    .join("\n");

  const intentLine = intentPrompt
    ? `Research intent: ${intentPrompt}`
    : "Research intent: Build the strongest reliable baseline-to-production tabular model for this dataset.";

  return `# ML-Labs Research Report

Run ID: ${runId}

${intentLine}

## Dataset Profile

- Scenario: ${scenario ?? datasetProfile.problemType}
- Rows: ${datasetProfile.rows}
- Columns: ${datasetProfile.columns}
- Target column: ${datasetProfile.targetColumn}
- Problem type: ${datasetProfile.problemType}
- Task framing: ${humanizeTaskSubtype(problemFraming.taskSubtype)}
- Primary metric: ${problemFraming.primaryMetric}
- Numeric columns: ${datasetProfile.numericColumns.join(", ") || "None"}
- Categorical columns: ${datasetProfile.categoricalColumns.join(", ") || "None"}
- Target summary: ${datasetProfile.targetSummary}

## Model Leaderboard

| Model | Family | Metric | Score | Improvement vs Baseline |
| --- | --- | --- | --- | --- |
${leaderboardTable}

## Best Model

- Winner: ${bestModel.modelName}
- Score: ${bestModel.score.toFixed(3)} ${bestModel.metricName}
- Baseline score: ${bestModel.baselineScore.toFixed(3)}
- Absolute improvement: ${bestModel.absoluteImprovement.toFixed(3)}
- Relative improvement: ${bestModel.relativeImprovement.toFixed(2)}%
- Why it won: ${bestModel.whyItWon}

## Plain-English Outcome

- ${buildPlainEnglishSummary(datasetProfile, leaderboard, criticReport, targetCardinality).headline}
- ${buildPlainEnglishSummary(datasetProfile, leaderboard, criticReport, targetCardinality).shortExplanation}

## Critic Report

### Warnings
${renderBulletSection(criticReport.warnings)}

### Failure Modes
${renderBulletSection(criticReport.failureModes)}

### Next Experiments
${renderBulletSection(criticReport.nextExperiments)}

### Limitations
${renderBulletSection(criticReport.limitations)}

## Prediction Input Schema

${renderPredictionSchema(predictionInputSchema)}

## Export Notes

- Generated artifacts include runnable training, evaluation, prediction, and report templates.
- The frontend can expose these artifacts for copy/download without any extra backend work.
`;
}

export function buildCompleteRun(
  input: ReportBuildInput,
  overrides: Pick<LabRunResult, "agentTrace" | "visualizations">,
): LabRunResult {
  const bestModel = buildBestModelSummary(input.datasetProfile, input.leaderboard);
  const problemFraming = buildProblemFraming(
    input.datasetProfile,
    input.leaderboard,
    input.targetCardinality,
  );
  const plainEnglishSummary = buildPlainEnglishSummary(
    input.datasetProfile,
    input.leaderboard,
    input.criticReport,
    input.targetCardinality,
  );
  const finalReportMarkdown = buildFinalReportMarkdown(input);

  return {
    runId: input.runId,
    scenario: input.scenario,
    datasetProfile: input.datasetProfile,
    problemFraming,
    agentTrace: overrides.agentTrace,
    leaderboard: input.leaderboard,
    bestModel,
    criticReport: input.criticReport,
    visualizations: overrides.visualizations,
    predictionInputSchema: input.predictionInputSchema,
    artifacts: buildArtifacts(input, bestModel, finalReportMarkdown),
    plainEnglishSummary,
    finalReportMarkdown,
  };
}

export function buildProblemFraming(
  datasetProfile: DatasetProfile,
  leaderboard: LeaderboardEntry[],
  targetCardinality?: number,
): ProblemFraming {
  const taskSubtype = resolveTaskSubtype(datasetProfile.problemType, targetCardinality);
  const primaryMetric = leaderboard[0]?.metricName ?? defaultMetric(datasetProfile.problemType);

  return {
    targetName: datasetProfile.targetColumn,
    taskSubtype,
    primaryMetric,
    rationale:
      datasetProfile.problemType === "regression"
        ? `${humanizeTaskSubtype(taskSubtype)} was selected because the target behaves like a continuous value, so fit quality and residual stability matter most.`
        : `${humanizeTaskSubtype(taskSubtype)} was selected because the target behaves like a labeled outcome, so held-out classification quality is the main decision signal.`,
  };
}

export function buildPlainEnglishSummary(
  datasetProfile: DatasetProfile,
  leaderboard: LeaderboardEntry[],
  criticReport: CriticReport,
  targetCardinality?: number,
): PlainEnglishSummary {
  const bestModel = buildBestModelSummary(datasetProfile, leaderboard);
  const framing = buildProblemFraming(datasetProfile, leaderboard, targetCardinality);
  const caution =
    criticReport.warnings[0] ??
    criticReport.limitations[0] ??
    "This is still an MVP-quality experiment and should be validated further before production use.";

  return {
    headline: `${bestModel.modelName} is the strongest model for predicting ${datasetProfile.targetColumn} on this dataset.`,
    shortExplanation: `ML-Labs treated this as ${humanizeTaskSubtype(framing.taskSubtype)} and ranked models by ${framing.primaryMetric}. The winning model improved on the baseline by ${bestModel.absoluteImprovement.toFixed(3)} points.`,
    takeaways: [
      `${datasetProfile.rows.toLocaleString()} rows and ${datasetProfile.columns} columns were profiled before training.`,
      `${bestModel.modelName} finished first with ${bestModel.metricName} ${bestModel.score.toFixed(3)}.`,
      `The lab found ${datasetProfile.numericColumns.length} numeric and ${datasetProfile.categoricalColumns.length} categorical feature families.`,
      caution,
    ],
  };
}

function buildWhyItWon(
  problemType: ProblemType,
  winner: LeaderboardEntry,
  baseline: LeaderboardEntry,
): string {
  const gap = winner.trainScore !== undefined && winner.testScore !== undefined
    ? round(winner.trainScore - winner.testScore)
    : null;

  const generalizationText =
    gap !== null
      ? `It held a train-test gap of ${gap.toFixed(3)}, which kept generalization acceptable for a hackathon MVP.`
      : "Its test-time behavior was stable enough to trust for the MVP demo.";

  const metricContext =
    problemType === "regression"
      ? `It improved the regression score over the baseline by ${round(winner.score - baseline.score).toFixed(3)}.`
      : `It raised classification performance above the baseline by ${round(winner.score - baseline.score).toFixed(3)}.`;

  return `${metricContext} ${generalizationText}`;
}

function resolveTaskSubtype(
  problemType: ProblemType,
  targetCardinality?: number,
): ProblemTaskSubtype {
  if (problemType === "regression") {
    return "regression";
  }

  if (typeof targetCardinality === "number" && targetCardinality > 2) {
    return "multiclass_classification";
  }

  return "binary_classification";
}

function defaultMetric(problemType: ProblemType): string {
  return problemType === "regression" ? "R2" : "Accuracy";
}

function humanizeTaskSubtype(taskSubtype: ProblemTaskSubtype): string {
  return taskSubtype.replaceAll("_", " ");
}

function buildTrainArtifact(datasetProfile: DatasetProfile, bestModel: BestModelSummary): string {
  const estimatorConfig = getEstimatorConfig(bestModel.modelName, datasetProfile.problemType);

  return `import pandas as pd
import joblib
from sklearn.compose import ColumnTransformer
from sklearn.impute import SimpleImputer
from sklearn.model_selection import train_test_split
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder
${estimatorConfig.importLine}

# Generated by ML-Labs for target: ${datasetProfile.targetColumn}
# Best model from the winning run: ${bestModel.modelName}

df = pd.read_csv("dataset.csv")
target = "${datasetProfile.targetColumn}"
X = df.drop(columns=[target])
y = df[target]

numeric_features = ${JSON.stringify(datasetProfile.numericColumns, null, 2)}
categorical_features = ${JSON.stringify(datasetProfile.categoricalColumns, null, 2)}

numeric_pipeline = Pipeline([
    ("imputer", SimpleImputer(strategy="median")),
])

categorical_pipeline = Pipeline([
    ("imputer", SimpleImputer(strategy="most_frequent")),
    ("encoder", OneHotEncoder(handle_unknown="ignore")),
])

preprocessor = ColumnTransformer([
    ("num", numeric_pipeline, numeric_features),
    ("cat", categorical_pipeline, categorical_features),
])

pipeline = Pipeline([
    ("preprocessor", preprocessor),
    ("model", ${estimatorConfig.constructorCode}),
])

X_train, X_test, y_train, y_test = train_test_split(
    X,
    y,
    test_size=0.2,
    random_state=42,
)

pipeline.fit(X_train, y_train)
joblib.dump(pipeline, "model.joblib")

print("Saved trained pipeline to model.joblib")
`;
}

function buildEvaluateArtifact(datasetProfile: DatasetProfile, bestModel: BestModelSummary): string {
  const metricImports =
    datasetProfile.problemType === "regression"
      ? "mean_squared_error, r2_score"
      : "accuracy_score, roc_auc_score";

  const metricBlock =
    datasetProfile.problemType === "regression"
      ? `predictions = pipeline.predict(X)
r2 = r2_score(y, predictions)
rmse = mean_squared_error(y, predictions) ** 0.5
print({"r2": round(float(r2), 4), "rmse": round(float(rmse), 4)})`
      : `predictions = pipeline.predict(X)
report = {"accuracy": round(float(accuracy_score(y, predictions)), 4)}

if hasattr(pipeline, "predict_proba"):
    probabilities = pipeline.predict_proba(X)
    if probabilities.shape[1] == 2:
        report["roc_auc"] = round(float(roc_auc_score(y, probabilities[:, 1])), 4)

print(report)`;

  return `import joblib
import pandas as pd
from sklearn.metrics import ${metricImports}

# Generated by ML-Labs for ${bestModel.modelName}

df = pd.read_csv("dataset.csv")
target = "${datasetProfile.targetColumn}"
X = df.drop(columns=[target])
y = df[target]

pipeline = joblib.load("model.joblib")

${metricBlock}
`;
}

function buildPredictArtifact(
  datasetProfile: DatasetProfile,
  predictionInputSchema?: PredictionInputSchema,
): string {
  const sampleInput =
    predictionInputSchema?.fields.reduce<Record<string, boolean | number | string>>((acc, field) => {
      if (field.example !== undefined) {
        acc[field.name] = field.example;
      }
      return acc;
    }, {}) ?? {};

  return `import joblib
import pandas as pd

# Generated by ML-Labs for target: ${datasetProfile.targetColumn}

pipeline = joblib.load("model.joblib")

sample_input = ${JSON.stringify(sampleInput, null, 2)}
sample_frame = pd.DataFrame([sample_input])
prediction = pipeline.predict(sample_frame)[0]

print({"prediction": prediction})
`;
}

function renderBulletSection(lines: string[]): string {
  if (lines.length === 0) {
    return "- None";
  }

  return lines.map((line) => `- ${line}`).join("\n");
}

function renderPredictionSchema(predictionInputSchema?: PredictionInputSchema): string {
  if (!predictionInputSchema) {
    return "- Prediction schema unavailable";
  }

  return predictionInputSchema.fields
    .map((field) => {
      const optionText = field.options && field.options.length > 0
        ? ` Options: ${field.options.join(", ")}.`
        : "";
      const exampleText = field.example !== undefined ? ` Example: ${String(field.example)}.` : "";
      return `- ${field.name} (${field.kind}).${optionText}${exampleText}`;
    })
    .join("\n");
}

function getEstimatorConfig(modelName: string, problemType: ProblemType): {
  importLine: string;
  constructorCode: string;
} {
  const normalized = modelName.toLowerCase();

  if (problemType === "classification") {
    if (normalized.includes("gradient")) {
      return {
        importLine: "from sklearn.ensemble import GradientBoostingClassifier",
        constructorCode: "GradientBoostingClassifier(random_state=42)",
      };
    }

    if (normalized.includes("forest")) {
      return {
        importLine: "from sklearn.ensemble import RandomForestClassifier",
        constructorCode: "RandomForestClassifier(n_estimators=200, random_state=42)",
      };
    }

    if (normalized.includes("logistic")) {
      return {
        importLine: "from sklearn.linear_model import LogisticRegression",
        constructorCode: "LogisticRegression(max_iter=1000)",
      };
    }

    return {
      importLine: "from sklearn.dummy import DummyClassifier",
      constructorCode: 'DummyClassifier(strategy="most_frequent")',
    };
  }

  if (normalized.includes("gradient")) {
    return {
      importLine: "from sklearn.ensemble import GradientBoostingRegressor",
      constructorCode: "GradientBoostingRegressor(random_state=42)",
    };
  }

  if (normalized.includes("forest")) {
    return {
      importLine: "from sklearn.ensemble import RandomForestRegressor",
      constructorCode: "RandomForestRegressor(n_estimators=200, random_state=42)",
    };
  }

  if (normalized.includes("linear")) {
    return {
      importLine: "from sklearn.linear_model import LinearRegression",
      constructorCode: "LinearRegression()",
    };
  }

  return {
    importLine: "from sklearn.dummy import DummyRegressor",
    constructorCode: 'DummyRegressor(strategy="mean")',
  };
}
