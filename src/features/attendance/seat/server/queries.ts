import "server-only";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllPagedInChunks, fetchInChunks } from "@/lib/supabase/batch";
import { effectiveAttendanceRecords } from "@/features/attendance/effective-records";
import { isEnrollmentActiveOn } from "@/features/enrollments/eligibility";
import { DOW_KEYS, dowIndexOf, resolveAttendDows } from "@/features/attendance/calendar";
import { specialSlotLabel } from "@/features/timetable/lib/teacher-label";
import { groupByStart, hhmm, isPayrollSeat, SEAT_DB_LABEL, type SeatKey, type SeatPeriod, type SeatSlot } from "../seat";

/** 지난 결석을 얼마나 거슬러 볼 것인가 — 그 반의 직전 몇 주. 길게 잡으면 옛 결석이 계속 붙어 다닌다. */
const PREV_ABSENCE_DAYS = 30;

type PrevAbsenceRow = {
  class_id: string;
  student_id: string;
  session_date: string;
  status: string;
  note: string | null;
};

/** "YYYY-MM-DD" ± n일 — KST 날짜 문자열끼리만 다룬다(Date로 파싱하면 타임존이 하루를 민다). */
function shiftDays(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const t = Date.UTC(y, (m ?? 1) - 1, d ?? 1) + days * 86400000;
  return new Date(t).toISOString().slice(0, 10);
}

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
   * 그 칸에 적힌 사유 메모(`attendance_records.note`) — 카드 마우스 오버로만 보인다(원장 2026-08-28).
   * 🔴 **비로그인 PIN 경로는 항상 null이다** — 아래 select 분기 주석 참조(병원·수술·가족 일정이 그대로 적힌다).
   */
  note: string | null;
  /**
   * **지난 결석**(같은 반, 오늘 이전 30일 안의 가장 최근 결석·공결) — 원장 2026-09-08
   * *"JJ와 LAB 수업의 경우 이전수업이 결석인 경우에 사유를 확인할 수 있도록"*.
   *
   * 🔑 "직전 수업"이 아니라 **"지난 결석"**으로 잡는다 — 직전 수업을 정확히 집으려면 그 반의 전 기록을
   *    끌어와야 하고(90일 × 명단 = 1000행 넘김, B2), 화면 문구도 `지난 결석 9/4`라 사실 그대로다.
   * 🔴 **비로그인 PIN 경로는 항상 null** — 사유엔 `병원`·`수술`·`가족여행`이 적힌다(위 note와 같은 규약).
   */
  prevAbsence: { date: string; note: string | null } | null;
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
  students: SeatStudent[];
};

export type SeatDay = {
  date: string;
  /** 교시(시작시각 오름차순). 그 날 자리 수업이 없으면 빈 배열. */
  periods: SeatPeriod[];
  /** 교시 start("HH:MM") → 반별 명단. */
  rosterByPeriod: Record<string, SeatClassRoster[]>;
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
  prev?: { date: string; note: string | null } | null,
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
    prevAbsence: prev ?? null,
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
  if (seatRows.length === 0) return { date, periods: [], rosterByPeriod: {} };

  const classIds = [...new Set(seatRows.map((r) => r.class_id as string))];

  // 반 이름 · 수강생 · 그날 출결 — 서로 독립이라 병렬(B4). id 수십 개까지 갈 수 있어 청크 헬퍼(B3).
  const [classes, enrollments, records, prevAbsenceRows] = await Promise.all([
    fetchInChunks<{ id: string; class_name: string }>(classIds, (chunk) => {
      let q = supabase.from("classes").select("id, class_name").in("id", chunk);
      if (tenantId) q = q.eq("tenant_id", tenantId);
      return q;
    }),
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
      /** 사유 메모 — 로그인 화면에서만 채워진다(공개 PIN은 조회조차 안 한다, 아래 분기 주석). */
      note?: string | null;
      /** 로그인 화면에서만 채워진다 — 공개(PIN) 경로는 아예 조회하지 않는다(아래 주석). */
      recorder?: { display_name: string | null }[];
    }>(classIds, (chunk) =>
      // 🔴 공개(PIN) 경로에선 **직원 이름도 사유 메모도 아예 안 가져온다** — 지금 화면이 안 그린다고 해도,
      //    로그인 없이 열리는 페이지로 직원 신상·학생 신상이 건너가는 것 자체를 막는다(나중에 누가 그리면 끝).
      //    ⚠️ 사유 메모(`note`)엔 `병원`·`수술`·`가족여행`이 그대로 적혀 있다(실데이터) — 직원 이름보다
      //       오히려 더 민감하다. 로그인 분기에만 싣는다.
      //    tenantId가 넘어온 경로 = admin 클라이언트 = 공개 경로다.
      //    ⚠️ select 문자열을 삼항으로 만들면 PostgREST 타입 파서가 못 읽는다 → 분기를 통째로 나눈다.
      tenantId
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
    /**
     * **지난 결석**(오늘 이전 30일) — 사유를 그 자리에서 확인하려고 함께 받는다.
     * 🔴 공개(PIN) 경로는 **아예 조회하지 않는다** — 사유엔 병원·수술·가족 일정이 적힌다(위 분기와 같은 규약).
     * ⚠️ 결석·공결 행만 받는다(전 기록을 받으면 명단 × 30일이 1000행을 넘는다, B2). 청크 안 페이징까지.
     */
    tenantId
      ? Promise.resolve([] as PrevAbsenceRow[])
      : fetchAllPagedInChunks<PrevAbsenceRow>(classIds, (chunk, from, to) =>
          supabase
            .from("attendance_records")
            .select("class_id, student_id, session_date, status, note")
            .in("class_id", chunk)
            .in("status", ["absent", "excused"])
            .gte("session_date", shiftDays(date, -PREV_ABSENCE_DAYS))
            .lt("session_date", date)
            .order("id", { ascending: true })
            .range(from, to),
        ),
  ]);

  /** (반|학생) → 가장 최근 결석. 같은 날 여러 교시면 사유가 적힌 쪽을 남긴다. */
  const prevAbsenceByKey = new Map<string, { date: string; note: string | null }>();
  for (const r of prevAbsenceRows) {
    const key = `${r.class_id}|${r.student_id}`;
    const cur = prevAbsenceByKey.get(key);
    if (!cur || r.session_date > cur.date) {
      prevAbsenceByKey.set(key, { date: r.session_date, note: r.note ?? null });
    } else if (r.session_date === cur.date && !cur.note && r.note) {
      prevAbsenceByKey.set(key, { date: cur.date, note: r.note });
    }
  }

  const nameById = new Map(classes.map((c) => [c.id, c.class_name]));
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
      students: (studentsByClass.get(slot.classId) ?? [])
        .map((s) =>
          toSeatStudent(
            s,
            recByKey.get(`${slot.classId}|${s.id}|${p.start}`) ?? dayLevelFallback(slot.classId, s.id),
            prevAbsenceByKey.get(`${slot.classId}|${s.id}`) ?? null,
          ),
        )
        .sort((a, b) => (a.grade ?? "").localeCompare(b.grade ?? "", "ko") || a.name.localeCompare(b.name, "ko")),
    }));
  }

  return { date, periods, rosterByPeriod };
}
