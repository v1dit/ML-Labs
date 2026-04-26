import type { DemoPredictInput, DemoPredictResponse } from "@/lib/ml-labs/types";

const REGION_OFFSETS: Record<DemoPredictInput["region"], number> = {
  northeast: 1800,
  northwest: 1200,
  southeast: 2200,
  southwest: 1000,
};

export const demoPredictionExamples: DemoPredictInput[] = [
  {
    age: 24,
    sex: "female",
    bmi: 23.5,
    children: 0,
    smoker: false,
    region: "northwest",
  },
  {
    age: 43,
    sex: "male",
    bmi: 31.2,
    children: 2,
    smoker: true,
    region: "southeast",
  },
  {
    age: 58,
    sex: "female",
    bmi: 28.1,
    children: 1,
    smoker: false,
    region: "northeast",
  },
];

export function predictDemoInsuranceCharge(input: DemoPredictInput): DemoPredictResponse {
  const smokerLift = input.smoker ? 23800 : 0;
  const bmiLift = Math.max(input.bmi - 21, 0) * 320;
  const ageLift = input.age * 245;
  const childLift = input.children * 410;
  const sexOffset = input.sex === "male" ? 180 : -120;
  const prediction = Math.round(
    1600 + ageLift + bmiLift + childLift + smokerLift + sexOffset + REGION_OFFSETS[input.region],
  );

  const factors = [
    input.smoker ? "Smoking history contributed the strongest positive lift." : "Non-smoker profile kept risk-adjusted cost lower.",
    `BMI added approximately $${Math.round(bmiLift).toLocaleString()} to the projection.`,
    `Age contributed approximately $${Math.round(ageLift).toLocaleString()} to the projection.`,
  ];

  return {
    prediction,
    unit: "USD / year",
    explanation:
      "This demo prediction mirrors the bundled regression winner so the frontend can showcase instant post-training scoring.",
    topFactors: factors,
  };
}

