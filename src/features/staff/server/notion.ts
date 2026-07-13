import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  isNotionConfigured,
  notionTasksDatabaseId,
  queryDatabaseAll,
  listUsersAll,
} from "@/lib/notion/client";
import {
  NOTION_TASK_PROPS,
  parseNotionTaskPage,
  humanizeNotionError,
  type NotionTask,
} from "@/features/staff/notion-tasks";
import { monthRange } from "@/lib/month-grid";

// Notion 업무 DB → 직원 상세 '월간일정' 조회 + 직원↔Notion 사용자 매핑. 권한 게이트는 호출부(notion-actions.ts).
// 토큰/DB id는 env(lib/notion/client.ts). notion_user_id는 users 컬럼(0098a).

export type MonthlyTasksResult =
  | { ok: true; state: "ok"; tasks: NotionTask[] }
  | { ok: true; state: "not_configured" } // 토큰/DB id 미설정
  | { ok: true; state: "unmapped" } // 이 직원에 Notion 계정 미연결
  | { ok: false; error: string };

export type NotionUserOption = { id: string; name: string; email: string | null };

// 워크스페이스 사용자 목록은 요청 단위 1회만(자동매칭 + 매핑 드롭다운이 같은 렌더에서 각각 부름 → 중복 fetch 방지).
const cachedNotionUsers = cache(() => listUsersAll());

function normEmail(e: string | null | undefined): string {
  return (e ?? "").trim().toLowerCase();
}

/** 직원의 매핑 상태(notion_user_id) + 이메일(자동매칭용). RLS 스코프 — 같은 테넌트만. */
async function staffMappingRow(
  staffId: string,
): Promise<{ notionUserId: string | null; email: string | null }> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("users")
    .select("notion_user_id, email")
    .eq("id", staffId)
    .single();
  const row = data as { notion_user_id?: string | null; email?: string | null } | null;
  return { notionUserId: (row?.notion_user_id ?? null) || null, email: (row?.email ?? null) || null };
}

/**
 * eywa 직원 이메일 == Notion 계정 이메일이면 자동 연결(+ 저장 → 다음부턴 즉시). 없으면 null(수동 폴백).
 * 최초 미매핑 로드에서만 사용자 목록을 조회(요청 캐시). 저장 실패(테넌트 유니크 충돌 등)해도 이번 표시엔 매칭 id 사용.
 */
async function autoMatchByEmail(staffId: string, email: string): Promise<string | null> {
  const target = normEmail(email);
  if (!target) return null;
  const users = await cachedNotionUsers();
  const hit = users.find((u) => u.type === "person" && normEmail(u.person?.email) === target);
  if (!hit) return null;
  try {
    const admin = createAdminClient();
    const { error } = await admin.from("users").update({ notion_user_id: hit.id }).eq("id", staffId);
    if (error) console.warn(`[notion] 이메일 자동매칭 저장 실패(${staffId}): ${error.message}`);
  } catch (e) {
    console.warn(`[notion] 이메일 자동매칭 저장 예외: ${e instanceof Error ? e.message : String(e)}`);
  }
  return hit.id;
}

/**
 * 직원 1명의 특정 월(YYYY-MM) 업무 — Notion DB에서 마감일 기준으로 조회.
 * 연동 미설정/미매핑이면 API 호출 없이 즉시 상태 반환(토큰·컬럼 없어도 안전).
 */
export async function resolveMonthlyTasks(
  staffId: string,
  month: string,
): Promise<MonthlyTasksResult> {
  const dbId = notionTasksDatabaseId();
  if (!isNotionConfigured() || !dbId) return { ok: true, state: "not_configured" };

  // 매핑 우선순위: 저장된 notion_user_id → (없으면) 이메일 자동매칭(+저장) → 그래도 없으면 수동 폴백.
  const { notionUserId, email } = await staffMappingRow(staffId);
  let resolvedId = notionUserId;
  if (!resolvedId && email) {
    try {
      resolvedId = await autoMatchByEmail(staffId, email);
    } catch (e) {
      return { ok: false, error: humanizeNotionError(e instanceof Error ? e.message : String(e)) };
    }
  }
  if (!resolvedId) return { ok: true, state: "unmapped" };

  const { start, endExclusive } = monthRange(month);
  try {
    const pages = await queryDatabaseAll(dbId, {
      filter: {
        and: [
          { property: NOTION_TASK_PROPS.assigneePrimary, people: { contains: resolvedId } },
          { property: NOTION_TASK_PROPS.due, date: { on_or_after: start } },
          { property: NOTION_TASK_PROPS.due, date: { before: endExclusive } },
        ],
      },
      sorts: [{ property: NOTION_TASK_PROPS.due, direction: "ascending" }],
    });
    return { ok: true, state: "ok", tasks: pages.map(parseNotionTaskPage) };
  } catch (e) {
    return { ok: false, error: humanizeNotionError(e instanceof Error ? e.message : String(e)) };
  }
}

/** 워크스페이스 사람 목록(매핑 드롭다운) — 봇 제외, 이름순. 요청 캐시 재사용(자동매칭과 중복 fetch 방지). */
export async function fetchNotionUserOptions(): Promise<NotionUserOption[]> {
  const users = await cachedNotionUsers();
  return users
    .filter((u) => u.type === "person")
    .map((u) => ({ id: u.id, name: u.name?.trim() || "(이름 없음)", email: u.person?.email ?? null }))
    .sort((a, b) => a.name.localeCompare(b.name, "ko"));
}

/** 직원 ↔ Notion 사용자 매핑 저장(같은 테넌트 검증 후 admin update). account-actions.loadTarget 패턴. */
export async function setStaffNotionUserIdRow(
  staffId: string,
  notionUserId: string | null,
  actorTenantId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const admin = createAdminClient();
  const { data: target, error: readErr } = await admin
    .from("users")
    .select("tenant_id")
    .eq("id", staffId)
    .single();
  if (readErr || !target) return { ok: false, error: "대상 직원을 찾을 수 없습니다" };
  if ((target as { tenant_id: string }).tenant_id !== actorTenantId)
    return { ok: false, error: "다른 지점의 계정은 변경할 수 없습니다" };

  const { error } = await admin.from("users").update({ notion_user_id: notionUserId }).eq("id", staffId);
  if (error) return { ok: false, error: "매핑 저장에 실패했습니다" };
  return { ok: true };
}
