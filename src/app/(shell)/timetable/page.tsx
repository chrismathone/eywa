import { ParamLink } from "./_components/param-link";
import type { LucideIcon } from "@/components/icons/eywa-icon-compat";
import { Columns3, LayoutGrid, Users } from "@/components/icons/eywa-icon-compat";
import { PhotoCard } from "@/components/atoms/photo-card";
import { PageHeader } from "@/components/page-header";
import { cookies } from "next/headers";
import { requireAccess } from "@/lib/auth/require-access";
import { effectiveTeacherId } from "@/lib/auth/view-mode";
import {
  getTeacherColorMap,
  getTeacherLabelMap,
  getTeacherScheduleBlocks,
  getWeeklyScheduleWithStudents,
} from "@/features/timetable/server/queries";
import { resolveTeacherLabels } from "@/features/timetable/lib/teacher-label";
import { settingsToPeriodsConfig } from "@/features/timetable/lib/periods";
import type { TeacherColorMap } from "@/features/timetable/lib/class-grid";
import { getTenantSettings } from "@/features/owner/server/queries";
import { getGoogleSheetsStatus } from "@/features/integrations/server/queries";
import { canManageSheetSync } from "@/features/integrations/server/sheet-access";
import { canManageTimetableImport } from "@/features/timetable/server/import-access";
import { isSheetExportSubject } from "@/features/integrations/sheets-provider";
import { buildSubjectMaps } from "@/features/owner/subjects";
import { normalizeWeekdayGrouping } from "@/features/timetable/lib/weekday-groups";
import {
  DEFAULT_TIMETABLE_KIND,
  TIMETABLE_KINDS,
  TIMETABLE_KIND_LABEL,
  matchesTimetableKind,
  parseTimetableKind,
  type TimetableKind,
} from "@/features/timetable/lib/class-kind";
import { canAccessTenant, canWriteTenant } from "@/lib/auth/perm-matrix";
import { resolveSkillAreas } from "@/features/owner/skill-areas";
import { EcsShortcut } from "./_components/ecs-shortcut";
import { resolveIntegrationGroups } from "@/features/timetable/lib/integration-groups";
import { GroupSettingsDialog } from "./_components/group-settings-dialog";
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
import {
  COMPACT1H_COOKIE,
  COMPACT1H_NONE,
  EMPTY_DAYS_COOKIE,
  EMPTY_PERIODS_COOKIE,
  readCompact1hFor,
} from "@/features/timetable/lib/pref-cookies";
import { TimetableViewPrefsSync } from "./_components/prefs-sync";
import { EmptyPeriodScope } from "./_components/empty-period-scope";
import { TimetableColorPrefSync } from "./_components/color-mode-toggle";
import { TimetableFontPrefSync, TimetableZoomArea } from "./_components/font-size-toggle";
import { TimetableViewSettings } from "./_components/view-settings";
import { applyGradeFilter } from "@/features/timetable/lib/view-prefs";
import { getMyTimetableViewPrefs } from "@/features/timetable/server/view-prefs-queries";
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
  searchParams: Promise<{ view?: ViewMode; subject?: string; kind?: string; week?: string; compact1h?: string; emptydays?: string; emptyperiods?: string }>;
}) {
  const user = await requireAccess("timetable");
  const { view: viewParam, subject: subjectParam, kind: kindRaw, week: weekRaw, compact1h: compact1hRaw, emptydays: emptydaysRaw, emptyperiods: emptyperiodsRaw } = await searchParams;
  // 정규/특강/전체 — 기본 = 정규(특강 제외). 특강은 방학 단기강좌라 정규 주간표에 섞이면 시야가 흐려진다.
  const kind = parseTimetableKind(kindRaw);
  const cookieStore = await cookies();
  // 표시 선호(미사용 요일·빈 교시 접기·1시간 단위·셀 색) 해석은 **계정 설정을 읽은 뒤**로 내렸다 —
  // 아래 Promise.all의 viewPrefs가 필요하기 때문(우선순위 = URL 파라미터 → 계정 → 쿠키 → 기본값).
  // 통합뷰 '1시간 단위' — **섹션별 토글**(사용자 결정 2026-07-06, 전역 아님). compact1h=쉼표구분 sectionKey
  // (=시작교시 order, 자정기준 분). 든 섹션만 사이 빈 교시 행을 숨긴다.
  // 우선순위 = 파라미터 → (없으면) 쿠키 → 빈 값. `none`은 **명시적 해제** 센티널이라 쿠키로 되돌아가지 않는다
  // (없으면 마지막 하나를 풀 때 파라미터가 사라져 쿠키가 옛 값을 되살린다 = 안 꺼지는 토글).
  // 쿠키는 과목별이라 `subject` 확정 뒤에 읽는다(아래 compactList).
  const compactFromParam =
    compact1hRaw === undefined
      ? null
      : compact1hRaw === COMPACT1H_NONE
        ? []
        : compact1hRaw
            .split(",")
            .map((s) => Number(s.trim()))
            .filter((n) => Number.isFinite(n) && n > 0);
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
  const [allSlots, settings, teacherColors, viewPrefs] = await Promise.all([
    getWeeklyScheduleWithStudents({ referenceDate, teacherId }),
    getTenantSettings(),
    // 강사색 맵은 통합뷰(셀·담임색)·강사뷰(헤더색)에서만 필요. 기본뷰는 생략.
    view !== "basic" ? getTeacherColorMap() : Promise.resolve({} as TeacherColorMap),
    // 계정 귀속 뷰 설정(0146a) — 서버 첫 렌더에서 읽어야 필터 없는 화면을 그렸다가 학생이 사라지는
    // 깜빡임이 없다. 미로그인·깨진 값은 '설정 없음'으로 떨어져 무중단.
    getMyTimetableViewPrefs(),
  ]);
  // 표시 선호 해석 — 우선순위 **URL 파라미터 → 계정(0146a) → 쿠키(구 기기 저장) → 기본값**.
  // 계정을 쿠키보다 먼저 보는 게 이 배선의 핵심(원장 지시: 기기가 아니라 계정에 귀속). 쿠키는 계정에
  // 아직 값이 없는 사용자를 위한 **이관 폴백**으로만 남는다 — 다음 토글 때 계정으로 올라간다.
  // 파라미터가 있으면 그쪽 우선(공유 링크 존중). 쓰기는 TimetableViewPrefsSync(클라).
  //
  // 강사뷰 '미사용 요일' — 기본 = 표시(강사마다 월~토 전 컬럼). hide면 수업 있는 요일만.
  // (창(iframe)은 항상 깨끗한 URL로 열려서, 파라미터만으론 열 때마다 초기화됐다 — 주 2일 강사가 매번
  //  넓은 표를 다시 접어야 했던 문제.)
  const savedHideEmptyDays =
    viewPrefs.hideEmptyDays ?? cookieStore.get(EMPTY_DAYS_COOKIE)?.value === "hide";
  const hideEmptyDays = emptydaysRaw ? emptydaysRaw === "hide" : savedHideEmptyDays;
  // 기본뷰 '빈 교시 접기'(C안, 2026-07-19) — 수업 없는 교시 행을 222px → 36px 밴드로 축소(행 유지 =
  // 교시 축 연속·편집 드롭 존 보존, 편집 모드는 자동 펼침). 기본 = 현행(펼침).
  const savedCollapseEmptyPeriods =
    viewPrefs.collapseEmptyPeriods ?? cookieStore.get(EMPTY_PERIODS_COOKIE)?.value === "collapse";
  const collapseEmptyPeriods = emptyperiodsRaw
    ? emptyperiodsRaw === "collapse"
    : savedCollapseEmptyPeriods;
  // 교시 시각 = owner 설정(operations.weekdayPeriods/weekendPeriods) → PeriodsConfig. 미설정 시 기본 상수.
  const periodsConfig = settingsToPeriodsConfig(settings.operations);
  const subjectMaps = buildSubjectMaps(settings.operations.subjects);
  // 구분(정규/특강/전체) 먼저 좁힌다 — 과목 칩도 "그 구분에 실제 있는 과목"만 떠야 한다
  // (특강이 수학뿐인데 영어 칩이 뜨고 눌러도 빈 화면이면 고장으로 보인다).
  // 판정은 서버가 확정한 boolean만 사용(화면에서 이름 매칭 재구현 금지).
  const kindSlots = allSlots.filter((s) => matchesTimetableKind(kind, s.isSpecialLecture));
  // 과목 칩 = 학원설정 과목 순서 ∩ 데이터에 실제 존재하는 과목(빈 과목칩 방지). 무조건 한 과목.
  const available = subjectMaps.options
    .map((o) => o.value)
    .filter((k) => kindSlots.some((s) => s.subject === k));
  const defaultSubject = available[0] ?? "";
  const subject =
    subjectParam && available.includes(subjectParam) ? subjectParam : defaultSubject;
  // '1시간 단위' 최종 해석 — 파라미터(공유 링크 존중) → 이 **과목의** 쿠키 → 빈 값(전부 펼침).
  // 쓰기는 Compact1hPrefSync(클라). 과목별이라 영어에서 접어둔 섹션이 수학에 새지 않는다.
  // ⚠️ 과목별이라 **그 과목 키가 계정에 있을 때만** 계정을 쓴다 — 계정 맵이 있어도 아직 그 과목을
  // 토글한 적이 없으면 쿠키(구 설정)를 살려야 한다(계정 첫 저장이 다른 과목 설정을 덮어버리지 않게).
  // '해제'는 계정에 **빈 배열로 명시 저장**되므로 `?? 쿠키`가 옛 값을 되살리지 않는다(none 센티널과 같은 이유).
  const compactList =
    compactFromParam ??
    viewPrefs.compact1h?.[subject] ??
    readCompact1hFor(cookieStore.get(COMPACT1H_COOKIE)?.value, subject);
  const compactSections = new Set(compactList);

  // 비수업 블록(감독·준비·회의·연차, 0138a) — **강사뷰에서만** 그린다. 반이 아니라서 다른 뷰·집계에
  // 섞으면 수업 수가 부풀고 과목/구분 칩에도 새어 나온다. subject 확정 뒤에 읽어야 해서(위 Promise.all은
  // subject를 아직 모른다) 여기서 조회 — 강사뷰일 때만 도는 경량 쿼리다.
  const scheduleBlocks =
    view === "teacher" && subject
      ? await getTeacherScheduleBlocks(subject, referenceDate, teacherId)
      : [];

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
  // 이어서 계정 뷰 설정의 학년 필터를 **학생 단위**로 건다 — 반 단위로 걸면 학제 혼합 반이 통째로
  // 사라진다(실측 활성 반 106개 중 9개가 혼합, applyGradeFilter 주석 참조). 여기 한 곳만 거치면
  // 기본·강사·통합 3뷰와 상단 명단 요약이 전부 같은 명단을 본다(뷰마다 따로 거르면 숫자가 갈린다).
  // ⚠️ 과목 칩(available)에는 **일부러 적용하지 않는다** — 필터가 과목을 지우면 고를 과목이 0개가 돼
  // 빈 화면에 갇힌다. 칩은 "학원이 무엇을 운영하나", 필터는 "내가 누구를 보나"로 층을 나눈다.
  const slots = applyGradeFilter(
    kindSlots.filter((s) => s.subject === subject),
    viewPrefs.grades,
  );
  const subjectRow = settings.operations.subjects.find((s) => s.key === subject);
  // English Class Sheet 바로가기 — 지금 보는 과목이 ECS 대상일 때만. 조건은 ECS의 정식 게이트
  // (requireEcsClassAccess: english + skillAreas 비어있지 않음)와 **같은 식**이라야 "눌렀는데 빈 목록"이
  // 안 생긴다. 권한(ecs=none인 상담사·회계)까지 봐야 눌러도 튕기는 죽은 버튼이 안 된다(#77).
  // ⚠️ searchParams.subject를 직접 보지 말 것 — 기본 과목이면 URL에 파라미터가 없다(buildHref).
  const showEcsShortcut =
    subject === "english" &&
    resolveSkillAreas(subjectRow).length > 0 &&
    (await canAccessTenant(user.systemRole, "ecs"));
  // 통합뷰 섹션 = 커스텀 그룹(학원설정 과목별)이 켜져 있으면 그것, 아니면 "N교시 시작" 자동 그룹.
  // 엑셀·시트 빌더도 같은 해석기를 쓴다(화면과 배치 일치가 이 기능의 존재 이유).
  const customGroups = resolveIntegrationGroups(subjectRow);
  // '그룹 설정' 창의 배정 대상 = 이 과목·이 주 시간표에 실제 있는 반(가나다). 반 목록을 따로 조회하지
  // 않고 slots에서 뽑는다 — 화면에 보이는 것과 창이 보여주는 것이 어긋나지 않게.
  const groupClassOptions = [...new Map(slots.map((s) => [s.classId, s.className])).entries()]
    .map(([classId, className]) => ({ classId, className }))
    .sort((a, b) => a.className.localeCompare(b.className, "ko"));
  // 과목별 요일 병합 프리셋(설정) — 미설정/구데이터는 mon-thu 폴백(resolve가 스키마 미통과).
  const weekdayGrouping = normalizeWeekdayGrouping(subjectRow?.weekdayGrouping);

  // 강사뷰 허용 = 영어 또는 강사별시간표 설정(teacherViewLines)이 있는 과목만 — URL 직입력으로
  // 비영어에 영어 전용 격자·시트 강사 순서가 렌더되던 것 서버 강제 차단(2026-07-06, effView로 렌더).
  const allowsTeacherView = (k: string) =>
    k === "english" ||
    ((settings.operations.subjects.find((s) => s.key === k)?.teacherViewLines?.length ?? 0) > 0);
  const teacherViewAllowed = allowsTeacherView(subject);
  const effView: ViewMode = view === "teacher" && !teacherViewAllowed ? "basic" : view;
  // 통합뷰 '그룹 설정' = 학원설정(과목별)을 쓰므로 게이트도 **owner 쓰기**. 시간표에 있다고 시간표
  // 권한으로 열면 학원설정 우회 뒷문이 된다(서버 액션도 같은 게이트로 2차 방어, #77).
  const canEditGroups = effView === "integrated" && (await canWriteTenant(user.systemRole, "owner"));
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
  // '가로줄 제외 강사'는 **라벨 문자열로** 열과 맞물린다 — 슬롯 라벨을 한글 이름으로 바꾼 뒤에도
  // 예전에 저장된 값("Hannah"·"이주희")이 계속 맞도록 같은 해석기를 통과시킨다(마이그레이션 불필요).
  const teacherViewExcluded = resolveTeacherLabels(
    subjectRow?.teacherViewLineExcluded ?? [],
    await getTeacherLabelMap(),
  );

  const isIntegrated = effView === "integrated";
  // 섹션별 '1시간 단위' 토글 href — 그 sectionKey를 압축 집합에 넣고/빼기(다른 필터·주·과목은 유지).
  const hrefForSectionToggle = (sectionKey: number) =>
    buildHref({
      view: effView,
      subject,
      defaultSubject,
      kind,
      week,
      thisWk,
      compact1h: compactSections.has(sectionKey)
        ? compactList.filter((k) => k !== sectionKey)
        : [...compactList, sectionKey],
      // 사용자가 방금 정한 값 = 빈 집합도 명시(compact1h=none). 안 그러면 마지막 하나를 해제할 때
      // 파라미터가 사라져 쿠키의 옛 값이 되살아난다(안 꺼지는 토글).
      compact1hExplicit: true,
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
      <div className="flex h-full min-h-0 flex-col gap-4 compact-chrome:gap-3">
      {/* 표시 선호('미사용 요일'·'빈 교시 접기'·'1시간 단위')를 **계정에** 기억(0146a) + 쿠키 폴백 —
          창은 깨끗한 URL로 열려 파라미터만으론 매번 초기화된다. 셋을 한 컴포넌트로 합친 이유(동시 쓰기
          충돌)는 prefs-sync.tsx 주석 참조. */}
      <TimetableViewPrefsSync
        hideEmptyDays={hideEmptyDays}
        collapseEmptyPeriods={collapseEmptyPeriods}
        subject={subject}
        sections={compactList}
        savedHideEmptyDays={viewPrefs.hideEmptyDays}
        savedCollapseEmptyPeriods={viewPrefs.collapseEmptyPeriods}
        savedSections={viewPrefs.compact1h?.[subject] ?? null}
      />
      {/* 계정에 저장된 셀 색 강도를 스토어에 주입(서버→클라 단방향). 계정값이 없으면 기기 설정 유지. */}
      <TimetableColorPrefSync mode={viewPrefs.colorMode} />
      {/* 글씨 크기(계정) → 스토어 주입. 색 강도와 같은 단방향 동기화 — 토글은 뷰 설정 팝오버에 있다. */}
      <TimetableFontPrefSync fontSize={viewPrefs.fontSize} />
      {/* Editorial 문법 ① — 헤더 위계 + 우측 학생 집계(StudentTally). 시간표는 세로 공간이 가장
          귀한 화면이라 **창(임베드)에선 이 줄을 통째로 접고** 집계를 툴바 우측으로 내린다(컴팩트
          1행조차 아까움 — 2026-07-20 원장 "여전히 많은 공간"). 최상위 프레임은 풀 헤더 유지. */}
      <div className="shrink-0 compact-chrome:hidden">
        <PageHeader
          eyebrow="수업 운영"
          title="시간표"
          description={`${subjectMaps.labelOf(subject)} 주간표`}
          actions={
            <>
              {showEcsShortcut ? <EcsShortcut week={week} /> : null}
              <StudentTally
                enrolled={enrolledCount}
                newCount={newCount}
                transferCount={transferCount}
                holdCount={holdCount}
                withdrawnCount={withdrawnCount}
              />
            </>
          }
        />
      </div>
      {/* Toolbar — 좁은 화면(compact-chrome)에선 여백·구분선을 조인다. 구분선(1px)은 그 자체보다
          양옆 gap 때문에 줄바꿈을 앞당겨, 폰에서 툴바를 한 줄 더 밀어내는 값이 컸다. */}
      <div className="bg-card shadow-card toolbar-rail flex shrink-0 flex-wrap items-center gap-3 rounded-2xl px-4 py-3 compact-chrome:gap-2 compact-chrome:px-3 compact-chrome:py-2">
        {/* 주간 이동(타임머신) — 과거/미래 주의 반 구성 조회 */}
        <WeekNav
          currentWeek={week}
          today={today}
          hrefForWeek={(monday) => buildHref({ view: effView, subject, defaultSubject, kind, week: monday, thisWk, compact1h: compactList, hideEmptyDays, collapseEmptyPeriods })}
        />
        <span className="bg-line h-4 w-px" aria-hidden />

        {/* 과목 chip — 전 뷰 과목별(클릭 = 과목 전환). 강사뷰 비허용 과목으로 전환 시 기본뷰로.
            ⚠️ flex-wrap 필수 — 과목이 많은 학원(과학·국어·사회…)에서 칩이 한 줄로 강제되면 툴바가
            가로로 넘친다(칩 자체가 shrink-0이라 줄지도 않음). 형제인 toolbar-actions와 동일 규약. */}
        <div className="flex flex-wrap items-center gap-1">
          <span className="micro mr-1 compact-chrome:hidden">과목</span>
          {available.map((k) => (
            <ParamLink
              key={k}
              href={buildHref({
                view: effView === "teacher" && !allowsTeacherView(k) ? "basic" : effView,
                subject: k,
                defaultSubject,
                kind,
                week,
                thisWk,
                // 과목 전환 = '1시간 단위'를 안 싣는다(섹션 order가 과목마다 달라 엉뚱한 섹션이 접힌다).
                // 파라미터가 없으면 서버가 **그 과목 쿠키**를 읽으므로, 초기화가 아니라 "그 과목에서 내가
                // 마지막으로 정해둔 값"으로 복원된다(2026-07-23 — 과목별 기억 도입 전엔 매번 초기화였음).
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
            </ParamLink>
          ))}
        </div>
        <span className="bg-line h-4 w-px" aria-hidden />

        {/* 정규 / 특강 / 전체 — 특강(방학 단기강좌)을 정규 주간표와 분리해 본다(원장 요구 2026-07-22).
            기본은 정규라 파라미터 없는 URL = 지금까지의 화면. 과목 칩은 이 구분에 실제 있는 과목만 뜬다. */}
        <div className="flex flex-wrap items-center gap-1">
          <span className="micro mr-1 compact-chrome:hidden">구분</span>
          {TIMETABLE_KINDS.map((k) => (
            <ParamLink
              key={k}
              href={buildHref({
                view: effView,
                subject,
                defaultSubject,
                kind: k,
                week,
                thisWk,
                compact1h: compactList,
                hideEmptyDays,
                collapseEmptyPeriods,
              })}
              className={`shrink-0 rounded-full border px-2.5 py-0.5 text-xs transition ${
                kind === k
                  ? "border-primary bg-primary text-primary-foreground font-medium"
                  : "border-line text-text-dim hover:text-foreground hover:bg-bg-soft"
              }`}
            >
              {TIMETABLE_KIND_LABEL[k]}
            </ParamLink>
          ))}
        </div>
        <span className="bg-line h-4 w-px" aria-hidden />

        {/* 뷰 토글 — 강사뷰는 허용 과목(영어 또는 강사별시간표 설정 보유)에서만 노출. */}
        <div className="flex items-center gap-1">
          <span className="micro mr-1 compact-chrome:hidden">뷰</span>
          {([
            { key: "basic", label: "기본뷰", icon: Columns3 },
            { key: "integrated", label: "통합뷰", icon: LayoutGrid },
            ...(teacherViewAllowed
              ? [{ key: "teacher" as ViewMode, label: "강사뷰", icon: Users }]
              : []),
          ] as { key: ViewMode; label: string; icon: LucideIcon }[]).map((v) => {
            const Icon = v.icon;
            return (
              <ParamLink
                key={v.key}
                href={buildHref({ view: v.key, subject, defaultSubject, kind, week, thisWk, compact1h: compactList, hideEmptyDays, collapseEmptyPeriods })}
                className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs transition ${
                  effView === v.key
                    ? "border-primary bg-primary text-primary-foreground font-medium"
                    : "border-line text-text-dim hover:text-foreground hover:bg-bg-soft"
                }`}
              >
                <Icon size={11} strokeWidth={1.8} />
                {v.label}
              </ParamLink>
            );
          })}
        </div>

        {/* 강사뷰 '미사용 요일'·기본뷰 '빈 교시 접기'·'색 강도'는 **뷰 설정 팝오버 안으로** 옮겼다
            (2026-07-24 원장 "시간표도 깔끔하게"). 셋 다 "무엇이 어떻게 보이나"라 학년 필터와 같은 성격이고,
            특히 색 3칩이 툴바를 상시 2줄로 밀어내던 주범이었다. href는 아래 TimetableViewSettings에 넘긴다. */}

        {/* 통합뷰 '1시간 단위' 토글은 전역이 아니라 **각 섹션 헤더(RichGridView)** 에 있다
            (사용자 결정 2026-07-06 — 각 교시 시작별로 세팅). 툴바 전역 토글 없음. */}

        {/* 통합뷰 '그룹 설정' — 섹션을 'N교시 시작' 자동 묶음 대신 원장이 정한 묶음으로(ijw 이식). */}
        {canEditGroups ? (
          <>
            <span className="bg-line h-4 w-px" aria-hidden />
            <GroupSettingsDialog
              subject={subject}
              subjectLabel={subjectMaps.labelOf(subject)}
              classes={groupClassOptions}
              initialGroups={(subjectRow?.integrationGroups ?? []).map((g) => ({
                id: g.id,
                title: g.title,
                classIds: g.classIds ?? [],
              }))}
              initialEnabled={subjectRow?.integrationGroupsEnabled === true}
              initialShowOthers={subjectRow?.integrationShowOthers !== false}
              initialOthersTitle={subjectRow?.integrationOthersTitle ?? ""}
            />
          </>
        ) : null}

        {/* 뷰 설정 — 학제·학년 필터(계정 저장) + **표시 취향 3종**(색 강도·빈 교시 접기·미사용 요일).
            ⚠️ 인라인 토글이 아니라 팝오버인 이유·배지를 항상 띄우는 이유는 view-settings.tsx 주석 참조.
            전 뷰 공통(필터는 명단에 걸리므로 기본·강사·통합 어디서나 같은 뜻)이고, 표시 3종은 해당 뷰에서만
            항목이 뜬다(색·빈 교시=기본뷰 / 미사용 요일=강사뷰). 링크는 그대로 URL 파라미터라 공유 링크도 보존. */}
        <span className="bg-line h-4 w-px" aria-hidden />
        <TimetableViewSettings
          allGrades={settings.operations.gradeLevels ?? []}
          savedGrades={viewPrefs.grades}
          showColor={effView === "basic"}
          collapseHref={
            effView === "basic"
              ? buildHref({
                  view: effView,
                  subject,
                  defaultSubject,
                  kind,
                  week,
                  thisWk,
                  compact1h: compactList,
                  hideEmptyDays,
                  collapseEmptyPeriods: !collapseEmptyPeriods,
                })
              : undefined
          }
          collapseOn={collapseEmptyPeriods}
          hideEmptyDaysHref={
            effView === "teacher"
              ? buildHref({
                  view: effView,
                  subject,
                  defaultSubject,
                  kind,
                  week,
                  thisWk,
                  compact1h: compactList,
                  hideEmptyDays: !hideEmptyDays,
                  collapseEmptyPeriods,
                })
              : undefined
          }
          hideEmptyDaysOn={hideEmptyDays}
        />

        {/* 학년 필터가 걸린 채로 이 과목·이 주에 보이는 학생이 0명이면, 화면이 그냥 비어 있어 고장으로
            보인다. 배지만으론 부족해 한 줄로 명시한다(필터 때문임을 알아야 되돌릴 수 있다). */}
        {viewPrefs.grades && slots.length === 0 && kindSlots.some((s) => s.subject === subject) ? (
          <span className="bg-accent text-accent-foreground rounded-full px-2.5 py-0.5 text-[11px]">
            학년 필터에 걸려 표시할 수업이 없습니다 — 뷰 설정에서 학년을 넓혀 보세요.
          </span>
        ) : null}

        {/* 엑셀·시트 액션 — ⚠️ ml-auto 스페이서 **앞**에 둔다: 스페이서 뒤(우측 정렬 편집 옆)에 두면
            넓은 창에서도 항상 둘째 줄로 강제 줄바꿈돼 툴바가 상시 2줄이었다(2026-07-20 세로 회수). */}
        <span className="bg-line h-4 w-px" aria-hidden />
        <TimetableToolbarActions
          subject={subject}
          kind={kind}
          canSync={canSync}
          canManageImport={canManageImport}
          sheetUrl={sheetUrl}
          compact1h={compactList}
        />

        <div className="rail-spacer ml-auto" aria-hidden />

        {/* 학생 집계 — 최상위 프레임은 PageHeader 우측(문법 ②), 창(임베드)은 헤더 줄을 접으므로
            여기 툴바 우측에 노출(StudentTally 공유, 순수 마크업이라 이중 마운트 안전). */}
        {/* 창(임베드)에선 위 헤더 줄이 통째로 접히므로 ECS 바로가기도 여기 한 번 더 — 안 그러면
            실사용(플로팅 창)에서 영영 안 보인다(StudentTally가 이중 렌더인 이유와 동일). */}
        {showEcsShortcut ? (
          <div className="hidden compact-chrome:block">
            <EcsShortcut week={week} />
          </div>
        ) : null}
        <div className="hidden compact-chrome:block">
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
          {/* 특강 화면의 빈 상태는 "과목이 없다"가 아니라 "특강이 없다" — 원인이 다르면 문구도 달라야 한다. */}
          <PhotoCard
            src="/photos/timetable-empty.webp"
            alt=""
            caption={
              kind === "special" ? "이 기간에 등록된 특강이 없습니다" : "해당 과목의 시간표가 없습니다"
            }
            sub={
              kind === "special"
                ? "반을 만들 때 '특강'을 켜면 여기에 표시됩니다 (운영 종료일이 지난 특강은 자동으로 내려갑니다)"
                : "가져오기 또는 편집으로 반을 배치해 보세요"
            }
            aspect="3/2"
            sizes="(max-width: 768px) 100vw, 576px"
          />
        </div>
      ) : isIntegrated ? (
        <TimetableZoomArea>
          <RichGridView
            slots={slots}
            subjectMaps={subjectMaps}
            config={periodsConfig}
            teacherColors={teacherColors}
            compactSections={compactSections}
            hrefForSectionToggle={hrefForSectionToggle}
            customGroups={customGroups}
          />
        </TimetableZoomArea>
      ) : effView === "teacher" ? (
        // 강사뷰 — 시트 "강사별영어시간표" 그대로(강사=세로 블록, 그 안 월~토, 셀=반명+방). 읽기전용, 반 클릭=학생 명단.
        // 가로줄·격자 단위는 과목 설정(teacherViewLines/Step, 학원설정 과목 운영)에서.
        <TimetableZoomArea>
          <div className="flex min-h-0 flex-1 flex-col">
            <TeacherGridView
              slots={[...slots, ...scheduleBlocks]}
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
        </TimetableZoomArea>
      ) : (
        <TimetableDndArea>
          {/* ⚠️ zoom은 DndContext **안쪽**에 — 바깥에 두면 fixed인 DragOverlay가 커서와 어긋난다. */}
          <TimetableZoomArea>
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
          </TimetableZoomArea>
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
  /** 정규/특강/전체. 기본(정규)이면 파라미터를 생략해 지금까지의 URL과 같게 둔다. */
  kind: TimetableKind;
  week: string; // 월요일 YYYY-MM-DD
  thisWk: string; // 이번 주 월요일(기본값이면 생략)
  compact1h?: number[]; // 통합뷰 '1시간 단위' 압축 섹션(sectionKey 집합) — 다른 네비 시 유지, 미지정=쿠키(과목별 기기 선호)
  /**
   * 이 링크가 '1시간 단위'를 **사용자가 방금 정한 값**으로 못박는지. 위 hideEmptyDays와 같은
   * 양방향 직렬화 규약이다 — 빈 집합을 `compact1h=none`으로 명시해야 "마지막 하나 해제"가 살아남는다
   * (명시하지 않으면 파라미터가 사라져 쿠키의 옛 값이 되살아나 토글이 안 꺼진다).
   * 섹션 토글 링크만 true. 주·뷰·구분 이동 링크는 현재 값을 그대로 실어 나르므로 불필요.
   */
  compact1hExplicit?: boolean;
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
  if (opts.kind !== DEFAULT_TIMETABLE_KIND) params.set("kind", opts.kind);
  if (opts.subject !== opts.defaultSubject) params.set("subject", opts.subject);
  if (opts.week !== opts.thisWk) params.set("week", opts.week);
  if (opts.compact1h && opts.compact1h.length)
    params.set("compact1h", [...opts.compact1h].sort((a, b) => a - b).join(","));
  else if (opts.compact1hExplicit) params.set("compact1h", COMPACT1H_NONE);
  if (opts.hideEmptyDays !== undefined) params.set("emptydays", opts.hideEmptyDays ? "hide" : "show");
  if (opts.collapseEmptyPeriods !== undefined)
    params.set("emptyperiods", opts.collapseEmptyPeriods ? "collapse" : "expand");
  const q = params.toString();
  return q ? `/timetable?${q}` : "/timetable";
}

