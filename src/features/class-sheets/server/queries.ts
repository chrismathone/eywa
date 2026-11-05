import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { fetchAllPagedInChunks, fetchInChunks } from "@/lib/supabase/batch";
import { accessLevelTenant, canWriteTenant } from "@/lib/auth/perm-matrix";
import { getCurrentUser } from "@/lib/auth/current-user";
import { kstToday } from "@/lib/date-kst";
import { mondayOf, shiftDays, weekLabel, weekRelation } from "@/features/timetable/lib/week";
import { settingsToPeriodsConfig, weekdayTableFor } from "@/features/timetable/lib/periods";
import { getTeacherLabelMap } from "@/features/timetable/server/queries";
import { resolveTeacherLabel } from "@/features/timetable/lib/teacher-label";
import { viewAsTeacher } from "@/lib/auth/view-mode";
// 🔴 방 이름 규약은 좌석표(출결)와 **같은 두 함수**다 — 여기서 규칙을 다시 적으면 같은 방을
//    시트는 `305`, 좌석표는 `본원305`로 부른다(2026-08-25 실사고와 같은 결).
import { canonicalRoomName, resolveRoomName } from "@/features/attendance/live/seating-floors";
import { resolvePeriodLabel, tableToEntries } from "../lib/period-label";
import { isWeekendDow } from "../lib/grid-rows";
import { applySplitsToGrid } from "../lib/split-roster";
import { loadSplitsForSheet } from "./split-week";
import { getTenantSettings } from "@/features/owner/server/queries";
import { eieModuleOn } from "./eie-on";
import { isModuleEnabled } from "@/lib/modules";
import { resolveSkillAreas } from "@/features/owner/skill-areas";
import { shoutingKey, shoutingMapOf } from "../shouting";
import type { SkillAreaSetting } from "@/features/owner/settings-types";
import { effectiveAttendanceRecords } from "@/features/attendance/effective-records";
import type { OtherSpan } from "@/features/attendance/enrollment-span";
// 출결 쓰기의 담당 반 축 — **출결 서버 액션과 같은 함수**(담임 ∪ 위임 ∪ 교시 담당, write-gate-axis).
import { userTaughtClassSet } from "@/features/attendance/live/server/write-policy";
import { isWithinAttendanceEditWindow } from "@/features/attendance/edit-window";
import { readEcsFontSize, type EcsFontSize } from "../font-size";
import { freshRawUiPrefs } from "@/lib/filter-reset/server";
import {
  DEFAULT_ECS_ENGLISH_TRACK,
  readEcsCollapsedRosterGroups,
  readEcsEnglishTrack,
  readEcsLandingOrder,
  readEcsShowSelfStudy,
  readEcsTeacher,
} from "../view-prefs";
import {
  buildTeacherOptions,
  ECS_TEACHER_ALL,
  keepTeacher,
  resolveTeacherFilter,
  type LandingTeacherOption,
} from "../landing-teacher";
import type { RosterGroupKey } from "../lib/roster-order";
import { getClassNameAsOfIndex } from "@/features/classes/server/class-name-as-of-queries";
import { classNameForWeek } from "@/features/classes/class-name-as-of";
import type { SheetMark } from "../lib/roster-form";
import {
  keepEnglishTrack,
  readEnglishTrack,
  type EnglishTrack,
  type EnglishTrackFilter,
} from "@/features/classes/english-track";
import {
  buildWeekGrid,
  hasLiveSlotInWeek,
  holidaySlotKeySet,
  scheduledSlotKeySet,
  scheduledUnitsByDate,
  seatSlotKeySet,
  sheetFillStats,
  withdrawnFloorOf,
  type GridPlanLine,
  type WeekGrid,
} from "../lib/grid";
// 휴일 판정은 학원설정 하나뿐 — 내장 법정공휴일 표는 쓰지 않는다([[holiday.ts]]).
import { buildHolidayMap } from "@/features/attendance/calendar";
import { isMeaningfulPlanLine } from "../lib/plan-codec";
import { goalAreasFor } from "../lib/goal-areas";
import { normalizeSlotTime, weekDatesOf, YMD_RE, type DowKey } from "../lib/week";
import { ecsDelegatedClassIds, ecsVisibleClassFilter, requireEcsClassAccess } from "./access";

/**
 * ECS 주간 시트 로더 — 게이트(requireEcsClassAccess) 통과 후 admin client(service_role)로만 읽는다
 * (class_sheet_*는 deny-RLS). 조회는 전부 tenant_id + class_id 이중 필터(§A 결속).
 */

export type SheetStudentMeta = {
  name: string;
  school: string | null;
  grade: string | null;
  englishName: string | null;
};

export type SheetGoalDTO = {
  scope: "month" | "week";
  periodStart: string;
  role: "homeroom" | "assistant";
  skillArea: string;
  textbook: string | null;
  targetProgress: string | null;
};

export type ClassSheetWeekData = {
  classId: string;
  /** 🔴 **그 주에 불릴 이름**(예약된 개명 반영). DB의 오늘 이름은 `classNameBefore`. */
  className: string;
  /** 그 주 시작 전에 이미 개명이 적용됐으면 그 전 이름(=오늘 DB 이름). */
  classNameBefore?: string;
  /** 앞으로 올 개명 예고 — **예약된 때부터 그날까지 내내** 붙는다(옛 담임이 볼 기회를 갖도록). */
  classNameUpcoming?: { name: string; date: string };
  weekMonday: string;
  weekLabel: string;
  weekRelation: "past" | "current" | "future";
  today: string;
  canWrite: boolean;
  /** 쓰기 권한은 있는데 담당 반이 아니라 보기만 하는가(`EcsClassAccess.scopeLocked`) — 잠금 안내 문구를 가른다. */
  scopeLocked?: boolean;
  /** 날짜별 출석 present 체크 가능 여부(attendance 계약 — 권한 + 강사 7일 창). */
  canMarkAttendanceByDate: Record<string, boolean>;
  /**
   * **사유(메모)만** 고칠 수 있는가 — 권한 + 담당 반까지는 같고 **7일 창은 보지 않는다**.
   * 서버 `setAttendanceCell({ noteOnly: true })`가 정확히 그만큼을 면제하므로(메모는 시수·돈에 안 닿는다),
   * 화면도 같은 폭으로 열어야 "서버는 되는데 화면이 막는" 문이 생기지 않는다(원장 2026-08-06).
   */
  canNoteAttendance: boolean;
  /** 교시 계획 줄의 '구분' 영역 — EiE도 학원설정 영역 그대로다(왼쪽 표 행과 다른 목록). */
  skillAreas: SkillAreaSetting[];
  /**
   * **왼쪽 계획 표**의 행 — EiE = 달력 칸(`In-class · Homework · Test`), 그 외 = `skillAreas`
   * (원장 2026-09-14 *"EiE 왼쪽 월간 계획은 달력입력란에 맞게 메뉴 변경. 인재원영어와 구분."*).
   * 🔴 `PlanPanel`에만 넘긴다 — 판정은 [`goalAreasFor`](../lib/goal-areas) 하나(저장 검증도 같은 함수).
   */
  goalAreas: SkillAreaSetting[];
  grid: WeekGrid;
  /** teacherId → 표시 이름(users.display_name). 슬롯 라벨(slot_teacher_label)이 없을 때 폴백. */
  teacherNames: Record<string, string>;
  classTeacherName: string | null;
  students: Record<string, SheetStudentMeta>;
  /**
   * `${studentId}|${date}|${HH:MM}` → 출결(effective) — 상태 + **사유 메모** + 그 행의 교시.
   * ⚠️ 키의 교시는 **화면 칸**(교시 카드)이고, 값의 `slot`은 **DB 행이 실제로 들고 있는 값**이다.
   *    옛 기록(null="그날 전체")은 그 날 첫 교시 칸에 붙지만 저장 땐 null로 돌려줘야 제자리에서 고쳐진다.
   * ⚠️ 메모를 같이 싣는 이유: 출결 pill(지각·결석)이 사유 창을 띄우는데, 초기값이 없으면 창이 빈 채로
   *    열리고 저장 시 **출석부에 이미 적힌 사유를 null로 덮는다**(setAttendanceCell은 넘긴 note를 쓴다).
   */
  attendanceByStudentDate: Record<
    string,
    {
      status: string;
      note: string | null;
      units: number | null;
      /** 이 기록이 실제로 들고 있는 교시 — null = 옛 "그날 전체" 행(저장·취소 때 그대로 돌려준다). */
      slot: string | null;
    }
  >;
  /**
   * 날짜 → 그 날 **옛 유닛 자동값**(2026-08-06~08-10에만 쓰이던 값).
   *
   * 🔴 **새 기록에는 더 이상 안 쓴다** — 원장 2026-08-10: *"eie든 인재원 수업이든 다 1 / 분에 상관없이
   *    다 1로 처리할것"*. 트랙별 규칙(EiE=교시 수, 인재원=총 분÷60)은 60분+50분짜리 날을 1.8로 만들어
   *    "하나당 1"이라는 셈과 어긋났다. 이제 새 출결은 전부 기본 1(=null 저장).
   * ⚠️ 그래도 **계속 내려보낸다** — 그 시절에 자동으로 박힌 1.8·4 같은 값을 '선택 안 함'으로 되돌리려면
   *    서버(0187a `ecs_clear_present`)에 "이게 그때의 자동값이었다"를 알려 줘야 하기 때문이다.
   *    이 값을 쓰기 경로에서 되살리지 말 것.
   */
  unitsByDate: Record<string, number>;
  /** `${studentId}|${date}|${HH:MM}` → 마크(태도·특이사항 + 폼별 자유 입력 칸). */
  marks: Record<string, SheetMark>;
  goals: SheetGoalDTO[];
  monthStart: string;
  memos: Record<string, string>;
  /** `${date}|${HH:MM}` → "N교시". 요일별 교시표로 확정(주말은 평일과 시각이 달라 표가 다르다) — 표시 전용. */
  periodLabelBySlot: Record<string, string>;
  fill: { totalSlots: number; filledSlots: number; orphanSlots: number };
  /** 내 글씨 크기(users.ui_prefs.ecs.fontSize) — 계정 귀속이라 다른 PC에서도 같은 크기로 열린다. */
  fontSize: EcsFontSize;
  /**
   * **JJ** 교시 표시(users.ui_prefs.ecs, 기본 표시) — 상단 헤더 토글의 현재 값.
   * ⚠️ 이 값은 위 `grid`·`fill`에 **이미 반영돼 있다**(서버가 진실). 클라에서 따로 감추지 말 것.
   * ⚠️ LAB은 이 값과 무관하게 항상 빠져 있다(`hiddenSeatOf`) — 켜도 안 나온다.
   */
  showSelfStudy: boolean;
  /**
   * 접어 둔 로스터 섹션(재원·퇴원·기록) — 표시 전용이라 클라가 즉시 반영하고 계정에 뒤따라 저장한다.
   * ⚠️ 작성률·일괄 입력 대상은 안 바꾼다(접어도 그 학생들은 여전히 대상).
   */
  collapsedRosterGroups: RosterGroupKey[];
  /**
   * 이 반이 EiE 프로그램인가 — **컬럼(`english_track`)만** 본다(반 이름 추측 금지, english-track.ts 🔴).
   * 소비처: 수업계획 표의 '내신' 구획을 안 그린다(원장 2026-08-06 "EiE 수업의 경우 내신 제거 — 초등수업이므로").
   */
  isEie: boolean;
  /**
   * `${date}|${HH:MM}` → true — 그 교시에 **Shouting을 했다**고 체크한 표시(0230a).
   * ⚠️ **EiE 반에서만** 화면에 뜬다(원장 2026-08-27 "인재원 영어는 샤우팅 그냥 삭제").
   * ⚠️ 0230a 적용 전에는 항상 빈 객체다 — 마이그레이션보다 앱이 먼저 배포돼도 시트가 안 죽게([[#95]]).
   */
  shoutingSlots: Record<string, boolean>;
  /**
   * 임시 위임(0173a)으로 지금 **대신 맡은 반**의 시트인가 — 내 담당 반이면 false.
   * 툴바가 이 값으로 앰버 배지를 단다. 창(embed)에선 상단 PageHeader가 숨겨져서, 열고 난 뒤 "남의 반을
   * 고치는 중"임을 알 수 있는 자리가 툴바뿐이다.
   */
  delegated: boolean;
};

export async function getClassSheetWeek(
  classId: string,
  weekParam?: string | null,
  opts: { readOnly?: boolean } = {},
): Promise<{ ok: true; data: ClassSheetWeekData } | { ok: false; error: string }> {
  const gate = await requireEcsClassAccess(classId, opts);
  if (!gate.ok) return { ok: false, error: gate.error };
  const { access } = gate;
  const tenantId = access.tenantId;

  const today = kstToday();
  const weekMonday = mondayOf(weekParam && YMD_RE.test(weekParam) ? weekParam : today);
  const weekSunday = shiftDays(weekMonday, 6);
  const monthStart = `${weekMonday.slice(0, 7)}-01`;
  // 위임 배지용 — 게이트가 방금 같은 함수를 불렀고 react cache라 추가 왕복이 없다.
  const delegatedIds = await ecsDelegatedClassIds();
  // 끝난 수강도 유예(30일) 안이면 하단 '퇴원' 섹션에 남는다 → 조회 창을 그만큼 넓힌다.
  // ⚠️ 이 창을 weekMonday로 좁히면 퇴원 섹션이 조용히 비어버린다(판정은 grid, 조회는 여기 — 같은 상수).
  const enrollmentFloor = withdrawnFloorOf(weekMonday);

  const admin = createAdminClient();
  // 수업 나누기(0351a) — 아래 큰 조회와 독립이라 프라미스만 먼저 띄운다(B4). fail-soft(표 없음 = 나눔 없음).
  const splitsPromise = loadSplitsForSheet(admin, tenantId, [classId], weekMonday, weekSunday);
  const [
    schedulesRes,
    enrollmentsRes,
    planLinesRes,
    weekGoalsRes,
    monthGoalsRes,
    marksRes,
    attendanceRes,
    memosRes,
    settings,
    labelMap,
    myPrefsRes,
    roomsRes,
    shoutingRes,
  ] = await Promise.all([
    admin
      .from("class_schedules")
      .select(
        // ⚠️ `classroom_id`(FK)를 **함께** 읽는다 — 라벨(`slot_room_label`)은 시트가 적은 대로라
        //    같은 방이 `305`·`본원305` 두 표기로 들어 있다(실측 2026-09-04: 유효 슬롯 209건이
        //    접두 없는 표기). aywa 기준은 **등록된 강의실 이름**이라 FK가 먼저다.
        "day_of_week, start_time, end_time, valid_from, valid_to, teacher_id, classroom_id, slot_teacher_label, slot_room_label",
      )
      .eq("tenant_id", tenantId)
      .eq("class_id", classId)
      .lte("valid_from", weekSunday)
      .or(`valid_to.is.null,valid_to.gte.${weekMonday}`),
    admin
      .from("enrollments")
      .select(
        // withdrawal_reason = '퇴원' 섹션 한 줄 요약의 괄호(원장 2026-08-18) — 반 단위 사유라 여기서 온다.
        "student_id, start_date, end_date, on_hold, is_transferred, attendance_days, withdrawal_reason, students!inner(id, name, school, grade, english_name, withdrawn_at)",
      )
      .eq("tenant_id", tenantId)
      .eq("class_id", classId)
      .lte("start_date", weekSunday)
      .or(`end_date.is.null,end_date.gte.${enrollmentFloor}`),
    admin
      .from("class_sheet_plan_lines")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("class_id", classId)
      .gte("plan_date", weekMonday)
      .lte("plan_date", weekSunday)
      .order("plan_date")
      .order("slot_start")
      .order("term_mode")
      .order("line_no"),
    admin
      .from("class_sheet_goals")
      .select("scope, period_start, role, skill_area, textbook, target_progress")
      .eq("tenant_id", tenantId)
      .eq("class_id", classId)
      .eq("scope", "week")
      .eq("period_start", weekMonday),
    admin
      .from("class_sheet_goals")
      .select("scope, period_start, role, skill_area, textbook, target_progress")
      .eq("tenant_id", tenantId)
      .eq("class_id", classId)
      .eq("scope", "month")
      .eq("period_start", monthStart),
    admin
      .from("class_sheet_student_marks")
      // 🔴 `*`인 이유 = **마이그레이션(0202a `score`)보다 앱이 먼저 배포돼도 시트가 안 죽게**(#95).
      //    열을 이름으로 적으면 아직 없는 컬럼 하나에 PostgREST가 400을 내고 반 시트 전체가 통째로
      //    안 열린다(2026-08-03 실사고와 같은 모양). 이 표는 한 반 × 한 주라 행이 적어 `*`가 싸다.
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("class_id", classId)
      .gte("mark_date", weekMonday)
      .lte("mark_date", weekSunday),
    admin
      .from("attendance_records")
      // note = 지각·결석 사유. 출결 pill의 사유 창 초기값이라 **반드시 함께** 읽는다(없으면 저장 시 null로 덮음).
      .select("id, student_id, class_id, session_date, slot_start, status, note, session_units, recorded_at")
      .eq("tenant_id", tenantId)
      .eq("class_id", classId)
      .gte("session_date", weekMonday)
      .lte("session_date", weekSunday),
    admin
      .from("class_sheet_memos")
      .select("memo_key, body")
      .eq("tenant_id", tenantId)
      .eq("class_id", classId)
      .eq("week_start", weekMonday),
    getTenantSettings(),
    // 강사 라벨 해석기(시간표와 **같은 단일 소스**) — slot_teacher_label 원문은 ijw 시트의 영문 닉네임
    // ("Hannah")·옛 이름("이주희")이라 그대로 그리면 시간표는 "이현이/LAB"인데 ECS만 다른 이름이 뜬다
    // (원장 제보 2026-07-29). DB 원문은 시트 동기의 원본이라 건드리지 않고 **표시할 때만** 해석한다.
    // admin 클라이언트를 주입해 tenantId로 좁힌다(무인자 호출은 쿠키 세션 경로라 admin 흐름과 섞인다).
    getTeacherLabelMap({ supabase: admin, tenantId })
      // ⚠️ 이름 조회가 실패해도 시트는 연다 — 표시 전용이라 원문 라벨로 떨어지는 편이 시트 전체가 죽는 것보다 낫다
      //    (시간표는 같은 함수가 던진다 — 감사 E5. 영어 강사 전원이 매일 여는 화면이라 여기선 삼킨다).
      .catch(() => undefined),
    // 내 글씨 크기(계정 귀속) — 서버 확정값이라 첫 렌더부터 정확하다(localStorage 초기값 = 하이드레이션 크래시 #75).
    admin.from("users").select("ui_prefs").eq("id", access.user.id).eq("tenant_id", tenantId).maybeSingle(),
    // 교시 체크(Shouting, 0230a). ⚠️ **에러를 일부러 삼킨다**(아래 에러 게이트 목록에도 안 넣는다) —
    // 마이그레이션보다 앱이 먼저 배포되면 표가 없어 400이 나는데, 그때 시트 전체가 안 열리면 안 된다([[#95]]).
    // 표가 생긴 뒤엔 정상 조회된다. 체크가 잠깐 안 보이는 것과 반 시트가 통째로 죽는 것은 급이 다르다.
    // 등록된 강의실(id→이름) — 라벨을 aywa 기준 이름으로 맞추는 근거. 보관된 방도 포함해서 읽는다
    // (지난 주 시트가 그 방을 가리킬 수 있고, 이름을 못 찾으면 라벨이 그대로 나온다).
    admin.from("classrooms").select("id, name").eq("tenant_id", tenantId),
    admin
      .from("class_sheet_slot_flags")
      .select("flag_date, slot_start, shouting")
      .eq("tenant_id", tenantId)
      .eq("class_id", classId)
      .gte("flag_date", weekMonday)
      .lte("flag_date", weekSunday),
  ]);

  for (const r of [schedulesRes, enrollmentsRes, planLinesRes, weekGoalsRes, monthGoalsRes, marksRes, attendanceRes, memosRes]) {
    if (r.error) return { ok: false, error: `시트 데이터를 불러오지 못했습니다: ${r.error.message}` };
  }

  type EnrollmentRow = {
    student_id: string;
    start_date: string;
    end_date: string | null;
    on_hold: boolean;
    is_transferred: boolean | null;
    attendance_days: string[] | null;
    withdrawal_reason: string | null;
    students: {
      id: string;
      name: string;
      school: string | null;
      grade: string | null;
      english_name: string | null;
      withdrawn_at: string | null;
    };
  };
  const enrollments = (enrollmentsRes.data ?? []) as unknown as EnrollmentRow[];

  const planLines: GridPlanLine[] = (planLinesRes.data ?? []).map((l) => ({
    id: l.id as string,
    planDate: l.plan_date as string,
    slotStart: l.slot_start as string,
    termMode: l.term_mode as "regular" | "exam",
    skillArea: l.skill_area as string,
    lineNo: Number(l.line_no),
    textbook: (l.textbook as string | null) ?? null,
    pageRange: (l.page_range as string | null) ?? null,
    progress: (l.progress as string | null) ?? null,
    homework: (l.homework as string | null) ?? null,
    updatedAt: l.updated_at as string,
  }));

  const marks = (marksRes.data ?? []).map((m) => ({
    studentId: m.student_id as string,
    markDate: m.mark_date as string,
    slotStart: m.slot_start as string,
    status: (m.status as string | null) ?? null,
    progressNote: (m.progress_note as string | null) ?? null,
    // 마이그레이션(0202a score · 0206a 듣기/단어수) 적용 전엔 컬럼이 없어 undefined → null이 된다
    // — 화면은 '빈 칸'으로 정상 동작한다(#95 expand/contract). 위 select가 `*`인 이유도 이것.
    score: ((m as { score?: string | null }).score as string | null) ?? null,
    listeningLevel: ((m as { listening_level?: string | null }).listening_level as string | null) ?? null,
    memorizedWords: ((m as { memorized_words?: string | null }).memorized_words as string | null) ?? null,
  }));

  const effAttendance = effectiveAttendanceRecords(
    (attendanceRes.data ?? []).map((a) => ({
      id: a.id as string,
      student_id: a.student_id as string,
      class_id: a.class_id as string,
      session_date: a.session_date as string,
      // 교시(0196a) — effectiveAttendanceRecords의 키에 들어간다(빠뜨리면 4교시·6교시 중 하나가 사라진다).
      slot_start: (a.slot_start as string | null) ?? null,
      recorded_at: a.recorded_at as string,
      status: a.status as string,
      // 지각·결석 사유 — 출결 드롭다운의 사유 창 초기값. 여기서 흘리면 저장 시 기존 사유가 null로 덮인다.
      note: (a.note as string | null) ?? null,
      // 시수(유닛) — null = 기본 1(effectiveUnits). 화면의 유닛 칸이 이 값을 보여주고 고친다.
      session_units: (a.session_units as number | null) ?? null,
    })),
  );

  const memoRows = (memosRes.data ?? []).map((m) => ({
    memoKey: m.memo_key as string,
    body: m.body as string,
  }));

  // JJ 표시 여부 — **그리드 조립 전에** 정해야 한다(작성률 분모까지 이 값이 정한다). LAB은 항상 제외.
  const showSelfStudy = readEcsShowSelfStudy(myPrefsRes.data?.ui_prefs);

  // 이 반 수강이 끝난 학생의 **같은 과목 다른 반** 수강 — 판정 두 가지의 재료다.
  //  ① 종강(원장 2026-09-14 *"1과목이 완전히 종료되면 그 과목에 대해서는 퇴원"*): 같은 과목 다른 반을 계속 다니면
  //     '퇴원'이 아니라 '종강' 섹션. 판정은 grid가 월별 출석부 뱃지와 같은 `continuesIn`으로 한다(`elsewhereSpans`).
  //  ② 플래그 없는 반 이동 전출자 — 학원 퇴원이 아닌데 이 반 수강이 끝난 학생이 **같은 과목 다른 반**에
  //     열린 수강을 가지면 전출(반 이동)이지 퇴원이 아니다(원장 2026-08-18 "이런 건 퇴원처리 안 되어 있게").
  //     is_transferred 플래그는 이동 도구를 안 거친 이동(시트 동기·종료+배정 수작업)엔 없어서 백업 판정이 필요.
  // best-effort: 이 감지가 실패해도 시트는 열려야 한다(실패 시 옛 동작 = 퇴원 줄에 표시).
  let activeElsewhereSameSubject: string[] = [];
  const elsewhereSpans: Record<string, OtherSpan[]> = {};
  try {
    const endedStudentIds = [...new Set(enrollments.filter((e) => e.end_date).map((e) => e.student_id))];
    if (endedStudentIds.length > 0) {
      // 🔴 학생 id × 수강 이력(끝난 반 포함)이라 한 청크가 1,000행을 넘을 수 있다 → 청크 × 페이징(B2 🔴).
      const others = await fetchAllPagedInChunks<{
        student_id: string;
        class_id: string;
        start_date: string;
        end_date: string | null;
        is_transferred: boolean | null;
      }>(endedStudentIds, (chunk, from, to) =>
        admin
          .from("enrollments")
          .select("id, student_id, class_id, start_date, end_date, is_transferred")
          .eq("tenant_id", tenantId)
          .neq("class_id", classId)
          .in("student_id", chunk)
          // 🔴 새 반 수강이 **이 주에 이미 시작**한 것만 — 미래 시작(다음 주 예약 배정)까지 전출로 세면 이번 주엔
          //    새 반 로스터에도 없어서 학생이 ECS 어디에도 안 보인다(적대 리뷰 M1). 종강은 나간 날 이전 시작이라 이 창 안이다.
          .lte("start_date", weekSunday)
          // 유예 하한 전에 끝난 수강은 어느 판정에도 안 걸린다(종강은 나간 날 +14일에도 재원이어야 한다).
          .or(`end_date.is.null,end_date.gte.${enrollmentFloor}`)
          .order("id")
          .range(from, to),
      );
      const otherClassIds = [...new Set(others.map((o) => o.class_id))];
      if (otherClassIds.length > 0) {
        const otherClasses = await fetchInChunks<{ id: string; class_name: string; subject: string | null }>(
          otherClassIds,
          (chunk) =>
            admin.from("classes").select("id, class_name, subject").eq("tenant_id", tenantId).in("id", chunk),
        );
        const sameSubject = new Map(
          otherClasses.filter((c) => c.subject === access.subject).map((c) => [c.id, c]),
        );
        const notWithdrawn = new Set(
          enrollments.filter((e) => !e.students?.withdrawn_at).map((e) => e.student_id),
        );
        const moved = new Set<string>();
        for (const o of others) {
          const c = sameSubject.get(o.class_id);
          if (!c) continue;
          (elsewhereSpans[o.student_id] ??= []).push({
            start: o.start_date,
            end: o.end_date,
            isTransferred: o.is_transferred ?? undefined,
            classId: c.id,
            className: c.class_name,
            subject: c.subject,
          });
          // ② 전출 백업 판정은 종전 조건 그대로 — 열린 수강 + 학원 퇴원 아님.
          if (o.end_date == null && notWithdrawn.has(o.student_id)) moved.add(o.student_id);
        }
        activeElsewhereSameSubject = [...moved];
      }
    }
  } catch (e) {
    console.error("[class-sheets] 종강·전출자 감지 실패 — 퇴원 줄 표시로 폴백", e);
  }

  // 등록 강의실 표 — id→이름(FK 우선), 이름 목록(라벨 정정 근거).
  const roomRows = (roomsRes.data ?? []) as { id: string; name: string }[];
  const roomNameById = new Map(roomRows.map((r) => [r.id, r.name]));
  const roomNames = roomRows.map((r) => r.name);

  // 스케줄 행은 **한 번만** 만들어 그리드와 유닛 계산이 같은 입력을 본다(두 벌이면 라벨 해석이 갈린다).
  const scheduleRows = (schedulesRes.data ?? []).map((s) => ({
    dayOfWeek: s.day_of_week as DowKey,
    startTime: s.start_time as string,
    endTime: s.end_time as string,
    validFrom: s.valid_from as string,
    validTo: (s.valid_to as string | null) ?? null,
    teacherId: (s.teacher_id as string | null) ?? null,
    // 해석은 여기(슬롯이 만들어지는 지점) 한 곳에서 — 컴포넌트마다 하면 표기가 갈린다(시간표 규약 동일).
    slotTeacherLabel: resolveTeacherLabel((s.slot_teacher_label as string | null) ?? null, labelMap),
    // 🔴 방 이름도 **같은 자리에서 한 번만** 해석한다(강사 라벨과 같은 규약) — FK 이름이 먼저고,
    //    FK가 없으면 라벨을 등록된 이름으로 맞춘다(`305` → `본원305`). 화면마다 하면 표기가 갈린다.
    slotRoomLabel: canonicalRoomName(
      resolveRoomName({
        slotClassroomName: s.classroom_id ? (roomNameById.get(s.classroom_id as string) ?? null) : null,
        slotRoomLabel: (s.slot_room_label as string | null) ?? null,
      }),
      roomNames,
    ),
  }));

  const baseGrid = buildWeekGrid({
    weekMonday,
    schedules: scheduleRows,
    enrollments: enrollments.map((e) => ({
      studentId: e.student_id,
      startDate: e.start_date,
      endDate: e.end_date,
      onHold: e.on_hold,
      isTransferred: e.is_transferred ?? undefined,
      attendanceDays: e.attendance_days,
      withdrawnAt: e.students?.withdrawn_at ?? null,
      withdrawalReason: e.withdrawal_reason ?? null,
    })),
    planLines,
    marks,
    attendance: effAttendance.map((a) => ({
      studentId: a.student_id,
      sessionDate: a.session_date,
      status: a.status,
    })),
    slotMemoKeys: memoRows.map((m) => m.memoKey).filter((k) => k.startsWith("slot:")),
    includeSelfStudy: showSelfStudy,
    activeElsewhereSameSubject,
    subject: access.subject,
    elsewhereSpans,
    // 휴일 — **표시와 작성률 분모에만** 닿는다(칸·입력·출결은 평일과 똑같다, [[holiday.ts]] 규약).
    holidays: buildHolidayMap(settings.operations.holidays),
  });

  // 수업 나누기(0351a) — 받는 반 교시엔 학생을 세우고, 원래 반 교시에선 뺀다(기록이 있으면 표식만 남긴다).
  // 규약은 split-roster.ts 한 곳. 기록 판정 키는 grid와 **같은 정규화**(normalizeSlotTime)를 쓴다.
  const { splits, names: splitNames } = await splitsPromise;
  const recordKeys = new Set<string>([
    ...marks.map((m) => `${m.studentId}|${m.markDate}|${normalizeSlotTime(m.slotStart)}`),
    ...effAttendance.filter((a) => a.slot_start).map((a) => `${a.student_id}|${a.session_date}|${normalizeSlotTime(a.slot_start!)}`),
  ]);
  const grid = applySplitsToGrid(baseGrid, classId, splits, splitNames, (sid, date, slot) =>
    recordKeys.has(`${sid}|${date}|${slot}`),
  );

  // 학생 메타 — enrollment 조인분 + (마크·출석만 있는 historical) 부족분 보충 조회
  const students: Record<string, SheetStudentMeta> = {};
  for (const e of enrollments) {
    if (e.students) {
      students[e.student_id] = {
        name: e.students.name,
        school: e.students.school,
        grade: e.students.grade,
        englishName: e.students.english_name,
      };
    }
  }
  const rosterIds = new Set<string>();
  for (const day of grid.days) for (const slot of day.slots) for (const r of slot.roster) rosterIds.add(r.studentId);
  for (const a of grid.attendanceOnly) for (const id of a.studentIds) rosterIds.add(id);
  const missing = [...rosterIds].filter((id) => !students[id]);
  if (missing.length > 0) {
    const rows = await fetchInChunks<{ id: string; name: string; school: string | null; grade: string | null; english_name: string | null }>(
      missing,
      (chunk) =>
        admin
          .from("students")
          .select("id, name, school, grade, english_name")
          .eq("tenant_id", tenantId)
          .in("id", chunk),
    );
    for (const s of rows) {
      students[s.id] = { name: s.name, school: s.school, grade: s.grade, englishName: s.english_name };
    }
  }

  // 강사 표시 이름 — 슬롯 teacher_id + 반 담임
  const teacherIds = new Set<string>();
  for (const day of grid.days) for (const slot of day.slots) if (slot.teacherId) teacherIds.add(slot.teacherId);
  if (access.teacherId) teacherIds.add(access.teacherId);
  const teacherNames: Record<string, string> = {};
  if (teacherIds.size > 0) {
    const rows = await fetchInChunks<{ id: string; display_name: string | null }>([...teacherIds], (chunk) =>
      admin.from("users").select("id, display_name").eq("tenant_id", tenantId).in("id", chunk),
    );
    for (const u of rows) if (u.display_name) teacherNames[u.id] = u.display_name;
  }

  // 출석 present 체크 가능 여부 — attendance 계약 그대로(권한 + 강사만 7일 창, 날짜별 판정)
  const [attendanceWrite, attendanceScope] = await Promise.all([
    canWriteTenant(access.user.systemRole, "attendance"),
    accessLevelTenant(access.user.systemRole, "attendance"),
  ]);
  // 출결 저장은 **출석부와 같은 액션**(`setAttendanceCell`)을 타므로, 담당 반 판정도 그 액션과 **같은
  // 함수**(`userTaughtClassSet` = 담임 ∪ 위임 ∪ 교시 담당)를 쓴다. 게이트는 여전히 출석부 쪽이 단일 소스고
  // 여기는 그걸 미리 비추는 거울일 뿐이다(화면과 서버가 같은 말 — #77).
  // 🔴 종전엔 여기서 `getTeachingClassIds`(담임 ∪ 위임)만 봐서 **교시 담당(부담임)의 출결이 화면에서만
  //    잠겨** 있었다. 그때는 액션도 같은 축이라 맞는 잠금이었지만, 액션이 2026-08-18(write-gate-axis)에
  //    교시 담당까지 넓히면서 **거짓 잠금**으로 남았다(원장 확인 2026-08-19: "본인 수업이니 당연히 출결이
  //    가능해야 한다"). ⚠️ 두 축을 다시 갈라 놓지 말 것 — 넓히려면 액션 쪽을 고치고 여기가 따라온다.
  // ⚠️ **알려진 한계(축은 같고 날짜가 다르다)**: 여기는 주 단위 화면이라 담당 반을 `today` 하나로 재는데
  //    액션은 저장하려는 **그 날짜**(sessionDate)로 잰다. 담당이 이번 주 안에 바뀐 반(시간표 행 분할 #88)
  //    에서만 한 칸 어긋난다 — 강사는 7일 창에 묶여 폭이 좁고, 날짜마다 다시 재면 이 핫패스 왕복이 7배가
  //    된다(B4). 좁히려면 날짜 범위를 한 번에 받는 조회를 먼저 만들 것. (오늘 면 today.ts는 하루짜리
  //    화면이라 처음부터 그 날짜로 잰다 — 거기선 어긋남이 없다.)
  const attendanceClassIds =
    attendanceWrite && attendanceScope === "scoped"
      ? await userTaughtClassSet(await createClient(), access.user.id, today)
      : null;
  const attendanceClassOk = attendanceClassIds === null || attendanceClassIds.has(classId);
  // 사유(메모)만 = 권한 + 담당 반. 7일 창은 여기서 빼고 날짜별 canMark에만 곱한다(서버 noteOnly와 같은 폭).
  const canNoteAttendance = attendanceWrite && attendanceClassOk;
  const canMarkAttendanceByDate: Record<string, boolean> = {};
  for (const date of weekDatesOf(weekMonday)) {
    canMarkAttendanceByDate[date] =
      canNoteAttendance && (attendanceScope !== "scoped" || isWithinAttendanceEditWindow(date, today));
  }

  // 교시 라벨(표시 전용) — **요일별 표**로 슬롯마다 확정한다. 주말은 평일과 시각이 다른 별도 교시표를
  // 쓰므로(주말 09:00~ 1시간 / 영어 평일 14:20~ 40분), 평일표만 보면 주말 15:00~16:00 수업이
  // 평일 "2교시"(15:00~15:40)로 표시된다 — 시각이 다른 교시에 남의 번호를 붙이는 거짓 표시(원장 제보).
  // 키에 날짜를 넣는 이유: 같은 시각이라도 요일에 따라 교시 번호가 다르다.
  const periodsConfig = settingsToPeriodsConfig(settings.operations);
  const periodTables = {
    weekday: tableToEntries(weekdayTableFor("english", periodsConfig)),
    weekend: tableToEntries(periodsConfig.weekend),
  };
  const periodLabelBySlot: Record<string, string> = {};
  for (const day of grid.days) {
    const weekend = isWeekendDow(day.dow);
    for (const slot of day.slots) {
      const label = resolvePeriodLabel(slot.slotStart, slot.slotEnd, periodTables, weekend);
      if (label) periodLabelBySlot[`${day.date}|${slot.slotStart}`] = label;
    }
  }

  // 유닛 자동값 — **그리드와 무관하게** 원본 스케줄에서 센다(자리 제외, 표시 설정 불문).
  // 트랙 판정은 `english_track` 컬럼뿐(반 이름 추측 금지). 미분류는 인재원과 같이 취급(비대칭 규약).
  const unitsByDate = scheduledUnitsByDate(
    weekMonday,
    scheduleRows,
    access.englishTrack === "eie" ? "periods" : "hours",
  );

  // 교시별 출결(0196a) — 키에 교시가 들어간다. 옛 기록(slot_start null = "그날 전체")은 **그 날의 첫
  // 교시에만** 붙인다: 모든 교시에 붙이면 예전처럼 한 칸을 고쳤을 때 다른 칸이 함께 바뀐 것처럼 보인다
  // (원장 2026-08-10 제보의 바로 그 증상). 나머지 교시는 빈 칸으로 시작해 각자 찍힌다.
  const firstSlotByDate: Record<string, string> = {};
  for (const day of grid.days) {
    const first = day.slots[0]?.slotStart;
    if (first) firstSlotByDate[day.date] = normalizeSlotTime(first);
  }
  const attendanceByStudentDate: Record<
    string,
    { status: string; note: string | null; units: number | null; slot: string | null }
  > = {};
  for (const a of effAttendance) {
    const raw = (a.slot_start as string | null) ?? null;
    // 화면 키는 그 칸의 교시. 저장 시엔 `slot`(행이 실제로 들고 있는 값)을 그대로 돌려줘야
    // 옛 null 행을 **제자리에서** 고칠 수 있다(새 교시 행을 하나 더 만들면 시수가 이중 계상된다).
    const cell = raw ? normalizeSlotTime(raw) : (firstSlotByDate[a.session_date] ?? "");
    attendanceByStudentDate[`${a.student_id}|${a.session_date}|${cell}`] = {
      status: a.status,
      note: a.note ?? null,
      units: a.session_units ?? null,
      slot: raw ? normalizeSlotTime(raw) : null,
    };
  }

  const marksMap: Record<string, SheetMark> = {};
  for (const m of marks) {
    marksMap[`${m.studentId}|${m.markDate}|${normalizeSlotTime(m.slotStart)}`] = {
      status: m.status,
      progressNote: m.progressNote,
      score: m.score,
      listeningLevel: m.listeningLevel,
      memorizedWords: m.memorizedWords,
    };
  }

  const goals: SheetGoalDTO[] = [...(weekGoalsRes.data ?? []), ...(monthGoalsRes.data ?? [])].map((g) => ({
    scope: g.scope as "month" | "week",
    periodStart: g.period_start as string,
    role: g.role as "homeroom" | "assistant",
    skillArea: g.skill_area as string,
    textbook: (g.textbook as string | null) ?? null,
    targetProgress: (g.target_progress as string | null) ?? null,
  }));

  const memos: Record<string, string> = {};
  for (const m of memoRows) memos[m.memoKey] = m.body;

  // 🔴 **그 주에 불릴 이름으로 부른다**(원장 2026-08-29 — 시간표와 같은 이유). 이름 컬럼엔 시간 축이 없어
  //    9/1로 예약해 둔 개명이 있어도 9월 주 시트가 오늘 이름으로 떴다. 개명 전 주는 **옛 이름으로 부르고**
  //    `classNameUpcoming`으로 예고한다 — 예고는 전환 주뿐 아니라 **예약된 때부터 그날까지 내내** 붙는다
  //    (원장 2026-08-29: 전환 주엔 이미 남의 반이라 옛 담임은 볼 기회가 없다).
  const renameForWeek = classNameForWeek(
    await getClassNameAsOfIndex(),
    classId,
    weekMonday,
    weekSunday,
    access.className,
    today,
  );

  return {
    ok: true,
    data: {
      classId,
      className: renameForWeek?.name ?? access.className,
      classNameBefore: renameForWeek?.before,
      classNameUpcoming: renameForWeek?.upcoming,
      weekMonday,
      weekLabel: weekLabel(weekMonday),
      weekRelation: weekRelation(weekMonday, today),
      today,
      canWrite: access.canWrite,
      scopeLocked: access.scopeLocked === true,
      canMarkAttendanceByDate,
      canNoteAttendance,
      skillAreas: access.skillAreas,
      // 게이트가 이미 읽어 온 트랙으로 파생(추가 조회 0) — 저장 검증(`upsertGoal`)과 같은 함수.
      goalAreas: goalAreasFor(access.englishTrack, access.skillAreas),
      grid,
      teacherNames,
      classTeacherName: access.teacherId ? (teacherNames[access.teacherId] ?? null) : null,
      students,
      attendanceByStudentDate,
      unitsByDate,
      marks: marksMap,
      goals,
      monthStart,
      memos,
      periodLabelBySlot,
      fill: sheetFillStats(grid),
      // 크기 조회 실패는 기본값으로 떨어진다(개인 취향값이라 시트 전체를 막을 이유가 없다).
      fontSize: readEcsFontSize(myPrefsRes.data?.ui_prefs),
      showSelfStudy,
      collapsedRosterGroups: readEcsCollapsedRosterGroups(myPrefsRes.data?.ui_prefs),
      // EiE 구분(모듈)이 꺼진 학원엔 계획(MP) 면이 없다(2026-09-30).
      isEie: access.englishTrack === "eie" && (await eieModuleOn()),
      // 0230a 미적용(또는 조회 실패)이면 빈 맵 — 체크가 안 보일 뿐 시트는 그대로 열린다([[#95]]).
      shoutingSlots: shoutingMapOf(shoutingRes.data ?? []),
      // 위임 배지 — 게이트와 **같은 소스**(cache라 추가 왕복 0). 담임이 나면 위임이 아니다.
      delegated: delegatedIds.includes(classId) && access.teacherId !== access.user.id,
    },
  };
}

// ── 랜딩(반 목록 + 작성 상태) ─────────────────────────────────────────────────

export type SheetLandingCard = {
  classId: string;
  /** 🔴 **그 주에 불릴 이름**(예약된 개명 반영). DB의 오늘 이름은 `classNameBefore`. */
  className: string;
  /** 그 주 시작 전에 이미 개명이 적용됐으면 그 전 이름(=오늘 DB 이름). 안 바뀌었으면 undefined. */
  classNameBefore?: string;
  /** 앞으로 올 개명 예고 — **예약된 때부터 그날까지 내내** 붙는다(옛 담임이 볼 기회를 갖도록). */
  classNameUpcoming?: { name: string; date: string };
  /**
   * 담임 **id** — 목록을 담임별로 묶을 때 쓴다(2026-08-11 "열마다 담임 구분해서 놓자").
   * ⚠️ 이름으로 묶지 말 것: 동명이인이면 두 사람의 반이 한 덩어리가 된다(이름은 표시용 라벨일 뿐).
   */
  teacherId: string | null;
  teacherName: string | null;
  /**
   * 프로그램 구분(0176a `classes.english_track`) — 목록 **좌우 분단**의 기준(원장 2026-08-28
   * *"EiE와 인재원 영어를 분리해서 좌 우로 2단"*). null = 미분류이며 화면에선 인재원 쪽에 든다
   * (필터와 같은 비대칭 — [`landing-programs.ts`](../landing-programs) 참조).
   * ⚠️ `shoutingSlots`로 프로그램을 되짚지 말 것: 조회가 실패해도 null이라 "EiE가 아님"과 구분이 안 된다.
   */
  englishTrack: EnglishTrack | null;
  /**
   * 작성률 분모 — 그 주 배정 교시 중 **평일 전부 + 쓴 휴일**([[holiday.ts]] 규약).
   * ⚠️ 배정이 있어도 그 주가 통째로 휴일이면 0이 된다. 그때 반은 목록에 **그대로 남는다**
   *    (`hasLiveSlotInWeek`는 휴일을 보지 않는다) — 화면은 `holidaySlots`로 사유를 가려 적는다.
   */
  totalSlots: number;
  filledSlots: number;
  /** 시간표에 없는 시각(고아) 칸 수. 🔴 **화면에 안 띄운다**(원장 2026-09-23 *"앞으로 안뜨게하면 되고 이전 데이터들은 무시해"*) — 값은 남겨 둔다(점검용). */
  orphanSlots: number;
  /**
   * 그 주 **휴일에 배정된** 교시 수(쓴 것·안 쓴 것 모두). 0이 아닌데 `totalSlots`가 0이면
   * "배정이 없는 주"가 아니라 "휴일뿐인 주"다 — 두 사유를 같은 문구로 적으면 화면이 거짓말을 한다.
   */
  holidaySlots: number;
  /**
   * 그 주 Shouting 체크가 들어간 교시 수(0230a) — 분모는 `totalSlots`(작성률과 **같은 분모**라
   * `2/6 · 4/6`이 한 줄에서 바로 대조된다). 원장 2026-08-28 *"EiE반은 그 왼쪽에 샤우팅 체킹을
   * 했나 안했나 확인 바로 가능하게"* + *"샤우팅도 주단위 체크"*.
   * 🔴 **EiE가 아니면 `null`**(0이 아니다) — 인재원 영어는 Shouting 자체가 없어 `0/6`으로 그리면
   *    "해야 하는데 안 했다"는 거짓말이 된다. 화면은 null이면 칸을 비우되 폭은 잡는다.
   */
  shoutingSlots: number | null;
  /**
   * 임시 위임(0173a)으로 지금 대신 맡은 반인가 — 내 담당 반이면 false.
   * 원스크린 반 칩과 **같은 규약**으로 시각 구분한다(원장 지시 2026-08-03) — 남의 반 시트를 내 반인 줄
   * 알고 고치는 일이 없게. 카드의 `teacherName`은 원 담임이라 배지와 함께 읽으면 관계가 분명해진다.
   */
  delegated: boolean;
};

/**
 * 카드가 0개인 **이유** — 화면이 원인을 정확히 말하게 하려고 구분한다.
 * 담당 영어 반이 없는 강사에게 "학원 설정을 확인하라"고 하면 고칠 수 없는 일을 시키는 거짓 안내다.
 */
export type SheetLandingEmptyReason =
  | "not-configured"
  | "no-scoped-classes"
  | "no-classes"
  /** 반은 있는데 **보기 필터**(전체/EiE/인재원 영어) 때문에 빈 것 — 되돌릴 수 있는 원인이라 따로 안내한다. */
  | "filtered"
  /**
   * 담당 반은 있는데 **그 주에 배정된 교시가 하나도 없는** 것 — 주를 옮기면 보이므로 따로 안내한다.
   * (신설 반의 시작 전 주차·종강 반의 이후 주차가 여기 걸린다.)
   */
  | "no-week-classes"
  | null;

export async function getSheetLanding(
  weekParam?: string | null,
  /**
   * 영어 시트 화면에서 부를 때 true — 10분 넘게 안 본 영어 시트면 프로그램·담임 필터를 기본값으로 쓰고 저장값도 지운다(원장 2026-10-15,
   * src/lib/filter-reset/rules.ts). 운영실 카드 같은 다른 곳은 종전대로 저장값을 읽고 아무것도 지우지 않는다.
   */
  options: { resetStaleFilters?: boolean } = {},
): Promise<
  | {
      ok: true;
      weekMonday: string;
      weekLabel: string;
      today: string;
      cards: SheetLandingCard[];
      emptyReason: SheetLandingEmptyReason;
      /** 프로그램 보기 필터(내 계정, 0176a) — 헤더 토글의 현재 값. */
      trackFilter: EnglishTrackFilter;
      /** 내가 손으로 정한 목록 순서(내 계정, 2026-09-05) — 묶음 **안에서만** 적용된다. */
      landingOrder: string[];
      /** 토글에 붙는 개수 — **필터 전** 내 스코프 기준(필터를 걸어도 숫자가 안 변해야 고를 수 있다). */
      trackCounts: Record<EnglishTrackFilter, number>;
      /**
       * 담임 보기 필터(내 계정, 2026-08-11)의 **실제 적용값**. 저장값이 이 주 옵션에 없으면 `all`로
       * 떨어진 결과가 온다(저장값 자체는 안 지운다 — landing-teacher.ts 주석).
       */
      teacherFilter: string;
      /** 드롭다운 옵션 — **프로그램 필터 적용 후** 목록에 실제로 있는 담임뿐(개수는 전부 1 이상). */
      teacherOptions: LandingTeacherOption[];
    }
  | { ok: false; error: string }
> {
  const user = await getCurrentUser({ teacherView: true });
  if (!user) return { ok: false, error: "로그인이 필요합니다" };
  const level = await accessLevelTenant(user.systemRole, "ecs");
  if (level === "none") return { ok: false, error: "접근 권한이 없습니다" };

  const today = kstToday();
  const weekMonday = mondayOf(weekParam && YMD_RE.test(weekParam) ? weekParam : today);
  const weekSunday = shiftDays(weekMonday, 6);

  // ECS 대상 과목(v1: english + skillAreas 비어있지 않음) — 설정 단일 소스
  const settings = await getTenantSettings();
  const english = settings.operations.subjects.find((s) => s.key === "english");
  if (resolveSkillAreas(english).length === 0) {
    return {
      ok: true,
      weekMonday,
      weekLabel: weekLabel(weekMonday),
      today,
      cards: [],
      emptyReason: "not-configured",
      landingOrder: [],
      trackFilter: DEFAULT_ECS_ENGLISH_TRACK,
      trackCounts: { all: 0, eie: 0, injaewon: 0 },
      teacherFilter: ECS_TEACHER_ALL,
      teacherOptions: [],
    };
  }

  const supabase = await createClient();
  const admin = createAdminClient();
  // 반 목록과 내 보기 설정은 서로 독립 → 병렬(B4). 필터가 목록을 좁히므로 **뒤의 무거운 쿼리 전에** 읽는다.
  const [{ data: allClasses, error: classError }, prefsRes] = await Promise.all([
    supabase
      .from("classes")
      // english_track = 프로그램 구분(0176a). ⚠️ 이 컬럼은 마이그레이션이 **먼저** 적용돼야 한다(#95).
      .select("id, class_name, teacher_id, english_track")
      .eq("subject", "english")
      .eq("is_active", true)
      .or(`closed_at.is.null,closed_at.gte.${weekMonday}`)
      .order("class_name"),
    admin.from("users").select("ui_prefs").eq("id", user.id).eq("tenant_id", user.tenantId).maybeSingle(),
  ]);
  if (classError) return { ok: false, error: `반 목록을 불러오지 못했습니다: ${classError.message}` };
  /**
   * 🔴 **'다른 강사 뷰'는 그 사람이 보는 화면 그대로**여야 한다(원장 2026-09-05 *"다른 사람 강사뷰는
   *    그 사람 뷰와 동일하게 해줘"*) — 순서도 **그 강사가 저장한 값**을 읽는다. 보는 사람(관리자) 값을
   *    쓰면 남의 화면을 내 취향으로 재배열해 놓고 "그 사람 화면"이라 부르게 된다.
   * ⚠️ 그 뷰가 아닐 땐 **왕복이 안 는다**(내 행은 위에서 이미 읽었다). 쓰기는 그 화면에서 아예 막는다
   *    (열람 전용 — 손잡이를 안 그린다).
   */
  const orderOwner = await viewAsTeacher();
  const landingOrder = readEcsLandingOrder(
    orderOwner
      ? (
          await createAdminClient()
            .from("users")
            .select("ui_prefs")
            .eq("id", orderOwner.id)
            .eq("tenant_id", user.tenantId)
            .maybeSingle()
        ).data?.ui_prefs
      : prefsRes.data?.ui_prefs,
  );
  // 프로그램·담임 필터는 10분 넘게 안 본 영어 시트면 기본값(원장 2026-10-15 — src/lib/filter-reset/rules.ts). 순서는 위에서 그대로 읽었다.
  const myPrefs = options.resetStaleFilters ? await freshRawUiPrefs("ecs", prefsRes.data?.ui_prefs) : prefsRes.data?.ui_prefs;
  // EiE 구분(모듈)이 꺼진 학원은 프로그램 필터가 없다 — 저장된 옛 선택이 목록을 몰래 좁히지 않게 항상 '전체'(2026-09-30).
  const trackFilter: EnglishTrackFilter = isModuleEnabled(settings.modules.disabled, "eie")
    ? readEcsEnglishTrack(myPrefs)
    : "all";
  const storedTeacher = readEcsTeacher(myPrefs);
  // 강사 스코프는 JS 교집합(스코프 id를 .in에 넣지 않는다 — 대량 .in 상한/silent cap 회피, B3).
  // 담당 반 ∪ 부담임 반 ∪ **임시 위임 반**(ecsVisibleClassFilter — 게이트 requireEcsClassAccess와 같은
  // 세 갈래. 갈라지면 "목록엔 뜨는데 열면 거절" → ecs-scope-sources.test.ts가 두 곳을 함께 잠근다).
  //
  // 담임 이름을 **여기서** 함께 가져온다(2026-08-11 담임 필터). 이름이 있어야 드롭다운 옵션을 만들고,
  // 옵션이 있어야 저장된 담임 필터가 지금 고를 수 있는 값인지 판정할 수 있다 — 그런데 이 셋은 서로
  // 독립이라 **직렬로 세우면 왕복이 합산된다**(B4). 대상 id를 스코프 이후가 아니라 `allClasses`에서
  // 뽑으면(어차피 영어 담임 십수 명) 스코프 조회와 **동시에** 던질 수 있다.
  // 그 주의 배정 교시 — **필터보다 먼저** 알아야 한다(아래 `running` 주석). 대상은 스코프 이전
  // `allClasses`(영어 반 44개 규모)라 스코프 조회와 **같은 묶음**에 태울 수 있다(B4).
  const allClassIds = (allClasses ?? []).map((c) => c.id as string);
  const [{ classIds: visibleIds, hasScopeAnyWeek }, delegatedIds, teachers, nameIndex, schedules] =
    await Promise.all([
    // 🔴 **주를 넘긴다** — 부담임 갈래를 그 주로 좁혀야 "관계가 끝난 반"이 미래 주차에서 사라진다
    //    (원장 2026-08-29. 실측: 이다교의 LT3·중고E_중1 슬롯은 8/31에 끝나는데 9월 목록에 떠 있었다).
    ecsVisibleClassFilter(weekMonday),
    ecsDelegatedClassIds(),
    fetchInChunks<{ id: string; display_name: string | null }>(
      [...new Set((allClasses ?? []).map((c) => c.teacher_id as string | null).filter((v): v is string => !!v))],
      (chunk) => supabase.from("users").select("id, display_name").in("id", chunk),
    ),
    // 예약된 개명 — 이것도 위 셋과 독립이라 **같은 묶음**에 태운다(B4). 요청 캐시라 시트 헤더가 또 물어도 왕복 0.
    getClassNameAsOfIndex(),
    fetchInChunks<{
      class_id: string;
      day_of_week: DowKey;
      start_time: string;
      valid_from: string;
      valid_to: string | null;
      // 자리(LAB·JJ) 판정용 — 작성률 분모에서 빼려면 라벨이 필요하다(빼먹으면 랜딩만 옛 분모로 남는다).
      slot_teacher_label: string | null;
    }>(allClassIds, (chunk) =>
      supabase
        .from("class_schedules")
        .select("class_id, day_of_week, start_time, valid_from, valid_to, slot_teacher_label")
        .in("class_id", chunk)
        .lte("valid_from", weekSunday)
        .or(`valid_to.is.null,valid_to.gte.${weekMonday}`),
    ),
  ]);
  const scopeSet = visibleIds ? new Set(visibleIds) : null;
  // 카드에 '위임' 배지를 달기 위한 집합 — 게이트와 **같은 소스**(ecsDelegatedClassIds)라 배지와 접근이 안 갈린다.
  const delegatedIdSet = new Set(delegatedIds);
  const teacherName = new Map(teachers.map((t) => [t.id, t.display_name]));
  const inScope = (allClasses ?? []).filter((c) => !scopeSet || scopeSet.has(c.id as string));
  const schedulesByClass = new Map<string, typeof schedules>();
  for (const row of schedules) {
    const arr = schedulesByClass.get(row.class_id) ?? [];
    arr.push(row);
    schedulesByClass.set(row.class_id, arr);
  }
  /**
   * 🔴 **그 주에 배정된 교시가 하나도 없는 반은 목록에서 뺀다**(원장 2026-08-29 *"9/1 이후에 수업
   * 없을때 차단할 수 있는지 … 미래보기의 경우"*). 시간표는 칸을 슬롯에서 그리니 저절로 사라지지만
   * 랜딩은 **반을 먼저 세워 놓고** 그 주 교시를 세는 구조라, 안 걸러내면 `0/0` 카드가 남는다.
   * 실측(2026-08-29): 9/1 신설 반 `PL1b`·`중등E_초6 MED b`가 6월 말부터 **매주** 0교시로 떠 있었고,
   * 6월 중순엔 그런 반이 17개였다 — 분모가 0인 카드는 담임에게 할 수 없는 일을 재촉한다.
   *
   * 🔴 판정은 [`hasLiveSlotInWeek`](../lib/grid) — **자리(LAB·JJ)도 세고 표시 토글도 안 본다.**
   *    작성률 분모(`scheduled`)로 세면 LAB만 도는 반이 사라지고 JJ 토글 한 번에 반이 없어진다.
   *    행의 유무로 세도 안 된다 — `valid_from`이 그 주 수요일이면 월요일 행은 살아 있어도 안 돈다.
   * ⚠️ 게이트(`requireEcsClassAccess`)는 건드리지 않는다 — 목록에서 빠져도 URL로 그 주를 여는 건
   *    그대로 된다(빈 시트가 뜰 뿐이고, 과거 주차 열람은 유지되어야 한다).
   */
  const running = inScope.filter((c) =>
    hasLiveSlotInWeek(
      weekMonday,
      (schedulesByClass.get(c.id as string) ?? []).map((r) => ({
        dayOfWeek: r.day_of_week,
        validFrom: r.valid_from,
        validTo: r.valid_to,
      })),
    ),
  );
  // 프로그램 보기 필터(전체/EiE/인재원 영어) — 개수는 **필터 전** 집합에서 세야 토글에 진짜 숫자가 뜬다.
  // (여기서 '필터 전'은 프로그램·담임 필터 전이다. 위 주 배정은 필터가 아니라 **존재 여부**라
  //  숫자에도 반영해야 한다 — 안 그러면 "전체 9"를 눌렀는데 7장이 뜬다.)
  const trackCounts = {
    all: running.length,
    eie: keepEnglishTrack(running, "eie").length,
    injaewon: keepEnglishTrack(running, "injaewon").length,
  };
  // 담임 필터는 프로그램 필터 **다음**에 걸린다(둘은 곱해진다). 옵션도 프로그램 적용 후 집합에서 만들어
  // "골랐는데 0개"가 구조적으로 안 나오게 한다 — 상세 규약은 landing-teacher.ts 주석.
  const tracked = keepEnglishTrack(running, trackFilter).map((c) => ({
    row: c,
    teacherId: (c.teacher_id as string | null) ?? null,
  }));
  const teacherOptions = buildTeacherOptions(tracked, teacherName);
  const teacherFilter = resolveTeacherFilter(storedTeacher, teacherOptions);
  const classes = keepTeacher(tracked, teacherFilter).map((t) => t.row);
  const classIds = classes.map((c) => c.id as string);
  // 빈 목록이 "이 주만 빈 것"인가 — 스코프 자체가 그 주에만 빌 수도 있다(부담임만 하는 강사가 자기
  // 슬롯이 없는 주를 연 경우). 그때 "담당 반이 없습니다"라고 하면 그 사람에겐 거짓이고, 고칠 수 없는
  // 일(반 배정 문의)을 시키는 안내가 된다.
  const emptyOnlyThisWeek = inScope.length > 0 || (scopeSet !== null && hasScopeAnyWeek);
  if (classIds.length === 0) {
    return {
      ok: true,
      weekMonday,
      weekLabel: weekLabel(weekMonday),
      today,
      cards: [],
      trackFilter,
      landingOrder,
      trackCounts,
      teacherFilter,
      teacherOptions,
      // 원인별로 갈라야 안내가 거짓말이 안 된다 — 필터 때문에 빈 것을 "담당 반이 없다"로 말하면
      // 고칠 수 있는 일(필터 되돌리기)을 숨기고 못 고칠 일(반 배정)을 시키는 셈이다.
      // ⚠️ 여기서 말하는 '필터'는 **프로그램뿐**이다 — 담임 필터는 지금 목록에 있는 담임만 옵션이라
      //    고른 값이 목록을 비울 수 없다(그래서 안내가 담임을 지목하지 않는다).
      emptyReason:
        running.length > 0
          ? "filtered"
          : emptyOnlyThisWeek
            ? "no-week-classes"
            : scopeSet && (allClasses ?? []).length > 0
              ? "no-scoped-classes"
              : "no-classes",
    };
  }

  // Shouting은 EiE 반에만 있다(원장 2026-08-27) — 대상 id를 **미리** 갈라 두면 조회량도 그만큼 준다.
  const eieClassIds = classes
    .filter((c) => readEnglishTrack({ english_track: c.english_track as string | null }) === "eie")
    .map((c) => c.id as string);

  const [lines, shoutFlags] = await Promise.all([
    // 주간 계획 행 — 랜딩 집계용(28반 × 슬롯 × 행이라 1000행 초과 가능 → 페이지네이션, B2)
    fetchAllPagedInChunks<{
      class_id: string;
      plan_date: string;
      slot_start: string;
      textbook: string | null;
      page_range: string | null;
      progress: string | null;
      homework: string | null;
    }>(classIds, (chunk, from, to) =>
      admin
        .from("class_sheet_plan_lines")
        .select("class_id, plan_date, slot_start, textbook, page_range, progress, homework")
        .eq("tenant_id", user.tenantId)
        .in("class_id", chunk)
        .gte("plan_date", weekMonday)
        .lte("plan_date", weekSunday)
        .order("id")
        .range(from, to),
    ),
    // 주간 Shouting 체크(0230a) — **EiE 반만** 조회한다(대상이 아닌 반은 화면에서도 칸이 빈다).
    // ⚠️ 에러를 일부러 삼킨다(아래 어느 게이트에도 안 넣는다) — 마이그레이션보다 앱이 먼저 배포되면
    //    표가 없어 400이 나는데, 그때 **랜딩이 통째로 안 열리면 안 된다**([[#95]]. 시트 상세도 같은 처방).
    //    표가 생기면 정상 조회된다. 체크가 잠깐 안 보이는 것과 42반 목록이 죽는 것은 급이 다르다.
    // ⚠️ RLS 정책이 0개인 표라 **admin + tenant_id 명시 필터**가 필수다([[#104]]).
    // 🔴 실패는 **빈 배열이 아니라 `null`**로 떨어뜨린다. 빈 배열로 삼키면 EiE 반이 전부 `0/6`으로
    //    그려져 *"아무도 샤우팅을 안 했다"* 는 거짓 사실이 화면에 뜬다 — 모르는 것은 모른다고
    //    (칸을 비워) 말해야 한다(위 landing-shouting.ts 🔴와 같은 규약).
    eieClassIds.length > 0
      ? fetchAllPagedInChunks<{ class_id: string; flag_date: string; slot_start: string }>(
          eieClassIds,
          (chunk, from, to) =>
            admin
              .from("class_sheet_slot_flags")
              .select("class_id, flag_date, slot_start")
              .eq("tenant_id", user.tenantId)
              .eq("shouting", true)
              .in("class_id", chunk)
              .gte("flag_date", weekMonday)
              .lte("flag_date", weekSunday)
              .order("id")
              .range(from, to),
        ).catch(() => null)
      : Promise.resolve([]),
  ]);

  // JJ 표시 설정 — 시트 화면과 **같은 값**으로 세야 두 화면의 작성률이 갈리지 않는다(LAB은 양쪽 다 제외).
  // (프로그램 필터와 함께 위에서 한 번만 읽는다 — 같은 행을 두 번 조회하지 않게.)
  const showSelfStudy = readEcsShowSelfStudy(prefsRes.data?.ui_prefs);
  const meaningfulKeysByClass = new Map<string, Set<string>>();
  const allKeysByClass = new Map<string, Set<string>>();
  for (const l of lines) {
    const key = `${l.plan_date}|${normalizeSlotTime(l.slot_start)}`;
    const all = allKeysByClass.get(l.class_id) ?? new Set<string>();
    all.add(key);
    allKeysByClass.set(l.class_id, all);
    if (isMeaningfulPlanLine({ textbook: l.textbook, pageRange: l.page_range, progress: l.progress, homework: l.homework })) {
      const set = meaningfulKeysByClass.get(l.class_id) ?? new Set<string>();
      set.add(key);
      meaningfulKeysByClass.set(l.class_id, set);
    }
  }

  // 반별 Shouting 체크 키 — 분자는 아래에서 **배정 교시 안의 것만** 센다(옛 시간표의 체크로 `7/6`이
  // 뜨지 않게. 작성률 `filled`가 `scheduled`로 거르는 것과 같은 규약).
  const shoutKeysByClass = new Map<string, Set<string>>();
  for (const f of shoutFlags ?? []) {
    const set = shoutKeysByClass.get(f.class_id) ?? new Set<string>();
    set.add(shoutingKey(String(f.flag_date).slice(0, 10), String(f.slot_start)));
    shoutKeysByClass.set(f.class_id, set);
  }

  // 휴일 — 랜딩·주간 시트·월간이 **같은 맵**을 읽는다(설정 단일 소스, [[holiday.ts]]).
  const holidayMap = buildHolidayMap(settings.operations.holidays);

  const cards: SheetLandingCard[] = (classes ?? []).map((c) => {
    const slotRows = (schedulesByClass.get(c.id as string) ?? []).map((s) => ({
      dayOfWeek: s.day_of_week,
      startTime: s.start_time,
      validFrom: s.valid_from,
      validTo: s.valid_to,
      slotTeacherLabel: s.slot_teacher_label,
    }));
    // 🔴 휴일 교시는 `scheduled`에서 빠지고 여기로 온다 — **쓴 것만** 아래에서 분모·분자로 돌아간다
    //    (안 쓴 휴일 = 대상 0). 고아 판정은 **둘 다** 스케줄로 보므로 휴일에 쓴 계획이 "시간표에 없는
    //    기록"으로 둔갑하지 않는다.
    const scheduled = scheduledSlotKeySet(weekMonday, slotRows, {
      includeSelfStudy: showSelfStudy,
      holidays: holidayMap,
    });
    const holidayKeys = holidaySlotKeySet(weekMonday, slotRows, holidayMap, {
      includeSelfStudy: showSelfStudy,
    });
    const meaningful = meaningfulKeysByClass.get(c.id as string) ?? new Set<string>();
    const all = allKeysByClass.get(c.id as string) ?? new Set<string>();
    // 세는 대상 = 평일 배정 전부 + **쓴 휴일**. 작성률·Shouting이 같은 분모를 읽어야 한 줄에서 대조된다.
    const counted = new Set(scheduled);
    for (const key of holidayKeys) if (meaningful.has(key)) counted.add(key);
    let filled = 0;
    for (const key of counted) if (meaningful.has(key)) filled += 1;
    // 🔴 고아 = "시간표가 바뀌어 스케줄에 없는 기록". **안 그리기로 한 자리(LAB·숨긴 JJ)는 고아가 아니다** —
    //    스케줄엔 멀쩡히 있고 우리가 화면에서 뺐을 뿐이다. 빼면 `scheduled`에서 사라지므로 그냥 세면 LAB
    //    기록 전부가 "시간 변경된 기록 N건"으로 둔갑한다(시트 상세는 같은 걸 'LAB 각주'로 말한다 —
    //    두 화면이 같은 데이터를 다르게 설명하면 하나는 반드시 거짓말이다).
    const seatKeys = seatSlotKeySet(weekMonday, slotRows);
    let orphan = 0;
    // 🔴 휴일 교시(`holidayKeys`)는 스케줄에 **멀쩡히 있다** — 분모에서만 뺐을 뿐이다. 여기서 안 빼면
    //    추석에 쓴 계획이 전부 "시간표가 바뀌어 없는 기록"으로 뜬다(LAB이 그렇게 둔갑했던 것과 같은 함정).
    for (const key of all) if (!scheduled.has(key) && !holidayKeys.has(key) && !seatKeys.has(key)) orphan += 1;
    // 프로그램 구분 — 카드에 실어 보낸다(화면이 좌우로 가르는 기준). 위 `eieClassIds`와 **같은 술어**라
    // 조회 대상과 표시가 갈리지 않는다.
    const track = readEnglishTrack({ english_track: c.english_track as string | null });
    // Shouting — EiE 반만 숫자를 낸다(그 외는 null = 화면에서 칸을 비운다).
    // 조회가 실패했으면(shoutFlags === null) EiE 반도 null이다 — "0회"가 아니라 "모름"이다.
    let shout: number | null = null;
    if (shoutFlags !== null && track === "eie") {
      const keys = shoutKeysByClass.get(c.id as string);
      shout = 0;
      // 분모(`totalSlots`)와 **같은 집합**을 센다 — 안 쓴 휴일이 분모에서 빠졌는데 분자만 그 날 체크를
      // 세면 `7/6`이 뜬다(옛 시간표 체크를 거르는 것과 같은 규약).
      if (keys) for (const key of counted) if (keys.has(key)) shout += 1;
    }
    // ⚠️ 카드 **순서는 DB의 `class_name` 그대로 둔다**(위 .order). 표시 이름으로 다시 정렬하고 싶겠지만,
    //    Postgres 정렬은 로마자→한글인데 `localeCompare("ko")`는 정반대라([[#84]]) 개명과 무관한 반들의
    //    순서까지 통째로 뒤집힌다. 바뀜 이름은 아래 배지가 알린다.
    const renamed = classNameForWeek(
      nameIndex,
      c.id as string,
      weekMonday,
      weekSunday,
      c.class_name as string,
      today,
    );
    return {
      classId: c.id as string,
      className: renamed?.name ?? (c.class_name as string),
      ...(renamed?.before ? { classNameBefore: renamed.before } : {}),
      ...(renamed?.upcoming ? { classNameUpcoming: renamed.upcoming } : {}),
      teacherId: (c.teacher_id as string | null) ?? null,
      teacherName: c.teacher_id ? (teacherName.get(c.teacher_id as string) ?? null) : null,
      englishTrack: track,
      totalSlots: counted.size,
      filledSlots: filled,
      orphanSlots: orphan,
      holidaySlots: holidayKeys.size,
      shoutingSlots: shout,
      // 담임이 나면 위임이 아니다 — 내 반이 남에게 위임돼 있어도 내 화면에선 그냥 내 반이다.
      delegated: delegatedIdSet.has(c.id as string) && c.teacher_id !== user.id,
    };
  });

  return {
    ok: true,
    weekMonday,
    weekLabel: weekLabel(weekMonday),
    today,
    cards,
    emptyReason: null,
    trackFilter,
    trackCounts,
    teacherFilter,
    teacherOptions,
    landingOrder,
  };
}
