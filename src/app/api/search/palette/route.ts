import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { searchPalette } from "@/features/search/server/queries";

/**
 * 커맨드 팰릿 데이터 검색(학생/수업/상담/등록상담). 접근 권한 있는 메뉴만, RLS로 테넌트 자동 격리.
 * q < 2글자면 빈 배열. route handler라 redirect 불가 → 401 JSON 반환.
 */
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const q = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  if (q.length < 2) return NextResponse.json([]);
  const hits = await searchPalette(q, user.systemRole);
  return NextResponse.json(hits);
}
