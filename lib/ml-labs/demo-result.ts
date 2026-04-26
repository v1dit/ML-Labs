import { buildCompleteRun } from "@/lib/ml-labs/report-generator";
import type { AgentTraceItem, CriticReport, DatasetProfile, LeaderboardEntry, Visualization } from "@/lib/ml-labs/types";

const datasetProfile: DatasetProfile = {
  rows: 1338,
  columns: 7,
  targetColumn: "charges",
  problemType: "regression",
  numericColumns: ["age", "bmi", "children"],
  categoricalColumns: ["sex", "smoker", "region"],
  missingValues: {
    age: 0,
    sex: 0,
    bmi: 4,
    children: 0,
    smoker: 0,
    region: 0,
    charges: 0,
  },
  targetSummary:
    "Insurance charges span from $1,122 to $63,770 with a right-skewed cost distribution and a strong smoker effect.",
};

const leaderboard: LeaderboardEntry[] = [
  {
    modelName: "Mean Cost Baseline",
    family: "Baseline",
    metricName: "R2",
    score: 0.742,
    trainScore: 0.742,
    testScore: 0.742,
    improvementOverBaseline: 0,
    notes: "Predicts the training-set average charge for every patient.",
  },
  {
    modelName: "Linear Cost Regressor",
    family: "Linear Model",
    metricName: "R2",
    score: 0.811,
    trainScore: 0.826,
    testScore: 0.811,
    improvementOverBaseline: 0.069,
    notes: "Captured the dominant smoker and BMI relationships with strong stability.",
  },
  {
    modelName: "Random Forest Cost Model",
    family: "Tree Ensemble",
    metricName: "R2",
    score: 0.874,
    trainScore: 0.962,
    testScore: 0.874,
    improvementOverBaseline: 0.132,
    notes: "Best nonlinear fit with manageable generalization gap and clean residual spread.",
  },
  {
    modelName: "Gradient Boosted Cost Model",
    family: "Boosted Trees",
    metricName: "R2",
    score: 0.861,
    trainScore: 0.918,
    testScore: 0.861,
    improvementOverBaseline: 0.119,
    notes: "Competitive runner-up with slightly more variance than the forest.",
  },
];

const criticReport: CriticReport = {
  warnings: [
    "BMI contains a few missing values, so downstream production scoring should preserve the same imputation policy.",
    "The winning tree model shows a noticeable train-test gap, so the score may soften on a shifted population.",
  ],
  failureModes: [
    "The model may underperform on demographics that are rare in the training slice.",
    "Policy or market changes can shift insurance prices faster than the static training data can capture.",
  ],
  nextExperiments: [
    "Run cross-validation to confirm the forest lead is not split-specific.",
    "Engineer interaction features between smoker status and age bands.",
    "Collect richer clinical or claims-history features for harder edge cases.",
  ],
  limitations: [
    "This MVP evaluates a single train-test split rather than a full repeated validation regime.",
    "No fairness audit or calibration pass is included in the one-day hackathon scope.",
  ],
};

const visualizations: Visualization[] = [
  {
    type: "experiment_graph",
    title: "ML-Labs experiment graph",
    data: {
      nodes: [
        "Data Profile",
        "Schema Validation",
        "Target Analysis",
        "Missing Value Audit",
        "Baseline",
        "Linear Model",
        "Tree Model",
        "Best Model",
        "Critic",
        "Report",
      ],
      edges: [
        ["Data Profile", "Schema Validation"],
        ["Schema Validation", "Target Analysis"],
        ["Target Analysis", "Missing Value Audit"],
        ["Missing Value Audit", "Baseline"],
        ["Baseline", "Linear Model"],
        ["Linear Model", "Tree Model"],
        ["Tree Model", "Best Model"],
        ["Best Model", "Critic"],
        ["Critic", "Report"],
      ],
    },
  },
  {
    type: "residual_plot",
    title: "Residual behavior on held-out data",
    data: [
      { actual: 5120, predicted: 5400, residual: -280 },
      { actual: 12840, predicted: 12120, residual: 720 },
      { actual: 23150, predicted: 22690, residual: 460 },
      { actual: 34770, predicted: 35610, residual: -840 },
      { actual: 44810, predicted: 43950, residual: 860 },
    ],
  },
  {
    type: "feature_importance",
    title: "Winning model feature importance",
    data: [
      { feature: "smoker_yes", importance: 0.54 },
      { feature: "age", importance: 0.17 },
      { feature: "bmi", importance: 0.14 },
      { feature: "children", importance: 0.06 },
      { feature: "region_southeast", importance: 0.04 },
      { feature: "sex_male", importance: 0.02 },
    ],
  },
];

const agentTrace: AgentTraceItem[] = [
  { agent: "Data Intake Agent", status: "complete", message: "Loaded the bundled insurance CSV and confirmed tabular schema integrity." },
  { agent: "Schema Validation Agent", status: "complete", message: "Validated the target column and normalized data types across 1,338 rows." },
  { agent: "Data Profiling Agent", status: "complete", message: "Profiled missingness, column families, and target spread for downstream planning." },
  { agent: "Problem Framing Agent", status: "complete", message: "Detected a regression task because the numeric target has broad continuous variation." },
  { agent: "Missing Value Audit Agent", status: "warning", message: "Found a handful of BMI gaps and scheduled median imputation in the preprocessing stack." },
  { agent: "Feature Planning Agent", status: "complete", message: "Prepared numeric imputation plus categorical one-hot encoding inside a consistent pipeline." },
  { agent: "Baseline Agent", status: "complete", message: "Established a mean-regression baseline to anchor later uplift claims." },
  { agent: "Linear Modeling Agent", status: "complete", message: "Trained a linear regressor to capture first-order charge drivers." },
  { agent: "Forest Modeling Agent", status: "complete", message: "Trained a random forest and discovered the strongest held-out performance." },
  { agent: "Boosting Agent", status: "complete", message: "Benchmarked gradient boosting as a high-signal nonlinear challenger." },
  { agent: "Evaluation Agent", status: "complete", message: "Sorted the leaderboard, measured uplift, and selected the winning model." },
  { agent: "Critic Agent", status: "complete", message: "Flagged the forest generalization gap and produced follow-up experiments." },
  { agent: "Report Agent", status: "complete", message: "Packaged markdown findings and reusable code artifacts for export." },
];

export function getDemoLabRunResult(intentPrompt?: string) {
  return buildCompleteRun(
    {
      runId: "demo-insurance-regression-001",
      intentPrompt:
        intentPrompt ?? "Create a model that predicts insurance charges from patient and policy attributes.",
      datasetProfile,
      leaderboard,
      criticReport,
    },
    {
      agentTrace,
      visualizations,
    },
  );
}

