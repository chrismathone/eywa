import { NextResponse } from "next/server";
import { loadFieldAudit, saveStudio } from "@/features/academy-knowledge/studio-server";
import { sameOriginJsonPost } from "@/lib/http/same-origin-json";

/** 스키마 스튜디오 저장 — 권한('경영 분석·지식그래프' 전체)·연결 대상 재확인은 studio-server.ts · 표 academy_model_versions(s2_0051). */
export async function POST(request: Request) {
  return sameOriginJsonPost(request, 12000, "academy-model-studio", (body) => saveStudio(body));
}

/** 원본 빈값 점검 — 학생·강좌·직원 원본을 다 읽는 무거운 조회라 화면의 '점검 실행' 버튼을 누를 때만 돈다(페이지 로드로는 안 돈다). */
export async function GET() {
  const headers = { "Cache-Control": "private, no-store" };
  try { return NextResponse.json(await loadFieldAudit(), { headers }); }
  catch (e) {
    const denied = e instanceof Error && e.message.includes("권한");
    if (!denied) console.error("[academy-knowledge] audit", e);
    return NextResponse.json({ error: denied ? "열람 권한을 확인해 주세요" : "점검하지 못했습니다. 잠시 후 다시 실행해 주세요" }, { status: denied ? 403 : 500, headers });
  }
}
