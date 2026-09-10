import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { searchPalette } from "@/features/search/server/queries";
import { EMPTY_PALETTE_RESULT } from "@/features/search/palette";

/**
 * 커맨드 팰릿 데이터 검색(원생/수업/상담/등록상담). 접근 권한 있는 메뉴만, RLS로 테넌트 자동 격리.
 * q < 2글자면 빈 결과. route handler라 redirect 불가 → 401 JSON 반환.
 *
 * 🔴 **이 라우트는 팰릿 UI가 안 보이는 사람도 부를 수 있다** — 강사 미니셸엔 팰릿이 없지만 로그인만
 *    되어 있으면 주소로 직접 칠 수 있다. 그래서 강사 스코프는 화면이 아니라 `searchPalette` 안에서 건다([[#77]]).
 */
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const q = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  if (q.length < 2) return NextResponse.json(EMPTY_PALETTE_RESULT);
  return NextResponse.json(await searchPalette(q, user.systemRole));
}
