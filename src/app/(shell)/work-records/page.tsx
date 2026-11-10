import { requireAccess } from "@/lib/auth/require-access";
import { kstToday } from "@/lib/date-kst";
import { sampleWorkRecords } from "@/features/work-records/sample-data";
import { WorkRecordsWorkspace } from "@/features/work-records/workspace";

export const metadata = { title: "업무 작성센터 — 에이와" };

/** 업무 작성센터 시안 — 🔴 DB를 읽지 않는다(예시 값). 문 = '업무 작성센터' 권한(work_records · 2026-11-09 — 전엔 대시보드 권한). 기본값 = 원장만(원장 2026-11-10 결정). */
export default async function Page({ searchParams }: { searchParams: Promise<{ record?: string }> }) {
  await requireAccess("work_records");
  return <WorkRecordsWorkspace data={sampleWorkRecords(kstToday())} selectedId={(await searchParams).record}/>;
}
