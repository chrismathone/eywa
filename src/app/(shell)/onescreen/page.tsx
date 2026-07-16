import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getShellView } from "@/lib/auth/view-mode";
import { getPermMatrix } from "@/lib/auth/perm-matrix";
import { roleHome } from "@/lib/permissions";
import { getTeacherRoster } from "@/features/onescreen/server/roster";
import { OneScreenClient } from "@/features/onescreen/components/onescreen-client";

export const metadata = { title: "선생님 원스크린 — eywa" };

/**
 * 선생님 원스크린 — 강사 전용 수업 마감 화면.
 * 서버 컴포넌트: 권한 게이트 + 강사 본인의 오늘 반·학생 실데이터 조회(roster).
 * 진도·테스트·태도는 클라이언트 state로 입력하고, 보고서 발송은 lesson_reports에 영속화한다.
 *
 * ⚠️ 게이트는 **뷰 기준**(role 기준 requireAccess 아님): 원스크린은 실 강사뿐 아니라 **겸직**(관리자 계열이
 * '강사뷰로 전환' + 담당 반 보유)도 자기 담당 반을 마감·클래스노트 작성해야 한다. teacher_onescreen 권한은
 * role 기준 none이라 requireAccess로 막으면 겸직이 대시보드로 튕긴다(그게 버그였음). getShellView()가
 * "실 teacher OR effectiveTeacherId(쿠키+담당반)"를 단일 소스로 판정 → roster는 어차피 teacher_id=본인으로
 * 좁혀 스코프 안전(관리자 권한이어도 자기 반만 로드).
 */
export default async function OneScreenPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if ((await getShellView()) !== "teacher") {
    redirect(roleHome(user.systemRole, await getPermMatrix()));
  }
  const { date } = await searchParams;
  const roster = await getTeacherRoster(date);
  return (
    // key=대상 날짜 — 날짜 이동(searchParam) 시 클라 상태를 새 날짜 로스터로 재초기화(useState는 최초 1회만).
    <OneScreenClient
      key={roster.date}
      initial={roster.students}
      today={roster.today}
      date={roster.date}
      classTags={roster.classTags}
      todayClasses={roster.todayClasses}
      allowTeacherTestMax={roster.allowTeacherTestMax}
      showDailyTest={roster.showDailyTest}
      showCheckTest={roster.showCheckTest}
      noticeMode={roster.noticeMode}
      academyNoticeMode={roster.academyNoticeMode}
      classnoteSendEnabled={roster.classnoteSendEnabled}
      // 다른 창/기기 동시 열림 경고(3-3) — teacherId는 서버 파생(user.id = 담당 반 소유자, 겸직 포함).
      presenceScope={`onescreen:${user.id}:${roster.date}`}
    />
  );
}
