import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { searchExploreTargets } from "@/features/explore/server/search";

/**
 * 연결 탐색 검색(원생·수업·강사) — 로그인만 확인하고, 스코프는 조회 안에서 건다(검색 팰릿 라우트와 같은 규칙, [[#77]]).
 * 신원 = 보는 강사(`teacherView` — 담당·본인 판정, #154 ①). 감사·인증과 무관한 읽기라 강사뷰에서는 그 강사로 찾는다.
 * q < 2글자면 빈 결과. 라우트 핸들러라 redirect 불가 → 401 JSON.
 */
export async function GET(request: Request) {
  const user = await getCurrentUser({ teacherView: true });
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const q = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  if (q.length < 2) return NextResponse.json({ hits: [] });
  try {
    return NextResponse.json({ hits: await searchExploreTargets(q, user) });
  } catch (e) {
    console.error("[explore] 검색 실패:", e);
    return NextResponse.json({ error: "search_failed" }, { status: 500 });
  }
}
