import "server-only";
import { unstable_cache } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  isNotionConfigured,
  notionTasksDatabaseId,
  queryDatabaseAll,
  listCommentsAll,
  createComment,
} from "@/lib/notion/client";
import {
  NOTION_TASK_PROPS,
  parseNotionTaskPage,
  humanizeNotionError,
  type NotionTask,
} from "@/features/staff/notion-tasks";
import { monthRange, shiftMonth } from "@/lib/month-grid";
import { kstMonth } from "@/lib/date-kst";

// Notion 업무 DB → 직원 상세 '월간일정' 조회 + 직원↔Notion 사용자 매핑. 권한 게이트는 호출부(notion-actions.ts).
// 토큰/DB id는 env(lib/notion/client.ts). notion_user_id는 users 컬럼(0100a).

export type MonthlyTasksResult =
  | { ok: true; state: "ok"; tasks: NotionTask[] }
  | { ok: true; state: "not_configured" } // 토큰/DB id 미설정
  | { ok: true; state: "unmapped" } // 이 직원에 Notion 계정 미연결
  | { ok: false; error: string };

export type NotionUserOption = { id: string; name: string; email: string | null };

// 담당자 후보 = 업무의 담당자(정/부)에 등장하는 Notion 사람들. ⚠️ /users(멤버 목록)는 게스트를 안 주므로
// (이 워크스페이스는 멤버 1명 + 나머지 담당자는 게스트) 쓸 수 없다 — 업무에서 직접 수집해야 이메일까지 잡힌다.
// ⚠️ 전건 스캔 금지(B2/B7): 실 DB 4,000건+ = 순차 40+왕복 = 서버리스 타임아웃 → 탭이 안 열림(2026-07-13 실측,
// 3개월 한정도 19페이지·65초). 그래서 ①이 스캔은 **페이지 첫 페인트에서 절대 부르지 않고**(미매핑=즉시 반환,
// 매핑 준비는 클라가 액션으로 지연 호출) ②최신 마감순 정렬+8페이지(800행≈최근 5~6주) 상한 ③10분 캐시(B6).
const loadNotionAssignees = unstable_cache(
  async (dbId: string): Promise<NotionUserOption[]> => {
    const cutoff = `${shiftMonth(kstMonth(), -3)}-01`;
    const pages = await queryDatabaseAll(
      dbId,
      {
        filter: { property: NOTION_TASK_PROPS.due, date: { on_or_after: cutoff } },
        sorts: [{ property: NOTION_TASK_PROPS.due, direction: "descending" }],
      },
      { maxPages: 8 },
    );
    const seen = new Map<string, NotionUserOption>();
    for (const pg of pages) {
      for (const key of [NOTION_TASK_PROPS.assigneePrimary, NOTION_TASK_PROPS.assigneeSecondary]) {
        const prop = pg.properties?.[key];
        if (prop && prop.type === "people") {
          for (const p of prop.people ?? []) {
            if (p?.id && !seen.has(p.id)) {
              seen.set(p.id, { id: p.id, name: p.name?.trim() || "(이름 없음)", email: p.person?.email ?? null });
            }
          }
        }
      }
    }
    return [...seen.values()];
  },
  ["notion-task-assignees"],
  { revalidate: 600 },
);

/** 담당자 후보 목록(게스트 포함). DB 미설정이면 빈 배열. */
async function cachedNotionAssignees(): Promise<NotionUserOption[]> {
  const dbId = notionTasksDatabaseId();
  if (!dbId) return [];
  return loadNotionAssignees(dbId);
}

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

export type MappingPrep =
  | { state: "matched" } // 연결됨(이미 매핑 or 이메일 자동연결+저장) — 호출부는 월간 업무 재조회
  | { state: "options"; options: NotionUserOption[] } // 자동 불가 — 수동 후보(사무실만)
  | { state: "none" }; // 자동 불가 + 후보 비노출(비사무실)

/**
 * 미매핑 직원의 매핑 준비 — 이메일 자동연결 시도(성공 시 저장) 또는 수동 후보 반환.
 * ⚠️ 첫 페인트가 아니라 **클라 액션에서 지연 호출**되는 무거운 경로(담당자 스캔 수 초).
 */
export async function prepareStaffNotionMappingRow(
  staffId: string,
  actorTenantId: string,
  includeOptions: boolean,
): Promise<MappingPrep> {
  const { notionUserId, email } = await staffMappingRow(staffId);
  if (notionUserId) return { state: "matched" };

  const people = await cachedNotionAssignees();
  const target = normEmail(email);
  const hit = target ? people.find((u) => normEmail(u.email) === target) : undefined;
  if (hit) {
    const saved = await setStaffNotionUserIdRow(staffId, hit.id, actorTenantId);
    if (!saved.ok) console.warn(`[notion] 이메일 자동매칭 저장 실패(${staffId}): ${saved.error}`);
    return { state: "matched" };
  }
  if (!includeOptions) return { state: "none" };
  return { state: "options", options: [...people].sort((a, b) => a.name.localeCompare(b.name, "ko")) };
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

  // ⚠️ 여기(첫 페인트)선 Notion 스캔 금지 — 미매핑이면 즉시 반환하고, 이메일 자동매칭·후보 로드는
  // 클라가 화면 표시 후 prepareStaffNotionMappingRow(액션)로 지연 호출한다(B7, 2026-07-13 타임아웃 실측).
  const { notionUserId } = await staffMappingRow(staffId);
  if (!notionUserId) return { ok: true, state: "unmapped" };
  const resolvedId = notionUserId;

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

export type TaskComment = { id: string; author: string; time: string | null; text: string };

/** 태스크(페이지) 댓글 목록 — 작성자명은 담당자 후보(게스트 포함)에서 해결. 못 찾으면 "Notion"으로 폴백. */
export async function fetchTaskComments(pageId: string): Promise<TaskComment[]> {
  const [comments, people] = await Promise.all([
    listCommentsAll(pageId),
    cachedNotionAssignees().catch(() => [] as NotionUserOption[]),
  ]);
  const nameById = new Map(people.map((u) => [u.id, u.name]));
  return comments.map((c) => ({
    id: c.id,
    author: (c.created_by?.id ? nameById.get(c.created_by.id) : "") || "Notion",
    time: c.created_time ?? null,
    text: (c.rich_text ?? [])
      .map((t) => t.plain_text ?? "")
      .join("")
      .trim(),
  }));
}

/** 태스크에 댓글 추가 — API 댓글은 통합(봇)으로 표기되므로 eywa 작성자명을 접두로 붙여 출처 보존. */
export async function addTaskComment(pageId: string, text: string, authorName: string): Promise<void> {
  const body = `[eywa · ${authorName}] ${text}`.slice(0, 2000);
  await createComment(pageId, body);
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
