import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { fetchAllPaged } from "@/lib/supabase/batch";

import { fillSchoolKind, normalizeSchoolName, schoolKindCandidate, type SchoolSaveAlias } from "../school-name";

/**
 * 저장할 학교 표기에 빠진 학교급을 채운다(`칠성` + 학년 `초5` → `칠성초`). 후보가 그 지점 학교알리미 목록
 * (`school_enrollment_stats.name_key`)에 있을 때만 바꾸고, 아니면 받은 값 그대로 돌려준다.
 *
 * 급이 이미 있는 대부분의 저장은 조회 없이 끝난다(후보가 없으면 바로 반환). 조회 실패도 저장을 막지 않는다.
 * 🔴 `tenantId`는 늘 넘긴다 — QR 접수는 RLS를 우회하는 admin 클라이언트로 부른다.
 * 🔴 급을 채운 값에도 저장 별칭(학원설정 `schoolSaveAliases` — 침산 `일중`→`대구일중`)을 다시 건다.
 */
export async function completeSchoolKind(
  client: Pick<SupabaseClient, "from">,
  tenantId: string,
  school: string | null,
  grade: string | null | undefined,
  aliases: readonly SchoolSaveAlias[],
): Promise<string | null> {
  const candidate = schoolKindCandidate(school, grade);
  if (!candidate) return school;
  const { data, error } = await client
    .from("school_enrollment_stats")
    .select("name_key")
    .eq("tenant_id", tenantId)
    .eq("name_key", normalizeSchoolName(candidate))
    .limit(1);
  if (error) {
    console.error("[completeSchoolKind]", error.message);
    return school;
  }
  return fillSchoolKind(school, grade, new Set((data ?? []).map((r) => r.name_key as string)), aliases);
}

/** 그 지점 학교알리미 학교 키 전부(여러 해가 겹쳐 있어 중복은 Set이 접는다) — 줄이 많은 엑셀 가져오기가 한 번만 읽는다. */
export async function loadSchoolKeys(client: Pick<SupabaseClient, "from">, tenantId: string): Promise<Set<string>> {
  const rows = await fetchAllPaged<{ name_key: string }>((from, to) =>
    client.from("school_enrollment_stats").select("name_key").eq("tenant_id", tenantId).order("id").range(from, to),
  );
  return new Set(rows.map((r) => r.name_key));
}
