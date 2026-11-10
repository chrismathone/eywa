import { SampleBanner } from "@/features/mockup/sample";
import { AnnualPlanningWorkspace } from "@/features/marketing/annual-planning";
import { requireSampleViewer } from "@/lib/auth/sample-viewer";
import { sampleMarketing } from "@/features/marketing/sample-data";
import { sampleOperations } from "@/features/marketing/sample-data-operations";
import { attribute } from "@/features/marketing/calc";
import type { AnnualMetric } from "@/features/marketing/annual-planning-model";

export const metadata = { title: "3개년 비교 · 신년 기획 — 에이와" };

/** 3개년 비교·신년 기획 시안 — 🔴 DB를 읽지 않는다(예시 값). */
export default async function Page({ searchParams }: { searchParams: Promise<{ year?: string }> }) {
  await requireSampleViewer();
  const p = await searchParams, data = sampleOperations();
  const requested = Number(p.year), year = Number.isInteger(requested) && requested >= 2024 && requested <= 2099 ? requested : Number(data.today.slice(0, 4)) + 1;
  const metrics: AnnualMetric[] = attribute(sampleMarketing(year), "linear", 90).map((r) => ({ id: r.id, enrollments: r.ready ? r.enrollments : null, revenue: r.revenueReady ? r.revenue : null, cpe: r.cpe, roi: r.roi, gaps: r.gaps }));
  const { annualReferences, actorId, canPlan, canAnalyze, canEditCost, staff, today } = data;
  return <><SampleBanner/><AnnualPlanningWorkspace key={year} year={year} metrics={metrics} metricsAvailable data={{ annualReferences, actorId, canPlan, canAnalyze, canEditCost, staff, today }}/></>;
}
