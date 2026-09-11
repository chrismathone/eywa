import "server-only";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllPagedInChunks } from "@/lib/supabase/batch";
import { isEnrollmentActiveOn } from "@/features/enrollments/eligibility";
import { DOW_KEYS, dowIndexOf } from "@/features/attendance/calendar";
import { specialSlotLabel } from "@/features/timetable/lib/teacher-label";
import { hhmm } from "../seat";
import { destinationRoomOf } from "../destination-room";
import type { NextDestinationDay, NextDestinationSlot } from "../next-destination";

/**
 * 다음 행선지·학생 축의 **하루치 재료**(그날 유효한 수강 × 그 요일 배치 × 강의실 이름) — 조회는 여기 한 벌이고,
 * 교시 판정은 이 뒤에 순수 함수로 돈다. 호출부 = [`next-destination.ts`](./next-destination.ts)의 두 문(화면용
 * `getSeatNextDestinationsBySlot` · 쓰기 경로용 `getSeatStudentClasses`).
 *
 * 🔴 `tenantId`를 주면(비로그인 PIN) **admin + 명시 `tenant_id` 필터**로 읽는다 — admin은 RLS를 우회하므로 이 필터가
 *    **유일한 격리선**이다(세 조회 모두에 건다. 임베드된 반·강의실은 이미 거른 배치 행의 FK 대상이라 따로 거를 것이 없다).
 * 🔴 수강·배치 조회는 **청크 × 페이징**(B2) — 1,000행에서 조용히 잘리면 뒤쪽 학생의 수업이 사라져 '마지막 수업'이
 *    **거짓으로** 선다(이력 표 `class_schedules`, [[#54]]·[[#88]]).
 * ⚠️ 왕복은 셋 고정(수강 → 배치 ∥ 강의실 이름) — 학생 수만큼 늘지 않는다(B3·B4). 조회 오류는 던진다(`fetchAllPaged`).
 */

/** PostgREST 임베드는 행이 하나여도 배열로 올 수 있다 — 첫 행을 쓴다. */
function one<T>(v: T | T[] | null | undefined): T | null {
  return Array.isArray(v) ? (v[0] ?? null) : (v ?? null);
}

type RoomEmbed = { name: string | null };
type ClassEmbed = { class_name: string | null; classroom: RoomEmbed[] | RoomEmbed | null };
type SlotRow = {
  class_id: string;
  start_time: string;
  end_time: string | null;
  slot_room_label: string | null;
  slot_teacher_label: string | null;
  classroom: RoomEmbed[] | RoomEmbed | null;
  class: ClassEmbed[] | ClassEmbed | null;
};

export async function loadDaySlots(
  studentIds: readonly string[],
  date: string,
  tenantId: string | undefined,
  /** 그날 이 자리에 걸린 반들(`stays.classIds`) — 옮겨 가는 교시의 강의실을 알려고 배치 조회에 얹는다. */
  seatClassIds: readonly string[],
): Promise<NextDestinationDay> {
  const supabase = tenantId ? createAdminClient() : await createClient();
  const dowKey = DOW_KEYS[new Date(`${date}T00:00:00Z`).getUTCDay()]!;
  const todayIdx = dowIndexOf(dowKey);
  const none: NextDestinationDay = { live: [], slotsByClass: new Map(), classNames: new Map(), todayIdx };
  if (studentIds.length === 0) return none;

  // 그날 유효한 수강 — 반 축이 아니라 **학생 축**이라 이 자리 밖 과목까지 함께 들어온다.
  const enrollments = await fetchAllPagedInChunks<{
    student_id: string;
    class_id: string;
    start_date: string;
    end_date: string | null;
    on_hold: boolean | null;
    is_transferred: boolean | null;
    attendance_days: string[] | null;
  }>([...studentIds], (chunk, from, to) => {
    let q = supabase
      .from("enrollments")
      .select("student_id, class_id, start_date, end_date, on_hold, is_transferred, attendance_days")
      .in("student_id", chunk)
      .not("on_hold", "is", true)
      .lte("start_date", date)
      .or(`end_date.is.null,end_date.gte.${date}`);
    if (tenantId) q = q.eq("tenant_id", tenantId);
    return q.order("id").range(from, to);
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
  // 그날 유효한 수강이 하나도 없으면 물은 학생 모두 **모름**이다(명단에 섰는데 수강이 없는 건 이상한 경우다).
  if (classIds.length === 0) return none;
  // 🔑 이 자리 반들을 **같은 id 목록**에 얹는다 — 새 왕복이 아니다(대개 한 청크 안). 수강이 없는 반의 배치는
  //    학생 후보가 되지 않고, 이 자리 교시의 강의실을 아는 데만 쓰인다(접기 쪽 `seatRoomByStart`).
  //    🔴 아래 배치 조회는 **이 목록**을 받는다 — 옛 `classIds`로 되돌려도 tsc·eslint는 못 잡는다(동작 잠금 =
  //    `next-destination.test.ts`).
  const slotClassIds = [...new Set([...classIds, ...seatClassIds])];

  // 라벨 정규화의 사전 — 등록된 강의실 이름(폐강의실 포함: 라벨을 이름으로 맞추는 데만 쓴다, [[#122]]).
  // 배치 조회와 서로 독립이라 병렬(B4).
  let roomQ = supabase.from("classrooms").select("name");
  if (tenantId) roomQ = roomQ.eq("tenant_id", tenantId);
  const [slots, { data: rooms }] = await Promise.all([
    // 그 요일에 **그 날짜로 유효한** 배치만(이력 행을 그대로 읽으면 끝난 교시가 미래로 보인다, [[#88]]).
    fetchAllPagedInChunks<SlotRow>(slotClassIds, (chunk, from, to) => {
      let q = supabase
        .from("class_schedules")
        // 🔑 임베드는 **컬럼으로** 건다(`classroom:classroom_id ( name )`·`class:class_id ( … )`) — 시간표·키오스크
        //    조회와 같은 모양이라 FK가 둘로 갈릴 여지가 없다([[#94]]는 표 대 표가 모호할 때의 규약이다).
        //    반 기본 강의실(`classes.classroom_id`)은 반 임베드 안에 한 겹 더 건다 — 새 왕복 0.
        .select(
          "class_id, start_time, end_time, slot_room_label, slot_teacher_label, classroom:classroom_id ( name ), class:class_id ( class_name, classroom:classroom_id ( name ) )",
        )
        .in("class_id", chunk)
        .eq("day_of_week", dowKey)
        .lte("valid_from", date)
        .or(`valid_to.is.null,valid_to.gte.${date}`);
      if (tenantId) q = q.eq("tenant_id", tenantId);
      return q.order("id").range(from, to);
    }),
    roomQ,
  ]);
  const known = (rooms ?? []).map((r) => r.name as string).filter(Boolean);

  const slotsByClass = new Map<string, NextDestinationSlot[]>();
  const classNames = new Map<string, string>();
  for (const sl of slots) {
    const klass = one(sl.class);
    if (klass?.class_name) classNames.set(sl.class_id, klass.class_name);
    // 자리 판정은 단일 소스(별칭 `이주희`·`랩실`까지) — 여기서 문자열을 다시 비교하지 않는다.
    const seatLabel = specialSlotLabel(sl.slot_teacher_label);
    const list = slotsByClass.get(sl.class_id) ?? [];
    list.push({
      start: hhmm(sl.start_time),
      end: sl.end_time ? hhmm(sl.end_time) : null,
      room: destinationRoomOf(
        {
          slotRoom: one(sl.classroom)?.name ?? null,
          roomLabel: sl.slot_room_label,
          classRoom: one(klass?.classroom)?.name ?? null,
          seatLabel,
        },
        known,
      ),
      seatLabel,
    });
    slotsByClass.set(sl.class_id, list);
  }
  return {
    live: live.map((e) => ({ studentId: e.student_id, classId: e.class_id, attendanceDays: e.attendance_days })),
    slotsByClass,
    classNames,
    todayIdx,
  };
}
