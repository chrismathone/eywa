import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllPaged } from "@/lib/supabase/batch";
import { hhmm, MOVABLE_SEATS } from "@/features/attendance/seat/seat";
import type { SeatPinRow } from "../lib/seat-pin-mark";

/**
 * 시간표가 읽는 **자리 교시 고정**(0255a `seat_period_pins`) — 표식 재료 한 벌.
 *
 * 🔴 **admin 클라이언트 + 명시 `tenant_id` 필터**로만 읽는다. 그 표는 RLS 정책이 **0개**라 세션
 *    클라이언트로 읽으면 **에러 없이 0행**이 온다([[#104]]) — 조용히 표식이 사라지는 쪽이라 더 나쁘다.
 * 🔴 **fail-soft**([[#95]]) — 0255a는 원장이 손으로 적용한다. 표가 없어도 시간표는 그대로 살아야 하고
 *    표식만 안 붙는다. 그래서 여기선 **어떤 실패도 삼켜 빈 배열**로 떨어진다(시간표는 전 직원이 매일
 *    여는 화면이고, 표식은 있으면 좋은 부가 신호지 화면의 뼈대가 아니다).
 * 🔑 **왕복은 주당 한 번**이고 요일 수·교시 수와 무관하다 — 시간표는 창(iframe)마다 셸이 다시 도는
 *    화면이라(B6) 요일별로 나눠 부르면 그 비용이 7배가 된다. 요일 축은 화면에서 나눈다.
 *
 * ⚠️ **하루짜리 이동(`seat_period_moves`)은 일부러 안 읽는다** — 원장이 말한 것은 "영구 이동"이고,
 *    주간 시간표에 그날 하루 사정을 실으면 주가 바뀔 때마다 표식이 나타났다 사라진다.
 *    (자리 출석부는 둘 다 필요해서 [`getSeatPeriodChoices`](../../attendance/seat/server/period-choice.ts)로
 *     하루치를 읽는다 — 축이 다른 조회라 그 함수를 여기서 그대로 쓰면 주 한 판에 왕복이 14회가 된다.)
 */
export async function getSeatPins(tenantId: string): Promise<SeatPinRow[]> {
  // 교시를 옮길 수 있는 자리가 하나도 없으면 물어볼 것이 없다(설정이 좁아지면 왕복도 0으로).
  if (MOVABLE_SEATS.length === 0) return [];
  try {
    // 🔴 클라이언트 생성도 try 안에 둔다 — service_role 키가 없으면 여기서 throw하는데, 밖에 두면
    //    **시간표 전체가 500**이 된다(부가 표식 하나 때문에 전 직원이 매일 여는 화면이 죽는 꼴).
    const supabase = createAdminClient();
    // 🔴 무페이징 select 금지(B2) — 고정이 쌓이면 1000행에서 **조용히 잘려** 일부 학생만 표식이
    //    사라진다(에러가 안 난다). `.order("id")`는 OFFSET 페이지가 흔들리지 않게 하는 tie-break.
    const rows = await fetchAllPaged<{
      seat: string;
      day_of_week: string;
      class_id: string;
      student_id: string;
      slot_start: string;
      effective_from: string;
    }>((from, to) =>
      supabase
        .from("seat_period_pins")
        .select("seat, day_of_week, class_id, student_id, slot_start, effective_from")
        .eq("tenant_id", tenantId)
        .in("seat", [...MOVABLE_SEATS])
        .order("id")
        .range(from, to),
    );
    return rows.map((r) => ({
      seat: r.seat,
      dayOfWeek: r.day_of_week,
      classId: r.class_id,
      studentId: r.student_id,
      slotStart: hhmm(r.slot_start),
      effectiveFrom: String(r.effective_from).slice(0, 10),
    }));
  } catch {
    // 표가 아직 없다(42P01/PGRST205)도, 그냥 실패도 여기선 **같은 결말**이다 — 표식만 안 붙는다.
    // (원인을 갈라 배너로 말하는 것은 자리 출석부의 몫이다. 시간표엔 이 기능의 스위치가 없어서,
    //  여기서 배너를 띄우면 아무도 손쓸 수 없는 경고가 매일 뜬다.)
    return [];
  }
}
