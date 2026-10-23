import { redirect } from "next/navigation";
import { kstToday } from "@/lib/date-kst";
import { isMonth } from "@/features/student-contribution/model/dates";
import { getContributionOntology } from "@/features/student-contribution/server/ontology-query";
import { OntologyExplorer } from "@/features/student-contribution/components/ontology-explorer";
import { getCurrentOntologyScope } from "@/features/student-contribution/server/live-scope-query";
import { CurrentScopeExplorer } from "@/features/student-contribution/components/current-scope-explorer";
export const metadata = { title: "학생 기록의 연결 — 에이와" };
export default async function Page({ searchParams }: { searchParams: Promise<{ month?: string; view?: string; kind?: string; entity?: string; q?: string; page?: string; embed?: string }> }) {
  const params = await searchParams;
  if (params.view === "current") {
    const view = await getCurrentOntologyScope(params);
    if (!view) redirect("/");
    return <CurrentScopeExplorer view={view} embed={params.embed === "1"} />;
  }
  const { month } = params;
  const data = await getContributionOntology(month && isMonth(month) ? month : kstToday().slice(0, 7));
  if (!data) redirect("/");
  return <OntologyExplorer data={data} />;
}
