import "server-only";
import type { CurrentUser } from "@/lib/auth/current-user";
import { accessLevelTenant } from "@/lib/auth/perm-matrix";
import { ASSIGNABLE_TEACHER_ROLES } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/server";
import { getTenantSettings } from "@/features/owner/server/queries";
import { buildSubjectMaps } from "@/features/owner/subjects";
import { searchPalette } from "@/features/search/server/queries";
import type { ExploreTarget } from "../model";

/** 검색 팰릿과 같은 안전화 — PostgREST .or()/ilike 구분자·와일드카드 제거(한글·공백 보존). */
const sanitize = (q: string) => q.replace(/[%,()*\\]/g, " ").trim();
const TEACHER_LIMIT = 8;

/**
 * 연결 탐색의 검색 — 원생·수업은 **검색 팰릿과 같은 조회**(`searchPalette`: 강사 스코프·재원 먼저 규칙 그대로),
 * 강사는 수업목록 권한이 있을 때 배정 가능한 재직자 중에서(강사 본인은 자기만). 고르면 그 대상이 새 중심이 된다.
 */
export async function searchExploreTargets(q: string, user: CurrentUser): Promise<ExploreTarget[]> {
  const term = sanitize(q);
  if (term.length < 2) return [];
  const [palette, teachers] = await Promise.all([searchPalette(term, user.systemRole), searchTeachers(term, user)]);
  const fromPalette: ExploreTarget[] = palette.hits
    .filter((h) => h.kind === "student" || h.kind === "class")
    .map((h) => ({ kind: h.kind === "student" ? "student" : "class", id: h.id, label: h.title, detail: h.subtitle }));
  return [...fromPalette.filter((t) => t.kind === "student"), ...fromPalette.filter((t) => t.kind === "class"), ...teachers];
}

async function searchTeachers(term: string, user: CurrentUser): Promise<ExploreTarget[]> {
  const level = await accessLevelTenant(user.systemRole, "classes");
  if (level === "none") return [];
  const supabase = await createClient();
  let qb = supabase
    .from("users")
    .select("id, display_name, english_name, subjects")
    .in("system_role", [...ASSIGNABLE_TEACHER_ROLES])
    .eq("status", "active")
    .or(`display_name.ilike.%${term}%,english_name.ilike.%${term}%`);
  if (level === "scoped") qb = qb.eq("id", user.id);
  const [{ data, error }, settings] = await Promise.all([qb.order("display_name").limit(TEACHER_LIMIT), getTenantSettings()]);
  if (error) {
    console.error(`[explore] 강사 검색 실패: ${error.message}`);
    return [];
  }
  const subjects = buildSubjectMaps(settings.operations.subjects);
  return (data ?? []).map((u) => ({
    kind: "teacher",
    id: u.id,
    label: u.display_name,
    detail: [u.english_name, (Array.isArray(u.subjects) ? (u.subjects as string[]) : []).map((k) => subjects.labelOf(k)).join("·")].filter(Boolean).join(" · ") || null,
  }));
}
