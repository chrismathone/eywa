import "server-only";
/**
 * 학원 설정에 오른 사람 중 **퇴사가 확인된 사람**과 그 역할을 찾는 조회(퇴사자 권한 정리 — 원장 2026-11-09). 규칙은 [`retired-people.ts`](../retired-people.ts).
 * 🔴 퇴사 = 직원 표에서 재직 상태가 퇴사(`inactive`)로 **확인된** 사람만(리뷰 r1 F3). 계정 행이 없는 사람(지워진 직원 · 직원 표에 없는 운영 계정)은
 *    모르는 사람이라 거르지 않는다 — 걸렀다가 운영 계정 줄이 화면에서 빠지면 원장의 역할·권한 저장이 '운영 설정 변경'으로 통째로 거절된다.
 *    (완전 삭제한 직원은 삭제할 때 정리한다 — `cleanupPersonSettings`.) 대기(`pending`)는 재직으로 본다(저장 검사의 '재직 직원' 판정과 같다).
 * 역할은 개인별 메뉴 권한 줄이 '역할보다 더 주는가'를 견주는 데 쓴다(`userOverrideGrants`).
 * ⚠️ 감사로그·캐시 비우기를 싣지 않는 가벼운 모듈이다 — 설정 읽기(`queries.ts`)가 가져다 쓴다(정리 쓰기는 `retired-people.ts`).
 */
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchInChunks } from "@/lib/supabase/batch";
import { SYSTEM_ROLES, type SystemRole } from "@/lib/permissions";

type Db = ReturnType<typeof createAdminClient>;
const asRole = (v: unknown): SystemRole | null => (typeof v === "string" && (SYSTEM_ROLES as readonly string[]).includes(v) ? (v as SystemRole) : null);

/** 이 id들 가운데 퇴사가 확인된 사람 → 역할(캐시에 싣는 모양 — 배열). 조회 실패는 던진다(부르는 쪽이 '거르지 않음'으로 받는다). */
export async function retiredPeopleEntries(ids: readonly string[], db: Db = createAdminClient()): Promise<[string, SystemRole | null][]> {
  const unique = [...new Set(ids)].filter((id) => /^[0-9a-f-]{36}$/i.test(id));
  if (unique.length === 0) return [];
  const rows = await fetchInChunks<{ id: string; status: string | null; system_role: string | null }>(unique, (chunk) =>
    db.from("users").select("id, status, system_role").in("id", chunk),
  );
  return rows.filter((r) => r.status === "inactive").map((r) => [String(r.id), asRole(r.system_role)]);
}

/** 위와 같은 조회 — 지도로. 역할·권한 면 같은 화면이 캐시 없이 지금 값을 볼 때. */
export async function retiredPeople(ids: readonly string[], db: Db = createAdminClient()): Promise<Map<string, SystemRole | null>> {
  return new Map(await retiredPeopleEntries(ids, db));
}
