import "server-only";
/**
 * 학원 설정에 오른 사람 중 **재직이 아닌 사람**을 찾는 조회(퇴사자 권한 정리 — 원장 2026-11-09). 규칙은 [`retired-people.ts`](../retired-people.ts).
 * 퇴사(`inactive`) · 지워져 없는 계정 = 재직 아님. 대기(`pending`)는 재직으로 본다(`saveOwnerSection`의 '재직 직원' 판정과 같다).
 * 다른 지점 계정(운영 계정 등)은 있으면 그대로 둔다 — 지점을 보지 않고 id로 찾는다.
 * ⚠️ 감사로그·캐시 비우기를 싣지 않는 가벼운 모듈이다 — 설정 읽기(`queries.ts`)가 가져다 쓴다(정리 쓰기는 `retired-people.ts`).
 */
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchInChunks } from "@/lib/supabase/batch";

type Db = ReturnType<typeof createAdminClient>;

/** 이 id들 가운데 재직이 아닌 사람(퇴사 · 계정 없음). 조회 실패는 던진다(부르는 쪽이 '거르지 않음'으로 받는다 — 판정은 로그인 자체가 막는다). */
export async function retiredPersonIds(ids: readonly string[], db: Db = createAdminClient()): Promise<Set<string>> {
  const unique = [...new Set(ids)].filter((id) => /^[0-9a-f-]{36}$/i.test(id));
  if (unique.length === 0) return new Set();
  const rows = await fetchInChunks<{ id: string; status: string | null }>(unique, (chunk) => db.from("users").select("id, status").in("id", chunk));
  const status = new Map(rows.map((r) => [String(r.id), r.status]));
  return new Set(unique.filter((id) => !status.has(id) || status.get(id) === "inactive"));
}
