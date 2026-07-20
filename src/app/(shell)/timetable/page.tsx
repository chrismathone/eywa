import Link from "next/link";
import type { LucideIcon } from "@/components/icons/eywa-icon-compat";
import { Columns3, LayoutGrid, CalendarOff, ListFilter, Users } from "@/components/icons/eywa-icon-compat";
import { PhotoCard } from "@/components/atoms/photo-card";
import { PageHeader } from "@/components/page-header";
import { cookies } from "next/headers";
import { requireAccess } from "@/lib/auth/require-access";
import { effectiveTeacherId } from "@/lib/auth/view-mode";
import { getWeeklyScheduleWithStudents, getTeacherColorMap } from "@/features/timetable/server/queries";
import { settingsToPeriodsConfig } from "@/features/timetable/lib/periods";
import type { TeacherColorMap } from "@/features/timetable/lib/class-grid";
import { getTenantSettings } from "@/features/owner/server/queries";
import { getGoogleSheetsStatus } from "@/features/integrations/server/queries";
import { canManageSheetSync } from "@/features/integrations/server/sheet-access";
import { canManageTimetableImport } from "@/features/timetable/server/import-access";
import { isSheetExportSubject } from "@/features/integrations/sheets-provider";
import { buildSubjectMaps } from "@/features/owner/subjects";
import { normalizeWeekdayGrouping } from "@/features/timetable/lib/weekday-groups";
import { getWeekReferenceDate, mondayOf, thisMonday, weekRelation } from "@/features/timetable/lib/week";
import { kstToday } from "@/lib/date-kst";
import { RichGridView } from "./_components/rich-grid-view";
import {
  TimetableEditProvider,
  TimetableEditControls,
  TimetableDndArea,
} from "./_components/timetable-board";
import { TimetableToolbarActions } from "./_components/toolbar-actions";
// ⚠️ 쿠키 이름 상수는 반드시 pref-cookies(일반 모듈)에서 — prefs-sync("use client")의 export를
// 서버가 import하면 참조 프록시로 런타임 undefined가 된다(쿠키 기본값 침묵 사망, 2026-07-19 실측).
import { EMPTY_DAYS_COOKIE, EMPTY_PERIODS_COOKIE } from "@/features/timetable/lib/pref-cookies";
import { EmptyDaysPrefSync, EmptyPeriodsPrefSync } from "./_components/prefs-sync";
import { EmptyPeriodScope } from "./_components/empty-period-scope";
import { TimetableColorToggle } from "./_components/color-mode-toggle";
import { StudentTally } from "./_components/student-tally";
import { WeekNav } from "./_components/week-nav";
import { WeekdayGroupTables } from "./_components/weekday-group-tables";
import { TeacherGridView } from "./_components/teacher-grid";

export const metadata = { title: "시간표 — eywa" };

type ViewMode = "basic" | "integrated" | "teacher";
// 전부 과목별(과목칩으로 1개 선택·전환). 기본뷰 = 요일그룹밴드(교시×강사요일, 학생명단, 드래그 편집).
// 통합뷰 = 반=단위 반응형 카드 그리드(반 카드: 헤더·학생명단·정원, 읽기전용 — 한눈에 반 단위로 본다).
// 강사뷰 = 기본뷰와 같은 격자를 **슬롯 강사**(slot_teacher_label) 기준으로 재구성(시트 강사별 배치 패리티,
// 읽기전용) — 영어처럼 한 반을 (요일,교시)마다 다른 강사가 가르치는 과목용. 칩은 english에서만 노출.
// 과목 키·순서·라벨·색은 전부 학원설정(operations.subjects) 단일 소스(하드코딩 금지).

export default async function TimetablePage({
  searchParams,
}: {
  searchParams: Promise<{ view?: ViewMode; subject?: string; week?: string; compact1h?: string; emptydays?: string; emptyperiods?: string }>;
}) {
  const user = await requireAccess("timetable");
  const { view: viewParam, subject: subjectParam, week: weekRaw, compact1h: compact1hRaw, emptydays: emptydaysRaw, emptyperiods: emptyperiodsRaw } = await searchParams;
  // 강사뷰 '미사용 요일' 토글 — 기본 = 표시(강사마다 월~토 전 컬럼). emptydays=hide 일 때만 수업 요일만.
  // ⚠️ URL 파라미터가 없으면 **기기에 저장된 선호(쿠키)** 를 기본으로 쓴다 — 창(iframe)은 항상 깨끗한
  // URL로 열려서, 파라미터만으론 열 때마다 초기화됐다(주 2일 강사가 매번 넓은 표를 다시 접어야 했음).
  // 파라미터가 있으면 그쪽 우선(공유 링크 존중). 쓰기는 EmptyDaysPrefSync(클라).
  const cookieStore = await cookies();
  const savedHideEmptyDays = cookieStore.get(EMPTY_DAYS_COOKIE)?.value === "hide";
  const hideEmptyDays = emptydaysRaw ? emptydaysRaw === "hide" : savedHideEmptyDays;
  // 기본뷰 '빈 교시 접기'(C안, 2026-07-19) — 수업 없는 교시 행을 222px → 36px 밴드로 축소(행 유지 =
  // 교시 축 연속·편집 드롭 존 보존, 편집 모드는 자동 펼침). 기본 = 현행(펼침). 파라미터/쿠키 우선순위는
  // emptydays와 동일(파라미터 → 쿠키 → 기본). 쓰기는 EmptyPeriodsPrefSync(클라).
  const savedCollapseEmptyPeriods = cookieStore.get(EMPTY_PERIODS_COOKIE)?.value === "collapse";
  const collapseEmptyPeriods = emptyperiodsRaw
    ? emptyperiodsRaw === "collapse"
    : savedCollapseEmptyPeriods;
  // 통합뷰 '1시간 단위' — **섹션별 토글**(사용자 결정 2026-07-06, 전역 아님). compact1h=쉼표구분 sectionKey
  // (=시작교시 order, 자정기준 분). 든 섹션만 사이 빈 교시 행을 숨긴다. 읽기전용이라 상태는 URL 파라미터.
  const compactSections = new Set(
    (compact1hRaw ?? "")
      .split(",")
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isFinite(n) && n > 0),
  );
  const compactList = [...compactSections];
  const view: ViewMode =
    viewParam === "integrated" ? "integrated" : viewParam === "teacher" ? "teacher" : "basic";

  // 주간 이동(타임머신) — week 파라미터(그 주 아무 날)를 월요일로 정규화. 미지정=이번 주.
  // 기준 '오늘'은 KST(서버 UTC라 새벽 시간대 하루 밀림 방지). week.ts 내부 날짜 산술은 UTC 결정적 유지.
  const today = kstToday();
  const thisWk = thisMonday(today);
  const week = weekRaw && /^\d{4}-\d{2}-\d{2}$/.test(weekRaw) ? mondayOf(weekRaw) : thisWk;
  // 그 시점 명단 재구성 기준일 = ijw getWeekReferenceDate(미래주→월/이번주→오늘/과거주→일).
  const referenceDate = getWeekReferenceDate(week, today);
  const rel = weekRelation(week, today);
  const isFutureWeek = rel === "future";
  // 편집 = 이번 주(즉시 이동) 또는 미래 주(그 주에 예약). 과거 주는 조회 전용(소급 금지).
  // ⚠️ 이 값은 편집 *컨트롤* 노출뿐 아니라 **provider에도** 넘겨야 한다 — 컨트롤만 숨기면 주 이동이
  // soft nav라 provider의 editing state가 살아남아 과거 주에서도 그리드가 계속 편집 가능했다(적대 감사 F1).
  const canEdit = rel !== "past";
  // 이동 적용일 — 미래 주면 그 주 월요일에 예약, 이번 주면 오늘 즉시(undefined→RPC current_date).
  const effectiveDate = isFutureWeek ? week : undefined;

  // 강사(또는 겸직-강사뷰)는 본인 담당 반만(intra-tenant PII 누수 차단). master/직원은 전체.
  const teacherId = (await effectiveTeacherId()) ?? undefined;
  const [allSlots, settings, teacherColors] = await Promise.all([
    getWeeklyScheduleWithStudents({ referenceDate, teacherId }),
    getTenantSettings(),
    // 강사색 맵은 통합뷰(셀·담임색)·강사뷰(헤더색)에서만 필요. 기본뷰는 생략.
    view !== "basic" ? getTeacherColorMap() : Promise.resolve({} as TeacherColorMap),
  ]);
  // 교시 시각 = owner 설정(operations.weekdayPeriods/weekendPeriods) → PeriodsConfig. 미설정 시 기본 상수.
  const periodsConfig = settingsToPeriodsConfig(settings.operations);
  const subjectMaps = buildSubjectMaps(settings.operations.subjects);
  // 과목 칩 = 학원설정 과목 순서 ∩ 데이터에 실제 존재하는 과목(빈 과목칩 방지). 무조건 한 과목.
  const available = subjectMaps.options
    .map((o) => o.value)
    .filter((k) => allSlots.some((s) => s.subject === k));
  const defaultSubject = available[0] ?? "";
  const subject =
    subjectParam && available.includes(subjectParam) ? subjectParam : defaultSubject;

  // '시트 반영' 버튼 = sheet_sync 권한(기본 원장·관리자·실장, owner에서 조정) + 지원 과목(math·english) + 연동 ON.
  // 상태는 **현재 보는 과목** 기준. (subject가 allSlots·설정에 의존하므로 위 Promise.all 뒤에 조회 —
  // 권한자 한정 1회 경량 쿼리. 서버 액션도 같은 canManageSheetSync로 이중 방어.)
  const sheetsStatus =
    (await canManageSheetSync(user.systemRole)) && isSheetExportSubject(subject)
      ? await getGoogleSheetsStatus(subject)
      : null;
  const canSync = sheetsStatus?.enabled === true;
  // '가져오기'(파일 업로드) 버튼 = classes "full"만. 서버 액션도 같은 canManageTimetableImport로 이중 방어
  // (업로드 시트가 테넌트 전체 수강이라 담당 개념이 없다 — 시트 경로와 동일 규약).
  const canManageImport = await canManageTimetableImport(user.systemRole);
  // 구글 시트 URL — 대상 시트가 설정돼 있을 때만(그 과목 전용 시트).
  const sheetUrl = sheetsStatus?.spreadsheetId
    ? `https://docs.google.com/spreadsheets/d/${sheetsStatus.spreadsheetId}/edit`
    : null;
  // 평일/주말은 WeekdayGroupTables가 알아서 분리 렌더(주말은 시작시각이 달라 별도 판). 여기선 과목만 필터.
  const slots = allSlots.filter((s) => s.subject === subject);
  const subjectRow = settings.operations.subjects.find((s) => s.key === subject);
  // 과목별 요일 병합 프리셋(설정) — 미설정/구데이터는 mon-thu 폴백(resolve가 스키마 미통과).
  const weekdayGrouping = normalizeWeekdayGrouping(subjectRow?.weekdayGrouping);

  // 강사뷰 허용 = 영어 또는 강사별시간표 설정(teacherViewLines)이 있는 과목만 — URL 직입력으로
  // 비영어에 영어 전용 격자·시트 강사 순서가 렌더되던 것 서버 강제 차단(2026-07-06, effView로 렌더).
  const allowsTeacherView = (k: string) =>
    k === "english" ||
    ((settings.operations.subjects.find((s) => s.key === k)?.teacherViewLines?.length ?? 0) > 0);
  const teacherViewAllowed = allowsTeacherView(subject);
  const effView: ViewMode = view === "teacher" && !teacherViewAllowed ? "basic" : view;
  // 강사뷰 커스터마이징(과목 설정) — 가로줄 시각(분)·격자 단위. english는 resolve가 기본 프리필.
  const sectionLineMins = (subjectRow?.teacherViewLines ?? [])
    .map((t) => {
      const [h, m] = t.split(":").map(Number);
      return (h ?? 0) * 60 + (m ?? 0);
    })
    .filter((m) => Number.isFinite(m));
  const teacherViewStep = subjectRow?.teacherViewStep ?? 10;
  const teacherViewPxPerMin = subjectRow?.teacherViewPxPerMin;
  const teacherViewBreaks = subjectRow?.teacherViewBreaks ?? [];
  const teacherViewExcluded = subjectRow?.teacherViewLineExcluded ?? [];

  const isIntegrated = effView === "integrated";
  // 섹션별 '1시간 단위' 토글 href — 그 sectionKey를 압축 집합에 넣고/빼기(다른 필터·주·과목은 유지).
  const hrefForSectionToggle = (sectionKey: number) =>
    buildHref({
      view: effView,
      subject,
      defaultSubject,
      week,
      thisWk,
      compact1h: compactSections.has(sectionKey)
        ? compactList.filter((k) => k !== sectionKey)
        : [...compactList, sectionKey],
      hideEmptyDays,
      collapseEmptyPeriods,
    });
  // 상단 명단 요약(ijw식 재원/신입/전입/퇴원) — 그 주 시점(타임머신) 기준. 학생이 여러 반에 걸쳐 있어
  // studentId로 유일 집계(중복 제거). 상태 우선순위 재원>대기>퇴원(한 반 재원·다른 반 퇴원이면 재원).
  const statusOf = new Map<string, "active" | "hold" | "withdrawn">();
  const newIds = new Set<string>();
  const transferIds = new Set<string>();
  const sRank = (s: "active" | "hold" | "withdrawn") => (s === "active" ? 0 : s === "hold" ? 1 : 2);
  for (const sl of slots) {
    for (const st of sl.students) {
      const prev = statusOf.get(st.studentId);
      if (prev === undefined || sRank(st.status) < sRank(prev)) statusOf.set(st.studentId, st.status);
      if (st.isNew) newIds.add(st.studentId);
      if (st.isTransferredIn) transferIds.add(st.studentId);
    }
  }
  let enrolledCount = 0;
  let holdCount = 0;
  let withdrawnCount = 0;
  for (const s of statusOf.values()) {
    if (s === "active") enrolledCount++;
    else if (s === "hold") holdCount++;
    else withdrawnCount++;
  }
  // 신입·전입은 재원(active) 학생만 카운트(퇴원자의 옛 플래그 제외).
  const newCount = [...newIds].filter((id) => statusOf.get(id) === "active").length;
  const transferCount = [...transferIds].filter((id) => statusOf.get(id) === "active").length;

  return (
    <TimetableEditProvider effectiveDate={effectiveDate} today={today} canEdit={canEdit}>
      <div className="flex h-full min-h-0 flex-col gap-4 [.embed-main_&]:gap-3">
      {/* '미사용 요일'·'빈 교시 접기' 선호를 기기에 기억(쿠키) — 창은 깨끗한 URL로 열려 파라미터만으론 매번 초기화된다. */}
      <EmptyDaysPrefSync hide={hideEmptyDays} />
      <EmptyPeriodsPrefSync collapse={collapseEmptyPeriods} />
      {/* Editorial 문법 ① — 헤더 위계 + 우측 학생 집계(StudentTally). 시간표는 세로 공간이 가장
          귀한 화면이라 **창(임베드)에선 이 줄을 통째로 접고** 집계를 툴바 우측으로 내린다(컴팩트
          1행조차 아까움 — 2026-07-20 원장 "여전히 많은 공간"). 최상위 프레임은 풀 헤더 유지. */}
      <div className="shrink-0 [.embed-main_&]:hidden">
        <PageHeader
          eyebrow="수업 운영"
          title="시간표"
          description={`${subjectMaps.labelOf(subject)} 주간표`}
          actions={
            <StudentTally
              enrolled={enrolledCount}
              newCount={newCount}
              transferCount={transferCount}
              holdCount={holdCount}
              withdrawnCount={withdrawnCount}
            />
          }
        />
      </div>
      {/* Toolbar */}
      <div className="bg-card shadow-card flex shrink-0 flex-wrap items-center gap-3 rounded-2xl px-4 py-3">
        {/* 주간 이동(타임머신) — 과거/미래 주의 반 구성 조회 */}
        <WeekNav
          currentWeek={week}
          today={today}
          hrefForWeek={(monday) => buildHref({ view: effView, subject, defaultSubject, week: monday, thisWk, compact1h: compactList, hideEmptyDays, collapseEmptyPeriods })}
        />
        <span className="bg-line h-4 w-px" aria-hidden />

        {/* 과목 chip — 전 뷰 과목별(클릭 = 과목 전환). 강사뷰 비허용 과목으로 전환 시 기본뷰로.
            ⚠️ flex-wrap 필수 — 과목이 많은 학원(과학·국어·사회…)에서 칩이 한 줄로 강제되면 툴바가
            가로로 넘친다(칩 자체가 shrink-0이라 줄지도 않음). 형제인 toolbar-actions와 동일 규약. */}
        <div className="flex flex-wrap items-center gap-1">
          <span className="micro mr-1">과목</span>
          {available.map((k) => (
            <Link
              key={k}
              href={buildHref({
                view: effView === "teacher" && !allowsTeacherView(k) ? "basic" : effView,
                subject: k,
                defaultSubject,
                week,
                thisWk,
                // 과목 전환 = 섹션 order가 과목마다 달라 '1시간 단위' 압축 집합을 초기화(엉뚱한 섹션 압축 방지).
                // ⚠️ 단 '미사용 요일'·'빈 교시 접기' 상태는 과목과 무관한 표시 취향이라 **유지**한다 — 다른
                // 네비(주 이동·뷰 전환·강사 토글)는 전부 보존하는데 과목 칩만 떨궈 설정이 초기화됐다(적대 감사 LOW).
                hideEmptyDays,
                collapseEmptyPeriods,
              })}
              className={`shrink-0 rounded-full border px-2.5 py-0.5 text-xs transition ${
                subject === k
                  ? "border-foreground bg-foreground text-background font-medium"
                  : "border-line text-text-dim hover:text-foreground hover:bg-bg-soft"
              }`}
            >
              {subjectMaps.labelOf(k)}
            </Link>
          ))}
        </div>
        <span className="bg-line h-4 w-px" aria-hidden />

        {/* 뷰 토글 — 강사뷰는 허용 과목(영어 또는 강사별시간표 설정 보유)에서만 노출. */}
        <div className="flex items-center gap-1">
          <span className="micro mr-1">뷰</span>
          {([
            { key: "basic", label: "기본뷰", icon: Columns3 },
            { key: "integrated", label: "통합뷰", icon: LayoutGrid },
            ...(teacherViewAllowed
              ? [{ key: "teacher" as ViewMode, label: "강사뷰", icon: Users }]
              : []),
          ] as { key: ViewMode; label: string; icon: LucideIcon }[]).map((v) => {
            const Icon = v.icon;
            return (
              <Link
                key={v.key}
                href={buildHref({ view: v.key, subject, defaultSubject, week, thisWk, compact1h: compactList, hideEmptyDays, collapseEmptyPeriods })}
                className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs transition ${
                  effView === v.key
                    ? "border-primary bg-primary text-primary-foreground font-medium"
                    : "border-line text-text-dim hover:text-foreground hover:bg-bg-soft"
                }`}
              >
                <Icon size={11} strokeWidth={1.8} />
                {v.label}
              </Link>
            );
          })}
        </div>

        {/* 강사뷰 '미사용 요일' 토글 — 기본 활성(월~토 전 컬럼). 해제 시 수업 있는 요일만. */}
        {effView === "teacher" ? (
          <>
            <span className="bg-line h-4 w-px" aria-hidden />
            <Link
              href={buildHref({
                view: effView,
                subject,
                defaultSubject,
                week,
                thisWk,
                compact1h: compactList,
                hideEmptyDays: !hideEmptyDays,
                collapseEmptyPeriods,
              })}
              title="수업 없는 요일 컬럼 표시/숨김"
              className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs transition ${
                !hideEmptyDays
                  ? "border-primary bg-primary text-primary-foreground font-medium"
                  : "border-line text-text-dim hover:text-foreground hover:bg-bg-soft"
              }`}
            >
              <CalendarOff size={11} strokeWidth={1.8} />
              미사용 요일
            </Link>
          </>
        ) : null}

        {/* 통합뷰 '1시간 단위' 토글은 전역이 아니라 **각 섹션 헤더(RichGridView)** 에 있다
            (사용자 결정 2026-07-06 — 각 교시 시작별로 세팅). 툴바 전역 토글 없음. */}

        {/* 기본뷰 '빈 교시 접기' — 수업 없는 교시 행을 얇은 밴드로 축소(C안). 켜짐=강조.
            편집 모드에선 접힌 행이 자동으로 펼쳐진다(평소 격자 지형 복원, EmptyPeriodScope). */}
        {effView === "basic" ? (
          <>
            <span className="bg-line h-4 w-px" aria-hidden />
            <Link
              href={buildHref({
                view: effView,
                subject,
                defaultSubject,
                week,
                thisWk,
                compact1h: compactList,
                hideEmptyDays,
                collapseEmptyPeriods: !collapseEmptyPeriods,
              })}
              title="수업 없는 교시 행을 얇게 접기/펼치기 (편집 중엔 자동으로 펼쳐짐)"
              className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs transition ${
                collapseEmptyPeriods
                  ? "border-primary bg-primary text-primary-foreground font-medium"
                  : "border-line text-text-dim hover:text-foreground hover:bg-bg-soft"
              }`}
            >
              <ListFilter size={11} strokeWidth={1.8} />
              빈 교시 접기
            </Link>
          </>
        ) : null}

        {/* 셀 색 강도 개인 토글(쨍/중간/옅게) — 기본뷰에서만(셀 색이 있는 뷰). localStorage 영속. */}
        {effView === "basic" ? (
          <>
            <span className="bg-line h-4 w-px" aria-hidden />
            <TimetableColorToggle />
          </>
        ) : null}

        {/* 엑셀·시트 액션 — ⚠️ ml-auto 스페이서 **앞**에 둔다: 스페이서 뒤(우측 정렬 편집 옆)에 두면
            넓은 창에서도 항상 둘째 줄로 강제 줄바꿈돼 툴바가 상시 2줄이었다(2026-07-20 세로 회수). */}
        <span className="bg-line h-4 w-px" aria-hidden />
        <TimetableToolbarActions
          subject={subject}
          canSync={canSync}
          canManageImport={canManageImport}
          sheetUrl={sheetUrl}
          compact1h={compactList}
        />

        <div className="ml-auto" aria-hidden />

        {/* 학생 집계 — 최상위 프레임은 PageHeader 우측(문법 ②), 창(임베드)은 헤더 줄을 접으므로
            여기 툴바 우측에 노출(StudentTally 공유, 순수 마크업이라 이중 마운트 안전). */}
        <div className="hidden [.embed-main_&]:block">
          <StudentTally
            enrolled={enrolledCount}
            newCount={newCount}
            transferCount={transferCount}
            holdCount={holdCount}
            withdrawnCount={withdrawnCount}
          />
        </div>

        {/* 편집 컨트롤 — 기본뷰 + 이번/미래 주(통합뷰·강사뷰=읽기전용, 과거=조회 전용).
            미래 주 편집은 그 주에 이동 예약(Phase B). */}
        {effView === "basic" && slots.length > 0 && canEdit ? (
          <>
            <span className="bg-line h-4 w-px" aria-hidden />
            <TimetableEditControls />
            {isFutureWeek ? (
              <span className="text-blue text-[11px] whitespace-nowrap">· 이 주에 이동 예약</span>
            ) : null}
          </>
        ) : null}
      </div>

      {slots.length === 0 ? (
        <div className="mx-auto max-w-xl py-4">
          <PhotoCard
            src="/photos/timetable-empty.webp"
            alt=""
            caption="해당 과목의 시간표가 없습니다"
            sub="가져오기 또는 편집으로 반을 배치해 보세요"
            aspect="3/2"
            sizes="(max-width: 768px) 100vw, 576px"
          />
        </div>
      ) : isIntegrated ? (
        <RichGridView
          slots={slots}
          subjectMaps={subjectMaps}
          config={periodsConfig}
          teacherColors={teacherColors}
          compactSections={compactSections}
          hrefForSectionToggle={hrefForSectionToggle}
        />
      ) : effView === "teacher" ? (
        // 강사뷰 — 시트 "강사별영어시간표" 그대로(강사=세로 블록, 그 안 월~토, 셀=반명+방). 읽기전용, 반 클릭=학생 명단.
        // 가로줄·격자 단위는 과목 설정(teacherViewLines/Step, 학원설정 과목 운영)에서.
        <div className="flex min-h-0 flex-1 flex-col">
          <TeacherGridView
            slots={slots}
            weekMonday={week}
            teacherColors={teacherColors}
            sectionLineMins={sectionLineMins}
            stepMin={teacherViewStep}
            pxPerMin={teacherViewPxPerMin}
            breakRanges={teacherViewBreaks}
            excludedTeachers={teacherViewExcluded}
            showUnusedDays={!hideEmptyDays}
          />
        </div>
      ) : (
        <TimetableDndArea>
          <div className="flex min-h-0 flex-1 flex-col">
            {/* '빈 교시 접기' 중 편집 모드가 켜지면 접힌 행을 CSS 변수·.tt-editing으로 즉시 펼침(평소 격자 지형 복원). */}
            <EmptyPeriodScope>
              <WeekdayGroupTables
                slots={slots}
                config={periodsConfig}
                weekMonday={week}
                weekdayGrouping={weekdayGrouping}
                collapseEmptyPeriods={collapseEmptyPeriods}
              />
            </EmptyPeriodScope>
          </div>
        </TimetableDndArea>
      )}
      </div>
    </TimetableEditProvider>
  );
}

function buildHref(opts: {
  view: ViewMode;
  subject: string;
  defaultSubject: string;
  week: string; // 월요일 YYYY-MM-DD
  thisWk: string; // 이번 주 월요일(기본값이면 생략)
  compact1h?: number[]; // 통합뷰 '1시간 단위' 압축 섹션(sectionKey 집합) — 다른 네비 시 유지, 미지정=초기화
  /**
   * 강사뷰 '미사용 요일' 해제 상태. ⚠️ 값이 오면 **양방향 모두 명시 직렬화**(hide/show) — 파라미터
   * 없음은 "쿠키(기기 선호) 참조"라는 제3의 상태다. hide만 직렬화하던 옛 방식은 쿠키가 hide로
   * 저장된 순간 show 링크(=파라미터 생략)가 쿠키에 덮여 **토글이 show 방향으로 죽었다**(적대 리뷰
   * 확정 HIGH). 미지정(undefined)만 생략 = 쿠키 기본.
   */
  hideEmptyDays?: boolean;
  /**
   * 기본뷰 '빈 교시 접기' 상태 — hideEmptyDays와 동일 규약: 값이 오면 **양방향 명시 직렬화**
   * (collapse/expand), 미지정(undefined)만 생략(=쿠키 기본). 인앱 링크는 전부 현재 상태를 명시로 넘긴다.
   */
  collapseEmptyPeriods?: boolean;
}): string {
  const params = new URLSearchParams();
  if (opts.view !== "basic") params.set("view", opts.view);
  if (opts.subject !== opts.defaultSubject) params.set("subject", opts.subject);
  if (opts.week !== opts.thisWk) params.set("week", opts.week);
  if (opts.compact1h && opts.compact1h.length)
    params.set("compact1h", [...opts.compact1h].sort((a, b) => a - b).join(","));
  if (opts.hideEmptyDays !== undefined) params.set("emptydays", opts.hideEmptyDays ? "hide" : "show");
  if (opts.collapseEmptyPeriods !== undefined)
    params.set("emptyperiods", opts.collapseEmptyPeriods ? "collapse" : "expand");
  const q = params.toString();
  return q ? `/timetable?${q}` : "/timetable";
}

