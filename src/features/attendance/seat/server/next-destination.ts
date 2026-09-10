import "server-only";
import { createClient } from "@/lib/supabase/server";
import { fetchInChunks } from "@/lib/supabase/batch";
import { isEnrollmentActiveOn } from "@/features/enrollments/eligibility";
import { DOW_KEYS, dowIndexOf, resolveAttendDows } from "@/features/attendance/calendar";
import { canonicalRoomName } from "@/features/attendance/live/seating-floors";
import { hhmm } from "../seat";

/**
 * **다음 행선지** — 이 자리 수업이 끝난 뒤 그 학생이 오늘 갈 곳(시각 + 강의실).
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
 * 🔴 **로그인 화면 전용**이다 — 비로그인 PIN 경로는 이 함수를 부르지 않는다(동선은 사유·직원 이름과
 *    같은 결의 정보다). 그래서 세션 클라이언트(RLS)만 쓴다.
 * ⚠️ 왕복은 셋 고정(수강 · 배치 · 강의실 이름) — 학생 수만큼 늘지 않는다(B2·B3, 청크 헬퍼).
 */
export type SeatNextDestination = {
  /** 학생 id → 다음 수업 시작시각("HH:MM"). */
  startByStudent: Record<string, string>;
  /** 학생 id → 그 수업의 강의실 이름. **모르면 키가 없다.** */
  roomByStudent: Record<string, string>;
};

const EMPTY: SeatNextDestination = { startByStudent: {}, roomByStudent: {} };

export async function getSeatNextDestinations(
  studentIds: readonly string[],
  date: string,
  /** 지금 교시 시작시각 — 이보다 **늦게 시작하는** 수업만 다음 행선지다. */
  afterStart: string,
): Promise<SeatNextDestination> {
  if (studentIds.length === 0) return EMPTY;
  const supabase = await createClient();
  const dowKey = DOW_KEYS[new Date(`${date}T00:00:00Z`).getUTCDay()]!;
  const todayIdx = dowIndexOf(dowKey);
  const after = hhmm(afterStart);

  // 그날 유효한 수강 — 반 축이 아니라 **학생 축**이라 이 자리 밖 과목까지 함께 들어온다.
  const enrollments = await fetchInChunks<{
    student_id: string;
    class_id: string;
    start_date: string;
    end_date: string | null;
    on_hold: boolean | null;
    is_transferred: boolean | null;
    attendance_days: string[] | null;
  }>([...studentIds], (chunk) =>
    supabase
      .from("enrollments")
      .select("student_id, class_id, start_date, end_date, on_hold, is_transferred, attendance_days")
      .in("student_id", chunk)
      .not("on_hold", "is", true)
      .lte("start_date", date)
      .or(`end_date.is.null,end_date.gte.${date}`),
  );
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
  if (classIds.length === 0) return EMPTY;

  // 그 요일에 **그 날짜로 유효한** 배치만(이력 행을 그대로 읽으면 끝난 교시가 미래로 보인다, [[#88]]).
  const slots = await fetchInChunks<{
    class_id: string;
    start_time: string;
    slot_room_label: string | null;
    classroom: { name: string }[] | { name: string } | null;
  }>(classIds, (chunk) =>
    supabase
      .from("class_schedules")
      // 🔑 임베드는 **컬럼으로** 건다(`classroom:classroom_id ( name )`) — 시간표 조회와 같은 모양이라
      //    FK가 둘로 갈릴 여지가 없다([[#94]]는 표 대 표가 모호할 때의 규약이다).
      .select("class_id, start_time, slot_room_label, classroom:classroom_id ( name )")
      .in("class_id", chunk)
      .eq("day_of_week", dowKey)
      .gt("start_time", after)
      .lte("valid_from", date)
      .or(`valid_to.is.null,valid_to.gte.${date}`),
  );
  if (slots.length === 0) return EMPTY;

  // 라벨 정규화의 사전 — 등록된 강의실 이름(폐강의실 포함: 라벨을 이름으로 맞추는 데만 쓴다, [[#122]]).
  const { data: rooms } = await supabase.from("classrooms").select("name");
  const known = (rooms ?? []).map((r) => r.name as string).filter(Boolean);

  /** 반 → 그 요일 남은 교시 중 **가장 이른** 것. 같은 시각이 여럿이면 먼저 온 행(안정 선택). */
  const nextByClass = new Map<string, { start: string; room: string | null }>();
  for (const sl of slots) {
    const start = hhmm(sl.start_time);
    const cur = nextByClass.get(sl.class_id);
    if (cur && cur.start <= start) continue;
    const embedded = Array.isArray(sl.classroom) ? sl.classroom[0] : sl.classroom;
    const raw = embedded?.name ?? sl.slot_room_label ?? null;
    nextByClass.set(sl.class_id, { start, room: canonicalRoomName(raw, known) });
  }

  /** 반별 그 요일 등원 여부 — 분리등원(attendance_days) 학생은 오늘 안 오는 반이 있다. */
  const startByStudent: Record<string, string> = {};
  const roomByStudent: Record<string, string> = {};
  for (const e of live) {
    const next = nextByClass.get(e.class_id);
    if (!next) continue;
    // 그 반이 오늘 도는 요일인지는 위 쿼리가 이미 걸렀다 → 학생의 분리등원만 본다.
    const dows = resolveAttendDows(e.attendance_days, [todayIdx]);
    if (dows.length > 0 && !dows.includes(todayIdx)) continue;
    const cur = startByStudent[e.student_id];
    if (cur && cur <= next.start) continue;
    startByStudent[e.student_id] = next.start;
    if (next.room) roomByStudent[e.student_id] = next.room;
    else delete roomByStudent[e.student_id]; // 더 이른 수업의 방을 남겨 두면 엉뚱한 방을 적는다
  }
  return { startByStudent, roomByStudent };
}
