import { NextResponse } from "next/server";
import { requireAccess } from "@/lib/auth/require-access";
import { getStudentSummary } from "@/features/students/server/queries";

/**
 * 학생 QuickPanel(우측 오버레이)용 경량 요약 JSON.
 * server-only 쿼리(getStudentSummary)를 호출 — route handler는 서버 컨텍스트라
 * cookies adapter를 통해 RLS가 강제됨(타테넌트 학생은 row가 보이지 않아 404).
 * requireAccess는 권한(메뉴 접근) 게이트.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  await requireAccess("students");
  const { id } = await params;
  const summary = await getStudentSummary(id);
  if (!summary) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return NextResponse.json(summary);
}
