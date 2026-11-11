import { requireAccess } from "@/lib/auth/require-access";
import { loadWorkRecords } from "@/features/work-records/server";
import { WorkRecordsWorkspace } from "@/features/work-records/workspace";

export const metadata = { title: "업무 작성센터 — 에이와" };

/** 업무 작성센터 — 문 = '업무 작성센터' 권한(work_records · 기본값 원장만 · 원장 2026-11-10). 기록 = academy_work_records(s2_0048). */
export default async function Page({ searchParams }: { searchParams: Promise<{ record?: string }> }) {
  await requireAccess("work_records");
  const [data, params] = await Promise.all([loadWorkRecords().catch((e) => { console.error("[work-records] load", e); return null; }), searchParams]);
  if (!data) return <section className="p-8"><h1>업무 작성센터</h1><p>업무 기록을 불러오지 못했습니다. 잠시 후 다시 열어 주세요. 열람·아르바이트 계정은 업무 문서를 쓰지 않습니다.</p></section>;
  return <WorkRecordsWorkspace data={data} selectedId={params.record}/>;
}
