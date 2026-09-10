import "server-only";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchInChunks } from "@/lib/supabase/batch";
import { effectiveAttendanceRecords } from "@/features/attendance/effective-records";
import { isEnrollmentActiveOn } from "@/features/enrollments/eligibility";
import { DOW_KEYS, dowIndexOf, resolveAttendDows } from "@/features/attendance/calendar";
import { specialSlotLabel } from "@/features/timetable/lib/teacher-label";
import {
  groupByStart,
  hhmm,
  isPayrollSeat,
  PIN_NOTE_SEATS,
  SEAT_DB_LABEL,
  type SeatKey,
  type SeatPeriod,
  type SeatSlot,
} from "../seat";
import type { SeatVisiting } from "../period-choice";

export type SeatStudent = {
  id: string;
  name: string;
  school: string | null;
  grade: string | null;
  /** 그 교시에 저장된 상태. null = 미체크(= 기록 없음, **결석이 아니다**). */
  status: "present" | "absent" | "late" | null;
  /** 누가 찍었나(표시용). 기록이 없으면 null. */
  recordedBy: string | null;
  /** 자리에서 찍힌 기록인가 — 반 출석부에서 찍힌 기록과 구분해 보여준다(시수 귀속이 다르다). */
  fromSeat: boolean;
  /**
   * 그 칸에 적힌 사유 메모(`attendance_records.note`) — 카드 아래 한 줄 + 마우스 오버(원장 2026-08-28·09-10).
   * 🔴 **비로그인 PIN 경로는 `PIN_NOTE_SEATS`(랩실)만 채운다** — 원장 2026-09-10 *"읽기·쓰기 둘 다 열기"*.
   *    그 밖의 자리 PIN은 여전히 null이다(병원·수술·가족 일정이 그대로 적힌다, 아래 select 분기).
   */
  note: string | null;
  /**
   * JJ 전용 칸 — 영어 시트 JJ 폼과 **같은 행**(`class_sheet_student_marks`). 랩실은 항상 null.
   * 🔴 `attitude`는 marks의 `status`(태도 5단 눈금)다 — 위 `status`(출결)와 **다른 축**이다.
   */
  attitude: string | null;
  listeningLevel: string | null;
  memorizedWords: string | null;
  progressNote: string | null;
};

export type SeatClassRoster = {
  classId: string;
  className: string;
  /** "HH:MM" — 같은 교시라도 반마다 다를 수 있다. */
  end: string;
  /**
   * 학원설정이 아니라 **반이 들고 있는 색**(`classes.bg_color`/`text_color`, ijw 패리티) — 시간표
   * 카드 헤더가 쓰는 것과 **같은 소스**다(원장 2026-09-10 *"반이름은 설정된 반색상으로 색칠해주고"*).
   * 🔴 null이면 칠하지 않는다 — 지어낸 색은 반을 잘못 알아보게 만든다.
   */
  bgColor: string | null;
  textColor: string | null;
  students: SeatStudent[];
  /**
   * **다른 시간에서 옮겨 온 학생 묶음**이면 원래 반의 자리 교시들(교시 선택 0255a, 원장 2026-09-10 *"다른
   * 시간으로 이동"*). 이 교시엔 그 반 슬롯이 없으므로 `end`는 원래 교시의 끝이다(화면이 안 적는다).
   * 🔴 반 id·이름·색은 **원래 반** 것이다 — 출결이 원래 반으로 저장되므로 화면도 그 반 이름을 단다.
   * 조회(`loadSeatDay`)는 이 칸을 채우지 않는다 — [`applySeatPeriodChoicesByPeriod`](../period-choice.ts)가 만든다.
   */
  visiting?: SeatVisiting | null;
};

export type SeatDay = {
  date: string;
  /** 교시(시작시각 오름차순). 그 날 자리 수업이 없으면 빈 배열. */
  periods: SeatPeriod[];
  /** 교시 start("HH:MM") → 반별 명단. */
  rosterByPeriod: Record<string, SeatClassRoster[]>;
  /**
   * 반 id → 그 날 이 자리에 걸린 교시 시작시각(오름차순, 중복 없음).
   * 🔑 **교시 선택**(0255a)의 재료다 — 하루에 자리 수업이 두 번 있는 반에서만 고를 것이 생긴다
   *    (실측 8개 반×요일). 새 조회가 아니라 위 `periods`를 반 축으로 뒤집은 것이다.
   */
  slotsByClass: Record<string, string[]>;
  /**
   * `반id|학생id` → 그 날 이 자리에서 **이미 기록이 있는** 교시들.
   * 🔴 교시 선택이 **사실을 못 덮게** 하는 재료다([`period-choice.ts`](../period-choice.ts)) — 기록이 있는
   *    교시에서는 감추지 않는다. 교시가 안 붙은 날 단위 행(`slot_start` null)은 담지 않는다.
   */
  markedSlotsByCell: Record<string, string[]>;
  /**
   * 반 id → 그 날 이 반의 **다른**(이 자리가 아닌) 수업 시작 — 교시 이동의 **겹침 방지** 재료.
   * 🔴 그 시각으로 옮기면 자리 기록과 반 수업 기록이 같은 `(반·학생·날짜·교시)` 키가 되어 서로를 덮는다.
   */
  busyStartsByClass: Record<string, string[]>;
  /**
   * `반id|학생id` → 교시 → **그 반의 이 자리 교시 밖**에서 이미 찍힌 이 자리 기록(다른 시간으로 옮겨 가서
   * 찍힌 것). 사실이 규칙을 이긴다 — 교시 선택이 지워져도 이 기록은 그 교시에 선다.
   */
  offSlotByCell: Record<string, Record<string, SeatStudent>>;
};

function toSeatStudent(
  s: { id: string; name: string; school: string | null; grade: string | null },
  rec:
    | {
        status: "present" | "absent" | "late";
        seat_label: string | null;
        note?: string | null;
        recorder?: { display_name: string | null }[] | { display_name: string | null };
      }
    | undefined,
): SeatStudent {
  const recorder = Array.isArray(rec?.recorder) ? rec.recorder[0] : rec?.recorder;
  return {
    id: s.id,
    name: s.name,
    school: s.school,
    grade: s.grade,
    status: rec?.status ?? null,
    recordedBy: recorder?.display_name ?? null,
    fromSeat: !!rec?.seat_label,
    note: rec?.note ?? null,
    attitude: null,
    listeningLevel: null,
    memorizedWords: null,
    progressNote: null,
  };
}

/**
 * 자리(랩실·JJ실) 하루치 명단 — **그 날짜에 유효한** 슬롯만 읽는다.
 *
 * 🔴 `class_schedules`는 운영 이력을 함께 담는다(만료 행 다수). "현재 유효"로 고정 필터하면 **지난
 *    날짜를 열었을 때 그 날의 배치가 아니라 오늘 배치가 나온다** — 출결을 엉뚱한 반에 찍게 된다.
 * 🔴 묶는 키는 **자리 라벨**이지 방 이름이 아니다. JJ실은 방 표기가 `305`·`본원305`로 갈려 있어
 *    (실측 각 23행) 방 이름으로 묶으면 한 방이 두 개로 쪼개진다.
 * ⚠️ 라벨 원문은 `이주희`·`랩실` 같은 별칭도 쓰인다 → 문자열 비교 대신 `specialSlotLabel`(단일 소스)로
 *    판정한다. 그래서 쿼리는 라벨이 있는 그 요일 슬롯을 받아 JS에서 거른다(한 요일치라 수십~백 행).
 */
/** 로그인 자리 출석부 — 세션 클라이언트(RLS). */
export async function getSeatDay(seat: SeatKey, date: string): Promise<SeatDay> {
  return loadSeatDay(await createClient(), seat, date, null);
}

/**
 * 비로그인 PIN 화면 — admin + **명시 tenantId**(RLS 우회라 필터가 필수).
 * 학생은 이름·학교·학년만 고른다(전화번호 없음).
 */
export async function getPublicSeatDay(
  tenantId: string,
  seat: SeatKey,
  date: string,
): Promise<SeatDay> {
  return loadSeatDay(createAdminClient(), seat, date, tenantId);
}

async function loadSeatDay(
  supabase: Awaited<ReturnType<typeof createClient>> | ReturnType<typeof createAdminClient>,
  seat: SeatKey,
  date: string,
  tenantId: string | null,
): Promise<SeatDay> {
  const dowKey = DOW_KEYS[new Date(`${date}T00:00:00Z`).getUTCDay()]!;
  const wantLabel = SEAT_DB_LABEL[seat];

  let slotQ = supabase
    .from("class_schedules")
    .select("class_id, start_time, end_time, slot_teacher_label")
    .eq("day_of_week", dowKey)
    .not("slot_teacher_label", "is", null)
    .lte("valid_from", date)
    .or(`valid_to.is.null,valid_to.gte.${date}`);
  if (tenantId) slotQ = slotQ.eq("tenant_id", tenantId);
  const { data: rawSlots } = await slotQ;

  const seatRows = (rawSlots ?? []).filter((r) => specialSlotLabel(r.slot_teacher_label) === wantLabel);
  if (seatRows.length === 0)
    return {
      date,
      periods: [],
      rosterByPeriod: {},
      slotsByClass: {},
      markedSlotsByCell: {},
      busyStartsByClass: {},
      offSlotByCell: {},
    };

  const classIds = [...new Set(seatRows.map((r) => r.class_id as string))];

  // 반 이름 · 수강생 · 그날 출결 — 서로 독립이라 병렬(B4). id 수십 개까지 갈 수 있어 청크 헬퍼(B3).
  const [classes, enrollments, records] = await Promise.all([
    // 🔵 `bg_color`/`text_color`는 **이미 있는 컬럼**(0054a 계열)이라 새 스키마를 요구하지 않는다([[#95]]).
    fetchInChunks<{ id: string; class_name: string; bg_color: string | null; text_color: string | null }>(
      classIds,
      (chunk) => {
        let q = supabase.from("classes").select("id, class_name, bg_color, text_color").in("id", chunk);
        if (tenantId) q = q.eq("tenant_id", tenantId);
        return q;
      },
    ),
    // ⚠️ PostgREST 임베드는 타입상 **배열**로 온다(실제로는 1건) — 아래에서 첫 원소로 접는다.
    fetchInChunks<{
      class_id: string;
      start_date: string;
      end_date: string | null;
      on_hold: boolean | null;
      is_transferred: boolean | null;
      attendance_days: string[] | null;
      student: { id: string; name: string; school: string | null; grade: string | null }[];
    }>(classIds, (chunk) =>
      (() => {
        // 🔴 아래 날짜 조건은 **넓은 프리필터**일 뿐이다(1000행 캡 회피, [[#54]]) — 최종 판정은
        //    `isEnrollmentActiveOn`이 한다. `end_date >= 오늘`만 걸면 **반이동 학생이 옛 반에 하루 더
        //    남는다**: 이동 RPC가 옛 수강을 `end_date = 적용일`로 닫는데(daterange가 `[start, end)`)
        //    이 비교는 종료일을 포함하기 때문이다. 2026-09-01 실측 — 9/1 이동 12명이 JJ·LAB 명단에
        //    옛 반·새 반 양쪽으로 섰다(반 상세·반별 출석부는 이미 규약을 타서 갈렸다).
        let q = supabase
          .from("enrollments")
          .select(
            "class_id, start_date, end_date, on_hold, is_transferred, attendance_days, student:student_id ( id, name, school, grade )",
          )
          .in("class_id", chunk)
          .not("on_hold", "is", true)
          .lte("start_date", date)
          .or(`end_date.is.null,end_date.gte.${date}`);
        if (tenantId) q = q.eq("tenant_id", tenantId);
        return q;
      })(),
    ),
    fetchInChunks<{
      id: string;
      class_id: string;
      student_id: string;
      session_date: string;
      slot_start: string | null;
      status: "present" | "absent" | "late";
      seat_label: string | null;
      recorded_at: string;
      /** 사유 메모 — 로그인 화면 + `PIN_NOTE_SEATS`(랩실) PIN에서만 채워진다(아래 분기 주석). */
      note?: string | null;
      /** 로그인 화면에서만 채워진다 — 공개(PIN) 경로는 아예 조회하지 않는다(아래 주석). */
      recorder?: { display_name: string | null }[];
    }>(classIds, (chunk) =>
      // 🔴 공개(PIN) 경로에선 **직원 이름은 아예 안 가져온다** — 로그인 없이 열리는 페이지로 직원 신상이 건너가는
      //    것 자체를 막는다(나중에 누가 그리면 끝).
      // 🔴 **사유 메모(`note`)는 `PIN_NOTE_SEATS`(랩실) PIN에서만** 싣는다 — 원장 2026-09-10 *"seat/lab에서도 자리
      //    출석부와 동일해야해"* → 메모를 PIN에서 *"읽기·쓰기 둘 다 열기"*. 메모엔 `병원`·`수술`·`가족여행`이 그대로
      //    적혀 있어(실데이터) **자리마다 따로** 연다 — 그 밖의 자리 PIN은 여전히 조회조차 안 한다(화면이 안 그려도
      //    페이지 소스로 건너가므로 "안 그리면 된다"가 아니다).
      //    tenantId가 넘어온 경로 = admin 클라이언트 = 공개 경로다.
      //    ⚠️ select 문자열을 삼항으로 만들면 PostgREST 타입 파서가 못 읽는다 → 분기를 통째로 나눈다.
      tenantId && PIN_NOTE_SEATS.includes(seat)
        ? supabase
            .from("attendance_records")
            .select("id, class_id, student_id, session_date, slot_start, status, seat_label, recorded_at, note")
            .in("class_id", chunk)
            .eq("session_date", date)
            .eq("tenant_id", tenantId)
        : tenantId
          ? supabase
              .from("attendance_records")
              .select("id, class_id, student_id, session_date, slot_start, status, seat_label, recorded_at")
              .in("class_id", chunk)
              .eq("session_date", date)
              .eq("tenant_id", tenantId)
          : supabase
              .from("attendance_records")
              .select(
                "id, class_id, student_id, session_date, slot_start, status, seat_label, recorded_at, note, recorder:recorded_by ( display_name )",
              )
              .in("class_id", chunk)
              .eq("session_date", date),
    ),
  ]);

  const nameById = new Map(classes.map((c) => [c.id, c.class_name]));
  /** 반 색 — 시간표 카드 헤더와 같은 소스(`classes.bg_color`/`text_color`). 없으면 안 칠한다. */
  const colorById = new Map(classes.map((c) => [c.id, { bg: c.bg_color, text: c.text_color }]));
  const slots: SeatSlot[] = seatRows.map((r) => ({
    classId: r.class_id as string,
    className: nameById.get(r.class_id as string) ?? "(이름 없는 반)",
    start: r.start_time as string,
    end: r.end_time as string,
  }));
  const periods = groupByStart(slots);

  // 반별 그 요일 수업요일 — 분리등원(attendance_days)이 있는 학생은 그날 오는 학생만 명단에 올린다.
  const classDows = new Map<string, number[]>();
  for (const r of seatRows) {
    const list = classDows.get(r.class_id as string) ?? [];
    const i = dowIndexOf(dowKey);
    if (i >= 0 && !list.includes(i)) list.push(i);
    classDows.set(r.class_id as string, list);
  }
  const todayIdx = dowIndexOf(dowKey);

  type Enrolled = { id: string; name: string; school: string | null; grade: string | null };
  const studentsByClass = new Map<string, Enrolled[]>();
  for (const e of enrollments) {
    const s = (Array.isArray(e.student) ? e.student[0] : e.student) as Enrolled | null | undefined;
    if (!s) continue;
    // 종료·시작 규약은 eligibility 단일 소스가 판정한다(위 쿼리 주석 참조) — 여기서 다시 쓰지 말 것.
    if (
      !isEnrollmentActiveOn(
        {
          startDate: e.start_date,
          endDate: e.end_date,
          onHold: e.on_hold === true,
          isTransferred: e.is_transferred === true,
        },
        date,
      )
    )
      continue;
    const dows = resolveAttendDows(e.attendance_days, classDows.get(e.class_id) ?? []);
    if (dows.length > 0 && !dows.includes(todayIdx)) continue;
    const list = studentsByClass.get(e.class_id) ?? [];
    if (!list.some((x) => x.id === s.id)) list.push(s); // 재등록으로 행이 여럿이어도 한 번만
    studentsByClass.set(e.class_id, list);
  }

  // 교시별 유효행(정정 이력에서 최신 1건) — 교시가 키에 들어가야 같은 날 두 교시가 안 뭉갠다.
  const effective = effectiveAttendanceRecords(records);
  const recByKey = new Map<string, (typeof records)[number]>();
  for (const r of effective) recByKey.set(`${r.class_id}|${r.student_id}|${hhmm(r.slot_start)}`, r);
  // 🔴 비급여 자리(JJ실)는 자리 기록이 **담임 출석과 같은 사실**이다(seat_label 없이 저장 = 담임 시수).
  //    그래서 담임이 원스크린에서 먼저 찍은 "그날 전체"(slot null) 행도 이 교시의 기록으로 보여야 한다 —
  //    안 그러면 당번 눈에 '미체크'로 보여 다시 찍고, 그 두 번째 행이 시수·회차를 이중 계상한다
  //    (2026-08-17 적대 감사 P1-4). 급여 자리(랩실)는 자리 시수가 **별도 축**(seat_label 행)이라 폴백 금지 —
  //    담임 출석을 자리 기록처럼 보여주면 자리 시수가 안 찍힌 걸 찍힌 걸로 오인한다.
  // 이 자리판에 그 반이 오늘 몇 교시 걸려 있나 — day-level 폴백은 **한 교시뿐인 반**에만 허용한다.
  // 두 교시 이상이면 담임의 "그날 전체" 한 행이 모든 교시에 '체크됨'으로 복제돼 보이고, 한 교시에서
  // 승격되는 순간 나머지 교시가 미체크로 뒤집혀 새 insert를 부른다(적대 리뷰 확정 — 폴백이 만든 유령).
  const periodCountByClass = new Map<string, number>();
  for (const p of periods)
    for (const s of p.slots) periodCountByClass.set(s.classId, (periodCountByClass.get(s.classId) ?? 0) + 1);
  /**
   * 반 → 그 날 이 자리 교시들(교시 선택 0255a의 재료). `periods`가 이미 시작시각 오름차순이라
   * 이 배열도 정렬돼 있고, 같은 교시에 그 반이 두 줄이어도 한 번만 담는다.
   */
  const slotsByClass: Record<string, string[]> = {};
  for (const p of periods)
    for (const s of p.slots) {
      const list = (slotsByClass[s.classId] ??= []);
      if (!list.includes(p.start)) list.push(p.start);
    }
  /** (반|학생) → 이미 기록이 있는 교시. 날 단위 행(교시 없음)은 담지 않는다 — 감출지 판정의 근거가 못 된다. */
  const markedSlotsByCell: Record<string, string[]> = {};
  for (const r of effective) {
    const slot = hhmm(r.slot_start);
    if (!slot) continue;
    const list = (markedSlotsByCell[`${r.class_id}|${r.student_id}`] ??= []);
    if (!list.includes(slot)) list.push(slot);
  }
  /**
   * 반 → 그 날 이 반의 **다른** 수업 시작(이 자리가 아닌 교시) — 교시 이동이 반 수업과 겹치지 않게.
   * 🔑 새 조회가 아니다 — 위에서 받은 그 요일 라벨 슬롯(`rawSlots`)을 반 축으로 접은 것이다.
   * ⚠️ 라벨이 없는 교시(담당만 있는 슬롯)는 그 조회에 안 들어온다. 실측 2026-09-10 랩실 반 15개는 전부 영어이고
   *    유효 슬롯 145개가 전부 라벨을 들고 있다 — 라벨 없는 반이 랩실을 쓰게 되면 여기를 다시 볼 것.
   */
  const seatClassIdSet = new Set(classIds);
  const busyStartsByClass: Record<string, string[]> = {};
  for (const r of rawSlots ?? []) {
    const classId = r.class_id as string;
    if (!seatClassIdSet.has(classId)) continue;
    if (specialSlotLabel(r.slot_teacher_label) === wantLabel) continue;
    const start = hhmm(r.start_time as string);
    if (!start) continue;
    const list = (busyStartsByClass[classId] ??= []);
    if (!list.includes(start)) list.push(start);
  }
  /**
   * (반|학생) → 교시 → **그 반의 이 자리 교시 밖**에서 이미 찍힌 이 자리 기록(다른 시간으로 옮겨 가서 찍힌 것).
   * 🔴 **이 자리 라벨이 박힌 기록만** — 반 수업 기록(라벨 없음)을 자리 방문으로 읽으면 안 된다. 그래서 라벨을
   *    안 박는 비급여 자리(JJ실)엔 늘 비어 있다(JJ실은 교시를 옮기지 않는다).
   * 🔴 **그날 이 자리 명단에 있는 학생만**(`studentsByClass`) — 명단 밖 학생은 이 경로로도 안 들어온다.
   */
  const periodStartSet = new Set(periods.map((p) => p.start));
  const offSlotByCell: Record<string, Record<string, SeatStudent>> = {};
  for (const r of effective) {
    const slot = hhmm(r.slot_start);
    if (!slot || !periodStartSet.has(slot)) continue;
    if (specialSlotLabel(r.seat_label) !== wantLabel) continue;
    if ((slotsByClass[r.class_id] ?? []).includes(slot)) continue;
    // ⚠️ 상태로는 거르지 않는다 — 제 교시 칸(`recByKey`)과 같은 규약이다. 반 출석부가 그 칸을 조퇴·공결로
    //    고쳐도 자리 라벨은 남으므로, 여기서 거르면 그 기록이 아무도 안 보는 칸에 숨고 학생이 제 교시에 되살아난다.
    const base = (studentsByClass.get(r.class_id) ?? []).find((s) => s.id === r.student_id);
    if (!base) continue;
    (offSlotByCell[`${r.class_id}|${r.student_id}`] ??= {})[slot] = toSeatStudent(base, r);
  }
  const dayLevelFallback = (classId: string, studentId: string) => {
    if (isPayrollSeat(seat)) return undefined;
    if ((periodCountByClass.get(classId) ?? 0) !== 1) return undefined;
    const rec = recByKey.get(`${classId}|${studentId}|`);
    // 자리판이 표현 못 하는 상태(조퇴·공결·보강)는 폴백하지 않는다 — 미체크로 보이더라도 쓰기 경로
    // (writeOne·fillSeatSlot)가 그 행을 보호한다(덮지도, 중복 행을 만들지도 않는다).
    return rec && ["present", "absent", "late"].includes(rec.status) ? rec : undefined;
  };

  const rosterByPeriod: Record<string, SeatClassRoster[]> = {};
  for (const p of periods) {
    rosterByPeriod[p.start] = p.slots.map((slot) => ({
      classId: slot.classId,
      className: slot.className,
      end: hhmm(slot.end),
      bgColor: colorById.get(slot.classId)?.bg ?? null,
      textColor: colorById.get(slot.classId)?.text ?? null,
      students: (studentsByClass.get(slot.classId) ?? [])
        .map((s) =>
          toSeatStudent(
            s,
            recByKey.get(`${slot.classId}|${s.id}|${p.start}`) ?? dayLevelFallback(slot.classId, s.id),
          ),
        )
        .sort((a, b) => (a.grade ?? "").localeCompare(b.grade ?? "", "ko") || a.name.localeCompare(b.name, "ko")),
    }));
  }

  return { date, periods, rosterByPeriod, slotsByClass, markedSlotsByCell, busyStartsByClass, offSlotByCell };
}
