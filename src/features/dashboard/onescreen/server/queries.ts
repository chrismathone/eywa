import { createClient } from "@/lib/supabase/server";
import { kstToday } from "@/lib/date-kst";
import { buildWeeklyChange, weeklyChangeStart, type WeeklyChangeBucket } from "../weekly-change";

/**
 * 한 화면 대시보드가 새로 필요로 하는 조회 — 지금은 **4주 등록/퇴원** 하나뿐이다.
 *
 * 🔴 기존 대시보드 조회(`features/dashboard/server/queries.ts`)를 건드리지 않고 여기 따로 둔다 —
 *    옛 화면과 새 화면이 같은 파일을 밀면 한쪽을 고칠 때 다른 쪽이 조용히 바뀐다.
 */

/**
 * 최근 4주 주별 등록·퇴원 수.
 *
 * 🔴 **집계를 JS에서 하되 창이 조회를 이미 좁힌다** — 4주면 이 학원 기준 수십 행이라 1000행 절단([[#54]])
 *    과 무관하다. 창을 넓힐 일이 생기면 그때는 group-by RPC로 옮길 것(창 없는 전건 select 금지).
 * 🔴 세는 것은 **등록 처리일**(`enrolled_at`)과 **퇴원 처리일**(`withdrawn_at`)이다 — 수강 시작일이
 *    아니다(둘을 섞으면 이 차트와 학생목록이 다른 학원이 된다, 설계서 §8-5).
 * ⚠️ 퇴원은 `status`를 보지 않고 **날짜가 그 창에 있는지**로 센다 — 퇴원했다가 복구된 학생은 지금
 *    상태가 `enrolled`라 상태로 거르면 그 주의 퇴원이 통째로 사라진다(그 주엔 실제로 나갔다).
 */
export async function getWeeklyChange(weeks = 4): Promise<WeeklyChangeBucket[]> {
  const today = kstToday();
  const from = weeklyChangeStart(today, weeks);
  const supabase = await createClient();
  const [enrolledRes, withdrawnRes] = await Promise.all([
    supabase.from("students").select("enrolled_at").gte("enrolled_at", from),
    supabase.from("students").select("withdrawn_at").gte("withdrawn_at", from),
  ]);
  // 🔴 조회 실패를 빈 배열로 삼키지 않는다 — 그러면 "이번 달 아무도 안 들어왔다"는 **사실 주장**이 된다.
  //    호출부(페이지)가 실패 허용 래퍼로 감싸 카드만 비운다.
  if (enrolledRes.error) throw new Error(`주별 등록 조회 실패: ${enrolledRes.error.message}`);
  if (withdrawnRes.error) throw new Error(`주별 퇴원 조회 실패: ${withdrawnRes.error.message}`);
  const ymd = (v: unknown): string => (typeof v === "string" ? v.slice(0, 10) : "");
  return buildWeeklyChange(
    {
      enrolledOn: (enrolledRes.data ?? []).map((r) => ymd((r as { enrolled_at: unknown }).enrolled_at)),
      withdrawnOn: (withdrawnRes.data ?? []).map((r) => ymd((r as { withdrawn_at: unknown }).withdrawn_at)),
    },
    today,
    weeks,
  );
}
