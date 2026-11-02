import { canManageStudentStatusNow } from "@/features/students/server/status-access";
import { ParamLink } from "./_components/param-link";
import { isModuleEnabled } from "@/lib/modules";
import { ParamSelect } from "./_components/param-select";
import { Layers } from "@/components/icons/aywa-icon-compat";
import { PhotoCard } from "@/components/atoms/photo-card";
import { Toolbar, ToolbarRow } from "@/components/toolbar";
import { PageHeader } from "@/components/page-header";
import { PageMaximizeToolbar } from "@/components/page-maximize/page-maximize-toolbar";
import { TOOLBAR_CHIP, TOOLBAR_CHIP_OFF, TOOLBAR_CHIP_ON } from "@/components/toolbar-controls";
import { Suspense } from "react";
import { isMemoSheetSubject } from "@/features/timetable-memo/doc";
import { isCellMemoSubject } from "@/features/timetable-cell-memo/rules";
import { memoSheetAccess } from "@/features/timetable-memo/server/access";
import { MemoSheetPane, MemoSheetSkeleton } from "@/features/timetable-memo/ui/memo-sheet-pane";
import { MemoSheetJumpButton, TimetableSplitPanes } from "@/features/timetable-memo/ui/split-panes";
import { cookies } from "next/headers";
import { requireAccess } from "@/lib/auth/require-access";
import { getTeacherViewLang } from "@/features/teacher-view/server/lang";
import { timetableText } from "@/features/teacher-view/timetable-labels";
import { effectiveTeacherId } from "@/lib/auth/view-mode";
import {
  getClassroomsLite,
  getTeacherColorMap,
  getTeacherLabelMap,
  getTeacherNicknameMap,
  getTeacherScheduleBlocks,
  getWeeklyScheduleWithStudents,
} from "@/features/timetable/server/queries";
import { isSpecialSlotLabel, resolveTeacherLabels } from "@/features/timetable/lib/teacher-label";
import { applySeatPinMarks, NO_SEAT_PINS } from "@/features/timetable/lib/seat-pin-mark";
import { getSeatLiveSlots, getSeatPins } from "@/features/timetable/server/seat-pins";
import { buildVirtualLabs, knownLabSources, NO_VIRTUAL_LABS } from "@/features/timetable/lib/virtual-lab";
import { getSeatWeekMoves } from "@/features/timetable/server/seat-moves";
import { getLabSeparateEnrollmentIdSet } from "@/features/enrollments/server/lab-separate";
import { applyLabSeparateMarks } from "@/features/timetable/lib/lab-separate";
import {
  settingsToPeriodsConfig,
  slotPeriodRow,
  subjectPeriodRows,
  weekdayTableFor,
} from "@/features/timetable/lib/periods";
// 보강 탭(원장 2026-09-14) — 슬롯이 아니라 보강 예약(0264a)을 요일 × 교시 칸에 그린다. 표시 전용(가드 makeup-tab-wiring).
import { getReservationsInWeek } from "@/features/attendance/server/makeup-reservation-queries";
import { attachReservedLines } from "@/features/timetable/server/reserved-lines";
import { attachSplitLines } from "@/features/timetable/server/split-lines";
import { canSplitClassNow } from "@/features/class-splits/server/gate";
import { listMakeupScopeClasses } from "@/features/attendance/server/makeup-reservation-scope";
import { MakeupWeekView, type MakeupWeekEntry, type MakeupWeekRow } from "./_components/makeup-week-view";
import { fetchInChunks } from "@/lib/supabase/batch";
import { createClient } from "@/lib/supabase/server";
import { schoolGradeLabel } from "@/lib/format/school-grade";
import { buildRichClassCards, type TeacherColorMap } from "@/features/timetable/lib/class-grid";
import { getTenantSettings } from "@/features/owner/server/queries";
import { getGoogleSheetsStatus } from "@/features/integrations/server/queries";
import { canManageSheetSync } from "@/features/integrations/server/sheet-access";
import { canManageTimetableImport } from "@/features/timetable/server/import-access";
import { isSheetExportSubject } from "@/features/integrations/sheets-provider";
import { SUBJECT_SOFT, buildSubjectMaps } from "@/features/owner/subjects";
import { resolveWeekdayGroups } from "@/features/timetable/lib/weekday-groups";
import {
  DEFAULT_TIMETABLE_KIND,
  TIMETABLE_KINDS,
  isMakeupKind,
  TIMETABLE_KIND_LABEL,
  matchesTimetableKind,
  parseTimetableKind,
  type TimetableKind,
} from "@/features/timetable/lib/class-kind";
import {
  ENGLISH_TRACK_FILTERS,
  ENGLISH_TRACK_FILTER_LABEL,
  keepEnglishTrack,
  normalizeEnglishTrackFilter,
  type EnglishTrackFilter,
} from "@/features/classes/english-track";
import { canAccessTenant, canManageTenant, canWriteTenant } from "@/lib/auth/perm-matrix";
import { resolveSkillAreas } from "@/features/owner/skill-areas";
import { EcsShortcut } from "./_components/ecs-shortcut";
import { EditorShortcut } from "./_components/editor-shortcut";
import { canUseTimetableEditor } from "@/features/timetable-lab/server/access";
import { resolveIntegrationGroups } from "@/features/timetable/lib/integration-groups";
import { normalizePresets } from "@/features/timetable/lib/group-presets";
import { shouldSerializeView, subjectDefaultView, viewForSubjectSwitch } from "@/features/timetable/lib/view-default";
import { resolveTimetableSubject } from "@/features/timetable/lib/subject-default";
import { dateOfDowInWeek, getWeekReferenceDate, mondayOf, thisMonday, weekBoundsOf, weekRelation, weekSundayOf, weekTitle } from "@/features/timetable/lib/week";
import { pickScheduledGroupsForWeek } from "@/features/timetable/scheduled-groups";
import { getScheduledGroupPlans } from "@/features/timetable/server/scheduled-groups-queries";
import { buildTimetableSearchIndex, timetableSearchScope } from "@/features/timetable/lib/student-search";
import {
  TimetableSearchEmptyNote,
  TimetableSearchToggle,
  TimetableSearchProvider,
} from "./_components/search-context";
import { kstMinutesOfDay, kstToday, weekdayIndexOf } from "@/lib/date-kst";
import { RichGridView } from "./_components/rich-grid-view";
import { RosterMoveArea } from "./_components/roster-move";
import { IntegratedEditBoard } from "./_components/integrated-edit-board";
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
  STUDENTS_COOKIE,
  readCompact1hFor,
} from "@/features/timetable/lib/pref-cookies";
import { TimetableViewPrefsSync } from "./_components/prefs-sync";
import { EmptyPeriodScope } from "./_components/empty-period-scope";
import { ClassMoveProvider } from "./_components/class-move-context";
import { buildClassMoveIndex } from "@/features/timetable/lib/class-move";
import { TimetableColorPrefSync } from "./_components/color-mode-toggle";
import { TimetableFontPrefSync, TimetableZoomArea } from "./_components/font-size-toggle";
import { TimetableExitOverlay } from "./_components/exit-overlay/exit-overlay";
import { ExitOverlayHint } from "./_components/exit-overlay/exit-overlay-hint";
import { TimetableViewSettings } from "./_components/view-settings";
import { applyGradeFilter } from "@/features/timetable/lib/view-prefs";
import { getTimetableEntryPreferences } from "@/features/timetable/server/view-prefs-queries";
import { WeekNav } from "./_components/week-nav";
import { ScheduledImportBadge } from "./_components/scheduled-import-badge";
import { LabApplyBadge } from "./_components/lab-apply-badge";
import { getPendingLabApplies } from "@/features/timetable-lab/server/apply-queries";
import { SplitListBadge } from "./_components/split-list-badge";
import { getScheduledImports } from "@/features/timetable/server/scheduled-import-queries";
import { WeekdayGroupTables } from "./_components/weekday-group-tables";
import { TEACHER_VIEW_ORDER_GROUP, TeacherGridView } from "./_components/teacher-grid";
import { TimetableApplyRefresh } from './_components/apply-refresh';
import { TeacherOrderDialog } from "./_components/teacher-order-dialog";
import { RoomMapView } from "./_components/room-map-view";
import { resolveDayWindows } from "@/features/timetable/lib/room-metrics";
import { buildTeacherComparator } from "@/features/timetable/lib/english-teacher-sheet";
import type { DayOfWeek } from "@/features/timetable/lib/periods";

export const metadata = { title: "시간표 — 에이와" };

type ViewMode = "basic" | "integrated" | "teacher" | "rooms";
// 전부 과목별(과목칩으로 1개 선택·전환). 기본뷰 = 요일그룹밴드(교시×강사요일, 학생명단, 드래그 편집).
// 통합뷰 = 반=단위 반응형 카드 그리드(반 카드: 헤더·학생명단·정원, 읽기전용 — 한눈에 반 단위로 본다).
// 강사뷰 = 기본뷰와 같은 격자를 **슬롯 강사**(slot_teacher_label) 기준으로 재구성(시트 강사별 배치 패리티,
// 읽기전용) — 영어처럼 한 반을 (요일,교시)마다 다른 강사가 가르치는 과목용. 칩은 english에서만 노출.
// 교실뷰 = 강의실 × 시간 점유 지도(전 과목·특강 포함, 읽기전용) — 과목·구분 칩이 **적용되지 않는** 유일한
// 뷰(한 과목만 그리면 다른 과목이 쓰는 교실이 비어 보이는 거짓 지도). 관리자 전용(강사 스코프는 담당 반만
// 보여 지도가 거짓이 된다 — roomsViewAllowed로 서버 강등).
// 과목 키·순서·라벨·색은 전부 학원설정(operations.subjects) 단일 소스(하드코딩 금지).

export default async function TimetablePage({
  searchParams,
}: {
  searchParams: Promise<{ view?: ViewMode; subject?: string; kind?: string; week?: string; compact1h?: string; emptydays?: string; emptyperiods?: string; students?: string; gedit?: string; etrack?: string }>;
}) {
  const user = await requireAccess("timetable");
  const { view: viewParam, subject: subjectParam, kind: kindRaw, week: weekRaw, compact1h: compact1hRaw, emptydays: emptydaysRaw, emptyperiods: emptyperiodsRaw, students: studentsRaw, gedit: geditRaw, etrack: etrackRaw } = await searchParams;
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
  // URL이 뷰를 **명시**했는지 — 없으면 아래에서 **그 과목의 기본 뷰**(학원설정)로 정한다.
  // 🔴 과목마다 주로 보는 뷰가 다르다(원장 2026-08-06 *"영어는 기본뷰를 잘 안 쓴다"*). 과목 키를 코드에
  //    박지 않고 `subjects[].defaultView`에서 읽는다(운영 enum 하드코딩 금지 규칙).
  //    ⚠️ 과목은 slots가 있어야 확정되므로(아래 `available`) 최종 view는 Promise.all **뒤**에 정해진다.
  const paramView: ViewMode | null =
    viewParam === "integrated"
      ? "integrated"
      : viewParam === "teacher"
        ? "teacher"
        : viewParam === "rooms"
          ? "rooms"
          : viewParam === "basic"
            ? "basic"
            : null;

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
  //
  // 🔴 **역할 게이트가 빠져 있었다**(2026-08-06 원장 제보로 수리): 조건이 시간(rel)뿐이라 실 강사에게도
  //    '편집'이 그대로 떴다. 시간표 편집은 드래그로 **학생을 반 사이로 옮기는 것**(moveEnrollmentsBatch)이라
  //    남의 반 명단까지 바뀐다 → 관리자(classes=full)만. `canWriteTenant`는 scoped 강사도 통과하므로
  //    쓰면 안 된다(perm-matrix `canManageTenant` 주석). 서버 액션도 같은 게이트로 잠갔다(#77).
  const canEdit = rel !== "past" && (await canManageTenant(user.systemRole, "classes"));
  // 명단 이동(통합뷰에서 대기/퇴원으로 끌어 놓기) = **학생 기록 변경**이라 문이 다르다 — 서버 액션의
  // 게이트(canManageStudentRecords = students full)와 같은 모양이어야 한다(#77: 끌 수는 있는데 저장에서
  // 거절당하면 그게 더 나쁘다). 강사는 학생 기록 열람 전용(원장 2026-08-18).
  const canEditRoster = rel !== "past" && (await canManageStudentStatusNow());
  // 이동 적용일 — 미래 주면 그 주 월요일에 예약, 이번 주면 오늘 즉시(undefined→RPC current_date).
  const effectiveDate = isFutureWeek ? week : undefined;

  // 강사(또는 겸직-강사뷰)는 담임 반 ∪ 그 주에 교시 하나라도 맡은 반만(intra-tenant PII 누수 차단, 원장 2026-09-17). master/직원은 전체.
  const teacherId = (await effectiveTeacherId()) ?? undefined;
  const lang = teacherId ? await getTeacherViewLang() : "ko";
  const tt = (text: string) => timetableText(lang, text);
  // 교실뷰 = 관리자 전용 — 강사 스코프 슬롯으로 그리면 남의 반이 쓰는 교실이 전부 비어 보인다(거짓 지도).
  const roomsViewAllowed = !teacherId;
  const [allSlots, settings, storedTeacherColors, entryPrefs, classroomsForMap, seatPins, seatMoves, labSeparateIds] = await Promise.all([
    // futureNames — 사람이 읽는 화면이라 **그 주에 불릴 반 이름**으로 그린다(원장 2026-08-29).
    // 🔴 시트·엑셀 경로는 켜지 말 것: 거기선 반 이름이 매칭 키라, 아직 DB에 없는 이름이 적히면
    //    그 시트를 되읽는 구조 가져오기가 그 반을 버리고 배치를 마감한다(fetchSlots 주석).
    getWeeklyScheduleWithStudents({ referenceDate, teacherId, futureNames: true }),
    getTenantSettings(),
    // 강사색 맵은 통합뷰(셀·담임색)·강사뷰(헤더색)에서만 필요. **명시적으로** 기본뷰일 때만 생략한다 —
    // 파라미터가 없으면 이 시점엔 과목(=그 과목의 기본 뷰)을 아직 모르기 때문. 여기서 아끼려고 나중에
    // 따로 조회하면 직렬 워터폴이 되므로(B4), 병렬인 이 자리에서 넉넉히 받는 편이 체감이 낫다.
    paramView !== "basic" ? getTeacherColorMap() : Promise.resolve({} as TeacherColorMap),
    // 계정 귀속 뷰 설정(0146a) — 서버 첫 렌더에서 읽어야 필터 없는 화면을 그렸다가 학생이 사라지는
    // 깜빡임이 없다. 미로그인·깨진 값은 '설정 없음'으로 떨어져 무중단.
    getTimetableEntryPreferences(),
    // 강의실 목록(교실뷰 컬럼 축) — 그 뷰일 때만(소형 참조 쿼리, B4로 병렬).
    // 교실뷰는 과목의 기본 뷰가 될 수 없으므로(전 과목 지도) 파라미터로만 들어온다 = 여기서 확정 가능.
    paramView === "rooms" && roomsViewAllowed ? getClassroomsLite() : Promise.resolve([]),
    // 자리(랩실) **교시 고정** 표식 재료(0255a) — 원장 2026-09-10 *"랩실 시간대를 영구 이동한 학생은
    // 시간표에서 … 파란글씨에 밑줄+이탤릭체로"*. 교실뷰는 명단이 클라까지 오지 않아(인원 수만) 표식이
    // 붙을 자리가 없으므로 그 뷰일 땐 왕복도 하지 않는다(위 `classroomsForMap`과 같은 판정 자리).
    // 🔑 여기 **병렬**로 둔 것이 요점 — 아래 `slots` 뒤에 await하면 직렬 워터폴이 된다(B4).
    paramView === "rooms" && roomsViewAllowed ? Promise.resolve(NO_SEAT_PINS) : getSeatPins(user.tenantId, referenceDate),
    // 통합뷰 **\*LAB 임시 칸** 재료(원장 2026-09-11) — 표시 주의 **하루 이동**(0255a `seat_period_moves`, 주 범위만).
    // 통합뷰가 될 수 없는 뷰(파라미터로 기본·강사·교실을 명시)면 왕복하지 않는다 — 파라미터가 없으면 과목의 기본
    // 뷰를 아직 몰라(영어 = 통합뷰) 받아 둔다. 🔑 여기 **병렬**로 둔 것이 요점(B4).
    // 묻지 않은 것은 null(모름) — "이동 0줄"이 아니다(그 뷰는 어차피 통합뷰가 아니지만, 0줄로 두면 거짓 칸의 재료가 된다).
    paramView === null || paramView === "integrated"
      ? getSeatWeekMoves(user.tenantId, referenceDate)
      : Promise.resolve(null),
    // ***LAB 배정 원생** 표식 재료(0271b, 원장 2026-09-18 *"이름 색을 lab 과 같은 색상으로 해주고 이탤릭체로"*) —
    // 교시 고정과 같은 판정 자리(교실뷰는 명단이 없어 왕복 안 함). fail-soft(null = 표식 없이). 🔑 병렬(B4).
    paramView === "rooms" && roomsViewAllowed ? Promise.resolve(null) : getLabSeparateEnrollmentIdSet(),
  ]);
  const { viewPrefs, subjects: staffSubjects } = entryPrefs;
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
  // '학생 명단 접기'(2026-09-04 원장) — 셀에 반 이름·강의실·인원만 남기고 명단을 감춘다. 기본 = 펼침.
  // 우선순위는 위 둘과 같다(URL → 계정 → 쿠키 → 기본값). 명단을 감추면 셀·행 높이도 함께 줄어든다.
  const savedHideStudents =
    viewPrefs.hideStudents ?? cookieStore.get(STUDENTS_COOKIE)?.value === "hide";
  const hideStudents = studentsRaw ? studentsRaw === "hide" : savedHideStudents;
  // 교시 시각 = owner 설정(operations.weekdayPeriods/weekendPeriods) → PeriodsConfig. 미설정 시 기본 상수.
  const periodsConfig = settingsToPeriodsConfig(settings.operations);
  const subjectMaps = buildSubjectMaps(settings.operations.subjects);
  // 구분(정규/특강/전체) 먼저 좁힌다 — 과목 칩도 "그 구분에 실제 있는 과목"만 떠야 한다
  // (특강이 수학뿐인데 영어 칩이 뜨고 눌러도 빈 화면이면 고장으로 보인다).
  // 판정은 서버가 확정한 boolean만 사용(화면에서 이름 매칭 재구현 금지).
  const kindSlots = allSlots.filter((s) => matchesTimetableKind(kind, s.isSpecialLecture));
  // 과목 칩 = 학원설정 과목 순서 ∩ 데이터에 실제 존재하는 과목(빈 과목칩 방지). 무조건 한 과목.
  // 🔴 보강 탭은 그 주 배치와 무관하게 **설정 과목 전부**가 선택지다 — 예약은 배치가 없는 주(휴가 주·강사 스코프 밖)에도 있다
  //    (적대 리뷰 2026-09-14: 카드는 N건인데 탭은 "예약 없음"이 되던 것).
  const available = isMakeupKind(kind)
    ? subjectMaps.options.map((o) => o.value)
    : subjectMaps.options.map((o) => o.value).filter((k) => kindSlots.some((s) => s.subject === k));
  const subject = resolveTimetableSubject(available, staffSubjects, subjectParam);
  const editorView = viewPrefs.editorView?.[subject];
  const teacherColors = { ...storedTeacherColors, ...editorView?.teacherColors };
  // 영어 프로그램 보기 필터(전체/EiE/인재원 영어, 0176a `classes.english_track`).
  // 🔴 **영어에만 있는 축이다** — 다른 과목 반은 english_track이 항상 null이라 'eie'를 걸면 화면이 통째로
  //    빈다. 그래서 칩도 안 띄우고 값도 'all'로 못박는다(과목 칩으로 옮겨가도 필터가 따라붙지 않는다).
  // 우선순위 = URL 파라미터(공유 링크 존중) → 계정(0146a) → 전체. 저장은 TimetableViewPrefsSync.
  // 🔴 EiE 모듈이 꺼진 학원(새 학원 기본)엔 이 축 자체가 없다 — 칩을 안 띄우고 'all'로 못박는다(2026-09-22 방향 B).
  //    침산은 켜져 있어 종전과 같다.
  const trackApplies = subject === "english" && isModuleEnabled(settings.modules.disabled, "eie");
  const englishTrack: EnglishTrackFilter = !trackApplies
    ? "all"
    : etrackRaw !== undefined
      ? normalizeEnglishTrackFilter(etrackRaw)
      : (viewPrefs.englishTrack ?? "all");
  /** 같은 과목 안에서 움직이는 링크(주 이동·뷰 전환·구분·뷰 설정)가 실어 나르는 값. 비영어면 안 싣는다. */
  const carriedTrack = trackApplies ? englishTrack : undefined;
  /** 그 과목을 열 때 처음 보이는 뷰(학원설정, 미설정·모르는 값=기본뷰). 과목 칩은 상대 과목 것도 묻는다. */
  const defaultViewOf = (key: string): ViewMode =>
    subjectDefaultView(settings.operations.subjects, key);
  const thisSubjectDefaultView = defaultViewOf(subject);
  const view: ViewMode = paramView ?? thisSubjectDefaultView;
  // '1시간 단위' 최종 해석 — 파라미터(공유 링크 존중) → 이 **과목의** 쿠키 → 빈 값(전부 펼침).
  // 쓰기는 Compact1hPrefSync(클라). 과목별이라 영어에서 접어둔 섹션이 수학에 새지 않는다.
  // ⚠️ 과목별이라 **그 과목 키가 계정에 있을 때만** 계정을 쓴다 — 계정 맵이 있어도 아직 그 과목을
  // 토글한 적이 없으면 쿠키(구 설정)를 살려야 한다(계정 첫 저장이 다른 과목 설정을 덮어버리지 않게).
  // '해제'는 계정에 **빈 배열로 명시 저장**되므로 `?? 쿠키`가 옛 값을 되살리지 않는다(none 센티널과 같은 이유).
  // ⚠️ 2026-08-13부터 **계정이 파라미터보다 앞선다** — 토글이 통합뷰에서 빠지고 '그룹 설정'으로 옮겨
  //    가면서, 유일한 쓰기 경로가 계정(users.ui_prefs)이 됐기 때문이다. 파라미터를 앞에 두면 그룹
  //    설정에서 방금 저장한 값을 **돌아올 때 URL에 실려 있던 옛 값**이 덮어써 "체크가 안 먹는다"가 된다.
  //    파라미터·쿠키는 계정에 값이 없을 때의 이관 폴백으로만 남는다.
  const compactList =
    viewPrefs.compact1h?.[subject] ??
    compactFromParam ??
    readCompact1hFor(cookieStore.get(COMPACT1H_COOKIE)?.value, subject);
  const compactSections = new Set(compactList);

  // 비수업 블록(감독·준비·회의·연차, 0138a) — **강사뷰에서만** 그린다. 반이 아니라서 다른 뷰·집계에
  // 섞으면 수업 수가 부풀고 과목/구분 칩에도 새어 나온다. subject 확정 뒤에 읽어야 해서(위 Promise.all은
  // subject를 아직 모른다) 여기서 조회 — 강사뷰일 때만 도는 경량 쿼리다.
  // ⚠️ 기본뷰에서도 **편집 권한자에 한해** 읽는다 — 반 블록 이동 판정의 강사 축이 이걸 봐야
  //    "그 시간에 그 강사는 회의/연차"인 칸을 초록으로 칠하지 않는다(적대 리뷰 2026-09-04).
  //    화면엔 안 그린다(반이 아니라서 다른 뷰에 섞으면 수업 수가 부푼다) — 판정 재료로만 쓴다.
  // ⚠️ 블록은 **과목별로 저장**된다(`teacher_schedule_blocks.subject`) — 영어로 등록된 연차·회의는
  //    수학 시간표의 이동 판정에 안 잡힌다(같은 과목 안에서만 참인 축이다).
  // 🔴 여기서 곧바로 await하지 않는다 — 기본뷰는 가장 많이 여는 화면이라 직렬 왕복이 첫 페인트를 민다(B4).
  //    아래 다른 조회들과 겹쳐 돌리고 **쓰기 직전에** 기다린다.
  const needsBlocks = subject && (view === "teacher" || canEdit);
  const scheduleBlocksPromise = needsBlocks
    ? getTeacherScheduleBlocks(subject, referenceDate, teacherId)
    : Promise.resolve([]);

  // '시트로 보내기' 버튼 = sheet_sync 권한(기본 원장·관리자·실장, owner에서 조정) + 지원 과목(math·english) + 연동 ON.
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
  const canMasterImport = subject === "english" && canManageImport && await canManageSheetSync(user.systemRole);
  // 미래 날짜로 적용해 둔 가져오기(예약) — 툴바 배지의 재료. 예약이 없으면 0행이라 비용이 사실상 없고,
  // 권한자에게만 도는 쿼리다(배지의 × 가 권한자 전용이라 남에게 보여줄 이유가 없다).
  const scheduled = (canSync && canManageImport) || canMasterImport ? await getScheduledImports() : [];
  // 위에서 미리 띄워 둔 근무 블록(판정 재료·강사뷰 격자) — 여기서 한 번 기다린다.
  const scheduleBlocks = (await scheduleBlocksPromise).map(slot => ({ ...slot, editorNote: editorView?.slotMetadata?.[slot.id.startsWith('block:') ? slot.id : `block:${slot.id}`]?.note }));
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
  // 프로그램 필터는 **반 단위**(학년 필터와 축이 다르다 — 저쪽은 학생 단위라 혼합 반이 살아남아야 한다).
  // 비대칭 계약 주의: '인재원 영어' = "EiE가 아닌 전부"(미분류 포함) — keepEnglishTrack 주석 참조.
  // 마지막에 자리(랩실) **교시 고정** 표식을 얹는다 — 세 뷰(기본·통합·강사)가 이 한 벌을 함께 쓴다.
  // 🔴 필터 **뒤**여야 한다: '그 반이 그날 이 자리에 오는가'는 화면에 실제로 선 슬롯 기준이다(필터로 빠진 반엔
  //    표식을 얹을 명단도 없다). 반면 **다른 시간으로 옮긴** 고정의 목표 교시는 남의 반 자리 교시라 필터·강사
  //    범위 뒤엔 안 보인다 → 학원 전체 배치(`liveStarts`, 고정이 있을 때만 조회)로 본다. 고정이 0줄이면 입력을
  //    그대로 돌려주므로 평소 비용은 0이다.
  // 이어서 ***LAB 배정 원생** 표식(0271b) — 그 주 *LAB 교시가 있는 반의 켠 원생 이름만 LAB 파랑 + 이탤릭(lab-separate.ts).
  //    켠 수강이 없으면 입력을 그대로 돌려준다(평소 비용 0).
  const slots = applyLabSeparateMarks(
    applySeatPinMarks(
      applyGradeFilter(
        keepEnglishTrack(
          kindSlots.filter((s) => s.subject === subject),
          englishTrack,
        ),
        viewPrefs.grades,
      ),
      { pins: seatPins.pins, liveStarts: seatPins.liveStarts, referenceDate },
    ),
    labSeparateIds,
  ).map(slot => ({ ...slot, sourceId: slot.id, editorNote: editorView?.slotMetadata?.[slot.id]?.note, editorLocked: editorView?.slotMetadata?.[slot.id]?.locked }));
  const subjectRow = settings.operations.subjects.find((s) => s.key === subject);

  /**
   * **보강 탭**(구분 = 보강, 원장 2026-09-14) — 이 과목 반들의 그 주 보강 예약(0264a)을 요일 × 교시 칸에 세운다.
   * 🔴 반 집합은 **이 화면이 보는 반**(`allSlots`, 강사 스코프 뒤)뿐이다 — 예약 표를 따로 스코핑하지 않고 화면의
   *    범위를 그대로 쓴다(남의 반 예약이 새지 않게, #77). 이번 주에 배치가 없는 반의 예약은 여기 안 뜬다(알려진 한계).
   * 🔴 슬롯·명단·집계·드래그엔 안 들어간다 — 이 값은 `MakeupWeekView` 한 곳으로만 간다(가드 makeup-tab-wiring).
   * 교시 행은 학원설정 표(`subjectPeriodRows`), 시각 → 행은 슬롯과 **같은 함수**(`slotPeriodRow`)로 잰다.
   */
  const makeupTab = isMakeupKind(kind);
  let makeupEntries: MakeupWeekEntry[] = [];
  const makeupRows: MakeupWeekRow[] = makeupTab
    ? subjectPeriodRows(subject, false, periodsConfig).map((r) => ({ key: r.key, label: r.label, time: r.time }))
    : [];
  const makeupWeekendRows: MakeupWeekRow[] = makeupTab
    ? subjectPeriodRows(subject, true, periodsConfig).map((r) => ({ key: r.key, label: r.label, time: r.time }))
    : [];
  if (makeupTab && subject) {
    // 🔴 반 집합은 운영실 '보강예정' 카드와 **같은 함수**(`listMakeupScopeClasses` — 관리자 = 활성 반 전부 · 강사 = 담임∪위임∪
    //    교시 담당) + 이 탭의 과목 축. 그래서 이번 주 배치가 없는 반의 예약(토요일 보강 등)도 여기 선다.
    const scopeClasses = await listMakeupScopeClasses(teacherId ?? null, weekBoundsOf(referenceDate));
    const classMeta = new Map<string, { className: string; teacherName: string | null }>();
    for (const c of scopeClasses) {
      if (c.subject !== subject) continue;
      classMeta.set(c.id, { className: c.className, teacherName: c.teacherName });
    }
    const reservations = await getReservationsInWeek(referenceDate, [...classMeta.keys()]);
    if (reservations.length > 0) {
      const sb = await createClient();
      const [students, creators] = await Promise.all([
        fetchInChunks<{ id: string; name: string; grade: string | null; school: string | null }>(
          [...new Set(reservations.map((r) => r.studentId))],
          (chunk) => sb.from("students").select("id, name, grade, school").in("id", chunk),
        ).catch(() => [] as { id: string; name: string; grade: string | null; school: string | null }[]),
        fetchInChunks<{ id: string; display_name: string | null }>(
          [...new Set(reservations.map((r) => r.createdBy).filter((v): v is string => !!v))],
          (chunk) => sb.from("users").select("id, display_name").in("id", chunk),
        ).catch(() => [] as { id: string; display_name: string | null }[]),
      ]);
      const studentById = new Map(students.map((s) => [s.id, s]));
      const creatorById = new Map(creators.map((u) => [u.id, u.display_name ?? null]));
      const dowOf = (ymd: string): DayOfWeek =>
        (["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const)[weekdayIndexOf(ymd)]!;
      const rowKeys = new Set([...makeupRows, ...makeupWeekendRows].map((r) => r.key));
      makeupEntries = reservations.flatMap((r): MakeupWeekEntry[] => {
        const stu = studentById.get(r.studentId);
        const cls = classMeta.get(r.classId);
        if (!stu || !cls) return [];
        const dow = dowOf(r.makeupDate);
        const row = slotPeriodRow(subject, r.slotStart, dow, periodsConfig, r.slotEnd);
        return [
          {
            id: r.id,
            dayOfWeek: dow,
            date: r.makeupDate,
            slotStart: r.slotStart,
            slotEnd: r.slotEnd,
            periodLabel: r.periodLabel,
            rowKey: rowKeys.has(row.key) ? row.key : null,
            studentName: stu.name,
            studentLabel: schoolGradeLabel(stu.school, stu.grade) || null,
            className: cls.className,
            teacherName: cls.teacherName,
            absenceDate: r.absenceDate,
            // 잘못 잡힌 예약을 고치는 자리 = 결석일이 있는 **원반의 월별 출석부 칸**(우클릭 → 보강 예약 취소, 감사 N10).
            //    학생 검색 씨앗(`q`)으로 그 학생 줄만 남긴 채 연다. 이 탭은 여전히 표시 전용이다(링크 하나만).
            attendanceHref: `/attendance?class=${encodeURIComponent(r.classId)}&month=${r.absenceDate.slice(0, 7)}&q=${encodeURIComponent(stu.name)}`,
            note: r.note,
            createdByName: r.createdBy ? creatorById.get(r.createdBy) ?? null : null,
          },
        ];
      });
    }
  }
  /** 요일 → 그 주 날짜 "M/D"(보강 탭 머리) — 요일 칸의 실제 날짜(`dateOfDowInWeek`)와 같은 축. */
  const makeupDateOf: Record<string, string> = {};
  if (makeupTab) {
    for (const d of ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]) {
      const ymd = dateOfDowInWeek(referenceDate, d);
      if (ymd) makeupDateOf[d] = `${Number(ymd.slice(5, 7))}/${Number(ymd.slice(8, 10))}`;
    }
  }
  // English Class Sheet 바로가기 — 지금 보는 과목이 ECS 대상일 때만. 조건은 ECS의 정식 게이트
  // (requireEcsClassAccess: english + skillAreas 비어있지 않음)와 **같은 식**이라야 "눌렀는데 빈 목록"이
  // 안 생긴다. 권한(ecs=none인 상담사·회계)까지 봐야 눌러도 튕기는 죽은 버튼이 안 된다(#77).
  // ⚠️ searchParams.subject를 직접 보지 말 것 — 메뉴로 처음 들어오면 URL에 과목이 없고(담당 과목으로 정해진다),
  //    없는 과목이 적힌 링크도 들어온다. 판정은 위에서 확정한 `subject`로만.
  const showEcsShortcut =
    subject === "english" &&
    resolveSkillAreas(subjectRow).length > 0 &&
    (await canAccessTenant(user.systemRole, "ecs"));
  // 시간표 편집기(연습본) 바로가기 — 편집기는 아직 **영어 전용**이라 영어를 볼 때만, 편집기 화면·연습본 API와
  // **같은 판정**(`canUseTimetableEditor` = 시간표·반 관리)을 통과한 사람에게만 보인다(#77: 눌러도 튕기는 죽은 버튼 금지).
  const showEditorShortcut = subject === "english" && (await canUseTimetableEditor(user.systemRole));
  // 실행을 기다리는 연습본 예약 — 시트 반영 배지 옆에 띄운다(원장 2026-11-02). 예약이 없으면 0행이다.
  const labApplies = showEditorShortcut ? await getPendingLabApplies(user.tenantId) : [];
  // X 겹침(석 달 퇴원 — 수강종료 포함, 원장 2026-10-14) — 퇴원관리를 볼 수 있는 사람만(액션이 같은 판정으로 한 번 더 막는다).
  // 강사 화면(본인·'다른 강사 뷰')엔 없다 — 그 화면은 강사 범위인데 겹침은 과목 전체라서.
  const showExitOverlay = !teacherId && (await canAccessTenant(user.systemRole, "withdrawals"));
  // 통합뷰 섹션 = 커스텀 그룹(학원설정 과목별)이 켜져 있으면 그것, 아니면 "N교시 시작" 자동 그룹.
  // 엑셀·시트 빌더도 같은 해석기를 쓴다(화면과 배치 일치가 이 기능의 존재 이유).
  // 🔴 **미래 주는 그 주에 쓸 줄로 그린다**(원장 2026-08-29 *"통합뷰 그룹설정(줄)은 반영안된거같은데?"*).
  //    반 이름은 이미 미래 이름으로 그리므로(futureNames), 줄만 옛 배치로 두면 9월 주 화면에서
  //    **9월 반 이름이 8월 줄에 서 있다**. 판정·조회는 예약 스냅샷 단일 소스.
  // ⚠️ 지나간 주는 물어보지도 않는다(왕복 0) — 예약은 미래분만 있다.
  const scheduledGroups =
    subjectRow && weekSundayOf(week) >= today
      ? pickScheduledGroupsForWeek(
          await getScheduledGroupPlans(),
          weekSundayOf(week),
          subject,
          subjectRow.integrationGroups,
        )
      : null;
  const customGroups = editorView?.groups ?? resolveIntegrationGroups(
    // 🔴 **읽기 뷰에만** 갈아끼운다 — 배치 편집 모드는 아래에서 `subjectRow`를 직접 읽는다.
    //    편집기에 미래 배치를 넣으면 저장 한 번에 그 배치가 **오늘부터** 굳어 버린다.
    scheduledGroups && subjectRow ? { ...subjectRow, integrationGroups: scheduledGroups.groups } : subjectRow,
  );
  // 저장해 둔 배치 보관함(과목별) — 그룹 설정(배치 편집) 모드가 읽는다.
  const groupPresets = normalizePresets(
    subjectRow?.integrationGroupPresets,
    subjectRow?.integrationOthersTitle ?? "",
  );
  // 과목별 요일 병합 — 기본 프리셋 또는 학원이 만든 묶음. 없거나 깨지면 월·목 / 화·금.
  const weekdayGroups = resolveWeekdayGroups(subjectRow?.weekdayGrouping, settings.operations.weekdayGroupings);

  // 강사뷰 허용 = 영어 또는 강사별시간표 설정(teacherViewLines)이 있는 과목만 — URL 직입력으로
  // 비영어에 영어 전용 격자·시트 강사 순서가 렌더되던 것 서버 강제 차단(2026-07-06, effView로 렌더).
  const allowsTeacherView = (k: string) =>
    k === "english" ||
    ((settings.operations.subjects.find((s) => s.key === k)?.teacherViewLines?.length ?? 0) > 0);
  const teacherViewAllowed = allowsTeacherView(subject);
  const effView: ViewMode =
    view === "teacher" && !teacherViewAllowed
      ? "basic"
      : view === "rooms" && !roomsViewAllowed
        ? "basic"
        : view;
  // 통합뷰 '그룹 설정' = 학원설정(과목별)을 쓰므로 게이트도 **owner 쓰기**. 시간표에 있다고 시간표
  // 권한으로 열면 학원설정 우회 뒷문이 된다(서버 액션도 같은 게이트로 2차 방어, #77).
  const canEditGroups = effView === "integrated" && (await canWriteTenant(user.systemRole, "operations_settings"));
  // 통합뷰 '배치 편집' 모드 — 실제 표 위에서 반을 끌어 줄을 바꾼다. URL 파라미터라 창을 다시 열면
  // 자동으로 읽기 전용으로 돌아온다(편집 상태가 눌러앉지 않게). 권한 없으면 파라미터를 무시.
  const groupEditing = canEditGroups && geditRaw === "1";
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
  /**
   * 강사뷰 시간축 **하한** — 학원설정 교시표의 **첫 교시 시작**(설정 단일 소스, 하드코딩 금지).
   *
   * 원장 2026-09-09: *"이 1개 반 때문에 지금 오전이 표시되고 있는데, 그냥 강제로 2시로 끌어내려."*
   * 실측(영어 9월 2주차): 토요일 `고등E_고3 정규` 한 반이 10:00에 있어 축이 10:00부터 그려졌고
   * **평일 오전 4시간이 통째로 빈 칸**이었다. 하한을 두면 그 반은 첫 줄에 끌려 내려오고(표식 + 실제 시각),
   * 나머지는 실제로 수업하는 시간대만 본다.
   * ⚠️ 교시표를 바꾸면 축도 따라 움직인다 — 그게 설정 단일 소스로 두는 이유다.
   */
  const teacherAxisFloorMin = (() => {
    const table = weekdayTableFor(subject, periodsConfig);
    const starts = Object.values(table)
      .map((p) => {
        const [h, m] = String(p.startTime ?? "").split(":").map(Number);
        return Number.isFinite(h) && Number.isFinite(m) ? (h as number) * 60 + (m as number) : null;
      })
      .filter((v): v is number => v != null);
    return starts.length > 0 ? Math.min(...starts) : undefined;
  })();
  // '가로줄 제외 강사'는 **라벨 문자열로** 열과 맞물린다 — 슬롯 라벨을 한글 이름으로 바꾼 뒤에도
  // 예전에 저장된 값("Hannah"·"이주희")이 계속 맞도록 같은 해석기를 통과시킨다(마이그레이션 불필요).
  const teacherLabelMap = await getTeacherLabelMap();
  const teacherViewExcluded = resolveTeacherLabels(
    subjectRow?.teacherViewLineExcluded ?? [],
    teacherLabelMap,
  );
  // 강사 컬럼 순서도 **라벨 문자열로** 열과 맞물린다 — 제외 강사와 같은 해석기를 통과시켜야
  // 예전에 닉네임으로 저장된 값도 계속 맞는다(마이그레이션 불필요).
  /**
   * 강사뷰 열 순서 — **계정 저장이 먼저**(원장 2026-09-09 *"강사 드래그해서 위치 바꾸도록. 사용자별 저장"*),
   * 없으면 학원설정 '강사 순서'(전 직원 공용), 그것도 없으면 시트 미러 + 자리(JJ·LAB) 최우측.
   * 🔴 둘을 합치지 않는다 — 개인이 한 번이라도 끌었으면 그 사람 화면은 그 순서다(설정이 개인 선택을
   *    덮으면 "끌어도 원래대로 돌아온다"가 된다). 순서는 정렬 힌트라 목록에 없는 강사는 뒤에 붙는다.
   */
  const personalTeacherViewOrder = viewPrefs.teacherOrder?.[subject]?.[TEACHER_VIEW_ORDER_GROUP];
  const teacherViewOrder = resolveTeacherLabels(
    personalTeacherViewOrder && personalTeacherViewOrder.length > 0
      ? personalTeacherViewOrder
      : (subjectRow?.teacherViewOrder ?? []),
    teacherLabelMap,
  );
  /**
   * 담임·강사 헤더에 `한글이름(영어이름)`을 적을 때 쓰는 맵 — **영어 과목에서만**(원장 2026-08-13).
   * 🔴 과목을 가리는 이유: 닉네임은 영어과 문화다. 실측(활성 12명 중) **김은정(Celine)이 비영어 반 8개**
   *    담임이라, 과목을 안 가리면 수학 시간표에도 "김은정(Celine)"이 붙는다(요청 밖 화면이 바뀐다).
   * 왕복은 0회 — `getTeacherLabelMap`과 **같은 조회**(getTeacherNameRows, React cache)를 나눠 쓴다.
   */
  const teacherNicknames = subject === "english" ? await getTeacherNicknameMap() : undefined;
  // '강사 순서' 창이 편집할 목록 = **지금 강사뷰에 실제 있는 강사**를 현재 표시 순서 그대로.
  // (설정에 없던 강사도 포함해야 저장 한 번에 순서가 통째로 굳는다.)
  const teacherViewNames =
    effView === "teacher"
      ? Array.from(
          new Set(
            // ⚠️ 컬럼 키 도출은 강사뷰(teacher-grid `teacherOf`)와 **똑같아야** 한다 —
            //    다르면 창에 없는 열이 화면에 뜨거나 그 반대가 된다.
            [...slots, ...scheduleBlocks]
              .map((s2) => {
                const r = s2 as { slotTeacherLabel?: string | null; teacherName?: string | null };
                return r.slotTeacherLabel ?? r.teacherName ?? "—";
              })
              .filter(Boolean),
          ),
        ).sort(buildTeacherComparator(teacherViewOrder))
      : [];

  const isIntegrated = effView === "integrated";
  const isRooms = effView === "rooms";
  /**
   * 기본뷰 반 칸의 **'보강' 줄**(원장 2026-09-14 *"하단에 '대기'나 '퇴원'처럼 '보강' 리스트"*) — 화면에 선 반의 그 요일 칸
   * 날짜에 잡힌 예약(0264a). 🔴 **기본뷰 격자(`WeekdayGroupTables`)로만** 간다 — 통합·강사·교실뷰·엑셀·시트·이동 판정은
   * `slots`(예약 없음)를 그대로 본다(가드 makeup-reservation-wiring ③). 보강 탭은 제 격자를 따로 세운다.
   */
  // 🔴 예약이 **두 갈래**로 나온다(reserved-lines.ts): 원반 칸이 있는 날은 그 반 칸 아래 줄(`slots[].reserved`),
  //    없는 날은 원반 담임 열에 세울 '보강' 박스(`strays`). 둘 다 기본뷰 격자 한 곳으로만 간다.
  // 🔑 '나눔'(수업 나누기 0351a)도 같은 자리로만 간다 — 보강 예약과 서로 독립이라 함께 읽는다(B4). 칸 순서는 둘 다 보존한다.
  const basicOnly = !makeupTab && effView === "basic";
  // 메모 시트(영어 통합뷰 오른쪽 엑셀 판, 원장 2026-10-19) — 판이 설 수 있는 화면일 때만 문을 본다(보기·편집 한 번에).
  // 강사 화면엔 없다(memoSheetAccess 주석). 시트 내용은 오른쪽 판의 Suspense 안에서 읽는다(첫 그림을 막지 않게, B7).
  const memoSlot = isIntegrated && !groupEditing && !makeupTab && slots.length > 0 && isMemoSheetSubject(subject);
  // 칸 메모(영어 강사뷰, 원장 2026-10-22 *"각 셀마다 우클릭해서 엑셀처럼 메모"*) — 메모 시트와 **같은 문**(memoSheetAccess:
  // 보기 = 시간표 열람 · 편집 = 시간표 '전체' · 강사 화면 없음). 메모 내용은 표가 뜬 뒤 레이어가 그 주 것만 따로 읽는다(B7).
  const cellMemoSlot = effView === "teacher" && !makeupTab && slots.length > 0 && isCellMemoSubject(subject);
  const [basicReserved, basicSplit, canSplit, memo, cellMemoAccess] = await Promise.all([
    basicOnly ? attachReservedLines(slots, referenceDate) : null,
    basicOnly ? attachSplitLines(slots, referenceDate) : null,
    basicOnly && canEdit ? canSplitClassNow() : false,
    memoSlot ? memoSheetAccess(user) : { canView: false, canEdit: false },
    cellMemoSlot ? memoSheetAccess(user) : { canView: false, canEdit: false },
  ]);
  const reservedSlots = basicReserved?.slots ?? slots;
  const basicSlots = basicSplit
    ? reservedSlots.map((s, i) => {
        const lines = basicSplit.slots[i]?.splits;
        return lines ? { ...s, splits: lines } : s;
      })
    : reservedSlots;
  const activeSplits = basicSplit?.active ?? [];
  const strayReserved = basicReserved?.strays ?? [];
  // 통합뷰 **\*LAB 임시 칸**(원장 2026-09-11 *"이동된 학생때문에 추가되는거니까 *LAB 같은식으로 임시 추가"*) —
  // 자리 출석부에서 다른 시간 랩실로 옮겨 앉는(하루 이동·상시 고정) 학생의 요일·교시 칸. 판정은 자리 출석부와 같은 함수.
  // 🔴 `slots`·카드 칸·교시축엔 **안 넣는다** — 이 값은 RichGridView 한 곳으로만 간다(인원·반 드래그·충돌·엑셀·
  //    강사뷰·기본뷰 무관, 가드 virtual-lab-wiring). 배치 편집(수업명만)엔 격자가 없어 만들지 않는다.
  // 🔴 고정·하루 이동 중 **하나라도 모르면**(조회 실패·안 물음) 칸을 안 세운다(`knownLabSources`) — 실패를 "0줄"로
  //    읽으면 거짓 칸이 선다(하루 이동을 모르면 "오늘만 제 교시로" 되돌린 학생이 고정 교시에 서고, 고정을 모르면 고정
  //    첫날이 "하루만"이 된다). 이름 표식(`applySeatPinMarks`)은 이 판정과 무관하게 고정만 본다.
  // 🔑 고정·이동이 0건이어도 null이라 입력도 안 본다(추가 조회 0). 학원 전체 배치는 **초기 Promise.all 안에서 이미
  //    읽혔다**(고정이 있으면 getSeatPins, 이동이 있으면 getSeatWeekMoves — 같은 React cache) → 여기 await는 늘 캐시
  //    적중이라 직렬 왕복이 없다(B4).
  // 🔴 `.catch(() => null)` = 이중 방어 — getSeatLiveSlots 안쪽 catch가 빠져도 부가 표시 하나 때문에 시간표 전체가
  //    500이 되지 않게(여기는 어떤 try에도 싸여 있지 않다). 모르면 칸 없음.
  const labSources = isIntegrated && !groupEditing ? knownLabSources(seatPins, seatMoves) : null;
  const virtualLabs = labSources
    ? buildVirtualLabs({
        slots,
        pins: labSources.pins,
        moves: labSources.moves,
        live: await getSeatLiveSlots(user.tenantId, referenceDate).catch(() => null),
        referenceDate,
        subject,
        config: periodsConfig,
      })
    : NO_VIRTUAL_LABS;
  // 교실뷰 인라인 정원 편집 — 강의실은 owner 도메인이라 게이트도 owner 쓰기(그룹 설정과 동일 논리,
  // 서버 액션 updateClassroomCapacity가 같은 게이트로 2차 방어).
  const canEditRoomCapacity = isRooms && (await canWriteTenant(user.systemRole, "operations_settings"));
  // 교실뷰 데이터 — **전 과목·전 구분(특강 포함)** 슬롯을 경량화(학생 명단 대신 재원 수만 = PII·페이로드
  // 축소). kind·과목·학년 필터를 일부러 안 태운다 — 어떤 필터든 "그 교실이 그 시간에 비어 있다"는 거짓을
  // 만든다(위 ViewMode 주석. 유일한 예외 = 뷰 안 '특강 숨김' 토글, 원장 요청 08-03 — 지도·지표 동시 제외라
  // 화면 내 수치는 일관). 실효 강의실 = 교시 override ?? 반 기본(overlap-detect와 같은 우선순위).
  const roomSlots = isRooms
    ? allSlots
        .filter((s) => !s.blockKind)
        .map((s) => ({
          id: s.id,
          classId: s.classId,
          className: s.className,
          subject: s.subject,
          dayOfWeek: s.dayOfWeek,
          startTime: s.startTime,
          endTime: s.endTime,
          teacherLabel: s.slotTeacherLabel ?? s.teacherName,
          students: s.students.filter((st) => st.status === "active").length,
          classBgColor: s.classBgColor,
          classTextColor: s.classTextColor,
          isSpecialLecture: s.isSpecialLecture,
          roomId: s.slotRoomId ?? s.classRoomId,
          roomLabel: s.slotRoomLabel ?? s.classroomName,
          // 자리(JJ·LAB) 여부 — 겹침 판정의 근거. ⚠️ 판정은 **`slot_teacher_label`만** 본다
          // (teacherName이 우연히 같은 문자열일 수 있고, 반 이름 추측은 더 위험하다 — #93과 같은 이유).
          isSeat: isSpecialSlotLabel(s.slotTeacherLabel),
        }))
    : [];
  // 운영 창 두 벌 — 전체 / 특강 제외. '특강 숨김' 토글이 **분자만** 줄이고 분모(창)는 그대로 두면
  // 가동률이 거짓으로 떨어진다(2026-08-04 적대 리뷰). 뷰가 토글에 맞는 창을 골라 쓴다.
  const roomSubjects = [...new Set(roomSlots.map((s) => s.subject))];
  const roomWindows = isRooms ? resolveDayWindows(roomSubjects, periodsConfig, roomSlots) : null;
  const roomWindowsNoSpecial = isRooms
    ? resolveDayWindows(
        roomSubjects,
        periodsConfig,
        roomSlots.filter((s) => !s.isSpecialLecture),
      )
    : null;
  const todayDow: DayOfWeek = (["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const)[
    weekdayIndexOf(today)
  ]!;
  // "지금" 표시(교실뷰) — 서버 렌더 시점 KST 고정(클라 타이머 없음, 새로고침·주 이동 시 갱신).
  const nowMin = kstMinutesOfDay();
  // ('1시간 단위' 섹션 토글 href는 없앴다 — 토글이 통합뷰에서 '그룹 설정' 화면으로 옮겨갔고,
  //  거기선 URL이 아니라 계정 설정에 직접 저장한다. 2026-08-13)
  // 🔴 상단 명단 요약(재원·신입·반이동·대기·퇴원 인원)은 **없앴다**(원장 2026-09-28 *"시간표 우측 상단 인원 표시 삭제. 헷갈리니까"*).
  //    셀의 신입·준신입·반이동·대기·퇴원 **표시**(30일·60일 창)는 그대로다. 인원은 원생목록·운영실·퇴원관리가 센다.

  // 학생 검색(원장 2026-08-20 "학생 검색하면 해당 학생이 존재하는 수업만 노출") — **새 조회 없이**
  // 위에서 이미 만든 `slots[].students[]`로 반 단위 색인만 만든다(그래서 강사 열람 범위도 안 넓어진다).
  // 판정·강조·0건 문구는 전부 클라에서(서버 왕복 0) — [search-context.tsx](./_components/search-context.tsx).
  // 🔴 **교실뷰는 제외**: 그 뷰의 슬롯(roomSlots)은 명단 대신 인원 수만 내려가 검색할 이름이 아예 없다.
  //    통합뷰 '배치 편집'(gedit)도 표가 수업명만 남는 배치 화면이라 검색 대상이 아니다. 두 경우엔
  //    공급자를 안 씌워 **입력칸 자체가 안 뜬다**("있는데 안 먹는 것"이 제일 나쁘다).
  const searchEnabled = !isRooms && !(isIntegrated && groupEditing);
  const searchIndex = searchEnabled ? buildTimetableSearchIndex(slots) : [];
  // 0건일 때 "어디에 없는지" — 지금 보고 있는 범위 그대로(권한 이야기는 하지 않는다).
  const searchScope = timetableSearchScope([
    rel === "current" ? "이번 주" : weekTitle(week),
    subjectMaps.labelOf(subject),
    kind === "special" ? "특강" : null,
  ]);
  // 통합뷰 격자 — 메모 시트가 서면 두 칸 배치의 왼쪽 판, 아니면 그대로(아래 render 분기).
  const integratedGrid = isIntegrated ? (
    <TimetableZoomArea scale={editorView?.scale}>
      <RichGridView
        slots={slots}
        subjectMaps={subjectMaps}
        config={periodsConfig}
        teacherColors={teacherColors}
        teacherNicknames={teacherNicknames}
        compactSections={compactSections}
        customGroups={customGroups}
        hideStudents={hideStudents}
        hidePeriods={editorView?.hidePeriods}
        virtualLabs={virtualLabs}
      />
    </TimetableZoomArea>
  ) : null;

  // 메모 시트가 서는 화면(영어 통합뷰)에선 툴바가 **시간표 판 안** 맨 위에 선다(원장 2026-10-19 *"메모시트 시간표 같은 위치로"*) —
  // 오른쪽으로 넘기면 툴바(주차·과목·필터)는 시간표와 함께 밀려나고, 시트 머리줄이 툴바가 있던 높이에 선다.
  // 판정은 아래 본문 갈래와 같은 조건이다(이 값이 참이면 반드시 분할 판 갈래로 간다 — 툴바가 사라지는 화면이 없게).
  const memoSplit = memo.canView && !makeupTab && !(isRooms && roomWindows) && slots.length > 0 && isIntegrated && !groupEditing;
  const toolbar = (
    <>
      {/* Toolbar — 좁은 화면(compact-chrome)에선 여백·구분선을 조인다. 구분선(1px)은 그 자체보다
          양옆 gap 때문에 줄바꿈을 앞당겨, 폰에서 툴바를 한 줄 더 밀어내는 값이 컸다. */}
      <PageMaximizeToolbar>
      <Toolbar rail={false} gap="gap-3 compact-chrome:gap-1">
        <ToolbarRow>
        {/* 모바일에서는 주간 이동을 필터와 별도의 짧은 레일에 둔다. */}
        {/* 왼쪽 묶음(필터·검색·설정·엑셀) / 오른쪽 묶음(집계·ECS·편집) — 창을 줄이면 **묶음 단위로** 줄이 바뀐다
            (원장 2026-09-04 *"창 크기를 조절했을때도 헤더 정렬이 이루어질 수 있게"* — 종전엔 항목 하나(엑셀·시트)만 둘째 줄
            왼쪽에 떨어지고 집계·편집이 그 오른쪽에 붙어 어디가 왼쪽 묶음의 끝인지 안 읽혔다).
            ⚠️ 폰 레일(compact-chrome)에선 묶음 상자를 없앤다(display: contents) — 레일은 직계 항목을 한 줄로 흘린다. */}
        {/* 주간 이동(타임머신) — 과거/미래 주의 반 구성 조회 */}
        <WeekNav
          currentWeek={week}
          today={today}
          hrefForWeek={(monday) => buildHref({ view: effView, subject, kind, week: monday, thisWk, compact1h: compactList, hideEmptyDays, collapseEmptyPeriods, hideStudents, englishTrack: carriedTrack, defaultView: thisSubjectDefaultView })}
        />
        {/* 미래 날짜로 적용해 둔 변경 — 이번 주 화면엔 흔적이 없어 여기 상시로 붙인다(원장 2026-08-28).
            라벨=시트 열기 · ×=예약 취소. 예약이 없으면 아무것도 안 그린다(평소 비용 0). */}
        {scheduled.map((g) => (
          <ScheduledImportBadge
            key={g.effectiveDate}
            effectiveDate={g.effectiveDate}
            today={today}
            sheetUrl={sheetUrl}
            canCancel={(canSync && canManageImport) || canMasterImport}
          />
        ))}
        {labApplies.map((job) => (
          <LabApplyBadge key={job.id} id={job.id} at={job.at} today={today} canCancel={job.actorId === user.id} />
        ))}
        {/* 그 주의 '수업 나누기' — 누가 어느 시간에 어느 선생님 반으로 가는지 한 목록(× = 해제). 없으면 안 그린다. */}
        {activeSplits.length > 0 ? <SplitListBadge lines={activeSplits} canEnd={canSplit} /> : null}
        </ToolbarRow>
        <ToolbarRow>
        <div className="toolbar-group flex min-w-0 flex-wrap items-center gap-3">

        {/* 교실뷰는 과목·구분을 접는다 — 전 과목·전 구분이 한 지도에 그려져야 참이다(요일·과목
            하이라이트는 RoomMapView 안의 클라 칩이 담당). */}
        {isRooms ? null : (
          <>
            {/* 과목 · 구분 · 프로그램 — 지시서 §10(원장 2026-09-03 *"지시서 그대로"*): 세그먼트 칩 묶음이 아니라 `축: 값`
                드롭다운 하나씩. 옛 칩 줄은 과목 수만큼 늘어나 툴바를 2줄로 밀었고(과학·국어·사회…) 축 이름이 따로 서 있었다.
                항목은 서버가 만든 href(ParamSelect = ParamLink와 같은 무플래시 이동 + 미저장 가드). */}
            {/* 이 구분에 과목이 하나도 없으면(특강 0개 등) 고를 게 없다 — "과목: —"에 빈 목록을 여는 것보다 안 그리는 게 낫다.
                되돌아갈 길은 옆 구분 드롭다운(TIMETABLE_KINDS는 데이터로 거르지 않는다). */}
            {available.length === 0 ? null : (
            <span data-help="tt-subject">
            <ParamSelect
              axisLabel="과목"
              ariaLabel="과목 선택"
              value={subject}
              options={available.map((k) => ({
                value: k,
                label: subjectMaps.labelOf(k),
                href: buildHref({
                  // 🔴 과목마다 기본 뷰가 다르다 — **일부러 바꿔 보던 중이 아니면** 새 과목의 기본 뷰를 따른다
                  //    (그게 이 설정의 뜻이다: "영어를 열면 통합뷰"). 벗어나 있었다면 그 선택을 실어 나른다.
                  //    ⚠️ '벗어났나' 판정은 강등 전(`view`)으로 한다 — 강등된 effView로 재면 설정이 강사뷰인
                  //    과목에서 "안 벗어났는데 벗어난 것"으로 잡힌다. 강등은 **결과값에** 적용한다.
                  view: (() => {
                    const carried = viewForSubjectSwitch(view, thisSubjectDefaultView, defaultViewOf(k));
                    return carried === "teacher" && !allowsTeacherView(k) ? "basic" : carried;
                  })(),
                  defaultView: defaultViewOf(k),
                  subject: k,
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
                  hideStudents,
                  // 프로그램 필터는 **영어에만 있는 축**이라 다른 과목으로 갈 땐 안 싣는다(싣고 가면 그 과목
                  // 반이 전부 english_track=null이라 'eie'에서 화면이 통째로 빈다). 영어로 돌아올 땐 계정값 복원.
                  englishTrack: k === "english" ? englishTrack : undefined,
                }),
              }))}
            />
            </span>
            )}

            {/* 정규 / 특강 / 전체 — 특강(방학 단기강좌)을 정규 주간표와 분리해 본다(원장 요구 2026-07-22).
                기본은 정규라 파라미터 없는 URL = 지금까지의 화면. 과목 목록은 이 구분에 실제 있는 과목만 뜬다. */}
            <span data-help="tt-kind">
            <ParamSelect
              axisLabel="구분"
              ariaLabel="정규·특강 구분"
              value={kind}
              options={TIMETABLE_KINDS.map((k) => ({
                value: k,
                label: TIMETABLE_KIND_LABEL[k],
                href: buildHref({
                  view: effView,
                  defaultView: thisSubjectDefaultView,
                  subject,
                  kind: k,
                  week,
                  thisWk,
                  compact1h: compactList,
                  hideEmptyDays,
                  collapseEmptyPeriods,
                  hideStudents,
                  englishTrack: carriedTrack,
                }),
              }))}
            />
            </span>

            {/* 프로그램(전체/EiE/인재원 영어) — 영어 과목에서만. ECS 랜딩의 같은 칩과 **같은 어휘**다
                (원장 2026-08-04 "상단 헤더에 토글버튼", 2026-08-11 통합뷰에도 요청).
                ⚠️ 라벨·비대칭 계약은 english-track.ts 단일 소스에서 온다 — 여기서 문자열을 새로 적지 말 것. */}
            {trackApplies ? (
              <span data-help="tt-program">
              <ParamSelect
                axisLabel="프로그램"
                ariaLabel="영어 프로그램 필터"
                value={englishTrack}
                options={ENGLISH_TRACK_FILTERS.map((t) => ({
                  value: t,
                  label: ENGLISH_TRACK_FILTER_LABEL[t],
                  href: buildHref({
                    view: effView,
                    defaultView: thisSubjectDefaultView,
                    subject,
                    kind,
                    week,
                    thisWk,
                    compact1h: compactList,
                    hideEmptyDays,
                    collapseEmptyPeriods,
                    hideStudents,
                    englishTrack: t,
                  }),
                }))}
              />
              </span>
            ) : null}
          </>
        )}

        {/* 뷰 — 기본뷰/통합뷰/(강사뷰: 허용 과목에서만)/(교실뷰: 관리자 전용, roomsViewAllowed 주석 참조).
            아이콘은 뺐다(§10 툴바 아이콘 열 제거 — 글자가 곧 뜻이다).
            보강 탭은 뷰가 하나(예약 격자)라 드롭다운을 접는다 — 눌러도 아무 일도 안 일어나는 항목을 세우지 않는다. */}
        {makeupTab ? null : (
        <span data-help="tt-view">
        <ParamSelect
          axisLabel="뷰"
          ariaLabel="시간표 보기 방식"
          value={effView}
          options={(
            [
              { key: "basic", label: "기본뷰" },
              { key: "integrated", label: "통합뷰" },
              ...(teacherViewAllowed ? [{ key: "teacher" as ViewMode, label: "강사뷰" }] : []),
              ...(roomsViewAllowed ? [{ key: "rooms" as ViewMode, label: "교실뷰" }] : []),
            ] as { key: ViewMode; label: string }[]
          ).map((v) => ({
            value: v.key,
            label: v.label,
            href: buildHref({ view: v.key, subject, kind, week, thisWk, compact1h: compactList, hideEmptyDays, collapseEmptyPeriods, hideStudents, englishTrack: carriedTrack, defaultView: thisSubjectDefaultView }),
          }))}
        />
        </span>
        )}

        {/* 학생 검색 — 이름을 치면 **그 학생이 든 수업(칸)만** 남는다(원장 2026-08-20). 눌러야 나온다(§10 "검색은
            필요할 때만") · 검색어가 걸려 있으면 펼친 채. 서버 왕복 0(이미 내려온 명단으로 클라 판정)이라 글자마다 표가
            다시 그려지지 않는다. 교실뷰·배치 편집·편집 모드에선 스스로 물러난다. */}
        {/* 보강 탭엔 검색이 없다 — 색인이 슬롯 명단이라 예약 격자엔 안 걸린다("있는데 안 먹는 것"이 제일 나쁘다). */}
        {makeupTab ? null : (
          <span data-help="tt-search" className="inline-flex items-center gap-3">
            <TimetableSearchToggle />
          </span>
        )}

        {/* 강사뷰 '미사용 요일'·기본뷰 '빈 교시 접기'·'색 강도'는 **뷰 설정 팝오버 안으로** 옮겼다
            (2026-07-24 원장 "시간표도 깔끔하게"). 셋 다 "무엇이 어떻게 보이나"라 학년 필터와 같은 성격이고,
            특히 색 3칩이 툴바를 상시 2줄로 밀어내던 주범이었다. href는 아래 TimetableViewSettings에 넘긴다. */}

        {/* 통합뷰 '1시간 단위'는 툴바에도, 통합뷰 섹션 헤더에도 없다 — **'그룹 설정' 화면의 줄 머리글**이
            유일한 설정 지점이다(원장 2026-08-13). 값은 계속 계정(과목별)에 저장된다. */}

        {/* 통합뷰 '그룹 설정' — 섹션을 'N교시 시작' 자동 묶음 대신 원장이 정한 묶음으로(ijw 이식). */}
        {canEditGroups ? (
          <>
            <span className="bg-line h-4 w-px" aria-hidden />
            {/* 🔴 별도 창(칩 보드)이 아니라 **통합뷰 그 자체**가 편집 표면이다(원장 2026-08-06 —
                *"통합뷰에서 편집모드를 누르고, 통합뷰의 그 자체를 드래그하고 싶은거야"*).
                누르면 같은 서식 그대로 **수업명 행만** 남고 그 위에서 반을 끌어 줄을 바꾼다. */}
            <ParamLink
              href={buildHref({ view: effView, subject, kind, week, thisWk, compact1h: compactList, hideEmptyDays, collapseEmptyPeriods, hideStudents, gedit: !groupEditing, englishTrack: carriedTrack, defaultView: thisSubjectDefaultView })}
              title="통합뷰를 수업명만 남긴 상태로 바꿔 반을 끌어 옮깁니다"
              className={`${TOOLBAR_CHIP} gap-1.5 ${groupEditing ? TOOLBAR_CHIP_ON : TOOLBAR_CHIP_OFF}`}
            >
              <Layers size={11} strokeWidth={1.8} />
              그룹 설정
            </ParamLink>
          </>
        ) : null}

        {/* 강사뷰 '강사 순서' — 코드에 박힌 시트 미러 대신 사람이 정한다(자리 JJ·LAB은 기본 최우측).
            그룹 설정과 같은 자리·같은 게이트(학원설정 쓰기)다. 강사뷰에서만 보인다. */}
        {effView === "teacher" && canEditGroups ? (
          <>
            <span className="bg-line h-4 w-px" aria-hidden />
            <TeacherOrderDialog
              subject={subject}
              subjectLabel={subjectMaps.labelOf(subject)}
              teachers={teacherViewNames}
            />
          </>
        ) : null}

        {/* 뷰 설정 — 학제·학년 필터(계정 저장) + **표시 취향 3종**(색 강도·빈 교시 접기·미사용 요일).
            ⚠️ 인라인 토글이 아니라 팝오버인 이유·배지를 항상 띄우는 이유는 view-settings.tsx 주석 참조.
            전 뷰 공통(필터는 명단에 걸리므로 기본·강사·통합 어디서나 같은 뜻)이고, 표시 3종은 해당 뷰에서만
            항목이 뜬다(색·빈 교시=기본뷰 / 미사용 요일=강사뷰). 링크는 그대로 URL 파라미터라 공유 링크도 보존.
            교실뷰는 명단 필터가 지도를 왜곡하므로(학년 필터=교실이 비어 보임) 통째로 접는다. */}
        {/* 보강 탭엔 뷰 설정·엑셀도 없다 — 예약 격자엔 학년 필터·명단 접기·내보내기가 걸릴 자리가 없다. */}
        {isRooms || makeupTab ? null : (
        <>
        <span className="bg-line h-4 w-px" aria-hidden />
        <span data-help="tt-settings" className="inline-flex items-center gap-3">
        <TimetableViewSettings
          allGrades={settings.operations.gradeLevels ?? []}
          savedGrades={viewPrefs.grades}
          showColor={effView === "basic"}
          collapseHref={
            effView === "basic"
              ? buildHref({
                  view: effView,
                  defaultView: thisSubjectDefaultView,
                  subject,
                  kind,
                  week,
                  thisWk,
                  compact1h: compactList,
                  hideEmptyDays,
                  collapseEmptyPeriods: !collapseEmptyPeriods,
                  hideStudents,
                  englishTrack: carriedTrack,
                })
              : undefined
          }
          collapseOn={collapseEmptyPeriods}
          hideEmptyDaysHref={
            effView === "teacher"
              ? buildHref({
                  view: effView,
                  defaultView: thisSubjectDefaultView,
                  subject,
                  kind,
                  week,
                  thisWk,
                  compact1h: compactList,
                  hideEmptyDays: !hideEmptyDays,
                  collapseEmptyPeriods,
                  hideStudents,
                  englishTrack: carriedTrack,
                })
              : undefined
          }
          hideEmptyDaysOn={hideEmptyDays}
          hideStudentsHref={
            // '학생 명단' 토글은 명단을 그리는 뷰에서만(기본뷰·통합뷰) — 강사뷰·교실뷰엔 명단 자체가 없어
            // 항목이 서 있으면 눌러도 아무 일도 안 일어난다.
            effView === "basic" || effView === "integrated"
              ? buildHref({
                  view: effView,
                  defaultView: thisSubjectDefaultView,
                  subject,
                  kind,
                  week,
                  thisWk,
                  compact1h: compactList,
                  hideEmptyDays,
                  collapseEmptyPeriods,
                  hideStudents: !hideStudents,
                  englishTrack: carriedTrack,
                })
              : undefined
          }
          hideStudentsOn={hideStudents}
        />
        </span>

        {/* 학년 필터가 걸린 채로 이 과목·이 주에 보이는 학생이 0명이면, 화면이 그냥 비어 있어 고장으로
            보인다. 배지만으론 부족해 한 줄로 명시한다(필터 때문임을 알아야 되돌릴 수 있다). */}
        {viewPrefs.grades && slots.length === 0 && kindSlots.some((s) => s.subject === subject) ? (
          <span className="bg-accent text-accent-foreground rounded-full px-2.5 py-0.5 text-xs">
            학년 필터에 걸려 표시할 수업이 없습니다 — 뷰 설정에서 학년을 넓혀 보세요.
          </span>
        ) : null}

        {/* 프로그램 필터로 화면이 비면 원인을 밝힌다 — 안 그러면 아래 빈 상태가 "해당 과목의 시간표가
            없습니다"라고 말해 **거짓 원인**을 준다(학년 필터에 같은 안내를 둔 이유와 동일).
            ⚠️ 학년 필터 안내와 조건이 겹칠 수 있어 프로그램 쪽을 먼저 잡는다(학년은 계정 설정이라 안 보이지만
            프로그램은 바로 위 칩에서 눈에 보이는 원인이다). */}
        {englishTrack !== "all" && slots.length === 0 && kindSlots.some((s) => s.subject === subject) ? (
          <span className="bg-accent text-accent-foreground rounded-full px-2.5 py-0.5 text-xs">
            프로그램 필터(
            {ENGLISH_TRACK_FILTER_LABEL[englishTrack]})에 걸려 표시할 수업이 없습니다 — &lsquo;전체&rsquo;로
            바꿔 보세요.
          </span>
        ) : null}

        {/* 엑셀·시트 액션 — ⚠️ ml-auto 스페이서 **앞**에 둔다: 스페이서 뒤(우측 정렬 편집 옆)에 두면
            넓은 창에서도 항상 둘째 줄로 강제 줄바꿈돼 툴바가 상시 2줄이었다(2026-07-20 세로 회수). */}
        <span className="bg-line h-4 w-px" aria-hidden />
        <span data-help="tt-excel">
        <TimetableToolbarActions
          subject={subject}
          today={today}
          kind={kind}
          canSync={canSync}
          canManageImport={canManageImport}
          canMasterImport={canMasterImport}
          sheetUrl={sheetUrl}
          compact1h={compactList}
        />
        </span>
        </>
        )}

        </div>
        <div className="rail-spacer ml-auto" aria-hidden />
        <div className="toolbar-group flex flex-wrap items-center gap-3">

        {/* 창(임베드)에선 위 헤더 줄이 통째로 접히므로 ECS 바로가기를 여기 한 번 더 — 안 그러면
            실사용(플로팅 창)에서 영영 안 보인다. */}
        {showEcsShortcut && !isRooms ? (
          <div className="hidden compact-chrome:block">
            <EcsShortcut week={week} />
          </div>
        ) : null}

        {/* 시간표 편집기(연습본) — 오른쪽 도구 묶음. 교실 지도에서는 감춘다(수업 배치를 보는 화면이 아니다). */}
        {showEditorShortcut && !isRooms ? <EditorShortcut /> : null}

        {/* 메모 시트로 넘어가기 — 가로 스크롤과 같은 자리(오른쪽 판). 판이 선 화면에서만. */}
        {memo.canView ? <MemoSheetJumpButton className={`${TOOLBAR_CHIP} ${TOOLBAR_CHIP_OFF}`} /> : null}

        {/* 편집 컨트롤 — 기본뷰·**통합뷰** + 이번/미래 주(강사뷰=읽기전용, 과거=조회 전용).
            🔴 2026-09-09: 통합뷰에도 학생 반 이동이 생겨(원장 *"통합뷰에서도 학생 드래그 기능 추가시켜"*)
               이 줄이 함께 서야 한다 — 안 그러면 끌어다 놓아도 **'저장' 버튼이 화면에 없어** 큐에만 쌓이고
               아무 일도 안 일어난다(원장이 말한 *"드래그만 되고 적용이 안되네"* 그 증상 그대로다).
            ⚠️ 옮긴 게 없으면 이 컴포넌트는 아무것도 안 그리므로 평소 통합뷰 툴바는 종전과 같다.
            ⚠️ 옛 '· 이 주에 이동 예약' 꼬리표는 뺐다(원장 2026-09-01 *"하단 '이 주에 이동 예약'은 지워"*) —
               같은 사실을 주 네비의 **미래 조회 배지**가 이미 말하고 있어 한 줄 아래 같은 말이 또 있었다.
               되살리지 말 것. */}
        {/* ⚠️ 구분선은 **컨트롤 안쪽**에 있다 — 옮긴 게 없으면 이 컴포넌트가 아무것도 안 그리므로(2026-09-09
            멘트 제거), 여기 밖에 두면 툴바 끝에 세로줄만 덩그러니 남는다. */}
        {!makeupTab && (effView === "basic" || effView === "integrated") && slots.length > 0 && canEdit ? (
          <span data-help="tt-save">
            <TimetableEditControls rosterHidden={hideStudents} />
          </span>
        ) : null}
        </div>
        </ToolbarRow>
      </Toolbar>
      </PageMaximizeToolbar>
    </>
  );

  return (
    <TimetableEditProvider effectiveDate={effectiveDate} today={today} canEdit={canEdit} canSplit={canSplit} weekMonday={week}>
      <TimetableApplyRefresh tenantId={user.tenantId} />
      {/* 학생 검색 — 툴바 입력칸과 세 뷰(기본·통합·강사)가 같은 값을 보게 감싼다. 편집 공급자 **안쪽**이라
          검색이 편집 모드를 읽고 스스로 물러난다(search-context.tsx 주석). */}
      <TimetableSearchProvider index={searchIndex} scope={searchScope} enabled={searchEnabled}>
      {/* `.edge-to-edge` — 창(임베드)에선 셸 <main>의 좌우·아래 베젤과 스크롤바 거터를 0으로(globals.css
          `main.embed-main:has(.edge-to-edge)`, 원장 2026-09-08 *"좌우와 하단 여백이 거의 느껴지지 않도록 딱"*).
          ⚠️ loading.tsx 루트와 **같은 className**이어야 한다(스켈레톤→본문에서 폭이 튀지 않게, 가드 window-bezel). */}
      <div data-maximize-toolbar-page="" className="edge-to-edge flex h-full min-h-0 flex-col gap-4 compact-chrome:gap-3">
      {/* 표시 선호('미사용 요일'·'빈 교시 접기'·'1시간 단위')를 **계정에** 기억(0146a) + 쿠키 폴백 —
          창은 깨끗한 URL로 열려 파라미터만으론 매번 초기화된다. 셋을 한 컴포넌트로 합친 이유(동시 쓰기
          충돌)는 prefs-sync.tsx 주석 참조. */}
      <TimetableViewPrefsSync
        hideEmptyDays={hideEmptyDays}
        collapseEmptyPeriods={collapseEmptyPeriods}
        hideStudents={hideStudents}
        subject={subject}
        sections={compactList}
        englishTrack={carriedTrack}
        savedHideEmptyDays={viewPrefs.hideEmptyDays}
        savedCollapseEmptyPeriods={viewPrefs.collapseEmptyPeriods}
        savedHideStudents={viewPrefs.hideStudents}
        savedSections={viewPrefs.compact1h?.[subject] ?? null}
        savedEnglishTrack={viewPrefs.englishTrack}
      />
      {/* 계정에 저장된 셀 색 강도를 스토어에 주입(서버→클라 단방향). 계정값이 없으면 기기 설정 유지. */}
      <TimetableColorPrefSync mode={viewPrefs.colorMode} />
      {/* 글씨 크기(계정) → 스토어 주입. 색 강도와 같은 단방향 동기화 — 토글은 뷰 설정 팝오버에 있다. */}
      <TimetableFontPrefSync fontSize={viewPrefs.fontSize} />
      {/* X 겹침 — 키를 누를 때만 읽는다(첫 화면 비용 0). 교실 지도는 과목 축이 아니라 뺀다. */}
      {showExitOverlay && !isRooms ? <TimetableExitOverlay subject={subject} /> : null}
      {/* Editorial 문법 ① — 헤더 위계. 시간표는 세로 공간이 가장 귀한 화면이라 **창(임베드)에선 이 줄을
          통째로 접는다**(컴팩트 1행조차 아까움 — 2026-07-20 원장 "여전히 많은 공간"). 최상위 프레임은 풀 헤더 유지.
          (우측 학생 인원 집계는 2026-09-28 삭제 — 원장 "헷갈리니까".) */}
      <div data-maximize-title-row="" className="shrink-0 compact-chrome:hidden">
        <PageHeader
          eyebrow={tt("수업 운영")}
          title={tt("시간표")}
          description={isRooms ? tt("교실 사용 현황 지도") : lang === "en" ? `${tt(subjectMaps.labelOf(subject))} weekly timetable` : `${subjectMaps.labelOf(subject)} 주간표`}
          actions={
            isRooms || !showEcsShortcut ? null : <EcsShortcut week={week} />
          }
        />
      </div>
      {memoSplit ? null : toolbar}

      {/* 검색 결과 0건 — 빈 격자만 남기면 "시간표가 고장났다"로 읽힌다. 왜 비었는지(어느 주·어느 과목에
          없는지)를 한 줄로 말하고, 그 자리에서 지울 수 있게 한다. */}
      {memoSplit ? null : <TimetableSearchEmptyNote />}

      {makeupTab ? (
        // 보강 탭 — 슬롯 격자 대신 예약 격자(표시 전용). 빈 주도 이 컴포넌트가 스스로 말한다.
        <MakeupWeekView
          rows={makeupRows}
          weekendRows={makeupWeekendRows}
          entries={makeupEntries}
          dateOf={makeupDateOf}
          today={today}
        />
      ) : isRooms && roomWindows ? (
        <RoomMapView
          slots={roomSlots}
          rooms={classroomsForMap}
          windows={roomWindows}
          windowsNoSpecial={roomWindowsNoSpecial ?? roomWindows}
          weekMonday={week}
          todayDay={todayDow}
          isCurrentWeek={week === thisWk}
          nowMin={nowMin}
          canEditCapacity={canEditRoomCapacity}
          groupLines={viewPrefs.roomGroupLines ?? true}
          timeVertical={viewPrefs.roomTimeVertical ?? false}
          showIssues={viewPrefs.roomIssues ?? true}
        />
      ) : slots.length === 0 ? (
        // 🔴 `w-full` 필수 — 바깥 틀이 세로 flex라 `mx-auto`만 두면 이 상자가 내용 폭으로 줄고, 사진 카드는
        //    내용이 전부 absolute라 폭 0이 된다(빈 안내가 DOM엔 있는데 화면에 안 보였다 — 2026-09-22 빈 지점 점검).
        <div className="mx-auto w-full max-w-xl py-4">
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
      ) : isIntegrated && groupEditing ? (
        // ⚠️ 여기엔 TimetableZoomArea를 감싸지 않는다 — 편집 보드가 **DndContext 안쪽에서** 직접 감싼다
        //    (바깥이면 fixed인 DragOverlay가 zoom 좌표계로 들어가 커서와 어긋난다).
        <IntegratedEditBoard
          subject={subject}
          cards={buildRichClassCards(slots, periodsConfig)}
          config={periodsConfig}
          teacherColors={teacherColors}
          subjectSoftClass={SUBJECT_SOFT[subjectMaps.colorOf(subject)]}
          initialGroups={(subjectRow?.integrationGroups ?? []).map((g) => ({
            id: g.id,
            title: g.title,
            classIds: g.classIds ?? [],
          }))}
          initialEnabled={subjectRow?.integrationGroupsEnabled === true}
          initialShowOthers={subjectRow?.integrationShowOthers !== false}
          initialOthersTitle={subjectRow?.integrationOthersTitle ?? ""}
          initialPresets={groupPresets}
          initialCompactSections={compactList}
          doneHref={buildHref({ view: effView, subject, kind, week, thisWk, compact1h: compactList, hideEmptyDays, collapseEmptyPeriods, hideStudents, englishTrack: carriedTrack, defaultView: thisSubjectDefaultView })}
        />
      ) : isIntegrated ? (
        // 통합뷰 명단 이동(대기/퇴원 드롭) — 🔴 zoom 래퍼 **바깥**에 DndContext를 둔다([[#98]]: 안쪽이면
        // fixed인 DragOverlay가 zoom 좌표계로 들어가 고스트가 커서와 어긋난다. 기본뷰와 같은 배치).
        // 메모 시트가 서는 화면 = 시간표 판 | 엑셀 판 두 칸(오른쪽으로 넘기면 시트 — split-panes.tsx). 그 밖은 종전 그대로.
        // 🔴 명단 드래그 영역은 **시간표 판만** 감싼다 — 시트까지 감싸면 시트에서 범위를 끈 직후의 클릭·더블클릭을
        //    '드래그 뒤 클릭'으로 삼킨다(drag-flag.ts). 시트는 그 영역 밖의 자기 판이다(침범하지 않게).
        memoSplit ? (
          <TimetableSplitPanes
            top={
              <>
                {toolbar}
                <TimetableSearchEmptyNote />
              </>
            }
            left={<RosterMoveArea canEdit={canEditRoster} today={today}>{integratedGrid}</RosterMoveArea>}
            right={
              <Suspense fallback={<MemoSheetSkeleton />}>
                <MemoSheetPane tenantId={user.tenantId} subject={subject} canEdit={memo.canEdit} />
              </Suspense>
            }
          />
        ) : (
          <RosterMoveArea canEdit={canEditRoster} today={today}>{integratedGrid}</RosterMoveArea>
        )
      ) : effView === "teacher" ? (
        // 강사뷰 — 시트 "강사별영어시간표" 그대로(강사=세로 블록, 그 안 월~토, 셀=반명+방). 읽기전용, 반 클릭=학생 명단.
        // 가로줄·격자 단위는 과목 설정(teacherViewLines/Step, 학원설정 과목 운영)에서.
        <TimetableZoomArea scale={editorView?.scale}>
          <div className="flex min-h-0 flex-1 flex-col">
            <TeacherGridView
              slots={[...slots, ...scheduleBlocks]}
              weekMonday={week}
              teacherColors={teacherColors}
              teacherNicknames={teacherNicknames}
              sectionLineMins={sectionLineMins}
              stepMin={teacherViewStep}
              pxPerMin={teacherViewPxPerMin}
              breakRanges={teacherViewBreaks}
              axisFloorMin={teacherAxisFloorMin}
              excludedTeachers={teacherViewExcluded}
              teacherOrder={teacherViewOrder}
              subject={subject}
              showUnusedDays={!hideEmptyDays}
              hideSaturday={editorView?.hideSaturday}
              showSunday={editorView?.showSunday}
              cellMemo={cellMemoAccess.canView ? { tenantId: user.tenantId, canEdit: cellMemoAccess.canEdit } : undefined}
            />
          </div>
        </TimetableZoomArea>
      ) : (
        <ClassMoveProvider
          index={
            canEdit
              ? buildClassMoveIndex(
                  // 🔴 강사 근무 블록(감독·회의·연차)도 강사 축에 태운다 — 학생 축엔 학생이 0명이라 안 걸린다.
                  [...allSlots, ...scheduleBlocks],
                  [...new Set(slots.map((s) => s.classId ?? s.id))],
                )
              : null
          }
        >
        <TimetableDndArea>
          {/* ⚠️ zoom은 DndContext **안쪽**에 — 바깥에 두면 fixed인 DragOverlay가 커서와 어긋난다. */}
          <TimetableZoomArea>
            <div className="flex min-h-0 flex-1 flex-col">
              {/* '빈 교시 접기' 중 편집 모드가 켜지면 접힌 행을 CSS 변수·.tt-editing으로 즉시 펼침(평소 격자 지형 복원). */}
              {/* 반 블록 이동 판정 재료 — **그 주 전 과목 슬롯**(allSlots)을 서버에서 한 번 접어 내려보낸다.
                  🔴 새 조회가 0건이다(page가 이미 받아 둔 값) · 화면에 뜬 반 + 그 반이 쓰는 강사·방과 겹칠 수 있는
                     슬롯만 실어 payload를 줄인다(class-move.ts 주석). 반 드래그가 없는 화면(권한 없음)엔 null. */}
              <EmptyPeriodScope collapsed={collapseEmptyPeriods} hideStudents={hideStudents}>
                <WeekdayGroupTables
                  slots={basicSlots}
                  strays={strayReserved}
                  config={periodsConfig}
                  weekMonday={week}
                  dayGroups={weekdayGroups}
                  collapseEmptyPeriods={collapseEmptyPeriods}
                  hideStudents={hideStudents}
                  teacherOrder={viewPrefs.teacherOrder?.[subject]}
                />
              </EmptyPeriodScope>
            </div>
          </TimetableZoomArea>
        </TimetableDndArea>
        </ClassMoveProvider>
      )}
      {/* X 겹침 안내 한 줄 — 모든 뷰의 마지막 줄이자 아래 여백 자리(영어·수학 같은 여백, exit-overlay-hint.tsx). */}
      {showExitOverlay && !isRooms ? <ExitOverlayHint /> : null}
      </div>
      </TimetableSearchProvider>
    </TimetableEditProvider>
  );
}

function buildHref(opts: {
  view: ViewMode;
  subject: string;
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
  /**
   * '학생 명단 접기' 상태 — 위 둘과 동일 규약: 값이 오면 **양방향 명시 직렬화**(hide/show),
   * 미지정(undefined)만 생략(=계정/쿠키 기본).
   */
  hideStudents?: boolean;
  /**
   * 통합뷰 '배치 편집' 모드. **true일 때만** 직렬화한다 — 위 두 표시 설정과 달리 '기억할 취향'이 아니라
   * 지금 켠 작업 모드라, 다른 링크(주 이동·과목 전환)는 파라미터를 안 실어 자연스럽게 읽기 전용으로 돌아간다.
   */
  gedit?: boolean;
  /**
   * 영어 프로그램 필터(전체/EiE/인재원 영어). **값이 오면 양방향 명시 직렬화**(all도 적는다) —
   * hideEmptyDays와 같은 규약이다. 'all'을 생략하면 계정에 저장된 'eie'가 되살아나 **'전체' 칩이 죽는다**.
   * 영어가 아닌 과목으로 가는 링크는 undefined(그 과목엔 없는 축이라 실어 나르면 안 된다).
   */
  englishTrack?: EnglishTrackFilter;
  /**
   * 이 링크가 가리키는 **과목의 기본 뷰**(학원설정 `subjects[].defaultView`). 같으면 `view`를 생략해
   * URL을 깨끗이 둔다. 미지정=basic(설정이 없던 시절과 같은 URL).
   */
  defaultView?: ViewMode;
}): string {
  const params = new URLSearchParams();
  // 🔴 생략 기준은 "basic이냐"가 아니라 **그 링크가 가리키는 과목의 기본 뷰냐**다. 예전처럼 basic만
  //    생략하면, 영어 기본 뷰가 통합뷰인 순간 '기본뷰' 칩이 파라미터 없는 URL이 되어 다시 통합뷰로
  //    되돌아온다 = **기본뷰를 영영 못 고른다**.
  if (shouldSerializeView(opts.view, opts.defaultView ?? "basic")) params.set("view", opts.view);
  if (opts.kind !== DEFAULT_TIMETABLE_KIND) params.set("kind", opts.kind);
  // 기본 과목이 사람마다 다르므로 링크에는 현재 과목을 남긴다(공유·주 이동 시 선택 유지).
  if (opts.subject) params.set("subject", opts.subject);
  if (opts.week !== opts.thisWk) params.set("week", opts.week);
  if (opts.compact1h && opts.compact1h.length)
    params.set("compact1h", [...opts.compact1h].sort((a, b) => a - b).join(","));
  else if (opts.compact1hExplicit) params.set("compact1h", COMPACT1H_NONE);
  if (opts.hideEmptyDays !== undefined) params.set("emptydays", opts.hideEmptyDays ? "hide" : "show");
  if (opts.collapseEmptyPeriods !== undefined)
    params.set("emptyperiods", opts.collapseEmptyPeriods ? "collapse" : "expand");
  if (opts.hideStudents !== undefined) params.set("students", opts.hideStudents ? "hide" : "show");
  if (opts.gedit) params.set("gedit", "1");
  if (opts.englishTrack !== undefined) params.set("etrack", opts.englishTrack);
  const q = params.toString();
  return q ? `/timetable?${q}` : "/timetable";
}

