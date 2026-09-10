import React from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";
export function Dashboard() {
  const { data } = useQuery({ queryKey: ["summary"], queryFn: () => api<any>("/dashboard/summary") });
  return <div className="card"><h1>Dashboard</h1><p>Competency {(data?.competencyRate ?? "-")}% · Completion {(data?.completionRate ?? "-")}%</p></div>;
}

