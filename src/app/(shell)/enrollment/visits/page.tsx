import { requireAccess } from "@/lib/auth/require-access";
import { kstToday } from "@/lib/date-kst";
import { sampleJourney } from "@/features/enrollment/journey/sample-data";
import { JourneyWorkspace } from "@/features/enrollment/journey/workspace";

export const metadata = { title: "방문·등록 점검 — 에이와" };

/** 방문·등록 점검 시안 — 🔴 DB를 읽지 않는다(예시 값). 기록 표(enrollment_journey_records)가 연결되기 전까지 저장도 하지 않는다. */
export default async function Page({ searchParams }: { searchParams: Promise<{ year?: string }> }) {
  await requireAccess("enrollment");
  const p = await searchParams;
  return <JourneyWorkspace data={sampleJourney(kstToday(), Number(p.year))} />;
}
