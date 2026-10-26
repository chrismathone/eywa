import { redirect } from "next/navigation";
import { kstToday } from "@/lib/date-kst";
import { isMonth } from "@/features/student-contribution/model/dates";
import { getContributionOntology } from "@/features/student-contribution/server/ontology-query";
import { OntologyExplorer } from "@/features/student-contribution/components/ontology-explorer";
import { getCurrentOntologyScope } from "@/features/student-contribution/server/live-scope-query";
import { CurrentScopeExplorer } from "@/features/student-contribution/components/current-scope-explorer";
import { liveScopeRequest, type LiveScopeParams } from "@/features/students/ontology/live-scope";
export async function OntologyView({ searchParams }: { searchParams: Promise<LiveScopeParams & { month?: string; view?: string; embed?: string }> }) {
  const params = await searchParams;
  if (params.view === "current") {
    const view = await getCurrentOntologyScope(params);
    if (!view) redirect("/");
    return <CurrentScopeExplorer view={view} embed={params.embed === "1"} />;
  }
  const { month } = params;
  const data = await getContributionOntology(month && isMonth(month) ? month : kstToday().slice(0, 7), params);
  if (!data) redirect("/");
  const selection = liveScopeRequest(params, data.tenant);
  return <OntologyExplorer key={`${data.month}:${selection.kind}:${selection.id}:${JSON.stringify(data.filters)}`} data={data} initialScope={selection} />;
}
