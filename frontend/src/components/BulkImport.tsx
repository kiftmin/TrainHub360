import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useWorkspace } from "@/api/hooks";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/api/client";
import { Upload } from "lucide-react";

interface ImportRow { name?: string; email?: string; department?: string; jobFunction?: string; managerEmail?: string }
interface ImportResult { created: number; updated: number; failed: number; errors: { row: number; email?: string; error: string }[]; warnings: { row: number; email: string; warning: string }[] }

function parseCsv(text: string): ImportRow[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => {
      const [name, email, department, jobFunction, managerEmail] = line.split(",").map((s) => s.trim());
      return { name, email, department, jobFunction, managerEmail };
    });
}

export function BulkImportButton() {
  const [open, setOpen] = useState(false);
  const [csv, setCsv] = useState("Ava Mokoena, ava@example.com, Operations, Driver, ");
  const qc = useQueryClient();
  const workspace = useWorkspace();
  const orgId = workspace.data?.organization.id ?? "";
  const imp = useMutation({
    mutationFn: (rows: ImportRow[]) =>
      api<ImportResult>(`/organizations/${orgId}/learners/import`, {
        method: "POST",
        body: JSON.stringify({ rows }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["enrolments"] }),
  });

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) imp.reset(); }}>
      <DialogTrigger asChild><Button variant="outline"><Upload className="size-4" />Bulk import</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Bulk import learners</DialogTitle></DialogHeader>
        <div className="space-y-4 pt-2">
          <p className="text-xs text-muted-foreground">Paste CSV rows: name, email, department, jobFunction, managerEmail (one per line).</p>
          <label className="block text-xs font-semibold">CSV rows<Textarea className="mt-2" rows={5} value={csv} onChange={(e) => setCsv(e.target.value)} data-testid="input-import-csv" /></label>
          <Button className="w-full" disabled={imp.isPending} onClick={() => imp.mutate(parseCsv(csv))} data-testid="button-import-submit">
            {imp.isPending ? "Importing…" : "Import"}
          </Button>
          {imp.isError && <p className="text-xs text-destructive">Import failed — check the CSV format.</p>}
          {imp.data && (
            <div className="rounded-lg bg-secondary/55 p-3 text-xs" data-testid="import-results">
              <p><strong>{imp.data.created}</strong> created · <strong>{imp.data.updated}</strong> updated · <strong>{imp.data.failed}</strong> failed</p>
              {imp.data.errors.map((e) => <p key={e.row} className="mt-1 text-destructive">Row {e.row + 1} ({e.email}): {e.error}</p>)}
              {imp.data.warnings.map((w) => <p key={w.row} className="mt-1 text-amber-700">Row {w.row + 1}: {w.warning}</p>)}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
