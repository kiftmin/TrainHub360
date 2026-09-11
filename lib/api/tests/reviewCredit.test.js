import test from "node:test";
import assert from "node:assert/strict";
import { calculateEnrolmentScore, aggregateReviewCredit } from "../dist/services/reviewCredit.js";

test("example1: on-time, no manager rating renormalizes", () => {
  const r = calculateEnrolmentScore({ appliedAssessmentScore: 85, completionDate: "2025-06-01", deadlineDate: "2025-06-01" });
  assert.ok(Math.abs(r.score - 90.63) < 0.02);
});
test("example2: late + manager rating", () => {
  const r = calculateEnrolmentScore({ appliedAssessmentScore: 72, completionDate: "2025-06-06", deadlineDate: "2025-06-01", applicationScore: 80 });
  assert.equal(r.score, 67);
});
test("aggregation applies max weighting", () => {
  const agg = aggregateReviewCredit([91.55, 67, 88], 10);
  assert.ok(Math.abs(agg.raw - 82.18) < 0.02);
  assert.ok(Math.abs(agg.final - 8.218) < 0.01);
});

