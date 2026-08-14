import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";

/**
 * 이 직원의 '오늘 출결 데스크 알림' 토글.
 * 0211a 컬럼이 없으면 에러 없이 꺼짐(#95) — 직원 상세를 죽이지 않는다.
 */
export const getDeskAttendanceOptin = cache(async (userId: string): Promise<boolean> => {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("users")
    .select("desk_attendance_optin")
    .eq("id", userId)
    .maybeSingle();
  if (error || !data) return false;
  return data.desk_attendance_optin === true;
});
