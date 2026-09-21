import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { EMPTY_SEAT_DUTIES, type SeatDuties } from "../duty";
import { isModuleOnForTenant } from "@/features/owner/server/modules";

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

/**
 * **관문용** 담당 토글 — 착지·자리 화면·기록 게이트는 이걸 본다. 자습실(자리) 모듈이 꺼진 학원이면 토글이 켜져 있어도
 * 담당이 아니다(2026-09-22 방향 B — 그 학원엔 자리 출석부가 없다). 직원 정보 화면처럼 **저장값 그대로**가 필요한
 * 곳은 위 `getSeatDuties`를 쓴다(여기서 false로 보이면 폼 저장이 토글을 지운다).
 * 침산은 모듈이 켜져 있어 `getSeatDuties`와 같은 값이다.
 */
export const getActiveSeatDuties = cache(async (userId: string, tenantId: string): Promise<SeatDuties> => {
  if (!(await isModuleOnForTenant(tenantId, "seat_attendance"))) return EMPTY_SEAT_DUTIES;
  return getSeatDuties(userId);
});
