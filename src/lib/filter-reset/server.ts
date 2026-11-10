import "server-only";
import { cookies } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/auth/current-user";
import { patchMyUiPrefs } from "@/lib/ui-prefs/patch";
import { FILTER_SEEN_COOKIE, isFilterSeenFresh, parseFilterSeen, SAVED_FILTER_KEYS } from "./rules";
import { isRecord } from "@/lib/guards";

/**
 * 필터 10분 초기화의 서버 쪽 — 규칙은 [`rules.ts`](./rules.ts).
 *
 * 이 화면을 이 브라우저에서 10분 안에 봤나(쿠키). 쿠키를 못 읽는 자리(요청 밖)는 **봤다고 친다** — 종전처럼 저장값을 쓴다.
 */
export async function filterSeenFresh(screenKey: string): Promise<boolean> {
  try {
    const jar = await cookies();
    return isFilterSeenFresh(parseFilterSeen(jar.get(FILTER_SEEN_COOKIE)?.value)[screenKey], Date.now());
  } catch {
    return true;
  }
}

type SavedNs = keyof typeof SAVED_FILTER_KEYS;

/**
 * 계정에 저장된 보기 설정(`ui_prefs.<ns>`)에서 **필터 키만** 10분 규칙으로 거른다 — 그 화면을 10분 넘게 안 봤으면 필터 키를 기본값으로
 * 돌려주고, 저장값도 지운다(안 지우면 다음 렌더가 그 화면을 '방금 본' 것으로 알고 옛 필터를 되살린다).
 * 정렬·보기 키는 손대지 않는다. 저장값이 이미 기본값이면 아무것도 안 한다.
 *
 * `saved`·`defaults`는 그 화면 파서를 거친 완전한 객체여야 한다(키 순서·값 모양이 같아야 비교가 맞다).
 */
export async function freshSavedFilters<T extends object>(ns: SavedNs, saved: T, defaults: T): Promise<T> {
  const { screen, keys } = SAVED_FILTER_KEYS[ns];
  if (await filterSeenFresh(screen)) return saved;
  const s = saved as Record<string, unknown>;
  const d = defaults as Record<string, unknown>;
  const out: Record<string, unknown> = { ...s };
  let changed = false;
  for (const key of keys) {
    if (JSON.stringify(s[key]) === JSON.stringify(d[key])) continue;
    out[key] = d[key];
    changed = true;
  }
  if (changed) await clearSavedFilters(ns, keys);
  return out as T;
}

/**
 * `ui_prefs` **원본**(읽기 함수가 원본에서 키를 바로 꺼내는 화면 — ECS)에서 같은 규칙으로 필터 키를 걷는다. 걷을 게 없거나 10분 안에 봤으면
 * 받은 원본 그대로를 돌려준다.
 */
export async function freshRawUiPrefs(ns: SavedNs, raw: unknown): Promise<unknown> {
  if (!isRecord(raw) || !isRecord(raw[ns])) return raw;
  const { screen, keys } = SAVED_FILTER_KEYS[ns];
  const scope = raw[ns];
  if (!keys.some((key) => key in scope)) return raw;
  if (await filterSeenFresh(screen)) return raw;
  const next: Record<string, unknown> = { ...scope };
  for (const key of keys) delete next[key];
  await clearSavedFilters(ns, keys);
  return { ...raw, [ns]: next };
}

/**
 * `ui_prefs.<ns>`의 필터 키를 지운다 — 공용 부분 저장([`patchMyUiPrefs`](../ui-prefs/patch.ts), 값 `undefined` = 지우기)을 그대로 쓴다.
 * 🔴 **화면을 그리는 도중에 기다려서** 쓴다(`after()` 금지): 응답 뒤 콜백에서는 쿠키를 못 읽어 운영 콘솔의 '지점 보기'(읽기 전용)
 *    판정이 늘 '아님'이 되고, 이 쓰기가 막히지 않고 나간다(가드 tenant-view-wiring.test.ts). 기다리면 보기 중엔 관리자 연결이 막는다.
 *    값이 실제로 기본값과 다를 때만 돈다 — 그 화면을 10분 넘게 안 보고 다시 열 때 한 번이다.
 * ⚠️ 저장은 읽고-고쳐-쓰기라, 창 여럿이 한꺼번에 열리는 아침(복원 간격 250ms)엔 다른 창의 같은 쓰기가 지운 키를 되살릴 수 있다 —
 *    지운 뒤 한 번 읽어 남아 있으면 한 번 더 지운다. 남는 틈: 확인 읽기 **뒤에** 다른 창의 옛 읽기가 덮어쓰면 DB에 옛 필터가 되살아나고,
 *    그 화면은 지금 기본값으로 보이지만 10분 안의 다음 서버 렌더(정렬·쪽 넘김)에서 옛 필터가 다시 걸린다(창 복원 간격이 250ms라 드물다).
 * 실패해도 화면은 이미 기본값이다.
 */
async function clearSavedFilters(ns: SavedNs, keys: readonly string[]): Promise<void> {
  const patch = Object.fromEntries(keys.map((key) => [key, undefined]));
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      if (!(await patchMyUiPrefs(ns, patch)).ok) return;
      if (!(await savedFilterKeysLeft(ns, keys))) return;
    }
  } catch {
    /* 다음에 열 때 다시 걸러진다 */
  }
}

/** 방금 지운 필터 키가 아직(또는 다시) 남아 있나 — 캐시 없는 읽기(`readMyUiPrefs`는 요청 안 캐시라 쓰기 전 값을 준다). */
async function savedFilterKeysLeft(ns: string, keys: readonly string[]): Promise<boolean> {
  const user = await getCurrentUser();
  if (!user) return false;
  const { data, error } = await createAdminClient()
    .from("users")
    .select("ui_prefs")
    .eq("id", user.id)
    .eq("tenant_id", user.tenantId)
    .maybeSingle();
  if (error) return false;
  const scope = isRecord(data?.ui_prefs) ? data.ui_prefs[ns] : null;
  return isRecord(scope) && keys.some((key) => key in scope);
}

