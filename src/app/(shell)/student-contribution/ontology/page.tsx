import { redirect } from "next/navigation";
import { kstToday } from "@/lib/date-kst";
import { isMonth } from "@/features/student-contribution/model/dates";
import { getContributionOntology } from "@/features/student-contribution/server/ontology-query";
import { OntologyExplorer } from "@/features/student-contribution/components/ontology-explorer";
export const metadata = { title: "학생 기록의 연결 — 에이와" };
export default async function Page({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const { month } = await searchParams;
  const data = await getContributionOntology(month && isMonth(month) ? month : kstToday().slice(0, 7));
  if (!data) redirect("/");
  return <OntologyExplorer data={data} />;
}
