import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * LAB '따로 수업(*LAB)' 표식(0271a `class_schedules.lab_separate`) 조회 — **단일 진입점**.
 *
 * 원장 2026-09-17 *"랩실 옆에 토글키를 두고 토글하게 되면 LAB -> *LAB 밑줄 + 이탤릭체"*.
 *
 * 🔴 왜 기존 select에 컬럼을 안 끼우나([[#95]]): 시간표 뿌리 조회·반 수정 폼·반 저장·반 드래그가 전부
 *    `class_schedules`를 명시 컬럼으로 읽는다. 칸이 없는 DB(롤백·새 환경)에서 거기에 끼우면 **시간표가 500**,
 *    반 수정 폼은 오류를 삼켜 빈 격자로 열린다(그대로 저장하면 그 반의 교시가 전부 마감된다).
 *    그래서 표식은 **켜진 행의 id만** 따로 받는다.
 *
 * 🔑 결과가 **셋**이다(적대적 리뷰 2026-09-17 — 둘로 뭉치면 일시 실패가 "칸 없음"이 되어 저장이 표식을 조용히 끈다):
 *  · `{ ids }`     — 칸 있음. 켜진 행 id.
 *  · `"missing"`  — 칸이 없다(42703·PGRST204). 쓰기 경로는 insert에서 `lab_separate`를 **뺀다**.
 *  · `"error"`    — 그 밖의 실패. **쓰기 경로는 멈춘다**(delete 뒤 재insert가 기본값 false로 표식을 지운다).
 *    읽기(표시) 경로는 `labSeparateIdsOrNull`로 둘 다 "모름"으로 떨어진다.
 */
export type LabSeparateLookup = { ids: Set<string> } | "missing" | "error";

type Scope =
  | { kind: "class"; classId: string }
  /** 반 여러 개(원생 주간 시간표) — 격리는 RLS가 한다(세션 클라 전용, admin 경로는 쓰지 말 것). */
  | { kind: "classes"; classIds: readonly string[] }
  | { kind: "ids"; ids: readonly string[]; tenantId: string }
  | { kind: "window"; from: string; to: string; tenantId?: string };

const MISSING_CODES = new Set(["42703", "PGRST204"]);

/**
 * 이 오류가 **칸이 없어서**인가(42703 · PGRST204 · 본문에 칸 이름). 쓰기 경로가 "키를 빼고 다시"를 판단한다.
 * 🔴 아무 오류에나 다시 넣지 말 것 — 1차가 커밋됐는데 응답만 실패한 경우 같은 행이 두 벌이 된다(재리뷰 2026-09-17).
 */
export function isMissingColumnError(error: { code?: string | null; message?: string | null } | null | undefined): boolean {
  if (!error) return false;
  if (MISSING_CODES.has(String(error.code ?? ""))) return true;
  return (error.message ?? "").includes("lab_separate");
}
const PAGE = 1000;

export async function lookupLabSeparateIds(db: SupabaseClient, scope: Scope): Promise<LabSeparateLookup> {
  if (scope.kind === "ids" && scope.ids.length === 0) return { ids: new Set() };
  if (scope.kind === "classes" && scope.classIds.length === 0) return { ids: new Set() };
  try {
    const ids = new Set<string>();
    // 켜진 행만이라 몇십 행이지만 결과를 id 명단으로 쓰니 페이징한다(B2). 오류 코드를 봐야 해서 헬퍼(fetchAllPaged)를 안 쓴다.
    for (let from = 0; ; from += PAGE) {
      let q = db.from("class_schedules").select("id").eq("lab_separate", true);
      if (scope.kind === "class") q = q.eq("class_id", scope.classId);
      else if (scope.kind === "classes") q = q.in("class_id", [...scope.classIds]);
      else if (scope.kind === "ids") q = q.in("id", [...scope.ids]).eq("tenant_id", scope.tenantId);
      else {
        q = q.lte("valid_from", scope.to).or(`valid_to.is.null,valid_to.gte.${scope.from}`);
        if (scope.tenantId) q = q.eq("tenant_id", scope.tenantId); // admin(cron) 경로 — RLS 우회라 명시 격리
      }
      const { data, error } = await q.order("id").range(from, from + PAGE - 1);
      if (error) return MISSING_CODES.has(String((error as { code?: string }).code ?? "")) ? "missing" : "error";
      for (const r of data ?? []) ids.add(String((r as { id: string }).id));
      if (!data || data.length < PAGE) break;
    }
    return { ids };
  } catch {
    return "error";
  }
}

/** 표시 경로용 — 칸 없음·실패를 모두 "모름"(null)으로. 모르면 표식 없이 그린다. */
export async function loadLabSeparateIds(db: SupabaseClient, scope: Scope): Promise<Set<string> | null> {
  const r = await lookupLabSeparateIds(db, scope);
  return typeof r === "object" ? r.ids : null;
}
