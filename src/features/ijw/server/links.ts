import "server-only";

/**
 * 인재원 짝 — aywa 쪽 조회(짝 색인 · 후보 모집단 · 학원 전체 이름 인원)와 **짝 제안**.
 *
 * 🔑 aywa에 저장하는 것은 짝 하나(students.ijw_student_id, 0259a)뿐이다 — 숫자는 매번 인재원에 묻는다.
 * 🔴 조회 실패는 던지지 않고 **실패로 돌려준다** — 이 구역들은 성적관리·학생 상세의 곁가지라, DB가 한 번
 *    삐끗했다고 화면 전체가 오류 화면으로 바뀌면 안 된다(적대 리뷰 2026-09-10).
 * ⚠️ 0259a가 아직 적용되지 않았으면 짝 칸이 없다 — "짝 칸 준비 전"으로 알린다([[#95]]).
 * ⚠️ admin 클라이언트는 RLS를 우회한다 → 조회마다 tenant_id를 건다(tenant-guard.test.ts가 잠근다).
 */
import { cache } from "react";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllPaged, fetchAllPagedInChunks, fetchInChunks } from "@/lib/supabase/batch";
import { kstToday } from "@/lib/date-kst";
import { reportError } from "@/lib/observability/report-error";
import { IJW_FAIL_TEXT, IJW_SCHEMAS } from "../contract";
import { isMissingIjwColumn } from "../db-errors";
import { countNameKeys, suggestLinks, type LinkSuggestion } from "../match";
import { IJW_PATHS, ijwGet, type IjwFailure } from "./client";

export type AywaLink = { studentId: string; name: string; school: string | null; grade: string | null };
export type LinkIndex = { byIjw: Map<string, AywaLink>; columnMissing: boolean; failure: IjwFailure | null };

/** aywa 쪽 조회 실패 → 화면용 실패(원문은 detail 툴팁으로만). 보고는 여기서 한 번. */
export function localFailure(e: unknown, step: string): IjwFailure {
  reportError(e, { scope: "ijw", step });
  const raw = e instanceof Error ? e.message : String(e);
  return { ok: false, kind: "local", message: IJW_FAIL_TEXT.local, detail: raw.slice(0, 200) };
}

function asDbError(e: unknown): { code?: string; message?: string } {
  const o = (e ?? {}) as { code?: unknown; message?: unknown };
  return {
    code: typeof o.code === "string" ? o.code : undefined,
    message: typeof o.message === "string" ? o.message : String(e),
  };
}

/** ijwId → aywa 학생. 요청당 한 번(JJ실은 표와 짝 잇기 구역이 함께 부른다). */
export const loadLinkIndex = cache(async (tenantId: string): Promise<LinkIndex> => {
  const admin = createAdminClient();
  try {
    const rows = await fetchAllPaged<{ id: string; name: string; school: string | null; grade: string | null; ijw_student_id: string }>(
      (from, to) =>
        admin
          .from("students")
          .select("id, name, school, grade, ijw_student_id")
          .eq("tenant_id", tenantId)
          .not("ijw_student_id", "is", null)
          .order("id")
          .range(from, to),
    );
    const byIjw = new Map<string, AywaLink>();
    for (const r of rows) byIjw.set(r.ijw_student_id, { studentId: r.id, name: r.name, school: r.school, grade: r.grade });
    return { byIjw, columnMissing: false, failure: null };
  } catch (e) {
    if (isMissingIjwColumn(asDbError(e))) return { byIjw: new Map(), columnMissing: true, failure: null };
    return { byIjw: new Map(), columnMissing: false, failure: localFailure(e, "link-index") };
  }
});

export type PoolStudent = { id: string; name: string; school: string | null; grade: string | null; classNames: string[] };

/**
 * 짝 후보 모집단 = **지금 영어 반을 다니는** 재원·휴원 학생(인재원은 영어 학습 프로그램이다) + 그 영어 반 이름.
 * 반 이름은 인재원 반 이름과 대조해 후보 근거로 쓴다(인재원 반 = aywa 반 이름인 경우가 있다).
 * ⚠️ `english`는 과목 표준 키(코드 특수동작 허용 범위). 모든 조회에 tenant_id를 건다(admin 우회).
 */
async function loadEnglishPool(tenantId: string): Promise<PoolStudent[]> {
  const admin = createAdminClient();
  const today = kstToday();
  const { data: cls, error } = await admin
    .from("classes")
    .select("id, class_name")
    .eq("tenant_id", tenantId)
    .eq("subject", "english")
    .eq("is_active", true);
  if (error) throw new Error(`loadEnglishPool classes: ${error.message}`);
  const className = new Map((cls ?? []).map((c) => [c.id as string, c.class_name as string]));
  const enr = await fetchAllPagedInChunks<{ id: string; student_id: string; class_id: string }>(
    [...className.keys()],
    (chunk, from, to) =>
      admin
        .from("enrollments")
        .select("id, student_id, class_id")
        .eq("tenant_id", tenantId)
        .in("class_id", chunk)
        .or(`end_date.is.null,end_date.gte.${today}`)
        .order("id")
        .range(from, to),
  );
  const classesOf = new Map<string, Set<string>>();
  for (const e of enr) {
    const set = classesOf.get(e.student_id) ?? new Set<string>();
    set.add(className.get(e.class_id) ?? "");
    classesOf.set(e.student_id, set);
  }
  const studs = await fetchInChunks<{ id: string; name: string; school: string | null; grade: string | null }>(
    [...classesOf.keys()],
    (chunk) =>
      admin
        .from("students")
        .select("id, name, school, grade")
        .eq("tenant_id", tenantId)
        .in("id", chunk)
        .in("status", ["enrolled", "on_hold"]),
  );
  return studs
    .map((s) => ({ ...s, classNames: [...(classesOf.get(s.id) ?? [])].filter(Boolean).sort() }))
    .sort((a, b) => a.name.localeCompare(b.name, "ko"));
}

/**
 * 학원 **전체** 학생(상태 불문 — 퇴원생 포함) 이름 키별 인원 — '한 번에 연결'의 유일성 판정(match.ts).
 * 후보 모집단(지금 영어 반)만으로 세면 그만둔 동명이인이 안 보여 새 아이가 옛 아이의 인재원 기록에 이어진다.
 */
async function loadTenantNameCounts(tenantId: string): Promise<Map<string, number>> {
  const admin = createAdminClient();
  const rows = await fetchAllPaged<{ id: string; name: string | null }>((from, to) =>
    admin.from("students").select("id, name").eq("tenant_id", tenantId).order("id").range(from, to),
  );
  return countNameKeys(rows.map((r) => r.name ?? ""));
}

export type LinkSuggestions =
  | { ok: true; suggestions: LinkSuggestion[]; pool: PoolStudent[]; columnMissing: boolean }
  | IjwFailure;

/**
 * 짝 제안(관리자 전용 화면·'한 번에 연결' 서버 재계산) — 인재원 학생 목록 × 짝 없는 aywa 영어 학생.
 * `pool`은 후보에 없을 때 사람이 직접 찾아 고르는 목록(짝 없는 학생만).
 */
export async function getIjwLinkSuggestions(tenantId: string): Promise<LinkSuggestions> {
  const [res, links, local] = await Promise.all([
    ijwGet(tenantId, IJW_PATHS.students(), IJW_SCHEMAS.students),
    loadLinkIndex(tenantId),
    Promise.all([loadEnglishPool(tenantId), loadTenantNameCounts(tenantId)]).catch((e: unknown) =>
      localFailure(e, "link-pool"),
    ),
  ]);
  if (!res.ok) return res;
  if (links.failure) return links.failure;
  if (!Array.isArray(local)) return local;
  const [pool, aywaNameCounts] = local;
  const linkedIds = new Map<string, string>(); // aywa 학생 id → 걸린 ijwId
  for (const [ijwId, l] of links.byIjw) linkedIds.set(l.studentId, ijwId);
  const suggestions = suggestLinks(
    res.data.students,
    pool.map((s) => ({ ...s, ijwId: linkedIds.get(s.id) ?? null })),
    { aywaNameCounts },
  ).filter((s) => !links.byIjw.has(s.ijw.ijwId));
  return {
    ok: true,
    suggestions,
    pool: pool.filter((s) => !linkedIds.has(s.id)),
    columnMissing: links.columnMissing,
  };
}
