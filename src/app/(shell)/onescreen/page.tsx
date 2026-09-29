import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getShellView, viewAsTeacher } from "@/lib/auth/view-mode";
import { getPermMatrix } from "@/lib/auth/perm-matrix";
import { roleHome } from "@/lib/permissions";
import { getTeacherRoster } from "@/features/onescreen/server/roster";
import { resolveReportAuthorName } from "@/features/onescreen/server/report-author-name";
import { getJjAccess } from "@/features/ijw/server/queries";
import { getClassnoteMatchMap } from "@/features/onescreen/server/classnote-match";
import { pickCnForClasses } from "@/features/onescreen/classnote-match";
import { parseView } from "@/features/onescreen/view";
import { OneScreenClient } from "@/features/onescreen/components/onescreen-client";
import { TodayAttendanceStrip } from "@/features/attendance/live/components/today-strip";
import { VideoHomeworkProvider } from "@/features/video-homework/components/video-homework-provider";
import { getVideoHomeworkMarks } from "@/features/video-homework/server/queries";

export const metadata = { title: "선생님 원스크린 — 에이와" };

/**
 * ⚠️ 서버 액션은 **호출된 세그먼트의 maxDuration**을 따른다(등록상담 상세 선례). 기본값은 15초라
 * AI 호출 하나에도 빠듯하다 — 자동작성(`generateReportComment`)이 폴백을 타면 플랫폼이 중간에 죽여
 * **멘트가 또 템플릿으로 떨어진다**([[#118]]을 고쳐 놓고 같은 증상을 다시 만드는 셈).
 * 실측: Haiku 2~3초 · DeepSeek v4-flash 7.3초 · v4-pro는 86초였다(그래서 폴백을 flash로 되돌렸다).
 * 크레딧이 비면 **전건이 폴백 경로**로 오므로 여유를 크게 잡는다(상한일 뿐 과금은 실사용분).
 */
export const maxDuration = 300;

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
  // 발송용 이름(0217a)은 병렬 fail-soft 조회(B4) — **이 화면에서 지금 저장하는 보고서**(teacher_name=
  // 본인 실명 기록)의 발송 표기와 미리보기를 맞춘다. ⚠️ 옛 별칭 보강 행(pre-0172a, teacher_name이 실명이
  // 아닌 행)은 /r가 행별 저장값으로 해석하므로 미리보기와 다를 수 있다(재저장하면 실명으로 갱신돼 일치).
  // ⚠️ 로스터(전원 핫패스)에 새 컬럼을 넣지 않는다(#95) — 실패해도 sendName=null이라 실명으로 그대로 산다.
  // '다른 강사 뷰'(열람 전용)면 로스터·발송용 이름 모두 그 강사 기준(로스터는 내부에서 같은 판정 공유).
  const viewAs = await viewAsTeacher();
  const [roster, sendName, jjAccess, classnoteMatch] = await Promise.all([
    getTeacherRoster(date, all === "1"),
    resolveReportAuthorName(user.tenantId, viewAs?.displayName ?? user.displayName),
    // 인재원 짝 잇기 권한 — JJ실 짝 잇기 구역과 **같은 함수**(ijw/server/viewer.ts). 영어 칸 '미연결' 줄의 링크만 켠다.
    // 실패해도 링크만 빠진다(관리자에게 요청하라는 문구로 떨어진다) — 전원 핫패스라 이 조회가 화면을 막으면 안 된다.
    getJjAccess().catch(() => null),
    // ClassNote 반 보드 매칭(0302a, 'C.N' 알약) — 로스터와 독립(B4). 함수 안에서 실패를 삼켜 라벨만 뺀다(#95 핫패스).
    getClassnoteMatchMap(),
  ]);
  // 진입 지정(2026-08-07) — '오늘 ECS' 카드에서 `?class=&student=`로 넘어온다.
  // 🔴 **로스터 안에 실제로 있을 때만** 넘긴다. 남의 반 id를 URL에 적어도 여기서 걸러지고(로스터는 이미
  //    담당 반으로 좁혀져 있다), 없는 값이면 조용히 '전체'로 떨어진다(빈 화면·에러 대신 기존 동작).
  //    반 필터 state는 **이름 축**이라 id를 이름으로 해석해 내린다.
  const initialClassName = classId ? (roster.todayClasses.find((c) => c.id === classId)?.name ?? null) : null;
  const initialStudentId =
    studentId && roster.students.some((s) => s.id === studentId) ? studentId : null;
  const videoHomeworkMarks = await getVideoHomeworkMarks(user.tenantId, roster.students.map((student) => student.id), roster.date);
  return (
    <>
      {/* '다른 강사 뷰' 열람 배너 — 이 화면의 입력·발송은 서버가 전부 거절한다(perm-matrix 캡 +
          readonlyTeacherViewError). 배너가 없으면 타이핑해 놓고 저장이 안 되는 이유를 알 수 없다. */}
      {viewAs ? (
        <div className="bg-purple-soft text-purple mb-3 rounded-lg px-3 py-2 text-sm font-medium">
          {viewAs.displayName || "이름 없음"} 강사의 화면을 열람 중입니다 — 이 화면에서는 저장·발송이 되지 않습니다.
        </div>
      ) : null}
      {/* 오늘 출석 미입력 스트립(2026-08-14) — 출결을 '보고서 마감의 부산물'에서 '수업 직후의 행동'으로
          옮기는 자리. ⚠️ Suspense로 감싼다: 전원이 매일 여는 hot path라 이 조회가 첫 페인트를 막으면 안
          된다(B7). 다 찍은 날엔 컴포넌트가 스스로 null을 돌려 아무 것도 그리지 않는다. */}
      <Suspense fallback={null}>
        <TodayAttendanceStrip />
      </Suspense>
      {/* key=대상 날짜 — 날짜 이동(searchParam) 시 클라 상태를 새 날짜 로스터로 재초기화(useState는 최초 1회만). */}
      <VideoHomeworkProvider initial={videoHomeworkMarks} checkDate={roster.date}
        policy={roster.reportSettings.videoHomeworkPolicy}>
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
      // '다른 강사 뷰'(열람 전용) — 카드·표의 입력·발송·저장 UI를 실제로 잠근다(서버 가드의 거울).
      readonlyView={!!viewAs}
      // 글씨 크기(작음/보통/큼) — 계정 저장값. 서버가 확정해 내리므로 첫 렌더부터 정확하다(하이드레이션 안전).
      initialFontSize={roster.fontSize}
      initialTrendOptOut={roster.trendOptOut}
      noClassesToday={roster.noClassesToday}
      showingAll={roster.showingAll}
      // 카드 뷰 우측 '학부모 미리보기'(2026-08-05) — /r·인쇄와 같은 컴포넌트에 넘길 재료. 표시 전용.
      // 발송용 이름이 있으면 그 이름으로(지금 저장·발송될 보고서 기준) — 저장되는 teacher_name(귀속 축)은 불변.
      teacherName={sendName ?? roster.teacherName}
      reportSettings={roster.reportSettings}
      academyName={roster.academyName}
      logoSrc={roster.logoSrc}
      // 다른 창/기기 동시 열림 경고(3-3) — teacherId는 서버 파생(user.id = 담당 반 소유자, 겸직 포함).
      // '다른 강사 뷰'는 대상 강사의 scope를 **읽기만** 한다(그 강사가 지금 작업 중이면 경고로 보임).
      // 내 track은 EditPresenceProvider trackDisabled가 전면 차단 — 강사 화면엔 아무것도 안 뜬다.
      presenceScope={`onescreen:${viewAs?.id ?? user.id}:${roster.date}`}
      // 날짜 이동은 위 key로 클라를 재마운트하므로 뷰(표·발송현황 등)는 URL로 넘겨받아야 유지된다.
      initialView={parseView(view)}
      initialClassName={initialClassName}
      initialStudentId={initialStudentId}
      canLinkIjw={!!jjAccess?.canLink}
      // 이 강사 로스터의 반만 — 다른 반 학생의 보류 사유를 내려보내지 않는다.
      classnoteMatch={pickCnForClasses(
        classnoteMatch,
        roster.students.flatMap((s) => s.subjects.map((su) => su.classId).filter((id): id is string => !!id)),
      )}
      />
      </VideoHomeworkProvider>
    </>
  );
}
