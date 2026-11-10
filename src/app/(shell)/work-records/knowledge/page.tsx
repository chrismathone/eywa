import { requireAccess } from "@/lib/auth/require-access";
import { loadKnowledgeRecords } from "@/features/academy-knowledge/server-records";
import { KnowledgeRecordsWorkspace } from "@/features/academy-knowledge/record-workspace";

export const metadata = { title: "관찰·후속 조치·OKR — 에이와" };

/** 관찰·후속 조치·OKR — 문 = 업무 작성센터와 같은 '업무 작성센터' 권한(work_records). 기록 = academy_knowledge_records(s2_0066). */
export default async function Page({ searchParams }: { searchParams: Promise<{ kind?: string; record?: string; student?: string; rule?: string }> }) {
  await requireAccess("work_records");
  const [data, params] = await Promise.all([loadKnowledgeRecords().catch((e) => { console.error("[academy-knowledge] records", e); return null; }), searchParams]);
  if (!data) return <section className="p-8"><h1>관찰·후속 조치·OKR</h1><p>기록을 불러오지 못했습니다. 잠시 후 다시 열어 주세요. 열람·아르바이트 계정은 관찰 기록을 쓰지 않습니다.</p></section>;
  return <KnowledgeRecordsWorkspace data={data} params={params}/>;
}
