import test from "node:test";
import assert from "node:assert/strict";
import { timeToCompetencyDays, trainerUtilizationRate, weeklyActivitySeries, dropOffHeatmap, satisfactionScore } from "../dist/services/kpi.js";

test("timeToCompetencyDays averages competent completions", () => {
  const v = timeToCompetencyDays([
    { createdAt: "2026-09-01", completionDate: "2026-09-11", appliedAssessmentScore: 80, appliedThreshold: 70 },
    { createdAt: "2026-09-01", completionDate: "2026-09-05", appliedAssessmentScore: 90, appliedThreshold: 70 },
    { createdAt: "2026-09-01", completionDate: "2026-09-05", appliedAssessmentScore: 40, appliedThreshold: 70 },
    { createdAt: "2026-09-01", completionDate: null, appliedAssessmentScore: null, appliedThreshold: 70 },
  ]);
  assert.equal(v, 7);
});

test("timeToCompetencyDays is null with no competent completions", () => {
  assert.equal(timeToCompetencyDays([{ createdAt: "2026-09-01", completionDate: null, appliedAssessmentScore: null, appliedThreshold: 70 }]), null);
});

test("trainerUtilizationRate matches bookings to trainers by name", () => {
  assert.equal(trainerUtilizationRate([{ id: "1", name: "Thabo" }, { id: "2", name: "Lerato" }], ["thabo", "Nobody"]), 50);
  assert.equal(trainerUtilizationRate([], ["x"]), 0);
});

test("weeklyActivitySeries buckets 7 days ending today", () => {
  const now = new Date(2026, 8, 11, 12, 0, 0);
  const series = weeklyActivitySeries([new Date(2026, 8, 11, 9, 0, 0), new Date(2026, 8, 11, 10, 0, 0)], [new Date(2026, 8, 10, 9, 0, 0)], now);
  assert.equal(series.length, 7);
  assert.equal(series[6].active, 2);
  assert.equal(series[5].completed, 1);
});

test("dropOffHeatmap sorts worst first", () => {
  const heat = dropOffHeatmap([
    { title: "Good", enrolled: 10, completed: 9 },
    { title: "Bad", enrolled: 10, completed: 2 },
  ]);
  assert.equal(heat[0].label, "Bad");
  assert.equal(heat[0].value, 80);
});

test("satisfactionScore averages ratings", () => {
  assert.deepEqual(satisfactionScore([5, 4, 3]), { average: 4, responses: 3 });
  assert.deepEqual(satisfactionScore([]), { average: null, responses: 0 });
});
