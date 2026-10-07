import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { markFolded } from "@/lib/folded-read";
import { parseSeatShareStudents, parseSeatShareUnits, type SeatShareAdjust } from "../seat-share-adjust";

/** 반 × 달 × 선생님 '자리 몫 → 수업 몫' 조정값(0355a). 서버 전용 표 — admin 클라이언트 + `tenant_id` 명시 필터로만 읽고 쓴다([[#104]]). */
export const SEAT_SHARE_TABLE = "attendance_seat_share_adjust";

type Row = { class_id: string; teacher_id: string; units: number | string | null; student_units: unknown };
type DbError = { code?: string | null; message?: string | null };
/** 반 id → 선생님 id → 값. */
export type SeatShareByClass = Map<string, Map<string, SeatShareAdjust>>;
const PAGE = 1000;

/** 표가 아직 없는 스키마(앱이 SQL보다 먼저 나간 사이, [[#95]])의 오류인가 — 조정이 있을 수 없으니 '없음'으로 읽는다. */
export const seatShareTableMissing = (error: DbError | null | undefined) =>
  !!error && (error.code === "42P01" || error.code === "PGRST205");

const shape = (row: Row): SeatShareAdjust | null => {
  const units = parseSeatShareUnits(row.units ?? 0);
  const students = parseSeatShareStudents(row.student_units);
  return units === null || students === null ? null : { units, students };
};

/**
 * 그 달 이 반들의 조정값 **전부**(선생님마다) — 반 id → 선생님 id → 값. 등록 차수 몫(`loadTeacherTermWeights`)이 다른 재료와 **함께** 읽는다(B4).
 * 🔴 이 선생님 것만 읽지 않는다 — 한 줄의 자리 몫을 같은 반 선생님들이 차례로 나눠 가져야 합이 자리 몫을 넘지 않는다
 *    (`seatShareTakeFor` — 따로 읽어 따로 깎으면 같은 자리 시수가 두 선생님 상한에 선다 · 적대 리뷰 2026-10-07).
 * 🔴 못 읽으면 빈 맵에 **'못 읽음' 표식**을 남긴다 — 화면은 종전 그대로 돌고(조정만 상한에 안 실린다), 그 결과를 금액으로 쓰는
 *    명세서는 표식을 보고 산정을 멈춘다(조용히 낮은 금액으로 발행하지 않는다 — 넘겨받은 자리 시수와 같은 규약).
 *    모양이 깨진 줄도 '못 읽음'이다(0으로 읽으면 같은 사고다).
 * ⚠️ 표가 아직 없는 스키마는 표식 없이 빈 맵이다 — 조정 자체가 있을 수 없다.
 * ⚠️ 줄 수는 반 × 선생님이라 적지만 페이지로 끝까지 읽는다(B2 — 잘리면 뒤 선생님 몫이 조용히 빠진다).
 */
export async function loadSeatShareAdjust(
  db: SupabaseClient, tenantId: string, classIds: readonly string[], period: string,
): Promise<SeatShareByClass> {
  const out: SeatShareByClass = new Map();
  const failed = (message: string) => {
    console.error("[seat-share-adjust] 자리 몫 조정 조회 실패 — 등록 차수 몫은 조정 없이 둔다:", message);
    return markFolded(new Map() as SeatShareByClass, "자리 몫 조정을 읽지 못했습니다");
  };
  try {
    for (let i = 0; i < classIds.length; i += 100) {
      const chunk = classIds.slice(i, i + 100);
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await db.from(SEAT_SHARE_TABLE).select("class_id, teacher_id, units, student_units")
          .eq("tenant_id", tenantId).eq("period", period).in("class_id", chunk)
          .order("class_id", { ascending: true }).order("teacher_id", { ascending: true }).range(from, from + PAGE - 1);
        if (error) return seatShareTableMissing(error) ? new Map() : failed(error.message ?? "알 수 없는 오류");
        const rows = (data ?? []) as Row[];
        for (const row of rows) {
          const value = shape(row);
          if (!value) return failed(`저장된 값의 모양이 올바르지 않습니다(${row.class_id})`);
          if (!out.has(row.class_id)) out.set(row.class_id, new Map());
          out.get(row.class_id)!.set(row.teacher_id, value);
        }
        if (rows.length < PAGE) break;
      }
    }
    return out;
  } catch (error) {
    return failed(error instanceof Error ? error.message : String(error));
  }
}

/** 한 반 한 달의 조정값 전부(선생님마다) — 조정 창과 저장이 읽는다. 오류는 던진다(창이 이유를 말한다). */
export async function readClassSeatShare(db: SupabaseClient, tenantId: string, classId: string, period: string): Promise<Map<string, SeatShareAdjust>> {
  const { data, error } = await db.from(SEAT_SHARE_TABLE).select("class_id, teacher_id, units, student_units")
    .eq("tenant_id", tenantId).eq("class_id", classId).eq("period", period);
  if (error) throw error;
  const out = new Map<string, SeatShareAdjust>();
  for (const row of (data ?? []) as Row[]) {
    const value = shape(row);
    if (!value) throw new Error("저장된 자리 몫 조정을 확인해 주세요");
    out.set(row.teacher_id, value);
  }
  return out;
}
