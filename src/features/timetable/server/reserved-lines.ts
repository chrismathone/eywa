import "server-only";

/**
 * 기본뷰 반 칸의 **'보강' 줄**(원장 2026-09-14 *"10/14일 시간표로 가봐도 보강학생을 찾을 수 없네. 하단에 '대기'나
 * '퇴원'처럼 '보강' 리스트 있어야하는데"*) — 화면에 선 반의 **그 요일 칸 날짜**에 잡힌 보강 예약(0264a)을 슬롯에 얹는다.
 *
 * 🔴 **표시 전용** — 명단 수·드래그·반 이동 판정·엑셀·시트엔 안 실린다(칸이 `reserved`로만 읽고, 이 값은
 *    `WeekdayGroupTables` 한 곳으로만 간다). 예약은 출결이 아니라 그 반 학생도 아니다.
 * 🔴 반 집합 = **화면에 선 슬롯의 반**(강사 스코프·과목·프로그램 필터 뒤) — 예약 표를 따로 스코핑하지 않는다(#77).
 * 🔴 fail-soft — 조회 실패·표 미적용이면 슬롯을 그대로 돌려준다(시간표는 hot path, [[#95]]).
 * ⚠️ 그 요일에 배치가 없는 반의 예약은 여기 못 선다(칸이 없다) — 그건 시간표 '보강' 탭이 요일 × 교시로 세운다.
 */
import { createClient } from "@/lib/supabase/server";
import { fetchInChunks } from "@/lib/supabase/batch";
import { getReservationsInWeek } from "@/features/attendance/server/makeup-reservation-queries";
import { toTimetableReservedLine, type TimetableReservedLine } from "@/features/attendance/makeup-reservation";
import { dateOfDowInWeek } from "../lib/week";

type SlotLike = { id: string; classId: string; dayOfWeek: string };

export async function attachReservedLines<T extends SlotLike>(
  slots: readonly T[],
  referenceDate: string,
): Promise<(T & { reserved?: TimetableReservedLine[] })[]> {
  const classIds = [...new Set(slots.map((s) => s.classId).filter(Boolean))];
  if (classIds.length === 0) return [...slots];
  const reservations = await getReservationsInWeek(referenceDate, classIds);
  if (reservations.length === 0) return [...slots];
  const sb = await createClient();
  const students = await fetchInChunks<{ id: string; name: string; grade: string | null; school: string | null }>(
    [...new Set(reservations.map((r) => r.studentId))],
    (chunk) => sb.from("students").select("id, name, grade, school").in("id", chunk),
  ).catch(() => [] as { id: string; name: string; grade: string | null; school: string | null }[]);
  const studentById = new Map(students.map((s) => [s.id, s]));
  const byKey = new Map<string, TimetableReservedLine[]>();
  for (const r of reservations) {
    const stu = studentById.get(r.studentId);
    if (!stu) continue; // 이름을 모르는 줄은 세우지 않는다(지어내지 않는다)
    const k = `${r.classId}|${r.makeupDate}`;
    (byKey.get(k) ?? byKey.set(k, []).get(k)!).push(toTimetableReservedLine(r, stu));
  }
  if (byKey.size === 0) return [...slots];
  return slots.map((s) => {
    const date = dateOfDowInWeek(referenceDate, s.dayOfWeek);
    const lines = date ? byKey.get(`${s.classId}|${date}`) : undefined;
    return lines ? { ...s, reserved: lines } : s;
  });
}
