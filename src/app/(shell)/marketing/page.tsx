import { SampleBanner } from "@/features/mockup/sample";
import { requireSampleViewer } from "@/lib/auth/sample-viewer";
import { sampleOperations } from "@/features/marketing/sample-data-operations";
import { OperationsWorkspace } from "@/features/marketing/operations-workspace";

export const metadata = { title: "연간 운영계획 · 홍보마케팅 — 에이와" };

/** 연간 운영계획 시안 — 🔴 DB를 읽지 않는다(예시 값). 저장은 안내만 띄운다. */
export default async function Page({ searchParams }: { searchParams: Promise<{ event?: string; view?: string; year?: string }> }) {
  await requireSampleViewer();
  const p = await searchParams;
  return <><SampleBanner/><OperationsWorkspace key={p.event ?? "annual"} data={sampleOperations(p.event)} initialView={p.view} initialYear={p.year}/></>;
}
