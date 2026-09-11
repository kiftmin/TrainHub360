import test from "node:test";
import assert from "node:assert/strict";
import { retentionDecay, costPerLearner } from "../dist/jobs/kpiJob.js";
import { fallbackExplanation, buildPrompt } from "../dist/services/aiExplainer.js";

test("retentionDecay compares immediate vs delayed scores", () => {
  const r = retentionDecay([
    { immediateScore: 80, delayedScore: 60 },
    { immediateScore: 90, delayedScore: 72 },
  ]);
  assert.equal(r.retentionRate, 77.6);
  assert.equal(r.decayPoints, 19);
});

test("retentionDecay is null without delayed samples", () => {
  assert.deepEqual(retentionDecay([{ immediateScore: 80, delayedScore: null }]), { retentionRate: null, decayPoints: null });
});

test("costPerLearner divides budget by active learners", () => {
  assert.equal(costPerLearner(10000, 40), 250);
  assert.equal(costPerLearner(10000, 0), null);
});

test("aiExplainer falls back without LLM_API_KEY", () => {
  const out = fallbackExplanation({ courseTitle: "Safety", moduleTitle: "M1", concept: "Regression Analysis", userQuery: "Explain simply" });
  assert.equal(out.provider, "fallback");
  assert.ok(out.explanation.length > 0);
  assert.ok(out.suggestedFollowUp.length > 0);
});

test("buildPrompt constrains answers, never quiz answers", () => {
  const p = buildPrompt({ courseTitle: "Safety", moduleTitle: "M1", concept: "X", userQuery: "Y" });
  assert.match(p, /150 words/);
  assert.match(p, /Do not reveal quiz answers/);
});
