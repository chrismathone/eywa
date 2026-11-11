import { requireManagementSample } from "@/features/mockup/access";
import { kstToday } from "@/lib/date-kst";
import { loadAcademyKnowledge } from "@/features/academy-knowledge/server";
import { KnowledgeWorkspace } from "@/features/academy-knowledge/workspace";

export const metadata = { title: "통합 지식그래프 — 에이와" };
const TABS = ["schema", "graph", "quality", "rules", "context", "coverage", "model"];

/** 통합 지식그래프 — 문 = '경영 분석·지식그래프' 권한(management · 기본값 원장만). 실제 기록(수강·OKR·관찰·스튜디오)을 읽는다. */
export default async function Page({ searchParams }: { searchParams: Promise<{ month?: string; student?: string; teacher?: string; tab?: string }> }) {
  await requireManagementSample();
  const params = await searchParams, current = kstToday().slice(0, 7);
  // 고를 수 있는 달 = 이번 달부터 거슬러 24개월(미래 달은 없다).
  const [y, m] = current.split("-").map(Number);
  const months = Array.from({ length: 24 }, (_, i) => { const d = new Date(Date.UTC(y!, m! - 1 - i, 1)); return d.toISOString().slice(0, 7); }).reverse();
  const month = months.includes(params.month ?? "") ? params.month! : current;
  const data = await loadAcademyKnowledge({ month, student: params.student || undefined, teacher: params.teacher || undefined }).catch((e) => { console.error("[academy-knowledge] load", e); return null; });
  if (!data) return <section className="p-8"><h1>통합 지식그래프</h1><p>지식그래프를 불러오지 못했습니다. 분석 월·대상 학생·강사를 확인하거나 잠시 후 다시 열어 주세요.</p></section>;
  return <KnowledgeWorkspace data={data} months={months} initialTab={TABS.includes(params.tab ?? "") ? params.tab : "graph"}/>;
}
