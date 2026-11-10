import "server-only";
import { attendanceWindowApplies } from "@/features/attendance/server/edit-window-gate";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { fetchAllPaged, fetchAllPagedInChunks, fetchInChunks } from "@/lib/supabase/batch";
import { accessLevelTenant, canWriteTenant } from "@/lib/auth/perm-matrix";
import { getCurrentUser } from "@/lib/auth/current-user";
// 출결 쓰기의 담당 반 축 — **출결 서버 액션과 같은 함수**(담임 ∪ 위임 ∪ 교시 담당). 화면 잠금이
// 액션보다 좁으면 "서버는 허락하는데 화면이 막는" 거짓 잠금이 된다(write-gate-axis.test.ts).
import { userTaughtClassSet } from "@/features/attendance/live/server/write-policy";
// 🔴 방 이름 규약은 좌석표·주간 시트와 **같은 두 함수**다(단일 소스) — 갈리면 같은 방을
//    화면마다 다르게 부른다.
import { canonicalRoomName, resolveRoomName } from "@/features/attendance/live/seating-floors";
import { addDays, kstToday } from "@/lib/date-kst";
import { getClassNameAsOfIndex } from "@/features/classes/server/class-name-as-of-queries";
import { resolveClassNameAsOf } from "@/features/classes/class-name-as-of";
import { settingsToPeriodsConfig, weekdayTableFor } from "@/features/timetable/lib/periods";
import { getTenantSettings } from "@/features/owner/server/queries";
import { loadNativeParticipants, participantsOrLegacy } from "@/features/makeups/server/adapters/participants";
import { isModuleEnabled } from "@/lib/modules";
import { resolveSkillAreas } from "@/features/owner/skill-areas";
import type { SkillAreaSetting } from "@/features/owner/settings-types";
import { effectiveAttendanceRecords } from "@/features/attendance/effective-records";
import { isWithinAttendanceEditWindow } from "@/features/attendance/edit-window";
import { enrollmentAttendsOnDay, isEnrollmentActiveOn } from "@/features/enrollments/eligibility";
import { mondayOf } from "@/features/timetable/lib/week";
import { resolvePeriodLabel, tableToEntries } from "../lib/period-label";
import { isWeekendDow } from "../lib/grid-rows";
import { hiddenSeatOf } from "../lib/grid";
import { holidayNameOn } from "../lib/holiday";
import { buildHolidayMap } from "@/features/attendance/calendar";
import { readEnglishTrack } from "@/features/classes/english-track";
import { shoutingKey } from "../shouting";
import { rosterFormOf, type RosterForm, type SheetMark } from "../lib/roster-form";
import { isMeaningfulPlanLine } from "../lib/plan-codec";
import { dowKeyOf, normalizeSlotTime, YMD_RE } from "../lib/week";
import { readEcsTodayOrder, readEcsShowSelfStudy } from "../view-prefs";
import { viewAsTeacher } from "@/lib/auth/view-mode";
import { DEFAULT_ECS_FONT_SIZE, readEcsFontSize, type EcsFontSize } from "../font-size";
// 영어 알림장은 aywa가 아니라 ClassNote 반 보드에 직접 올라간다(2026-08-11 전수 검사: 35일 5,680건 중
// 영어 lesson_reports 0건). "이 날짜에 알림장이 나갔나"의 진실은 워커가 적재하는 classnote_class_posts
// (0140a)이고, 반↔보드 매칭은 작성률 화면과 **같은 키**(classKey/boardKey)를 쓴다 — 따로 만들면 갈린다.
import { boardKey, classKey } from "@/features/report-admin/english-writing";
import { ecsDelegatedClassIds, ecsVisibleClassFilter } from "./access";
import { loadViewerUiPrefs } from "./viewer-prefs";
import { appendMakeupStudents, makeupStudentIds } from "../lib/makeup-roster";
// 보강 예약(0264a) — 그날 이 반에 예약된 학생을 보강 행으로 미리 세운다(fail-soft).
import { getReservationsOn } from "@/features/attendance/server/makeup-reservation-queries";
// 수업 나누기(0351a) — 그날 이 반으로 오는/나가는 학생(fail-soft).
import { getSplitsOnDate } from "@/features/class-splits/server/queries";
import { applySplitsToCard, splitIncomingIds } from "../lib/split-card";
import { explainDbError } from "@/lib/supabase/db-error";

/**
 * **오늘 ECS** — 영어 강사의 원스크린(원장 지시 2026-08-07 "영어 강사는 ECS를 기반으로 한 원스크린").
 *
 * 주간 시트가 "반 하나 × 주 하나"라면 여기는 그 직교 방향 — **날짜 하나 × 내 반 전부**다.
 * 그 날 수업이 있는 내 영어 반만, 교시 순서대로 한 화면에 쌓는다.
 *
 * 🔑 **반별로 `getClassSheetWeek`을 N번 부르지 않는다**(그게 제일 쉬운 길이지만 반 6개면 쿼리가 30개를
 *    넘는다 — 홈 화면이라 첫 페인트가 곧 체감 속도다). 랜딩(`getSheetLanding`)과 같은 방식으로
 *    **반 전체를 한 번에 묶어** 조회하고(B3 청크), 날짜를 하루로 좁혀 행 수를 줄인다.
 * ⚠️ 스코프·자리 판정·작성 여부는 전부 **기존 단일 소스를 재사용**한다(`ecsVisibleClassFilter`·
 *    `hiddenSeatOf`·`isMeaningfulPlanLine`) — 여기서 다시 구현하면 주간 시트와 숫자가 갈린다.
 */

/**
 * 계획 한 줄 — **주간 시트와 같은 모양**(`PlanLineDTO`)이다. 오늘 보드가 그 줄을 그대로 편집하고
 * 같은 CAS 경로로 저장하므로, 화면만 다르고 데이터·충돌 처리는 한 벌이다.
 */
export type TodayPlanLine = {
  id: string;
  planDate: string;
  slotStart: string;
  termMode: string;
  lineNo: number;
  skillArea: string | null;
  textbook: string | null;
  pageRange: string | null;
  progress: string | null;
  homework: string | null;
  updatedAt: string;
  /** 이 줄에 실제 내용이 있는가(작성률과 **같은 판정**). */
  filled: boolean;
};

export type TodaySlot = {
  slotStart: string;
  slotEnd: string | null;
  /**
   * 그 교시의 담당 라벨 **원문**(`slot_teacher_label`) — 자리(LAB·JJ) 판정용.
   * 🔴 표시·권한 근거로 쓰지 말 것(표시명은 해석을 거쳐야 하고, FK와 다른 사람을 가리킬 수 있다).
   */
  teacherLabel: string | null;
  /** "N교시"(요일별 교시표로 확정) — 못 찾으면 null(지어내지 않는다). */
  periodLabel: string | null;
  roomLabel: string | null;
  lines: TodayPlanLine[];
  /**
   * 이 교시의 **입력 폼**(기본 / JJ 전용) — 주간 시트와 **같은 판정**([roster-form.ts](../lib/roster-form.ts)).
   * JJ 교시는 태도·특이사항에 더해 듣기 레벨·누적 암기 단어수를 받는다(원장 2026-08-13 "JJ 수업에만 넣을
   * 것이므로 만약 JJ가 있다면 넣기"). ⚠️ 반이 아니라 **교시**가 정한다 — 같은 반이 4교시는 강사 수업,
   * 5교시는 JJ인 경우가 실제로 있다.
   */
  form: RosterForm;
};

export type TodayStudent = {
  studentId: string;
  name: string;
  /**
   * 영어 이름(`students.english_name`) — **영어 화면에서 주 이름**이 된다(원장 2026-09-03).
   * 🔴 표시 전용이고 판정은 [`studentNameParts`](@/features/teacher-view/student-name) 한 곳이다.
   *    학부모에게 나가는 것에는 절대 쓰지 않는다(그 모듈의 구조 가드가 막는다).
   */
  englishName: string | null;
  school: string | null;
  grade: string | null;
  /** 출결 effective 상태(없으면 null=미기록). 교시별 행이 여러 개면 가장 최근 기록의 상태. */
  attendance: string | null;
  /** 사유 메모가 붙어 있으면 여기(있으면 ECS에서 취소 못 함 — 출석부가 진실). */
  attendanceNote: string | null;
  /**
   * 이 학생의 그 날 유효 출결 행들의 `slot_start` **원본값**(0196a — 주간 시트가 만든 교시별 행 + 옛
   * '그날 전체' null 행). 취소(`clearPresentAttendance`)는 이 값을 그대로 넘겨야 실제 행이 지워진다 —
   * 안 넘기면 RPC가 null-slot 행만 세어 cleared:0 = "지운 척"이 된다(적대 리뷰 2026-08-11).
   */
  attendanceSlots: (string | null)[];
  /** 이 학생의 그 날 수업보고서가 작성됐는가(lesson_reports 존재). */
  reportWritten: boolean;
  /** ClassNote 발송 상태(성공만 true — 대기·실패는 false). */
  reportSent: boolean;
  /**
   * 그 날 이 학생의 **교시별 태도·특이사항**(`class_sheet_student_marks`) — 키는 `slot_start`.
   * 🔴 반 카드는 학생 한 줄인데 기록은 **교시마다** 있다(그날 2~3교시가 흔하다) — 한 칸으로 뭉개면
   *    어느 교시 기록인지 잃는다. 그래서 교시별로 들고 다니고, 입력도 교시별로 받는다(주간 시트와 같은 축).
   */
  marks: Record<string, SheetMark>;
  /** 이 반 수강생이 아닌데 그날 출결이 있는 보강(수업외) 학생. */
  isMakeup?: boolean;
  /**
   * 수업 나누기(0351a) — `in` = 그 시간 이 반으로 오는 학생 · `out` = 그 시간 다른 반으로 가는 학생. `note`는 화면 문장.
   * 판정은 [`split-card.ts`](../lib/split-card.ts) 한 곳(주간·오늘 시트는 `split-roster.ts`).
   */
  split?: { dir: "in" | "out"; note: string };
};

export type TodayClassCard = {
  classId: string;
  /** 🔴 **그 날짜에 불릴 이름**(예약된 개명 반영). DB의 오늘 이름은 `classNameBefore`. */
  className: string;
  /** 개명이 이미 적용된 날짜면 그 전 이름. 안 바뀌었으면 undefined. */
  classNameBefore?: string;
  /** 그 이름이 되는 날. */
  classNameChangeDate?: string;
  teacherName: string | null;
  /** 그 날 첫 교시 시작(정렬 키이자 카드 머리 시각). */
  startsAt: string;
  endsAt: string | null;
  slots: TodaySlot[];
  students: TodayStudent[];
  /** 계획 작성 = 그 날 교시 중 내용이 있는 교시 수 / 전체 교시 수. */
  fill: { total: number; filled: number };
  /** 출석 입력 가능(권한 + 강사 7일 창) — false면 화면이 체크를 잠그고 이유를 말한다. */
  canMarkAttendance: boolean;
  /**
   * 임시 위임(0173a)으로 지금 대신 맡은 반인가 — 내 담당 반이면 false. 주간 랜딩·원스크린 반 칩과
   * 같은 앰버 규약으로 구분한다(남의 반을 내 반인 줄 알고 고치는 사고 방지, 원장 2026-08-03).
   */
  delegated: boolean;
  /**
   * ClassNote 반 보드에 **이 날짜** 알림장이 올라왔는가(0140a classnote_class_posts, 워커 30분 주기 적재).
   * 영어 보고서는 aywa 밖(ClassNote 직접 게시)이라 lesson_reports 기반 '보고서' 배지만으로는 영어 강사의
   * 실제 마감이 안 보인다 — 이 값이 그 현실을 배지로 잇는다.
   *
   * 3상인 이유(적대 리뷰 2026-08-11): ① 보드가 아예 없는 반(실측 2개)에 '미게시' 앰버를 달면 **지울 수
   * 없는 거짓 할 일**이 된다 ② boardKey가 두 보드에 걸리는 반(실측 "Let's Speak 5" 월수목/화목금)은
   * 남의 반 게시로 '게시됨'이 켜져 **그날 알림장을 건너뛰게 만든다** → 둘 다 `untracked`(배지 미표시).
   */
  classnoteToday: "posted" | "pending" | "untracked";
  /** EiE 프로그램 반인가 — Shouting 체크(0230a)를 그리는 조건. 컬럼(`english_track`)만 본다. */
  isEie: boolean;
  /** 오늘 **Shouting을 했다**고 체크된 교시 시각(HH:MM) 목록. 0230a 미적용이면 항상 빈 배열([[#95]]). */
  shoutingSlots: string[];
  /**
   * 오늘 화면이 **안 그리는** 계획 행 수 — 살아있는 배치에 없는 시각(시간 변경된 기록)이거나 자리(LAB·숨긴 JJ).
   * ⚠️ 0이 아니면 반드시 각주로 알린다. 화면에서 빼는 것과 DB에서 지우는 건 다르고, 침묵하면
   *    **"분명히 썼는데 안 보인다"**가 된다(주간 시트가 같은 것을 '시간 변경된 기록 N건'으로 말한다).
   */
  hiddenLines: number;
  /** 위와 같은 이유로 안 그리는 **학생 기록**(태도·특이사항) 수 — 교시 축이 화면 슬롯뿐이라 생기는 실종. */
  hiddenMarks: number;
};

export type EcsTodayResult =
  | {
      ok: true;
      date: string;
      today: string;
      weekMonday: string;
      cards: TodayClassCard[];
      /** 내 스코프에 영어 반이 아예 없는가 — 빈 화면 문구를 원인별로 가르기 위한 값. */
      hasAnyClass: boolean;
      /** 계획 편집 가능(ecs full|scoped) — 출결과 별개 게이트다. */
      canWrite: boolean;
      /** 영역(구분) 정의 — 라벨·색의 **단일 소스는 학원설정**(주간 시트와 같은 값). */
      skillAreas: SkillAreaSetting[];
      /** 저널·presence 식별자(주간 시트와 같은 키를 써야 같은 문서로 인식된다). */
      userId: string;
      tenantId: string;
      /** 내 글씨 크기(users.ui_prefs.ecs.fontSize) — 주간 시트와 같은 계정 귀속 값·같은 배율. */
      fontSize: EcsFontSize;
      /**
       * 내가 손으로 정한 **반 순서**(users.ui_prefs.ecs.todayOrder, 2026-09-05 드래그&드롭).
       * 비었으면 기본 순서(화면에 보이는 첫 교시) 그대로 — 규약은 [`today-order.ts`](../today-order.ts).
       */
      todayOrder: string[];
      /**
       * 보고 있는 날짜가 학원 휴일이면 그 이름(아니면 null) — 화면이 그 사실을 한 줄로 알린다.
       * 🔴 **카드를 지우거나 입력을 막는 값이 아니다**(원장 2026-09-01 *"입력은 가능하도록"*).
       *    수업이 있으면 그대로 뜨고 출결·계획도 그대로 저장된다. 달라지는 건 안내 한 줄과
       *    요약 스트립의 **재촉 색**뿐이다(휴일에 "계획 0/6"을 앰버로 세우면 거짓 재촉이다).
       */
      holidayName: string | null;
    }
  | { ok: false; error: string };

export async function getEcsToday(dateParam?: string | null): Promise<EcsTodayResult> {
  const user = await getCurrentUser({ teacherView: true });
  if (!user) return { ok: false, error: "로그인이 필요합니다" };
  const level = await accessLevelTenant(user.systemRole, "ecs");
  if (level === "none") return { ok: false, error: "접근 권한이 없습니다" };
  // 계획 편집 게이트는 주간 시트와 동일(full|scoped). 출결은 별도 게이트(아래 attendanceWritable).
  const canWrite = level === "full" || level === "scoped";

  const today = kstToday();
  const date = dateParam && YMD_RE.test(dateParam) ? dateParam : today;
  const dow = dowKeyOf(date);

  const settings = await getTenantSettings();
  // EiE 구분(모듈)이 꺼진 학원엔 EiE 표시가 없다(2026-09-30 "꺼지면 흔적 없이").
  const eieOn = isModuleEnabled(settings.modules.disabled, "eie");
  const classnoteOn = isModuleEnabled(settings.modules.disabled, "classnote");
  // 휴일 판정은 학원설정 하나뿐([[holiday.ts]]) — 내장 법정공휴일 표는 쓰지 않는다(학원이 공휴일에 수업한다).
  const holidayName = holidayNameOn(buildHolidayMap(settings.operations.holidays), date);
  const english = settings.operations.subjects.find((s) => s.key === "english");
  const skillAreas = resolveSkillAreas(english);
  if (skillAreas.length === 0) {
    // 카드 0개 조기 반환 — 보드가 안 그려지므로 글씨 크기는 기본값이면 충분(ui_prefs 조회 전이다).
    return { ok: true, date, today, weekMonday: mondayOf(date), cards: [], hasAnyClass: false, canWrite, skillAreas, userId: user.id, tenantId: user.tenantId, fontSize: DEFAULT_ECS_FONT_SIZE, todayOrder: [], holidayName };
  }

  const supabase = await createClient();
  const admin = createAdminClient();

  // 반 목록 + 내 보기 설정(JJ 표시) — 서로 독립이라 병렬(B4). 필터가 뒤의 무거운 조회를 좁힌다.
  const [{ data: allClasses, error: classError }, prefsRes, nameIndex] = await Promise.all([
    supabase
      .from("classes")
      // english_track = Shouting 체크를 그릴지 판정(EiE 전용, 0230a) — 반 이름으로 추측 금지(english-track.ts).
      .select("id, class_name, teacher_id, english_track")
      .eq("subject", "english")
      .eq("is_active", true)
      .or(`closed_at.is.null,closed_at.gte.${date}`)
      .order("class_name"),
    // 표시 취향은 보는 사람(실제 계정) 것 — 쓰기(patchMyUiPrefs)와 같은 행(viewer-prefs.ts). 반 순서만 아래에서 화면 주인 것을 읽는다.
    loadViewerUiPrefs(),
    // 예약된 개명 — 위 둘과 독립이라 같은 묶음(B4). 요청 캐시라 다른 뷰가 또 물어도 왕복 0.
    getClassNameAsOfIndex(),
  ]);
  if (classError) return { ok: false, error: explainDbError(classError, { scope: "class-sheets.today.getEcsToday", fallback: "반 목록을 불러오지 못했습니다 — 잠시 후 다시 시도해 주세요" }).message };

  // 강사 스코프는 JS 교집합(스코프 id를 .in에 넣지 않는다 — 대량 .in 회피, B3). 게이트와 같은 세 갈래.
  // 위임 배지도 게이트와 **같은 소스**(ecsDelegatedClassIds, react cache라 추가 왕복 0 — 주간 랜딩과 동일).
  const [{ classIds: visibleIds }, delegatedIds] = await Promise.all([
    ecsVisibleClassFilter(),
    ecsDelegatedClassIds(),
  ]);
  const delegatedSet = new Set(delegatedIds);
  const scopeSet = visibleIds ? new Set(visibleIds) : null;
  const scoped = (allClasses ?? []).filter((c) => !scopeSet || scopeSet.has(c.id as string));
  const showSelfStudy = readEcsShowSelfStudy(prefsRes.data?.ui_prefs);
  const fontSize = readEcsFontSize(prefsRes.data?.ui_prefs);
  /**
   * 🔴 **'다른 강사 뷰'는 그 사람이 보는 화면 그대로**여야 한다(원장 2026-09-05 *"다른 사람 강사뷰는
   *    그 사람 뷰와 동일하게 해줘"*) — 순서도 **그 강사가 저장한 값**을 읽는다. 보는 사람(관리자) 값을
   *    쓰면 남의 화면을 내 취향으로 재배열해 놓고 "그 사람 화면"이라 부르게 된다.
   * ⚠️ 그 뷰가 아닐 땐 **왕복이 안 는다**(내 행은 위에서 이미 읽었다). 쓰기는 그 화면에서 아예 막는다
   *    (열람 전용 — 손잡이를 안 그린다).
   */
  const orderOwner = await viewAsTeacher();
  const orderPrefs = orderOwner
    ? (
        await admin
          .from("users")
          .select("ui_prefs")
          .eq("id", orderOwner.id)
          .eq("tenant_id", user.tenantId)
          .maybeSingle()
      ).data?.ui_prefs
    : prefsRes.data?.ui_prefs;
  const todayOrder = readEcsTodayOrder(orderPrefs);
  if (scoped.length === 0) {
    return { ok: true, date, today, weekMonday: mondayOf(date), cards: [], hasAnyClass: false, canWrite, skillAreas, userId: user.id, tenantId: user.tenantId, fontSize, todayOrder, holidayName };
  }
  const scopedIds = scoped.map((c) => c.id as string);

  // ── 그 날짜에 살아 있는 배치만(#88 — class_schedules는 운영 이력을 함께 담는다) ────────────────
  const schedules = await fetchInChunks<{
    class_id: string;
    start_time: string;
    end_time: string | null;
    slot_teacher_label: string | null;
    classroom_id: string | null;
    slot_room_label: string | null;
  }>(scopedIds, (chunk) =>
    supabase
      .from("class_schedules")
      // ⚠️ 라벨도 함께 읽는다 — FK가 빈 슬롯은 라벨이 유일한 단서다(주간 시트와 같은 규약).
      .select("class_id, start_time, end_time, slot_teacher_label, classroom_id, slot_room_label")
      .in("class_id", chunk)
      .eq("day_of_week", dow)
      .lte("valid_from", date)
      .or(`valid_to.is.null,valid_to.gte.${date}`),
  );

  // 자리(LAB·숨긴 JJ)는 화면에서 뺀다 — 주간 시트·작성률과 **같은 판정**(hiddenSeatOf).
  const slotsByClass = new Map<string, typeof schedules>();
  for (const s of schedules) {
    if (hiddenSeatOf(s.slot_teacher_label, showSelfStudy)) continue;
    const arr = slotsByClass.get(s.class_id) ?? [];
    arr.push(s);
    slotsByClass.set(s.class_id, arr);
  }
  const todayIds = scopedIds.filter((id) => (slotsByClass.get(id)?.length ?? 0) > 0);
  if (todayIds.length === 0) {
    return { ok: true, date, today, weekMonday: mondayOf(date), cards: [], hasAnyClass: true, canWrite, skillAreas, userId: user.id, tenantId: user.tenantId, fontSize, todayOrder, holidayName };
  }

  // 그날 보강 예약(0264a, fail-soft) — 독립 조회라 아래 큰 Promise.all과 함께 달리게 프라미스만 만들어 둔다(B4).
  const reservedTodayPromise = getReservationsOn(date, todayIds);
  // 수업 나누기(0351a, fail-soft) — 위와 같은 이유로 프라미스만 먼저(B4).
  const splitsTodayPromise = getSplitsOnDate(date, todayIds);
  const nativePromise = loadNativeParticipants({ session_date: date, limit: 500 }, { sharedRead: true });
  // 오늘 Shouting 체크(0230a) — EiE 카드의 교시 줄에 그린다.
  // 🔴 **여기가 강사 전원의 홈**이라 실패해도 죽으면 안 된다([[#95]]) — 표가 없으면 빈 맵으로 떨어진다.
  //    그래서 fetchInChunks(throw 규약)가 아니라 직접 청크를 돌며 error를 삼킨다.
  // ⚠️ 아래 큰 Promise.all과 **함께** 달리게 프라미스만 만들어 둔다(직렬 왕복을 얹지 않는다, B4).
  const shoutingPromise = (async () => {
    const out = new Map<string, string[]>();
    for (let i = 0; i < todayIds.length; i += 100) {
      const chunk = todayIds.slice(i, i + 100);
      const { data } = await admin
        .from("class_sheet_slot_flags")
        .select("class_id, slot_start, shouting")
        .eq("tenant_id", user.tenantId)
        .eq("flag_date", date)
        .in("class_id", chunk);
      for (const r of data ?? []) {
        if (!r.shouting) continue;
        const list = out.get(r.class_id as string) ?? [];
        list.push(shoutingKey(date, String(r.slot_start)).split("|")[1]!);
        out.set(r.class_id as string, list);
      }
    }
    return out;
  })();

  // ── 계획·학생기록·수강·출결·보고서·강의실·담당자 — 서로 독립이라 한 번에(B4) ────────────────────
  const [planLines, marks, enrollments, attendanceRaw, rooms, teachers, classnotePosts, classnoteBoards, boardSnapshot] = await Promise.all([
    fetchAllPagedInChunks<{
      id: string;
      class_id: string;
      plan_date: string;
      slot_start: string;
      term_mode: string;
      line_no: number;
      skill_area: string | null;
      textbook: string | null;
      page_range: string | null;
      progress: string | null;
      homework: string | null;
      updated_at: string;
    }>(todayIds, (chunk, from, to) =>
      admin
        .from("class_sheet_plan_lines")
        // id·updated_at은 **CAS 저장의 열쇠**다(주간 시트와 같은 경로로 고치려면 없어선 안 된다).
        .select(
          "id, class_id, plan_date, slot_start, term_mode, line_no, skill_area, textbook, page_range, progress, homework, updated_at",
        )
        .eq("tenant_id", user.tenantId)
        .in("class_id", chunk)
        .eq("plan_date", date)
        .order("id")
        .range(from, to),
    ),
    // 학생별 태도·특이사항(교시별) — 주간 시트가 쓰는 바로 그 표(`class_sheet_student_marks`).
    // 오늘 화면에서도 **같은 행**을 고친다(사본을 만들지 않는다 — 두 화면이 갈리면 어느 쪽이 진실인지 모른다).
    fetchAllPagedInChunks<{
      class_id: string;
      student_id: string;
      slot_start: string;
      status: string | null;
      progress_note: string | null;
      score?: string | null;
      listening_level?: string | null;
      memorized_words?: string | null;
    }>(todayIds, (chunk, from, to) =>
      admin
        .from("class_sheet_student_marks")
        // 🔴 `*`인 이유 = **여기가 강사 전원의 홈**이라 스키마 스큐에 죽으면 안 된다(#95). 열을 이름으로
        //    적으면 아직 없는 컬럼 하나에 PostgREST가 400을 내고 오늘 면이 통째로 안 열린다(2026-08-03
        //    실사고와 같은 모양). 이 조회는 그 날 하루치라 행이 적어 `*`가 싸다(주간 시트와 같은 판단).
        .select("*")
        .eq("tenant_id", user.tenantId)
        .in("class_id", chunk)
        .eq("mark_date", date)
        .order("id")
        .range(from, to),
    ),
    // 🔴 **출결 게이트(`checkStudentEligibleOn`)와 같은 조건이어야 한다** — 날짜·요일만 보고 명단을 만들면
    //    보류(on_hold)·전출(is_transferred)·퇴원(students.withdrawn_at) 학생이 목록에 뜨고, 출결을 찍는
    //    순간 서버가 "그 날짜에 이 반을 수강하지 않는 학생입니다"로 거절한다 = **"목록엔 뜨는데 못 찍음"**.
    //    (2026-08-07 적대적 리뷰. 실측 당시 해당 학생 0명이라 화면상 멀쩡했지만, 한 명만 생기면 바로 터진다.)
    fetchAllPagedInChunks<{
      class_id: string;
      student_id: string;
      attendance_days: string[] | null;
      start_date: string;
      end_date: string | null;
      on_hold: boolean;
      is_transferred: boolean | null;
      // PostgREST 임베드는 **배열**로 타이핑된다(!inner라 실제론 0~1개) — 아래에서 [0]로 읽는다.
      students: { withdrawn_at: string | null }[] | null;
    }>(todayIds, (chunk, from, to) =>
      supabase
        .from("enrollments")
        .select(
          "class_id, student_id, attendance_days, start_date, end_date, on_hold, is_transferred, students!inner(withdrawn_at)",
        )
        .in("class_id", chunk)
        .lte("start_date", date)
        .or(`end_date.is.null,end_date.gte.${date}`)
        .order("id")
        .range(from, to),
    ),
    fetchAllPagedInChunks<{
      class_id: string;
      student_id: string;
      status: string;
      note: string | null;
      recorded_at: string;
      id: string;
      session_date: string;
      // slot_start를 실어야 effective가 교시별로 갈리고, 취소가 실제 행의 slot을 넘길 수 있다(0196a).
      slot_start: string | null;
    }>(todayIds, (chunk, from, to) =>
      supabase
        .from("attendance_records")
        .select("id, class_id, student_id, status, note, recorded_at, session_date, slot_start")
        .in("class_id", chunk)
        .eq("session_date", date)
        .order("id")
        .range(from, to),
    ),
    fetchInChunks<{ id: string; name: string }>(
      [
        ...new Set(
          todayIds.flatMap((id) =>
            (slotsByClass.get(id) ?? []).map((s) => s.classroom_id).filter((v): v is string => !!v),
          ),
        ),
      ],
      (chunk) => supabase.from("classrooms").select("id, name").in("id", chunk),
    ),
    fetchInChunks<{ id: string; display_name: string | null }>(
      [
        ...new Set(
          scoped
            .filter((c) => todayIds.includes(c.id as string))
            .map((c) => c.teacher_id as string | null)
            .filter((v): v is string => !!v),
        ),
      ],
      (chunk) => supabase.from("users").select("id, display_name").in("id", chunk),
    ),
    // 그 날짜의 ClassNote 반 알림장(0140a — 워커가 피드에서 적재, 반 보드만 담긴다). 하루치는 보드당
    // 최대 1행이라 전량이어도 수십 행(#54 절단 아님 — 상한은 반 보드 수). 조회 실패는 배지만 잃으면 되므로
    // fail-soft(빈 목록) — 알림장 배지 때문에 오늘 보드 전체가 죽으면 안 된다.
    supabase
      .from("classnote_class_posts")
      .select("board_name")
      .eq("tenant_id", user.tenantId)
      .eq("posted_on", date)
      .then((r): { board_name: string }[] => (r.error ? [] : ((r.data ?? []) as { board_name: string }[]))),
    // 최근 45일 보드 우주 — "이 반에 연동된 보드가 있나 · 같은 키에 보드가 둘 아닌가"(3상 판정 재료).
    // 지금은 아래 보드 스냅샷과 겹쳐 '최근에 쓰인 보드'를 거르는 데 쓰고, 스냅샷이 비면 이것만으로 판정한다.
    // 보드×날짜 행이라 무페이징이면 곧 1,000행을 넘겨 조용히 잘린다(B2) → fetchAllPaged. 45일이면
    // 활성 반 보드는 전부 잡히고(주 2~5회 게시) 폐강 보드는 자연히 빠진다. 실패는 위와 같은 fail-soft.
    fetchAllPaged<{ board_name: string }>((from, to) =>
      supabase
        .from("classnote_class_posts")
        .select("board_name")
        .eq("tenant_id", user.tenantId)
        .gte("posted_on", addDays(today, -45))
        .order("board_name")
        .order("posted_on") // (board_name, posted_on) = 테넌트 안 PK — 페이지 경계가 흔들리지 않게
        .range(from, to),
    ).catch(() => [] as { board_name: string }[]),
    // 지금 있는 반 보드(0142a — 워커가 하루 1회 스냅샷, 보드 id당 1행)가 위 45일 기록보다 우선이다.
    // 게시 기록엔 **개명 전 이름이 남는다** — 강사가 바뀌어 `Elsa X`→`Green X`가 된 보드가 이름 둘로 보여
    // '키 모호'로 배지가 빠졌다(2026-10-13 실측 17개 반, 45일이 지나야 풀린다). 실패는 빈 목록 → 45일 기록으로.
    fetchAllPaged<{ board_id: number; board_name: string; child_count: number | null }>((from, to) =>
      supabase
        .from("classnote_boards")
        .select("board_id, board_name, child_count")
        .eq("tenant_id", user.tenantId)
        .order("board_id")
        .range(from, to),
    ).catch(() => [] as { board_id: number; board_name: string; child_count: number | null }[]),
  ]);

  // 보강(수업외) = 그 반 수강행은 없는데 그날 출결이 있는 학생. 반마다 가른다(A반 수강생이 B반 보강일 수 있다).
  // 🔴 **보강 예약**(0264a)된 학생도 같은 자리에 미리 선다(원장 2026-09-14 *"보강 추가 할 필요없이 미리 학생이 추가되어
  //    있어야"*) — 출결이 아직 없어도 오기로 한 사람이다. 조회는 fail-soft(표 없음 = 예약 없음).
  const reservedToday = await reservedTodayPromise;
  const splitsToday = await splitsTodayPromise;
  const nativeToday = participantsOrLegacy(await nativePromise);
  const attMakeupIds = new Set<string>();
  for (const classId of todayIds) {
    const enrolled = enrollments.filter((e) => e.class_id === classId).map((e) => e.student_id);
    const recorded = [
      ...attendanceRaw.filter((r) => r.class_id === classId).map((r) => r.student_id),
      ...reservedToday.filter((r) => r.classId === classId).map((r) => r.studentId),
      ...nativeToday.filter((r) => r.classId === classId).map((r) => r.studentId),
    ];
    for (const id of makeupStudentIds(recorded, enrolled)) attMakeupIds.add(id);
  }

  // 학생 이름은 수강 목록(+보강 출결)이 나온 뒤에야 알 수 있다 — 여기만 순차.
  const studentIds = [
    ...new Set([...enrollments.map((e) => e.student_id), ...attMakeupIds, ...splitIncomingIds(todayIds, date, splitsToday.splits)]),
  ];
  const studentRows = await fetchInChunks<{
    id: string;
    name: string;
    english_name: string | null;
    school: string | null;
    grade: string | null;
    // ⚠️ `english_name`은 **이미 있는 컬럼**이다(주간 시트 로스터가 그대로 읽는다) — 새 컬럼이 아니라
    //    [[#95]](마이그레이션보다 앱 먼저 배포) 위험이 없다.
  }>(studentIds, (chunk) =>
    supabase.from("students").select("id, name, english_name, school, grade").in("id", chunk),
  );

  // 보고서 상태 — 그 날짜·그 학생들.
  // ⚠️ **`class_id`로만 매칭하면 보강 보고서를 놓친다** — 원스크린은 보강을 `class_id=null` + `subject`로
  //    저장한다(unit_key가 `coalesce(class_id, subject)`라 같은 반 정규 보고서와 충돌하기 때문).
  //    그래서 학생 기준으로 한 번 더 훑어 `class_id is null AND subject='english'`도 '작성'으로 센다
  //    (2026-08-07 적대적 리뷰 — 안 그러면 보강을 써 놓고도 배지가 '미작성'이라 다시 쓰게 만든다).
  const [reports, subjectReports, anchoredMakeupReports] = await Promise.all([
    fetchAllPagedInChunks<{ student_id: string; class_id: string | null; classnote_status: string | null }>(
      todayIds,
      (chunk, from, to) =>
        supabase
          .from("lesson_reports")
          .select("student_id, class_id, classnote_status")
          .in("class_id", chunk)
          .eq("report_date", date)
          .order("id")
          .range(from, to),
    ),
    fetchAllPagedInChunks<{ student_id: string; classnote_status: string | null }>(
      studentIds,
      (chunk, from, to) =>
        supabase
          .from("lesson_reports")
          .select("student_id, classnote_status")
          .in("student_id", chunk)
          .is("class_id", null)
          .eq("subject", "english")
          .eq("report_date", date)
          .order("id")
          .range(from, to),
    ),
    // 원스크린이 어느 수업 시간에 한 보강인지 남겨 둔 행 — 출결보다 보고서가 먼저인 경우도 ECS에 보이게.
    fetchAllPagedInChunks<{ student_id: string; makeup_class_id: string | null; classnote_status: string | null }>(
      todayIds,
      (chunk, from, to) =>
        supabase
          .from("lesson_reports")
          .select("student_id, makeup_class_id, classnote_status")
          .in("makeup_class_id", chunk)
          .eq("makeup", true)
          .eq("report_date", date)
          .order("id")
          .range(from, to),
    ),
  ]);

  const roomName = new Map(rooms.map((r) => [r.id, r.name]));
  const teacherName = new Map(teachers.map((t) => [t.id, t.display_name]));
  // 보드명 → 비교키. 매칭은 작성률 화면(english-writing.ts)과 같은 키라 두 화면의 판정이 갈리지 않는다.
  // 단 **판정의 쓰임이 다르다** — 작성률은 주간 합계라 다대일 키가 값을 부풀릴 뿐이지만, 여기는 "오늘
  // 올렸나"는 당일 행동 트리거라 남의 반 게시가 내 배지를 끄면 그 반 알림장이 그날 안 나간다. 그래서
  // 한 키에 보드가 2개 이상이면(실측 "Let's Speak 5" 두 요일그룹) 판정 불가로 뺀다(untracked).
  const postedBoardKeys = new Set(classnotePosts.map((p) => boardKey(p.board_name)));
  // 보드 목록 = **스냅샷(지금 이름) ∩ 최근 45일에 글이 있는 보드**. 스냅샷만 쓰면 안 쓰는 옛 보드(원아가 남은
  // 폐강·옛 레벨 보드)가 끝까지 남아 그 반에 지울 수 없는 '미게시'가 뜨고, 45일 기록만 쓰면 개명 전 이름이
  // 남아 '키 모호'가 된다 — 둘을 겹치면 둘 다 막힌다. 원아 0명 보드는 '보드 없음'과 같다(올려도 받을 사람이
  // 없다, 실측 고3 정규). 세는 단위는 보드 id(이름이 같은 보드 둘도 '모호'로 잡힌다). 스냅샷이 비면 45일 기록.
  const recentBoardNames = new Set(classnoteBoards.map((b) => b.board_name.trim()));
  const boardUniverse =
    boardSnapshot.length > 0
      ? boardSnapshot
          .filter((b) => b.child_count !== 0 && recentBoardNames.has(b.board_name.trim()))
          .map((b) => ({ name: b.board_name, id: `board:${b.board_id}` }))
      : classnoteBoards.map((b) => ({ name: b.board_name, id: b.board_name.trim() }));
  const boardsByKey = new Map<string, Set<string>>();
  for (const b of boardUniverse) {
    const k = boardKey(b.name);
    const set = boardsByKey.get(k) ?? new Set<string>();
    set.add(b.id);
    boardsByKey.set(k, set);
  }
  const classnoteStateOf = (className: string): "posted" | "pending" | "untracked" => {
    const k = classKey(className);
    const boards = boardsByKey.get(k);
    if (!boards || boards.size >= 2) return "untracked"; // 연동 이력 없음 또는 키 모호 — 배지 미표시
    return postedBoardKeys.has(k) ? "posted" : "pending";
  };
  const studentMeta = new Map(studentRows.map((s) => [s.id, s]));
  const missingMakeup = [...new Set(anchoredMakeupReports.map((r) => r.student_id))].filter((id) => !studentMeta.has(id));
  if (missingMakeup.length > 0) {
    const extra = await fetchInChunks<{
      id: string;
      name: string;
      english_name: string | null;
      school: string | null;
      grade: string | null;
    }>(missingMakeup, (chunk) =>
      supabase.from("students").select("id, name, english_name, school, grade").in("id", chunk),
    );
    for (const s of extra) studentMeta.set(s.id, s);
  }
  // 교시 라벨 표 — 주간 시트(queries.ts)와 **같은 폴백 체인**(과목 전용 → english 내장 → 전역).
  const periodsConfig = settingsToPeriodsConfig(settings.operations);
  const periodTables = {
    weekday: tableToEntries(weekdayTableFor("english", periodsConfig)),
    weekend: tableToEntries(periodsConfig.weekend),
  };
  const weekend = isWeekendDow(dow);

  // 출결 effective(최신 recorded_at, tie는 id) — 출석부·시트와 **같은 축약 함수**를 쓴다.
  // slot_start를 실었으므로 교시별 행이 각각 살아남는다(0196a). 화면은 하루 한 값이라
  // (반|학생)별 **가장 최근** 행을 표시값으로 고르고, 취소를 위해 전 행의 slot 원본을 함께 나른다.
  const effective = effectiveAttendanceRecords(attendanceRaw);
  const attByKey = new Map<string, (typeof effective)[number]>();
  const attSlotsByKey = new Map<string, (string | null)[]>();
  for (const r of effective) {
    const key = `${r.class_id}|${r.student_id}`;
    const prev = attByKey.get(key);
    if (
      !prev ||
      r.recorded_at > prev.recorded_at ||
      (r.recorded_at === prev.recorded_at && r.id > prev.id)
    ) {
      attByKey.set(key, r);
    }
    const slots = attSlotsByKey.get(key) ?? [];
    slots.push(r.slot_start ?? null);
    attSlotsByKey.set(key, slots);
  }
  const reportByKey = new Map<string, { written: boolean; sent: boolean }>();
  for (const r of reports) {
    const key = `${r.class_id}|${r.student_id}`;
    const prev = reportByKey.get(key);
    reportByKey.set(key, {
      written: true,
      sent: (prev?.sent ?? false) || r.classnote_status === "success",
    });
  }
  // 반이 없는(보강) 영어 보고서 — 학생 단위라 그 학생이 오늘 듣는 **모든 영어 반**에 같은 상태를 얹는다.
  // 과목 단위 저장이라 그게 그 값의 의미다(어느 반의 보강인지 DB가 구분하지 않는다).
  const subjectReportByStudent = new Map<string, { written: boolean; sent: boolean }>();
  for (const r of subjectReports) {
    const prev = subjectReportByStudent.get(r.student_id);
    subjectReportByStudent.set(r.student_id, {
      written: true,
      sent: (prev?.sent ?? false) || r.classnote_status === "success",
    });
  }

  const attendanceWritable =
    (await canWriteTenant(user.systemRole, "attendance")) &&
    (!(await attendanceWindowApplies(user.systemRole)) || isWithinAttendanceEditWindow(date, today));
  // ↑ 7일 창 = 출석 권한 단계(서버 액션과 같은 판정 — 화면과 서버가 갈리면 켜진 단추가 거절된다, 4-5 리뷰).
  // 담당 반 게이트를 **서버 액션과 같은 소스**(`userTaughtClassSet` = 담임 ∪ 위임 ∪ 교시 담당)로 미리
  // 반영한다. full(관리자 계열)은 반 제한 없음.
  // 🔴 2026-08-19 원장 확인 *"'오늘'에 나온 본인 수업은 전부 출결 가능해야 한다"* — 종전엔 여기서
  //    `getTeachingClassIds`(담임 ∪ 위임)만 봐서, **교시 담당(부담임)으로 오늘 면에 뜬 반의 출결이
  //    화면에서만 잠겨** 있었다. 정작 서버 액션은 2026-08-18(write-gate-axis)부터 교시 담당을 통과시키므로
  //    이 잠금은 "서버는 허락하는데 화면이 막는" 거짓 잠금이었다(#77의 뒤집힌 꼴).
  // ⚠️ 두 축을 다시 갈라 놓지 말 것 — 넓히려면 액션 쪽(`userTaughtClassSet`)을 고치고 여기가 따라온다.
  const attendanceScoped = (await accessLevelTenant(user.systemRole, "attendance")) === "scoped";
  const teachingSet =
    attendanceWritable && attendanceScoped
      ? await userTaughtClassSet(supabase, user.id, date)
      : null;

  // 학생 기록 — (반|학생)당 교시별. 시각은 배치와 **같은 정규화**를 거쳐야 키가 맞는다("15:00:00" ↔ "15:00").
  const marksByStudent = new Map<string, Record<string, SheetMark>>();
  for (const m of marks) {
    const key = `${m.class_id}|${m.student_id}`;
    const slot = normalizeSlotTime(m.slot_start);
    const cur = marksByStudent.get(key) ?? {};
    cur[slot] = {
      status: m.status,
      progressNote: m.progress_note,
      // 마이그레이션(0202a·0206a) 적용 전엔 컬럼이 없어 undefined → null(빈 칸). 위 select가 `*`인 이유.
      score: m.score ?? null,
      listeningLevel: m.listening_level ?? null,
      memorizedWords: m.memorized_words ?? null,
    };
    marksByStudent.set(key, cur);
  }

  const shoutingByClass = await shoutingPromise;

  const linesByKey = new Map<string, typeof planLines>();
  for (const l of planLines) {
    const key = `${l.class_id}|${normalizeSlotTime(l.slot_start)}`;
    const arr = linesByKey.get(key) ?? [];
    arr.push(l);
    linesByKey.set(key, arr);
  }

  const cards: TodayClassCard[] = todayIds
    .map((classId) => {
      const cls = scoped.find((c) => c.id === classId)!;
      const slotRows = (slotsByClass.get(classId) ?? [])
        .slice()
        .sort((a, b) => normalizeSlotTime(a.start_time).localeCompare(normalizeSlotTime(b.start_time)));
      const slots: TodaySlot[] = slotRows.map((s) => {
        const start = normalizeSlotTime(s.start_time);
        const end = s.end_time ? normalizeSlotTime(s.end_time) : null;
        const lines = (linesByKey.get(`${classId}|${start}`) ?? [])
          .slice()
          .sort((a, b) => a.line_no - b.line_no)
          .map((l) => ({
            id: l.id,
            planDate: l.plan_date,
            slotStart: start,
            termMode: l.term_mode,
            lineNo: l.line_no,
            skillArea: l.skill_area,
            textbook: l.textbook,
            pageRange: l.page_range,
            progress: l.progress,
            homework: l.homework,
            updatedAt: l.updated_at,
            filled: isMeaningfulPlanLine({
              textbook: l.textbook,
              pageRange: l.page_range,
              progress: l.progress,
              homework: l.homework,
            }),
          }));
        return {
          slotStart: start,
          slotEnd: end,
          teacherLabel: s.slot_teacher_label ?? null,
          periodLabel: resolvePeriodLabel(start, end, periodTables, weekend),
          // 🔴 FK 이름이 먼저, 없으면 라벨을 등록된 이름으로 맞춘다 — 주간·월간 시트와 **같은 두 함수**.
          roomLabel: canonicalRoomName(
            resolveRoomName({
              slotClassroomName: s.classroom_id ? (roomName.get(s.classroom_id) ?? null) : null,
              slotRoomLabel: s.slot_room_label,
            }),
            [...roomName.values()],
          ),
          lines,
          // 폼은 자리 라벨이 정한다 — 주간 시트와 같은 함수(반 이름·강의실로 추측 금지).
          form: rosterFormOf(s.slot_teacher_label),
        };
      });

      // 그 날 실제 수강 대상 — **출결 게이트와 같은 판정**(기간·보류·전출·퇴원 + 분리등원 요일).
      const roster = enrollments
        .filter(
          (e) =>
            e.class_id === classId &&
            !((e.students?.[0]?.withdrawn_at ?? null) !== null && e.students![0]!.withdrawn_at! < date) &&
            isEnrollmentActiveOn(
              {
                startDate: e.start_date,
                endDate: e.end_date,
                onHold: e.on_hold,
                isTransferred: e.is_transferred ?? undefined,
              },
              date,
            ) &&
            enrollmentAttendsOnDay(e.attendance_days, dow),
        )
        .map((e) => {
          const meta = studentMeta.get(e.student_id);
          const att = attByKey.get(`${classId}|${e.student_id}`);
          const rep = reportByKey.get(`${classId}|${e.student_id}`);
          const subjRep = subjectReportByStudent.get(e.student_id);
          return {
            studentId: e.student_id,
            name: meta?.name ?? "(이름 없음)",
            englishName: meta?.english_name ?? null,
            school: meta?.school ?? null,
            grade: meta?.grade ?? null,
            attendance: att?.status ?? null,
            attendanceNote: att?.note ?? null,
            attendanceSlots: attSlotsByKey.get(`${classId}|${e.student_id}`) ?? [],
            reportWritten: (rep?.written ?? false) || (subjRep?.written ?? false),
            reportSent: (rep?.sent ?? false) || (subjRep?.sent ?? false),
            marks: marksByStudent.get(`${classId}|${e.student_id}`) ?? {},
            isMakeup: false,
          };
        })
        .sort((a, b) => a.name.localeCompare(b.name, "ko"));

      const enrolledIds = roster.map((s) => s.studentId);
      // 출결이 있는 학생 + 그날 이 반에 **보강 예약된** 학생(0264a) — 같은 규약(`makeupStudentIds`)으로 보강 행이 된다.
      const recordedIds = [
        ...attendanceRaw.filter((r) => r.class_id === classId).map((r) => r.student_id),
        ...reservedToday.filter((r) => r.classId === classId).map((r) => r.studentId),
        ...nativeToday.filter((r) => r.classId === classId).map((r) => r.studentId),
      ];
      const reportMakeupIds = anchoredMakeupReports
        .filter((r) => r.makeup_class_id === classId)
        .map((r) => r.student_id);
      const makeupIds = [
        ...new Set([...makeupStudentIds(recordedIds, enrolledIds), ...makeupStudentIds(reportMakeupIds, enrolledIds)]),
      ];
      const makeupRows = makeupIds.map((id) => {
        const meta = studentMeta.get(id);
        const att = attByKey.get(`${classId}|${id}`);
        const rep = reportByKey.get(`${classId}|${id}`);
        const subjRep = subjectReportByStudent.get(id);
        const anchored = anchoredMakeupReports.find((r) => r.student_id === id && r.makeup_class_id === classId);
        return {
          studentId: id,
          name: meta?.name ?? "(이름 없음)",
          englishName: meta?.english_name ?? null,
          school: meta?.school ?? null,
          grade: meta?.grade ?? null,
          attendance: att?.status ?? null,
          attendanceNote: att?.note ?? null,
          attendanceSlots: attSlotsByKey.get(`${classId}|${id}`) ?? [],
          reportWritten: (rep?.written ?? false) || (subjRep?.written ?? false) || !!anchored,
          reportSent:
            (rep?.sent ?? false) || (subjRep?.sent ?? false) || anchored?.classnote_status === "success",
          marks: marksByStudent.get(`${classId}|${id}`) ?? {},
          isMakeup: true,
        };
      });

      // 🔴 이 화면은 **날짜 단위**라 그 날짜의 이름으로 정확히 가른다(주 단위인 랜딩·시트와 다른 축).
      const renamed = resolveClassNameAsOf(nameIndex, classId, date, cls.class_name as string);
      return {
        classId,
        className: renamed?.name ?? (cls.class_name as string),
        ...(renamed ? { classNameBefore: renamed.before, classNameChangeDate: renamed.date } : {}),
        teacherName: cls.teacher_id ? (teacherName.get(cls.teacher_id as string) ?? null) : null,
        startsAt: slots[0]?.slotStart ?? "00:00",
        endsAt: slots.at(-1)?.slotEnd ?? null,
        slots,
        // 수업 나누기 — 원래 반 행엔 표식/제외, 받는 반엔 행 추가(split-card.ts 단일 규약).
        students: applySplitsToCard({
          classId,
          date,
          slots: slots.map((sl) => ({ start: sl.slotStart, end: sl.slotEnd })),
          students: appendMakeupStudents(roster, makeupRows),
          splits: splitsToday.splits,
          names: splitsToday.classNames,
          hasRecord: (sid) => attByKey.has(`${classId}|${sid}`) || marksByStudent.has(`${classId}|${sid}`),
          makeRow: (sid) => {
            const meta = studentMeta.get(sid);
            const att = attByKey.get(`${classId}|${sid}`);
            const rep = reportByKey.get(`${classId}|${sid}`);
            return {
              studentId: sid,
              name: meta?.name ?? "(이름 없음)",
              englishName: meta?.english_name ?? null,
              school: meta?.school ?? null,
              grade: meta?.grade ?? null,
              attendance: att?.status ?? null,
              attendanceNote: att?.note ?? null,
              attendanceSlots: attSlotsByKey.get(`${classId}|${sid}`) ?? [],
              reportWritten: rep?.written ?? false,
              reportSent: rep?.sent ?? false,
              marks: marksByStudent.get(`${classId}|${sid}`) ?? {},
              isMakeup: false,
            };
          },
        }),
        fill: { total: slots.length, filled: slots.filter((s) => s.lines.some((l) => l.filled)).length },
        canMarkAttendance: attendanceWritable && (teachingSet === null || teachingSet.has(classId)),
        // 담임이 나면 위임이 아니다 — 주간 시트·랜딩 카드와 같은 판정.
        delegated: delegatedSet.has(classId) && cls.teacher_id !== user.id,
        // 🔴 **DB 이름 그대로** 넘긴다 — 이 값은 표시가 아니라 ClassNote **보드 매칭 키**다(classKey).
        //    미래 이름을 먹이면 그 반 보드를 못 찾아 배지가 조용히 '연동 없음'이 된다.
        // ClassNote 기능이 꺼진 학원 = 알림장 배지 없음("untracked" = 미표시, 2026-09-30).
        // 그날 정규 명단이 비면 받을 학생이 없어 할 일이 아니다 — 작성률·운영실과 같은 취지(english-class-presence.ts).
        // (명단 판정은 이 화면 것이라 테스트 학생 포함·퇴원일 반영이 저쪽과 조금 다르다.)
        classnoteToday: classnoteOn && roster.length > 0 ? classnoteStateOf(cls.class_name as string) : "untracked",
        isEie: eieOn && readEnglishTrack(cls) === "eie",
        shoutingSlots: shoutingByClass.get(classId) ?? [],
        // 그 반의 오늘 계획 행 중 위 slots에 실리지 않은 것 = 안 그리는 기록(고아 시각 or 자리).
        hiddenLines:
          planLines.filter((l) => l.class_id === classId).length -
          slots.reduce((n, s) => n + s.lines.length, 0),
        // 학생 기록도 같은 실종이 가능하다(교시가 바뀐 날의 태도·특이사항) — 각주로만 알린다.
        hiddenMarks: marks.filter(
          (m) =>
            m.class_id === classId &&
            !slots.some((s) => s.slotStart === normalizeSlotTime(m.slot_start)),
        ).length,
      };
    })
    // 시간표 순서 = 그 날 일과 순서. 같은 시각이면 반 이름으로 안정 정렬.
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt) || a.className.localeCompare(b.className, "ko"));

  return { ok: true, date, today, weekMonday: mondayOf(date), cards, hasAnyClass: true, canWrite, skillAreas, userId: user.id, tenantId: user.tenantId, fontSize, todayOrder, holidayName };
}
