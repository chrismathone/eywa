import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { canManageTenant } from "@/lib/auth/perm-matrix";
import { loadStudentBusyWindows } from "@/features/timetable/server/student-busy";

/**
 * 시간표에서 학생을 **집는 순간** 그 학생의 다른 과목 일정을 받아 오는 경량 JSON
 * (원장 2026-09-09 *"영어를 듣는 학생이면 영어 스케줄 때문에 이동이 불가능한 곳은 … 차단시켜"*).
 *
 * 🔴 **서버 액션이 아니라 라우트 핸들러인 이유**: 서버 액션의 응답은 현재 라우트의 RSC 트리를 다시
 *    적용한다([[#102]]) — 그게 드래그 도중에 도착하면 끌고 있던 줄이 언마운트되어 드래그가 죽는다.
 *    라우트 핸들러는 그냥 JSON이라 화면을 건드리지 않는다.
 * 🔴 **실패는 조용히 빈 배열**(fail-open) — 이 값은 표식이지 게이트가 아니다. 못 받아 오면 빗금이 안 서고
 *    종전과 똑같이 동작한다(거짓 차단이 표식 없는 것보다 나쁘다). 그래서 권한 거절도 200 + 빈 배열이다.
 * ⚠️ 내려보내는 것은 **배치 시각과 반 이름뿐**이다(이름·성적 없음). 그 위에 RLS가 한 겹 더 있다.
 * 🔴 게이트는 **시간표를 볼 수 있나가 아니라 끌 수 있나**다(`canManageTenant("classes")` = 화면의 `canEdit`
 *    과 같은 값, [[#77]]) — 이 답은 드래그 표식에만 쓰이므로 열람 권한만으로 열면 담당 반만 보는 강사가
 *    학생 id만 알면 남의 반 시간표를 되짚을 수 있다. 필요 없는 문은 안 연다.
 */
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user || !(await canManageTenant(user.systemRole, "classes")))
    return NextResponse.json({ windows: [] });
  const url = new URL(request.url);
  const studentId = url.searchParams.get("studentId") ?? "";
  const weekMonday = url.searchParams.get("week") ?? "";
  const excludeClassId = url.searchParams.get("exclude");
  const out = await loadStudentBusyWindows({ studentId, weekMonday, excludeClassId });
  return NextResponse.json(out);
}
