import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/api/client";
import { LifeBuoy, Send } from "lucide-react";

interface ExplainResponse {
  explanation: string;
  suggestedFollowUp: string[];
  provider: "live" | "fallback";
}

export function AiConceptExplainer({ courseId, moduleId, moduleTitle }: { courseId: string; moduleId: string; moduleTitle: string }) {
  const [open, setOpen] = useState(false);
  const [concept, setConcept] = useState("");
  const [question, setQuestion] = useState("");
  const explain = useMutation({
    mutationFn: (body: { concept: string; userQuery: string }) =>
      api<ExplainResponse>(`/courses/${courseId}/modules/${moduleId}/explain`, { method: "POST", body: JSON.stringify(body) }),
  });

  return (
    <div className="rounded-xl border border-border/80 bg-card p-4">
      <button onClick={() => setOpen((v) => !v)} className="flex w-full items-center gap-2 text-sm font-semibold" data-testid="button-ai-explainer">
        <LifeBuoy className="size-4 text-primary" /> Stuck on this concept?
      </button>
      {open && (
        <div className="mt-3 space-y-3">
          <p className="text-xs text-muted-foreground">{moduleTitle} — ask for a plain-language breakdown.</p>
          <label className="block text-xs font-semibold">Concept<Input className="mt-2" placeholder="e.g. Regression Analysis" value={concept} onChange={(e) => setConcept(e.target.value)} data-testid="input-ai-concept" /></label>
          <label className="block text-xs font-semibold">Your question<Textarea className="mt-2" placeholder="What confuses you?" value={question} onChange={(e) => setQuestion(e.target.value)} data-testid="input-ai-question" /></label>
          <Button
            size="sm"
            disabled={!concept || !question || explain.isPending}
            onClick={() => explain.mutate({ concept, userQuery: question })}
            data-testid="button-ai-ask"
          >
            <Send className="size-4" /> {explain.isPending ? "Thinking…" : "Explain"}
          </Button>
          {explain.isError && <p className="text-xs text-destructive">Could not reach the explainer. Try again.</p>}
          {explain.data && (
            <div className="rounded-lg bg-secondary/55 p-3 text-sm">
              <p>{explain.data.explanation}</p>
              {explain.data.suggestedFollowUp.length > 0 && (
                <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-muted-foreground">
                  {explain.data.suggestedFollowUp.map((s) => (
                    <li key={s}>{s}</li>
                  ))}
                </ul>
              )}
              <Link href="/messages" className="mt-3 inline-block text-xs font-semibold text-primary hover:underline" data-testid="link-ai-dm-trainer">
                Still confused? DM your trainer
              </Link>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
