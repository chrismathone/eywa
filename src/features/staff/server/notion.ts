import "server-only";
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

/** 직원의 notion_user_id(RLS 스코프 — 같은 테넌트만). 없으면 null. */
async function staffNotionUserId(staffId: string): Promise<string | null> {
  const supabase = await createClient();
  const { data } = await supabase.from("users").select("notion_user_id").eq("id", staffId).single();
  return ((data as { notion_user_id?: string | null } | null)?.notion_user_id ?? null) || null;
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

  const notionUserId = await staffNotionUserId(staffId);
  if (!notionUserId) return { ok: true, state: "unmapped" };

  const { start, endExclusive } = monthRange(month);
  try {
    const pages = await queryDatabaseAll(dbId, {
      filter: {
        and: [
          { property: NOTION_TASK_PROPS.assigneePrimary, people: { contains: notionUserId } },
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

/** 워크스페이스 사람 목록(매핑 드롭다운) — 봇 제외, 이름순. */
export async function fetchNotionUserOptions(): Promise<NotionUserOption[]> {
  const users = await listUsersAll();
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
