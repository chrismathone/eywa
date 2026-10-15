import { canManageStudentStatusNow } from "@/features/students/server/status-access";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { loadEndScope } from "@/features/timetable/server/end-scope";

/**
 * 시간표 '수강 종료' 확인 팝업이 **이 반만 종강 / 그 과목 수강종료 / 퇴원**을 가려 말하기 위한 경량 JSON
 * (원장 2026-09-14). 판정은 [`loadEndScope`](@/features/timetable/server/end-scope).
 *
 * 🔴 **서버 액션이 아니라 라우트 핸들러**: 서버 액션 응답은 현재 라우트의 RSC 트리를 다시 적용한다([[#102]]) —
 *    읽기만 하는 조회로 시간표를 다시 그릴 이유가 없다(student-busy와 같은 규약).
 * 🔴 게이트 = 저장과 **같은 문**(`endSingleEnrollment`의 students full, [[#77]]) — 종료할 수 없는 사람에게는 필요 없는
 *    답이고, 열람 권한만으로 열면 학생 id로 남의 수강 이력을 되짚는 문이 된다.
 * 🔴 실패·거절은 200 + `result: null` — 팝업은 중립 문구로 떨어진다(문구는 게이트가 아니다).
 */
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user || !(await canManageStudentStatusNow()))
    return NextResponse.json({ result: null });
  const url = new URL(request.url);
  const result = await loadEndScope({
    enrollmentId: url.searchParams.get("enrollmentId") ?? "",
    date: url.searchParams.get("date") ?? "",
  });
  return NextResponse.json({ result });
}
