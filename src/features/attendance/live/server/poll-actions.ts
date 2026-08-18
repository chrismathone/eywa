"use server";
/**
 * 폴링용 경량 카운트 — 오늘 출결 화면이 20초마다 부른다.
 *
 * 🔑 **행을 받지 않는다**(`count: "exact", head: true`) — 창마다 도는 폴링이라 왕복 하나가 비싸다(B2·B6).
 *    보드 전체를 다시 계산하는 건 값이 **바뀌었을 때만**(호출부가 router.refresh).
 */
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { accessLevelTenant } from "@/lib/auth/perm-matrix";

/**
 * 그날 출결의 **변화 지문** — 건수만으로는 부족하다.
 *
 * 🔴 `present → absent` 정정은 행이 안 늘어 **건수가 그대로**다. 건수만 비교하면 데스크 화면은 갱신되지
 *    않고 방금 결석으로 바뀐 학생을 계속 '출석'으로 보여준다(벨은 가는데 화면만 거짓말). 그래서
 *    건수와 **가장 최근 기록 시각**을 합친 문자열을 지문으로 쓴다.
 */
export async function getLiveRecordedCount(date: string): Promise<string | null> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const user = await getCurrentUser();
  if (!user) return null;
  if ((await accessLevelTenant(user.systemRole, "attendance")) === "none") return null;

  const supabase = await createClient();
  // 건수는 행을 안 받고(head), 최신 시각은 1행만 — 창마다 도는 폴링이라 왕복 비용을 최소로(B2·B6).
  // 세 번째 축 = 그날 요청 이벤트(입력 요청·데스크 확인 요청) 최신 시각 — 요청은 출결 행을 안 만들어서
  // 이 축이 없으면 상시 띄워 둔 데스크 탭이 "강사 확인 요청" 카드를 다음 출결 기록 때까지 못 본다.
  const [{ count, error }, latest, reqLatest] = await Promise.all([
    supabase.from("attendance_records").select("*", { count: "exact", head: true }).eq("session_date", date),
    supabase
      .from("attendance_records")
      .select("recorded_at")
      .eq("session_date", date)
      .order("recorded_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("notification_events")
      .select("created_at")
      .in("event_type", ["attendance_input_request", "attendance_desk_confirm_request"])
      .like("bucket", `${date}|%`)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  if (error) return null;
  // 요청 축 조회 실패는 지문에서 빈 값으로 — 폴링이 죽는 것보다 표식 갱신이 한 박자 늦는 게 낫다.
  return `${count ?? 0}|${latest.data?.recorded_at ?? ""}|${reqLatest.data?.created_at ?? ""}`;
}
