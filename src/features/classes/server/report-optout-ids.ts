import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * '수업보고서 미발송' 반 id 집합 (0174a) — **보고서 표면들의 공용 조회**.
 *
 * 왜 함수 하나로 모으나: 이 기능의 유일한 실패 모드가 "표면 하나를 빠뜨림"(#77)이고, 실제로 소비처가
 * 7곳이다(작성률·영어 작성률·오늘 미작성 신호·직접 발송·반 구성 대조·미발송 재촉·출결 파생).
 * 조회를 각자 짜면 조건이 갈라져 "여기선 빠졌는데 저기선 보인다"가 된다.
 *
 * ⚠️ 세거나 집계하지 않는다 — id whitelist다. 미발송 반은 본질적으로 소수(랩실 몇 개)라 무페이징
 *    select로 충분하지만, **상한을 걸어** 규약(B2: bare unbounded select 금지)을 지킨다. 상한에 닿을
 *    규모면 '미발송'이 예외가 아니라 기본이 됐다는 뜻이라, 그때는 반대로 뒤집는 설계가 맞다.
 * ⚠️ `admin` 클라이언트로 부를 땐 RLS를 우회하므로 **tenantId를 반드시 넘긴다**(유일한 격리선).
 *
 * 🔴 **error를 삼키지 않는다**(규칙 B3 · 2026-07-29 "`data ?? []`는 실패와 빈 결과를 못 가름").
 *    이 함수가 조용히 빈 Set을 돌려주면 미발송 반이 **전 표면에서 한꺼번에 되살아나고**(작성률 분모에
 *    재등장 → 담당 강사 0%, 재촉 알림 발송) 화면은 멀쩡해 보인다. 던져야 위에서 눈에 띄게 실패한다.
 *    배포 순서가 어긋나(컬럼 없음) 42703이 날 때도 여기서 잡히는 게 맞다 — 다른 경로는 이미 그렇게 죽는데
 *    이 경로만 조용히 통과하면 "보고서 화면은 500인데 작성률만 멀쩡"이라는 진단 불가 상태가 된다.
 */
const OPTOUT_CAP = 500;

export async function fetchReportOptoutClassIds(
  // 서버 클라이언트와 admin 클라이언트를 둘 다 받는다(둘의 제네릭 파라미터가 달라 최소 구조로 받음).
  supabase: Pick<SupabaseClient, "from">,
  tenantId?: string,
): Promise<Set<string>> {
  let q = supabase.from("classes").select("id").eq("report_optout", true).limit(OPTOUT_CAP);
  if (tenantId) q = q.eq("tenant_id", tenantId);
  const { data, error } = await q;
  if (error) throw new Error(`수업보고서 미발송 반 조회 실패: ${error.message}`);
  const rows = data ?? [];
  if (rows.length >= OPTOUT_CAP) {
    // 상한에 닿으면 어느 500개가 왔는지 비결정적이다 — 조용히 틀리기 전에 흔적을 남긴다.
    console.error(`[report-optout] 미발송 반이 상한(${OPTOUT_CAP})에 도달 — 판정이 불완전할 수 있습니다`);
  }
  return new Set(rows.map((c) => c.id as string));
}
