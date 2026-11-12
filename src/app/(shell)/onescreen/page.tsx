import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getShellView, viewAsTeacher } from "@/lib/auth/view-mode";
import { getPermMatrix } from "@/lib/auth/perm-matrix";
import { roleHome } from "@/lib/permissions";
import { getTeacherRoster } from "@/features/onescreen/server/roster";
import { resolveReportAuthorSettings } from "@/features/onescreen/server/report-author-name";
import { getJjAccess } from "@/features/ijw/server/queries";
import { loadClassnoteMatch } from "@/features/onescreen/server/classnote-match";
import { pickCnForRoster } from "@/features/onescreen/classnote-match";
import { parseView } from "@/features/onescreen/view";
import { OneScreenClient } from "@/features/onescreen/components/onescreen-client";
import { TodayAttendanceStrip } from "@/features/attendance/live/components/today-strip";
import { MyDutiesStrip } from "@/features/duties/components/my-duties-strip";
import { MyWorkRequestsStrip } from "@/features/work-requests/components/my-work-requests-strip";
import { VideoHomeworkProvider } from "@/features/video-homework/components/video-homework-provider";
import { getVideoHomeworkMarks } from "@/features/video-homework/server/queries";
import { getOthersReportKeys, getVideoHomeworkAssignments } from "@/features/video-homework/server/assignments";
import { getVideoHomeworkDues, type VideoHomeworkDueUi } from "@/features/video-homework/server/report-due";
import { readVideoHomeworkCancels } from "@/features/video-homework/server/cancels";
import { loadEcsTextbookOptions } from "@/features/textbooks/server/ecs-options";
import { TextbookOptionsProvider } from "@/features/textbooks/textbook-options-context";
import { pickLessonMarks } from "@/features/video-homework/lesson-marks";
import { assignmentKey, assignmentOf } from "@/features/video-homework/assignment";
import { getSubmitLinkUi } from "@/features/video-submit/server/link-choice-db";
import { EmbedLink } from "@/components/embed-link";
import { makeupRecordBack } from "@/features/makeups/components/list-navigation";

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
  searchParams: Promise<{ date?: string; view?: string; all?: string; class?: string; student?: string; return?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if ((await getShellView()) !== "teacher") {
    redirect(roleHome(user.systemRole, await getPermMatrix()));
  }
  const { date, view, all, class: classId, student: studentId, return: returnTo } = await searchParams;
  const makeupBack = makeupRecordBack(returnTo);
  // all=1 = 강사가 '담당 반 전체 보기'를 명시로 고른 상태. 기본은 그 요일 수업만(폴백 금지).
  // 발송용 이름(0217a)은 병렬 fail-soft 조회(B4) — **이 화면에서 지금 저장하는 보고서**(teacher_name=
  // 본인 실명 기록)의 발송 표기와 미리보기를 맞춘다. ⚠️ 옛 별칭 보강 행(pre-0172a, teacher_name이 실명이
  // 아닌 행)은 /r가 행별 저장값으로 해석하므로 미리보기와 다를 수 있다(재저장하면 실명으로 갱신돼 일치).
  // ⚠️ 로스터(전원 핫패스)에 새 컬럼을 넣지 않는다(#95) — 실패해도 sendName=null이라 실명으로 그대로 산다.
  // '다른 강사 뷰'(열람 전용)면 로스터·발송용 이름 모두 그 강사 기준(로스터는 내부에서 같은 판정 공유).
  const viewAs = await viewAsTeacher();
  const [roster, sendName, jjAccess, classnoteMatch, mathBooks] = await Promise.all([
    getTeacherRoster(date, all === "1"),
    resolveReportAuthorSettings(user.tenantId, viewAs?.displayName ?? user.displayName),
    // 인재원 짝 잇기 권한 — JJ실 짝 잇기 구역과 **같은 함수**(ijw/server/viewer.ts). 영어 칸 '미연결' 줄의 링크만 켠다.
    // 실패해도 링크만 빠진다(관리자에게 요청하라는 문구로 떨어진다) — 전원 핫패스라 이 조회가 화면을 막으면 안 된다.
    getJjAccess().catch(() => null),
    // ClassNote 반 보드 매칭(0302a, 'C.N' 알약) — 로스터와 독립(B4). 함수 안에서 실패를 삼켜 라벨만 뺀다(#95 핫패스).
    // '그날 다니는 반'(물음표 판정)은 로스터와 같은 날짜로 본다(지난 날짜 로스터 — 함수 안에서 같은 resolveReportDate).
    loadClassnoteMatch(date),
    // 수학 교재명 칸 제안(원장 2026-10-27, math-book-list.ts) — 교재목록 마스터를 ECS와 같은 캐시 경로로. fail-soft(실패=제안 없음, #95 핫패스).
    loadEcsTextbookOptions("math"),
  ]);
  // 진입 지정(2026-08-07) — '오늘 ECS' 카드에서 `?class=&student=`로 넘어온다.
  // 🔴 **로스터 안에 실제로 있을 때만** 넘긴다. 남의 반 id를 URL에 적어도 여기서 걸러지고(로스터는 이미
  //    담당 반으로 좁혀져 있다), 없는 값이면 조용히 '전체'로 떨어진다(빈 화면·에러 대신 기존 동작).
  //    반 필터 state는 **이름 축**이라 id를 이름으로 해석해 내린다.
  const initialClassName = classId ? (roster.todayClasses.find((c) => c.id === classId)?.name ?? null) : null;
  const initialStudentId =
    studentId && roster.students.some((s) => s.id === studentId) ? studentId : null;
  // 영상 숙제 검사 + '영상 과제 있음/없음'(0308a) — 서로 독립이라 나란히(B4). 과제 값은 로스터 select에 넣지 않고
  // 따로 읽는다(#95). 🔴 전원 핫패스라 **필요한 날짜만**(각 행의 직전 수업일 + 오늘) 읽고, 학원이 영상 숙제를 꺼 뒀으면 읽지 않는다.
  const rosterStudentIds = roster.students.map((student) => student.id);
  const videoHwPolicy = roster.reportSettings.videoHomeworkPolicy;
  const videoHwDates = [roster.date, ...roster.students.flatMap((st) => st.subjects.map((su) => su.prevReport?.date ?? ""))];
  // 영상 제출 현황에서 먼저 찍은 같은 숙제의 기록도 이 칸 것이다(같은 숙제 = 한 칸) — 행마다 지난 수업일로 찾는다.
  const videoHwTargets = roster.students.flatMap((st) => st.subjects.flatMap((su) =>
    su.classId ? [{ classId: su.classId, studentId: st.id, homeworkDate: su.prevReport?.date ?? null }] : []));
  // 영상 첨부 링크 넣기(0328a) — 토글을 그릴 단계와 오늘 저장된 고르기. 실패·칸 미적용은 off(토글 없음 · 값 안 보냄).
  // 다른 선생님이 처음 쓴 오늘 보고서 줄(작성 계정 0172a) — 그 줄의 '영상 과제'는 잠근다(report-owner.ts 화면 겹, 실패 = 안 잠금).
  // 영상 숙제 마감(원장 2026-10-15) — 오늘 저장된 '다음 수업' 마감. 실패·칸 미적용은 ready=false(마감 토글 없음 · 값 안 보냄).
  // 장부에서 취소한 오늘 숙제(원장 2026-10-16, `cancels.ts`) — 세션 초안이 쥔 '있음'보다 보고서의 '없음'이 이긴다(아래). 읽은 시각은
  // 저장 관문이 "이 화면이 취소를 알았나"를 가를 때 쓴다(공급자 `seenAt`). 실패·표 없음은 빈 지도(종전 동작).
  const [loadedMarks, loadedAssignments, submitLinkUi, othersReportKeys, videoDueUi, videoHwCancels] = await Promise.all([
    getVideoHomeworkMarks(user.tenantId, rosterStudentIds, roster.date,
      videoHwPolicy.enabled ? videoHwTargets.flatMap((t) => (t.homeworkDate ? [t.homeworkDate] : [])) : []),
    // 지난 수업일엔 보고서 없이 따로 낸 숙제도 '있음'으로(검사 칸이 숨지 않게) — 오늘 값은 보고서 토글이라 덮지 않는다.
    videoHwPolicy.enabled ? getVideoHomeworkAssignments(user.tenantId, rosterStudentIds, videoHwDates,
      { issuedDates: videoHwTargets.flatMap((t) => (t.homeworkDate && t.homeworkDate !== roster.date ? [t.homeworkDate] : [])) }) : Promise.resolve({}),
    videoHwPolicy.enabled
      ? getSubmitLinkUi(user.tenantId, rosterStudentIds, roster.date)
      : Promise.resolve({ mode: "off" as const, choices: {} }),
    videoHwPolicy.enabled
      ? getOthersReportKeys(user.tenantId, rosterStudentIds, roster.date, viewAs?.id ?? user.id)
      : Promise.resolve([] as string[]),
    videoHwPolicy.enabled
      ? getVideoHomeworkDues(user.tenantId, rosterStudentIds, roster.date)
      : Promise.resolve({ ready: false, dues: {} } as VideoHomeworkDueUi),
    videoHwPolicy.enabled
      ? readVideoHomeworkCancels(user.tenantId, rosterStudentIds, roster.date)
      : Promise.resolve({ cancels: new Map<string, string>(), readAt: null }),
  ]);
  const othersReports = new Set(othersReportKeys);
  // null = 못 읽음 → 그 세션 동안 '영상 과제' 값을 보내지 않는다(저장돼 있던 '있음'을 '없음'으로 덮지 않게, 공급자 known=false).
  const videoHomeworkAssignments = loadedAssignments ?? {};
  const videoHomeworkMarks = pickLessonMarks(loadedMarks, videoHwTargets, roster.date);
  // 오늘 이미 저장한 보고서의 '영상 과제' — 세션에 값이 없을 때만 되채운다(세션 = 작업 중 편집이 이긴다, roster ⑤ 규약).
  const cancelOverridden: string[] = [];
  for (const st of roster.students) {
    for (const su of st.subjects) {
      if (!su.classId) continue;
      // 🔴 다른 선생님이 처음 쓴 줄은 **저장된 값이 이긴다** — 내 세션이 쥔 값(이 가드 전에 눌렀던 값)을 보여 주면
      //    화면과 실제가 갈린다(저장 관문이 그 값을 적지 않는다, report-owner.ts).
      if (othersReports.has(assignmentKey(st.id, roster.date, su.classId))) {
        su.videoHomework = assignmentOf(videoHomeworkAssignments, st.id, roster.date, su.classId) ?? undefined;
        su.videoSubmitLink = assignmentOf(submitLinkUi.choices, st.id, roster.date, su.classId) ?? undefined;
        const othersDue = videoDueUi.dues[assignmentKey(st.id, roster.date, su.classId)];
        su.videoHomeworkDue = othersDue ? "next" : undefined;
        su.videoHomeworkDueDate = othersDue;
        continue;
      }
      // 장부에서 취소한 숙제(보고서 '없음' + 취소 기록) — 초안이 쥔 '있음'(취소 전에 눌렀거나 열어 둔 화면이 다시 저장한 값)보다
      // '없음'이 이긴다. 링크 넣기·마감도 함께 비운다(원스크린에서 끈 것과 같다). 다시 켜면 그때부터는 선생님 값이다(seenAt).
      if (videoHwCancels.cancels.has(assignmentKey(st.id, roster.date, su.classId))
        && assignmentOf(videoHomeworkAssignments, st.id, roster.date, su.classId) === false) {
        if (su.videoHomework === true) cancelOverridden.push(assignmentKey(st.id, roster.date, su.classId));
        su.videoHomework = false;
        su.videoSubmitLink = false;
        su.videoHomeworkDue = undefined;
        su.videoHomeworkDueDate = undefined;
        continue;
      }
      if (su.videoHomework == null) {
        const saved = assignmentOf(videoHomeworkAssignments, st.id, roster.date, su.classId);
        if (saved != null) su.videoHomework = saved;
      }
      // 마감 — 저장된 '다음 수업' 날짜는 늘 싣는다(표시). 고른 값은 세션이 없을 때만 저장값으로(날짜가 있으면 '다음 수업', 없으면 고른 적 없음 = 7일).
      const savedDue = videoDueUi.dues[assignmentKey(st.id, roster.date, su.classId)];
      if (su.videoHomeworkDue == null && savedDue) su.videoHomeworkDue = "next";
      if (savedDue) su.videoHomeworkDueDate = savedDue;
      // 선생님별 기본 마감(원장 2026-10-28, due-pref.ts) — 아직 저장한 보고서가 없는 줄만(저장된 줄의 7일을 '다음 수업'으로 덮지 않는다).
      if (su.videoHomeworkDue == null && !savedDue && videoDueUi.ready && roster.videoDueDefault === "next"
        && assignmentOf(videoHomeworkAssignments, st.id, roster.date, su.classId) == null) su.videoHomeworkDue = "next";
      // 링크 넣기도 같은 규약 — 세션에 값이 없을 때만 저장된 보고서 값으로 되채운다.
      if (su.videoSubmitLink == null) {
        const savedLink = assignmentOf(submitLinkUi.choices, st.id, roster.date, su.classId);
        if (savedLink != null) su.videoSubmitLink = savedLink;
      }
    }
  }
  return (
    <>
      {makeupBack ? <EmbedLink href={makeupBack} className="text-primary mb-3 inline-block min-h-6 underline">보강 상세로 돌아가기</EmbedLink> : null}
      {roster.makeupNotice ? <p role="status" className="border-line mb-3 rounded-lg border p-3 text-sm">{roster.makeupNotice}</p> : null}
      {/* '다른 강사 뷰' 열람 배너 — 이 화면의 입력·발송은 서버가 전부 거절한다(perm-matrix 캡 +
          readonlyTeacherViewError). 배너가 없으면 타이핑해 놓고 저장이 안 되는 이유를 알 수 없다. */}
      {viewAs?.access === "readonly" ? (
        <div className="bg-purple-soft text-purple mb-3 rounded-lg px-3 py-2 text-sm font-medium">
          {viewAs.displayName || "이름 없음"} 강사의 화면을 열람 중입니다 — 이 화면에서는 저장·발송이 되지 않습니다.
        </div>
      ) : null}
      {/* 오늘 출석 미입력 스트립(2026-08-14) — 출결을 '보고서 마감의 부산물'에서 '수업 직후의 행동'으로
          옮기는 자리. ⚠️ Suspense로 감싼다: 전원이 매일 여는 hot path라 이 조회가 첫 페인트를 막으면 안
          된다(B7). 다 찍은 날엔 컴포넌트가 스스로 null을 돌려 아무 것도 그리지 않는다. */}
      <Suspense fallback={null}>
        <TodayAttendanceStrip className="mb-4" />
      </Suspense>
      {/* 오늘 내 업무(s2_0069 의무 장부) — 오늘 출결·보고서·발송 의무의 완료도. 의무가 있을 때만 · 첫 페인트를 막지 않는다(B7). */}
      <Suspense fallback={null}>
        <MyDutiesStrip className="mb-4" />
      </Suspense>
      {/* 받은 업무 요청(관리자 '처리 요청' 등) — 받은 것이 있을 때만 선다 · 의무 줄과 따로(의무 없는 날 · 읽기 강사뷰에도) · 첫 페인트를 막지 않는다(B7). */}
      <Suspense fallback={null}>
        <MyWorkRequestsStrip className="mb-4" />
      </Suspense>
      {/* key=대상 날짜 — 날짜 이동(searchParam) 시 클라 상태를 새 날짜 로스터로 재초기화(useState는 최초 1회만). */}
      {/* key=대상 날짜 — 공급자는 검사 기록을 처음 한 번만 읽는다. 날짜를 옮겼는데 옛 날짜 기록이 남으면 일괄 검사가
          "이미 찍힘"으로 건너뛰어 화면엔 찍힌 듯 보이고 새 날짜엔 기록이 없다(적대 리뷰 2026-10-02). */}
      <VideoHomeworkProvider key={roster.date} initial={videoHomeworkMarks} checkDate={roster.date}
        policy={roster.reportSettings.videoHomeworkPolicy} assignments={videoHomeworkAssignments}
        assignmentsKnown={loadedAssignments !== null} submitLinkMode={submitLinkUi.mode} dueReady={videoDueUi.ready} othersReports={othersReportKeys}
        cancelInfo={{ readAt: videoHwCancels.readAt, overridden: cancelOverridden }}>
      {/* 페이지/시간은 원스크린이 안 쓴다 — 실어 보내지 않는다(RSC payload). 같은 이름은 한 번만(datalist key). */}
      <TextbookOptionsProvider options={[...new Set(mathBooks.map((b) => b.title))].map((title) => ({ title, pageTime: null }))}>
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
      classnoteOn={roster.classnoteOn}
      sendWindow={roster.sendWindow}
      showAttachments={roster.showAttachments}
      canEditAttendance={roster.canEditAttendance}
      // '다른 강사 뷰'(열람 전용) — 카드·표의 입력·발송·저장 UI를 실제로 잠근다(서버 가드의 거울).
      readonlyView={viewAs?.access === "readonly"}
      // 글씨 크기(작음/보통/큼) — 계정 저장값. 서버가 확정해 내리므로 첫 렌더부터 정확하다(하이드레이션 안전).
      initialFontSize={roster.fontSize}
      initialDisplayOptions={roster.displayOptions}
      initialTrendOptOut={roster.trendOptOut}
      initialTemplatePrefs={roster.templatePrefs}
      initialVideoDueDefault={roster.videoDueDefault}
      noClassesToday={roster.noClassesToday}
      showingAll={roster.showingAll}
      holidayName={roster.holidayName}
      // 카드 뷰 우측 '학부모 미리보기'(2026-08-05) — /r·인쇄와 같은 컴포넌트에 넘길 재료. 표시 전용.
      // 발송용 이름이 있으면 그 이름으로(지금 저장·발송될 보고서 기준) — 저장되는 teacher_name(귀속 축)은 불변.
      teacherName={sendName.name ?? roster.teacherName}
      reportClassNamePrefix={sendName.includeClassName}
      teacherEnglishName={sendName.englishName ?? null}
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
      // 이 강사 로스터의 반만 — 다른 반 학생의 보류 사유를 내려보내지 않는다. 다른 반 보드 배정(이름만)은 이 반들을 그날 다니는 학생 것만.
      // 🔴 새로고침 없는 갱신(/api/onescreen/classnote-match)도 **같은 함수**로 좁힌다 — 같은 날짜·같은 반이면 같은 결과.
      classnoteMatch={pickCnForRoster(
        classnoteMatch,
        roster.students.flatMap((s) => s.subjects.map((su) => su.classId).filter((id): id is string => !!id)),
      )}
      />
      </TextbookOptionsProvider>
      </VideoHomeworkProvider>
    </>
  );
}
