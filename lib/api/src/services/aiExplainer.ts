export interface ExplainerInput {
  courseTitle: string;
  moduleTitle: string;
  moduleContext?: string | null;
  concept: string;
  userQuery: string;
}

export interface ExplainerOutput {
  explanation: string;
  suggestedFollowUp: string[];
  provider: "live" | "fallback";
}

export function buildPrompt(e: ExplainerInput): string {
  return [
    `Course: ${e.courseTitle}`,
    `Module: ${e.moduleTitle}`,
    e.moduleContext ? `Module context: ${e.moduleContext.slice(0, 2000)}` : null,
    `Concept: ${e.concept}`,
    `Learner question: ${e.userQuery}`,
    "",
    "Explain the concept in under 150 words using a simple, job-relevant analogy.",
    "Do not reveal quiz answers directly — teach the underlying idea instead.",
  ]
    .filter(Boolean)
    .join("\n");
}

export function fallbackExplanation(e: ExplainerInput): ExplainerOutput {
  return {
    explanation:
      `Here's a way to think about "${e.concept}" in the context of ${e.moduleTitle}: ` +
      `break it into the smallest moving parts, name what each part does in your day-to-day role, ` +
      `then reassemble them. If you can explain each part back in your own words, you've got it — ` +
      `try applying it to one real example from your current work before the assessment.`,
    suggestedFollowUp: [
      `Give me an analogy for ${e.concept} from my role`,
      "What is the most common mistake learners make here?",
      "Quiz me with one practice question (no answers)",
    ],
    provider: "fallback",
  };
}

export async function explainConcept(input: ExplainerInput): Promise<ExplainerOutput> {
  const key = process.env.LLM_API_KEY;
  if (!key) return fallbackExplanation(input);
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: process.env.LLM_MODEL ?? "gpt-4o-mini",
      max_tokens: 300,
      messages: [
        { role: "system", content: "You are a concise corporate-training tutor. Under 150 words. Simple analogies. Never reveal quiz answers." },
        { role: "user", content: buildPrompt(input) },
      ],
    }),
  });
  if (!res.ok) return fallbackExplanation(input);
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const text = data.choices?.[0]?.message?.content?.trim();
  if (!text) return fallbackExplanation(input);
  return { explanation: text, suggestedFollowUp: fallbackExplanation(input).suggestedFollowUp, provider: "live" };
}
