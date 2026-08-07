import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getShellView } from "@/lib/auth/view-mode";
import { getPermMatrix } from "@/lib/auth/perm-matrix";
import { roleHome } from "@/lib/permissions";
import { getTeacherRoster } from "@/features/onescreen/server/roster";
import { parseView } from "@/features/onescreen/view";
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
  searchParams: Promise<{ date?: string; view?: string; all?: string; class?: string; student?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if ((await getShellView()) !== "teacher") {
    redirect(roleHome(user.systemRole, await getPermMatrix()));
  }
  const { date, view, all, class: classId, student: studentId } = await searchParams;
  // all=1 = 강사가 '담당 반 전체 보기'를 명시로 고른 상태. 기본은 그 요일 수업만(폴백 금지).
  const roster = await getTeacherRoster(date, all === "1");
  // 진입 지정(2026-08-07) — '오늘 ECS' 카드에서 `?class=&student=`로 넘어온다.
  // 🔴 **로스터 안에 실제로 있을 때만** 넘긴다. 남의 반 id를 URL에 적어도 여기서 걸러지고(로스터는 이미
  //    담당 반으로 좁혀져 있다), 없는 값이면 조용히 '전체'로 떨어진다(빈 화면·에러 대신 기존 동작).
  //    반 필터 state는 **이름 축**이라 id를 이름으로 해석해 내린다.
  const initialClassName = classId ? (roster.todayClasses.find((c) => c.id === classId)?.name ?? null) : null;
  const initialStudentId =
    studentId && roster.students.some((s) => s.id === studentId) ? studentId : null;
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
      sendWindow={roster.sendWindow}
      showAttachments={roster.showAttachments}
      canEditAttendance={roster.canEditAttendance}
      // 글씨 크기(작음/보통/큼) — 계정 저장값. 서버가 확정해 내리므로 첫 렌더부터 정확하다(하이드레이션 안전).
      initialFontSize={roster.fontSize}
      noClassesToday={roster.noClassesToday}
      showingAll={roster.showingAll}
      // 카드 뷰 우측 '학부모 미리보기'(2026-08-05) — /r·인쇄와 같은 컴포넌트에 넘길 재료. 표시 전용.
      teacherName={roster.teacherName}
      reportSettings={roster.reportSettings}
      academyName={roster.academyName}
      logoSrc={roster.logoSrc}
      // 다른 창/기기 동시 열림 경고(3-3) — teacherId는 서버 파생(user.id = 담당 반 소유자, 겸직 포함).
      presenceScope={`onescreen:${user.id}:${roster.date}`}
      // 날짜 이동은 위 key로 클라를 재마운트하므로 뷰(표·발송현황 등)는 URL로 넘겨받아야 유지된다.
      initialView={parseView(view)}
      initialClassName={initialClassName}
      initialStudentId={initialStudentId}
    />
  );
}
