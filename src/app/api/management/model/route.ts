import { saveStudio } from "@/features/academy-knowledge/studio-server";
import { sameOriginJsonPost } from "@/lib/http/same-origin-json";

/** 스키마 스튜디오 저장 — 권한('경영 분석·지식그래프' 전체)·연결 대상 재확인은 studio-server.ts · 표 academy_model_versions(s2_0068). */
export async function POST(request: Request) {
  return sameOriginJsonPost(request, 12000, "academy-model-studio", (body) => saveStudio(body));
}
