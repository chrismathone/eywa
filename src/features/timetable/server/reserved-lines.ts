import "server-only";

/**
 * 기본뷰의 **보강 예약 표시**(0264a) — 두 갈래다. 원장 2026-09-14 *"10/14일 시간표로 가봐도 보강학생을 찾을 수 없네.
 * 하단에 '대기'나 '퇴원'처럼 '보강' 리스트 있어야하는데"* → 같은 날 *"9/17 이수진 선생님 1420-1620 수업에 안엄지가 없음"*
 * → *"퇴원블록처럼 보강블록이 있으면 됨"*.
 *
 *  ① **원반 칸이 있는 날** — 그 반 칸 아래 '보강' 줄(`reserved`). 종전 그대로다.
 *  ② **원반 칸이 없는 날**(`strays`) — 그 반이 그 요일에 안 도는 경우다(실측: 고등M 개별 TP4E는 화·금뿐인데
 *     보강은 목요일). 그래서 **원반 담임 열 · 그 요일 · 그 시각 칸**에 세운다. 그 칸에 다른 반이 이미 있으면
 *     그 칸 **안에서 명단과 분리된 박스**로 선다(퇴원 블록과 같은 모양).
 *
 * 🔴 **표시 전용이지 귀속이 아니다** — "반 보강이 아닌 보강엔 호스트 반이 없다"는 결정은 **데이터**(class_id·출결·시수)
 *    이야기다. 여기서 남의 반 칸에 박스를 그리는 것은 그 결정과 충돌하지 않는다(DB는 한 글자도 안 바뀐다).
 *    그래서 명단 수·드래그·반 이동 판정·충돌·엑셀·시트엔 안 실린다(값은 `WeekdayGroupTables` 한 곳으로만 간다).
 * 🔴 반 집합 = **화면에 선 슬롯의 반**(강사 스코프·과목·프로그램·학년 필터 뒤) — 예약 표를 따로 스코핑하지 않는다(#77).
 * 🔴 fail-soft — 조회 실패·표 미적용이면 슬롯을 그대로 돌려준다(시간표는 hot path, [[#95]]).
 * ⚠️ **원반 담임을 모르면 세우지 않는다**(그 열이 없다) — 담임이 빈 반, 그리고 그 담임이 그 요일에 아무 수업도
 *    없어 열 자체가 화면에 없는 경우다. 그건 시간표 '보강' 탭이 요일 × 교시로 세운다(알려진 한계).
 * ⚠️ 담임 이름은 **그 반 슬롯 중 첫 값**을 쓴다 — 지난 주를 볼 때 주 중간에 담임이 바뀌었다면 요일마다 다른
 *    이름이 올 수 있는데(`teacherName`은 셀 날짜 기준 as-of), 그때는 먼저 나온 열에 선다. 예약은 미래분이라
 *    실제로 걸릴 일이 거의 없고, 걸려도 '보강' 탭이 정본이다.
 */
import { createClient } from "@/lib/supabase/server";
import { fetchInChunks } from "@/lib/supabase/batch";
import { getReservationsInWeek } from "@/features/attendance/server/makeup-reservation-queries";
import { toTimetableReservedLine, type TimetableReservedLine } from "@/features/attendance/makeup-reservation";
import { dateOfDowInWeek } from "../lib/week";

type SlotLike = {
  id: string;
  classId: string;
  className?: string;
  dayOfWeek: string;
  /** 격자 강사 열 키와 **같은 값**(반 담임 표시 이름) — 이 값으로 열을 찾는다. */
  teacherName?: string | null;
};

/**
 * 원반 칸이 없는 날의 예약 한 묶음 = 격자의 한 칸(강사 열 × 요일 × 시각)에 설 '보강' 박스.
 * 같은 칸에 여럿이면 한 박스에 줄로 모인다.
 */
export type StrayReservedBlock = {
  /** 렌더 key — (담임, 요일, 시각)이 곧 칸이다. */
  key: string;
  teacherName: string;
  dayOfWeek: string;
  /** 그 요일 칸의 실제 날짜(YYYY-MM-DD). */
  date: string;
  /** "HH:MM" — 어느 교시 행에 앉을지는 격자가 제 교시표로 잰다(여기서 행을 정하지 않는다). */
  startTime: string;
  endTime: string;
  lines: TimetableReservedLine[];
};

export type ReservedAttachResult<T> = {
  slots: T[];
  /** 원반 칸이 없어 담임 열에 세울 묶음(없으면 빈 배열). */
  strays: readonly StrayReservedBlock[];
};

/**
 * 없을 때 돌려주는 빈 값.
 * 🔴 `readonly`로 잠근다 — 모듈 스코프는 Next 서버에서 **요청 사이에 살아 있다**. 누가 한 번 `push`하면
 *    그 뒤 모든 요청이 오염된 배열을 받는다(요청마다 새 배열을 만들지 않는 대신 타입으로 막는다).
 */
const NO_STRAYS: readonly StrayReservedBlock[] = [];

export async function attachReservedLines<T extends SlotLike>(
  slots: readonly T[],
  referenceDate: string,
): Promise<ReservedAttachResult<T & { reserved?: TimetableReservedLine[] }>> {
  const classIds = [...new Set(slots.map((s) => s.classId).filter(Boolean))];
  if (classIds.length === 0) return { slots: [...slots], strays: NO_STRAYS };
  const reservations = await getReservationsInWeek(referenceDate, classIds);
  if (reservations.length === 0) return { slots: [...slots], strays: NO_STRAYS };
  const sb = await createClient();
  const students = await fetchInChunks<{ id: string; name: string; grade: string | null; school: string | null }>(
    [...new Set(reservations.map((r) => r.studentId))],
    (chunk) => sb.from("students").select("id, name, grade, school").in("id", chunk),
  ).catch(() => [] as { id: string; name: string; grade: string | null; school: string | null }[]);
  const studentById = new Map(students.map((s) => [s.id, s]));

  // 반마다 ① 그 주 어느 날짜에 칸이 있나 ② 담임 이름(격자 열 키) ③ 반 이름(툴팁) — 새 조회 0건.
  const cellDates = new Set<string>();
  const teacherOf = new Map<string, string>();
  const nameOf = new Map<string, string>();
  for (const s of slots) {
    const date = dateOfDowInWeek(referenceDate, s.dayOfWeek);
    if (date) cellDates.add(`${s.classId}|${date}`);
    // 🔴 격자 열 키는 `s.teacherName`을 **그대로** 쓴다(`teacherName ?? "—"`) — 여기서만 `trim()`하면 이름 끝에
    //    공백이 있는 직원의 키가 안 맞아 박스가 **조용히** 안 뜬다(적대 리뷰 2026-09-14). 빈 이름만 거른다.
    const t = s.teacherName;
    if (t && t.trim() && !teacherOf.has(s.classId)) teacherOf.set(s.classId, t);
    if (s.className && !nameOf.has(s.classId)) nameOf.set(s.classId, s.className);
  }

  const byCell = new Map<string, TimetableReservedLine[]>();
  const strayByKey = new Map<string, StrayReservedBlock>();
  for (const r of reservations) {
    const stu = studentById.get(r.studentId);
    if (!stu) continue; // 이름을 모르는 줄은 세우지 않는다(지어내지 않는다)
    const cellKey = `${r.classId}|${r.makeupDate}`;
    if (cellDates.has(cellKey)) {
      // ① 원반 칸이 있다 — 그 칸 아래 줄로만 선다(두 번 그리지 않는다).
      (byKeyPush(byCell, cellKey)).push(toTimetableReservedLine(r, stu));
      continue;
    }
    // ② 원반 칸이 없다 — 담임 열로. 담임을 모르면 세우지 않는다(위 ⚠️).
    const teacherName = teacherOf.get(r.classId);
    if (!teacherName) continue;
    const dayOfWeek = dowOfDate(r.makeupDate);
    if (!dayOfWeek) continue;
    const key = `${teacherName}|${dayOfWeek}|${r.slotStart}|${r.slotEnd}`;
    const block =
      strayByKey.get(key) ??
      strayByKey
        .set(key, {
          key,
          teacherName,
          dayOfWeek,
          date: r.makeupDate,
          startTime: r.slotStart,
          endTime: r.slotEnd,
          lines: [],
        })
        .get(key)!;
    // 남의 반 칸에 서므로 **원반 이름을 툴팁에** 싣는다(줄은 `이름/학교학년`뿐이다).
    block.lines.push(toTimetableReservedLine(r, stu, { className: nameOf.get(r.classId) ?? null }));
  }

  const withLines =
    byCell.size === 0
      ? [...slots]
      : slots.map((s) => {
          const date = dateOfDowInWeek(referenceDate, s.dayOfWeek);
          const lines = date ? byCell.get(`${s.classId}|${date}`) : undefined;
          return lines ? { ...s, reserved: lines } : s;
        });
  return { slots: withLines, strays: strayByKey.size === 0 ? NO_STRAYS : [...strayByKey.values()] };
}

function byKeyPush(map: Map<string, TimetableReservedLine[]>, key: string): TimetableReservedLine[] {
  const cur = map.get(key);
  if (cur) return cur;
  const next: TimetableReservedLine[] = [];
  map.set(key, next);
  return next;
}

/** "YYYY-MM-DD" → 격자 요일 키. 형식이 아니면 null(요일을 지어내지 않는다). */
function dowOfDate(ymd: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return null;
  const [y, m, d] = ymd.split("-").map(Number);
  const idx = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1)).getUTCDay();
  return (["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const)[idx] ?? null;
}
