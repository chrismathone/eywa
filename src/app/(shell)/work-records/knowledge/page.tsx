import { requireAccess } from "@/lib/auth/require-access";
import { kstToday } from "@/lib/date-kst";
import { sampleKnowledgeRecords } from "@/features/academy-knowledge/sample-data";
import { KnowledgeRecordsWorkspace } from "@/features/academy-knowledge/record-workspace";

export const metadata = { title: "관찰·후속 조치·OKR — 에이와" };

/** 관찰·후속 조치·OKR 시안 — 🔴 DB를 읽지 않는다(예시 값). 문 = 업무 작성센터와 같은 '업무 작성센터' 권한(work_records · 2026-11-09). */
export default async function Page({ searchParams }: { searchParams: Promise<{ kind?: string; record?: string; student?: string; rule?: string }> }) {
  await requireAccess("work_records");
  return <KnowledgeRecordsWorkspace data={sampleKnowledgeRecords(kstToday())} params={await searchParams}/>;
}
