import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { EMPTY_SEAT_DUTIES, type SeatDuties } from "../duty";

/**
 * 이 직원의 자리 출석부 담당 토글.
 *
 * 🔴 0209a 컬럼이 아직 없으면(원장이 SQL을 돌리기 전) 에러 없이 빈 값으로 떨어진다(#95).
 *    이 조회를 getCurrentUser 같은 전역 select에 합치지 말 것 — 컬럼 부재가 전 화면을 죽인다.
 */
export const getSeatDuties = cache(async (userId: string): Promise<SeatDuties> => {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("users")
    .select("seat_lab_duty, seat_jj_duty")
    .eq("id", userId)
    .maybeSingle();
  if (error || !data) return EMPTY_SEAT_DUTIES;
  return {
    lab: data.seat_lab_duty === true,
    jj: data.seat_jj_duty === true,
  };
});
