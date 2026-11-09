import { requireManagementSample } from "@/features/mockup/access";
import { monthSchema } from "@/features/management/model";
import { SAMPLE_DEFAULT_MONTH, SAMPLE_MONTHS, sampleManagement } from "@/features/management/sample-data";
import { ManagementWorkspace } from "@/features/management/workspace";

export const metadata = { title: "경영 분석 · 대시보드 — 에이와" };

/** 경영 분석 시안 — 🔴 DB를 읽지 않는다(예시 값). 문은 대시보드 권한 + 원장·관리자. */
export default async function Page({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  await requireManagementSample();
  const p = await searchParams;
  const parsed = monthSchema.safeParse(p.month);
  const month = parsed.success && (SAMPLE_MONTHS as readonly string[]).includes(parsed.data) ? parsed.data : SAMPLE_DEFAULT_MONTH;
  return <ManagementWorkspace data={sampleManagement(month)} months={SAMPLE_MONTHS}/>;
}
