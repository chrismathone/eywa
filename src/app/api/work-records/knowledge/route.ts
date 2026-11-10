import { saveKnowledgeRecord } from "@/features/academy-knowledge/server-records";
import { sameOriginJsonPost } from "@/lib/http/same-origin-json";

/** 관찰·후속 조치·OKR·운영 보완 자료 저장 — 권한·담당 학생 판정은 server-records.ts · 표 academy_knowledge_records(s2_0066). */
export async function POST(request: Request) {
  return sameOriginJsonPost(request, 20000, "academy-knowledge-records", (body) => saveKnowledgeRecord(body));
}
