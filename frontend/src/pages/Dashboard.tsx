import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";

interface Summary {
  competencyRate?: number;
  completionRate?: number;
  dropOffRate?: number;
  timeToCompetency?: number;
}

export function Dashboard() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["summary"],
    queryFn: () => api<Summary>("/dashboard/summary"),
    retry: false,
  });

  return (
    <div>
      <h1>Dashboard</h1>
      {isLoading && <p className="loading">Loading KPIs…</p>}
      {isError && <p>Backend unreachable — start the API on :4000 to see live KPIs.</p>}
      {data && (
        <div className="grid">
          <div className="card">
            <div className="stat-label">Competency</div>
            <div className="stat">{data.competencyRate ?? "–"}%</div>
          </div>
          <div className="card">
            <div className="stat-label">Completion</div>
            <div className="stat">{data.completionRate ?? "–"}%</div>
          </div>
          <div className="card">
            <div className="stat-label">Drop-off</div>
            <div className="stat">{data.dropOffRate ?? "–"}%</div>
          </div>
          <div className="card">
            <div className="stat-label">Time to competency</div>
            <div className="stat">{data.timeToCompetency ?? "–"}d</div>
          </div>
        </div>
      )}
    </div>
  );
}
