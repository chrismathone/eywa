import { requireManagementSample } from "@/features/mockup/access";
import { kstToday } from "@/lib/date-kst";
import { SAMPLE_MONTHS } from "@/features/management/sample-data";
import { sampleAcademyKnowledge } from "@/features/academy-knowledge/sample-data";
import { KnowledgeWorkspace } from "@/features/academy-knowledge/workspace";

export const metadata = { title: "통합 지식그래프 — 에이와" };
const TABS = ["schema", "graph", "quality", "rules", "context", "coverage", "model"];

/** 통합 지식그래프 시안 — 🔴 DB를 읽지 않는다(예시 값). 문은 경영 분석과 같다(대시보드 권한 + 원장·관리자). */
export default async function Page({ searchParams }: { searchParams: Promise<{ month?: string; student?: string; teacher?: string; tab?: string }> }) {
  await requireManagementSample();
  const params = await searchParams, today = kstToday();
  const months = SAMPLE_MONTHS.filter(m => m <= today.slice(0, 7));
  const month = months.includes(params.month as typeof months[number]) ? params.month! : months.at(-1)!;
  const data = sampleAcademyKnowledge({ month, today, student: params.student, teacher: params.teacher });
  return <KnowledgeWorkspace data={data} months={months} initialTab={TABS.includes(params.tab ?? "") ? params.tab : "graph"}/>;
}
