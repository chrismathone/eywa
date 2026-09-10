import "server-only";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchInChunks } from "@/lib/supabase/batch";
import { isEnrollmentActiveOn } from "@/features/enrollments/eligibility";
import { DOW_KEYS, dowIndexOf } from "@/features/attendance/calendar";
import { canonicalRoomName } from "@/features/attendance/live/seating-floors";
import { specialSlotLabel } from "@/features/timetable/lib/teacher-label";
import { hhmm } from "../seat";
import {
  foldNextDestination,
  type NextDestinationDay,
  type NextDestinationSlot,
  type SeatNextDestination,
  type SeatStays,
} from "../next-destination";

export type { SeatNextDestination };

/**
 * **다음 행선지** — 이 자리 수업이 끝난 뒤 그 학생이 오늘 갈 곳(시각 + 강의실). 조회는 여기서 하고, 학생별로
 * 접는 규칙은 순수 모듈 [`next-destination.ts`](../next-destination.ts)가 한다(Vitest).
 *
 * 원장 2026-09-10: *"다음 17:20 이면 무슨 말인지 도대체 알 수가 없음. **17:20 304호 가야함** 처럼
 * 해줘"* + *"강의실은 다 있을테니"*.
 *
 * 🔴 **이 자리만 보던 것을 오늘 전 과목으로 넓힌 것**이다 — 종전 `nextSeatPeriodByStudent`는 같은 방의
 *    다음 교시만 봐서 "다음 17:20"이 곧 "여기 또 와"였고, 정작 아이가 어디로 가야 하는지는 안 적혔다.
 * 🔴 **강의실은 등록된 정본으로 정규화**한다([[#115]] `canonicalRoomName`) — 시트가 넣는
 *    `slot_room_label`은 `302`처럼 건물명이 없는 호수라 그대로 적으면 `본원302`와 다른 방으로 읽힌다.
 *    ⚠️ 애매하면(`602` = 바른602·본원602) 손대지 않는다.
 * 🔴 **방을 모르면 시각만** 돌려준다(키 없음) — 지어낸 방 이름은 아이를 엉뚱한 데로 보낸다.
 * 🔴 **교시를 옮기는 자리(랩실)는 이 자리 배치를 교시 선택을 얹은 명단으로 잰다**(원장 2026-09-10 *"다른 시간으로
 *    옮기기"* 이후) — 호출부가 `stays`([`seatStaysFor`](../next-destination.ts))를 넘기면 그날 이 자리 반들의
 *    배치를 **같은 조회**에 얹어 읽고(옮겨 가는 교시의 강의실), 접기가 이 자리 라벨 배치를 빼고 명단의 교시를
 *    넣는다. 안 넘기면 옛 동작 그대로(JJ실).
 * 🔑 **비로그인 PIN 화면도 같은 함수를 쓴다**(원장 2026-09-10 *"seat/lab에서도 자리 출석부와 동일해야해"*) —
 *    종전엔 로그인 화면 전용이었다. PIN 경로는 세션이 없어 `tenantId`를 넘기면 **admin + 명시 `tenant_id`
 *    필터**로 읽는다 — 🔴 admin은 RLS를 우회하므로 이 필터가 **유일한 격리선**이다(세 조회 모두에 건다).
 * ⚠️ 왕복은 셋 고정(수강 · 배치 · 강의실 이름) — 학생 수만큼 늘지 않는다(B2·B3, 청크 헬퍼).
 */
const EMPTY: SeatNextDestination = { startByStudent: {}, roomByStudent: {} };

/**
 * 교시 **여러 개**를 한 번에 — '전체' 보기(원장 2026-09-10 ⑨)가 교시 수만큼 왕복을 늘리지 않게,
 * 조회는 하루 한 벌이고 "이보다 늦게 시작하는" 판정만 교시마다 JS에서 돌린다(B6).
 */
export async function getSeatNextDestinationsBySlot(
  studentIds: readonly string[],
  date: string,
  /** 기준 교시들("HH:MM") — 각각에 대해 그 뒤 첫 수업을 찾는다. */
  afterStarts: readonly string[],
  opts: {
    /** 비로그인 PIN 경로 — 주면 admin + 이 테넌트 필터로 읽는다(세션이 없다). */
    tenantId?: string;
    /**
     * 교시를 옮기는 자리(랩실)의 명단 재료 — `seatStaysFor`로 **교시 선택을 얹은 명단**에서 만든다.
     * 없으면 옛 동작(배치표 그대로 — JJ실·옛 호출부).
     */
    stays?: SeatStays;
  } = {},
): Promise<Record<string, SeatNextDestination>> {
  const empty = Object.fromEntries(afterStarts.map((k) => [hhmm(k), EMPTY]));
  if (studentIds.length === 0 || afterStarts.length === 0) return empty;
  const loaded = await loadDaySlots(studentIds, date, opts.tenantId, opts.stays?.classIds ?? []);
  if (!loaded) return empty;
  return Object.fromEntries(
    afterStarts.map((raw) => {
      const after = hhmm(raw);
      return [after, foldNextDestination(loaded, after, opts.stays)];
    }),
  );
}

export async function getSeatNextDestinations(
  studentIds: readonly string[],
  date: string,
  /** 지금 교시 시작시각 — 이보다 **늦게 시작하는** 수업만 다음 행선지다. */
  afterStart: string,
): Promise<SeatNextDestination> {
  const bySlot = await getSeatNextDestinationsBySlot(studentIds, date, [afterStart]);
  return bySlot[hhmm(afterStart)] ?? EMPTY;
}

/** 하루치 재료(수강 × 그 요일 배치 × 강의실 이름) — 교시 판정은 이 뒤에 순수 함수로 돈다. */
async function loadDaySlots(
  studentIds: readonly string[],
  date: string,
  tenantId: string | undefined,
  /** 그날 이 자리에 걸린 반들(`stays.classIds`) — 옮겨 가는 교시의 강의실을 알려고 배치 조회에 얹는다. */
  seatClassIds: readonly string[],
): Promise<NextDestinationDay | null> {
  if (studentIds.length === 0) return null;
  const supabase = tenantId ? createAdminClient() : await createClient();
  const dowKey = DOW_KEYS[new Date(`${date}T00:00:00Z`).getUTCDay()]!;
  const todayIdx = dowIndexOf(dowKey);

  // 그날 유효한 수강 — 반 축이 아니라 **학생 축**이라 이 자리 밖 과목까지 함께 들어온다.
  const enrollments = await fetchInChunks<{
    student_id: string;
    class_id: string;
    start_date: string;
    end_date: string | null;
    on_hold: boolean | null;
    is_transferred: boolean | null;
    attendance_days: string[] | null;
  }>([...studentIds], (chunk) => {
    let q = supabase
      .from("enrollments")
      .select("student_id, class_id, start_date, end_date, on_hold, is_transferred, attendance_days")
      .in("student_id", chunk)
      .not("on_hold", "is", true)
      .lte("start_date", date)
      .or(`end_date.is.null,end_date.gte.${date}`);
    if (tenantId) q = q.eq("tenant_id", tenantId);
    return q;
  });
  const live = enrollments.filter((e) =>
    isEnrollmentActiveOn(
      {
        startDate: e.start_date,
        endDate: e.end_date,
        onHold: e.on_hold === true,
        isTransferred: e.is_transferred === true,
      },
      date,
    ),
  );
  const classIds = [...new Set(live.map((e) => e.class_id))];
  if (classIds.length === 0) return null;
  // 🔑 이 자리 반들을 **같은 id 목록**에 얹는다 — 새 왕복이 아니다(대개 한 청크 안). 수강이 없는 반의 배치는
  //    학생 후보가 되지 않고, 이 자리 교시의 강의실을 아는 데만 쓰인다(접기 쪽 `seatRoomByStart`).
  //    🔴 아래 배치 조회는 **이 목록**을 받는다 — 옛 `classIds`로 되돌려도 tsc·eslint는 못 잡는다(동작 잠금 = 같은
  //    폴더 `next-destination.test.ts`).
  const slotClassIds = [...new Set([...classIds, ...seatClassIds])];

  // 그 요일에 **그 날짜로 유효한** 배치만(이력 행을 그대로 읽으면 끝난 교시가 미래로 보인다, [[#88]]).
  const slots = await fetchInChunks<{
    class_id: string;
    start_time: string;
    slot_room_label: string | null;
    slot_teacher_label: string | null;
    classroom: { name: string }[] | { name: string } | null;
  }>(slotClassIds, (chunk) => {
    let q = supabase
      .from("class_schedules")
      // 🔑 임베드는 **컬럼으로** 건다(`classroom:classroom_id ( name )`) — 시간표 조회와 같은 모양이라
      //    FK가 둘로 갈릴 여지가 없다([[#94]]는 표 대 표가 모호할 때의 규약이다).
      .select("class_id, start_time, slot_room_label, slot_teacher_label, classroom:classroom_id ( name )")
      .in("class_id", chunk)
      .eq("day_of_week", dowKey)
      .lte("valid_from", date)
      .or(`valid_to.is.null,valid_to.gte.${date}`);
    if (tenantId) q = q.eq("tenant_id", tenantId);
    return q;
  });
  if (slots.length === 0) return null;

  // 라벨 정규화의 사전 — 등록된 강의실 이름(폐강의실 포함: 라벨을 이름으로 맞추는 데만 쓴다, [[#122]]).
  let roomQ = supabase.from("classrooms").select("name");
  if (tenantId) roomQ = roomQ.eq("tenant_id", tenantId);
  const { data: rooms } = await roomQ;
  const known = (rooms ?? []).map((r) => r.name as string).filter(Boolean);

  const slotsByClass = new Map<string, NextDestinationSlot[]>();
  for (const sl of slots) {
    const embedded = Array.isArray(sl.classroom) ? sl.classroom[0] : sl.classroom;
    const raw = embedded?.name ?? sl.slot_room_label ?? null;
    const list = slotsByClass.get(sl.class_id) ?? [];
    list.push({
      start: hhmm(sl.start_time),
      room: canonicalRoomName(raw, known),
      // 자리 판정은 단일 소스(별칭 `이주희`·`랩실`까지) — 여기서 문자열을 다시 비교하지 않는다.
      seatLabel: specialSlotLabel(sl.slot_teacher_label),
    });
    slotsByClass.set(sl.class_id, list);
  }
  return {
    live: live.map((e) => ({ studentId: e.student_id, classId: e.class_id, attendanceDays: e.attendance_days })),
    slotsByClass,
    todayIdx,
  };
}
