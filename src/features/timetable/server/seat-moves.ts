import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllPaged } from "@/lib/supabase/batch";
import { hhmm, MOVABLE_SEATS } from "@/features/attendance/seat/seat";
import type { SeatMoveRow } from "../lib/virtual-lab";
import { weekBoundsOf } from "../lib/week";
import { getSeatLiveSlots } from "./seat-pins";

/**
 * 시간표 통합뷰 **\*LAB 임시 칸**의 재료 — 표시 주의 **하루짜리** 교시 이동(0255a `seat_period_moves`).
 * 원장 2026-09-11 *"랩실에서 드래그로 시간을 이동시키면, 시간표에서도 LAB이 … *LAB 같은식으로 임시 추가"*.
 *
 * 🔴 **admin 클라이언트 + 명시 `tenant_id` 필터** — 그 표는 RLS 정책이 0개라 세션 클라이언트로 읽으면 에러 없이
 *    0행이다([[#104]]).
 * 🔴 **표시 주 범위만**(월~일, `weekBoundsOf`) — 필터 없는 전건 select 금지(B2). 주 범위라 수 줄이지만 페이지네이션은
 *    그대로 둔다(1000행에서 조용히 잘리면 그 뒤 학생의 칸만 사라진다).
 * 🔴 **fail-soft**([[#95]]) — 0255a 미적용·조회 실패 = **null(모름)** → 그 주엔 *LAB 없음, 시간표는 지금 그대로.
 *    🔴 빈 배열로 삼키지 말 것 — "이동 0줄"과 구분이 안 되어 page가 **고정만 보고** 칸을 세운다. 그러면 "오늘만 제
 *    교시로" 되돌린 학생이 고정 교시에 `*LAB`으로 선다(자리 출석부는 그날 제 교시에 세운다 — 두 화면이 갈린다).
 *    page는 고정·이동 중 하나라도 모르면 칸을 안 세운다([`knownLabSources`](../lib/virtual-lab.ts)).
 * ⚠️ 이 값은 *LAB 칸에만 간다 — 학생 이름 표식(파란 밑줄, `seat-pin-mark`)은 여전히 **상시 고정만** 본다
 *    (원장이 그 표식에 말한 것은 "영구 이동"이다).
 */
export async function getSeatWeekMoves(tenantId: string, referenceDate: string): Promise<SeatMoveRow[] | null> {
  // 교시를 옮길 수 있는 자리가 없으면 물어볼 것도 없다(설정이 좁아지면 왕복도 0).
  if (MOVABLE_SEATS.length === 0) return [];
  try {
    // 🔴 클라이언트 생성도 try 안 — service_role 키가 없으면 여기서 throw하는데, 밖이면 시간표 전체가 500이다.
    const supabase = createAdminClient();
    const { start, end } = weekBoundsOf(referenceDate);
    const rows = await fetchAllPaged<{
      seat: string;
      session_date: string;
      class_id: string;
      student_id: string;
      slot_start: string;
    }>((from, to) =>
      supabase
        .from("seat_period_moves")
        .select("seat, session_date, class_id, student_id, slot_start")
        .eq("tenant_id", tenantId)
        .in("seat", [...MOVABLE_SEATS])
        .gte("session_date", start)
        .lte("session_date", end)
        .order("id")
        .range(from, to),
    );
    const moves = rows.map((r) => ({
      seat: r.seat,
      sessionDate: String(r.session_date).slice(0, 10),
      classId: r.class_id,
      studentId: r.student_id,
      slotStart: hhmm(r.slot_start),
    }));
    // 🔑 이동이 있으면 학원 전체 자리 배치를 **이 병렬 가지 안에서** 읽어 둔다(`getSeatLiveSlots` = React cache).
    //    안 그러면 고정이 0건인 주(이동만 있는 주)엔 page가 초기 `Promise.all` **뒤에** 처음 물어, 통합뷰 창을 열
    //    때마다 첫 페인트 앞에 왕복이 하나 더 붙는다(B4 · 창마다 — B6). 고정이 있으면 `getSeatPins`가 같은 일을 한다.
    //    이동이 0건이면 묻지 않는다(평소 왕복 불변). 배치 조회가 실패해도 이동은 버리지 않는다(칸만 안 선다).
    if (moves.length > 0) await getSeatLiveSlots(tenantId, referenceDate).catch(() => null);
    return moves;
  } catch {
    // 표가 아직 없다(42P01/PGRST205)도 그냥 실패도 같은 결말 — 칸만 안 선다(시간표엔 이 기능의 스위치가 없다).
    // 🔴 `[]`가 아니라 null — 모름을 0줄로 바꾸면 고정만 보고 거짓 칸이 선다(파일 머리 🔴).
    return null;
  }
}
