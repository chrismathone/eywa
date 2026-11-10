import { SampleBanner } from "@/features/mockup/sample";
import { requireSampleViewer } from "@/features/marketing/sample-access";
import { sampleMarketing, SAMPLE_TODAY } from "@/features/marketing/sample-data";
import { MarketingWorkspace } from "@/features/marketing/workspace";

export const metadata = { title: "홍보·마케팅 — 에이와" };

/** 홍보·마케팅 성과 시안 — 🔴 DB를 읽지 않는다(예시 값). */
export default async function MarketingPage({ searchParams }: { searchParams: Promise<{ year?: string; campaign?: string }> }) {
  await requireSampleViewer();
  const p = await searchParams, year = Number(p.year ?? SAMPLE_TODAY.slice(0, 4));
  if (!Number.isInteger(year) || year < 2024 || year > 2100) return <p>조회 연도를 확인해 주세요.</p>;
  return <><SampleBanner/><MarketingWorkspace data={sampleMarketing(year)} selectedId={p.campaign}/></>;
}
