import { NextResponse } from "next/server";
import { knowledgeHistory, saveKnowledgeRecord } from "@/features/academy-knowledge/server-records";
import { sameOriginJsonPost } from "@/lib/http/same-origin-json";

/** 관찰·후속 조치·OKR·운영 보완 자료 저장 — 권한·담당 학생 판정은 server-records.ts · 표 academy_knowledge_records(s2_0049 · s2_0059). */
export async function POST(request: Request) {
  return sameOriginJsonPost(request, 20000, "academy-knowledge-records", (body) => saveKnowledgeRecord(body));
}

/** 한 기록의 변경 이력 — 화면에서 '변경 이력'을 펼칠 때만(목록은 최신 버전만 싣는다). */
export async function GET(request: Request) {
  const headers = { "Cache-Control": "private, no-store" };
  try { return NextResponse.json(await knowledgeHistory(new URL(request.url).searchParams.get("id") ?? ""), { headers }); }
  catch { return NextResponse.json({ error: "기록 또는 열람 권한을 확인해 주세요" }, { status: 403, headers }); }
}
