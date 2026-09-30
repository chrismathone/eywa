import "server-only";

/**
 * `attendance_records.taught_by`(0315a, 대신 보강 귀속 강사) **적용 여부 probe** — 가벼운 모듈로 따로 둔다
 * (정산 조립 `collectTierRows`가 부르므로 무거운 의존을 끌고 오지 않게).
 * 🔴 [[#95]] expand/contract — 칸이 없으면 읽는 곳은 칸을 빼고 읽고, 쓰는 곳은 귀속만 빼고 쓴다(저장·정산이 죽지 않게).
 * 캐시: 있음은 영구(칸은 생기기만 한다 — ment-source-db.ts와 같은 결). **없음은 60초**(적대 리뷰 2026-09-30) — 0315a 적용 전엔
 *   강사 보기 출결 저장·월별 출석부 반마다 probe 왕복이 붙어(매트릭스는 병렬 묶음 **앞**의 직렬 왕복) 반응속도를 깎는다.
 *   🔴 **쓰는 곳은 `fresh`**로 부른다 — 적용 직후 60초 동안 대신 보강 귀속을 빼고 쓰면 그 칸 시수가 반 담임에게 간다.
 */
import { createAdminClient } from "@/lib/supabase/admin";

type Admin = ReturnType<typeof createAdminClient>;

let taughtByKnownReady = false;
/** 칸이 **없다**고 확인된 때 — 이 시각까지 읽는 곳은 probe 없이 false(일시 오류는 캐시하지 않는다). */
let taughtByMissingUntil = 0;
const MISSING_RECHECK_MS = 60_000;

/**
 * 칸이 있는가 — 있다고 확인되면 캐시. 실패·부재 = false. admin 환경변수가 없으면(테스트) false.
 * @param opts.fresh 없음 캐시를 무시하고 다시 본다(쓰는 곳 — 귀속을 빼고 쓰는 창을 줄인다).
 */
export async function taughtByColumnReady(adminIn?: Admin, opts: { fresh?: boolean } = {}): Promise<boolean> {
  if (taughtByKnownReady) return true;
  if (!opts.fresh && Date.now() < taughtByMissingUntil) return false;
  let admin: Admin;
  try {
    admin = adminIn ?? createAdminClient();
  } catch {
    return false;
  }
  const { error } = await admin.from("attendance_records").select("taught_by").limit(1);
  if (!error) {
    taughtByKnownReady = true;
    return true;
  }
  if (error.code !== "42703" && !/taught_by/.test(error.message ?? "")) {
    console.warn(JSON.stringify({ level: "warn", scope: "taughtByColumnReady", reason: "probe_failed_transient", message: error.message }));
  } else {
    taughtByMissingUntil = Date.now() + MISSING_RECHECK_MS;
  }
  return false;
}

/** 테스트 전용 — 모듈 캐시 리셋. */
export function _resetTaughtByProbeForTest(): void {
  taughtByKnownReady = false;
  taughtByMissingUntil = 0;
}

