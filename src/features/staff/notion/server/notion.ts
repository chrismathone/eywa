import "server-only";
import { unstable_cache } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  notionConfigFor,
  queryDatabaseAll,
  listCommentsAll,
  createComment,
  listBlockChildren,
  updatePageProps,
  createPage,
  titlePropertyName,
} from "@/lib/notion/client";
import { shiftDays } from "@/features/timetable/lib/week";
import {
  NOTION_TASK_PROPS,
  parseNotionTaskPage,
  notionBlocksToLines,
  humanizeNotionError,
  type NotionTask,
  type ContentLine,
} from "@/features/staff/notion/notion-tasks";
import { monthRange, shiftMonth } from "@/lib/month-grid";
import { kstMonth } from "@/lib/date-kst";
import { logDbError } from "@/lib/supabase/db-error";

// Notion 업무 DB → 직원 상세 '월간일정' 조회 + 직원↔Notion 사용자 매핑. 권한 게이트는 호출부(notion-actions.ts).
// 토큰/DB id/연동 학원은 env(lib/notion/client.ts `notionConfigFor`). notion_user_id는 users 컬럼(0100a).
// 🔴 Notion을 부르는 경로는 모두 `notionConfigFor(학원)`을 먼저 지난다 — 연동 학원이 아니면 API를 부르지 않는다.

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

/** 담당자 후보 목록(게스트 포함). 이 학원이 연동 학원이 아니면 빈 배열 — 후보 목록이 곧 그 워크스페이스의 사람 명단이다. */
async function cachedNotionAssignees(tenantId: string): Promise<NotionUserOption[]> {
  const cfg = notionConfigFor(tenantId);
  if (!cfg) return [];
  return loadNotionAssignees(cfg.dbId);
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

export type TakenMapping = { notionName: string; staffName: string }; // 이미 다른 직원에 연결된 Notion 계정
export type MappingPrep =
  | { state: "matched" } // 연결됨(이미 매핑 or 이메일 자동연결+저장) — 호출부는 월간 업무 재조회
  | { state: "options"; options: NotionUserOption[]; taken: TakenMapping[] } // 자동 불가 — 수동 후보(사무실만)
  | { state: "none" }; // 자동 불가 + 후보 비노출(비사무실)

/** 이 테넌트에서 이미 연결된 notion_user_id → 직원명(중복 연결 방지용). RLS 스코프. */
async function usedNotionIds(): Promise<Map<string, string>> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("users")
    .select("display_name, notion_user_id")
    .not("notion_user_id", "is", null);
  const map = new Map<string, string>();
  for (const u of (data as { display_name: string; notion_user_id: string }[] | null) ?? []) {
    if (u.notion_user_id) map.set(u.notion_user_id, u.display_name);
  }
  return map;
}

/**
 * 미매핑 직원의 매핑 준비 — 이메일 자동연결 시도(성공 시 저장) 또는 수동 후보 반환.
 * ⚠️ 첫 페인트가 아니라 **클라 액션에서 지연 호출**되는 무거운 경로(담당자 스캔 수 초).
 * 수동 후보에서 **이미 다른 직원에 연결된 Notion 계정은 제외**(중복 연결 방지, DB 부분유니크와 정합).
 *
 * `canWrite` = 호출부가 판정한 직원관리 **쓰기** 권한(canWriteTenant(staff)) — 자동연결 **저장**과 수동 후보 노출 둘 다 이것이다.
 * 🔴 읽기 권한이면 이메일이 맞아도 저장하지 않는다(원장 2026-11-05 — 예전엔 월간일정 탭을 여는 것만으로
 *    `users.notion_user_id`가 admin 클라로 써졌다). 'matched'로 답하면 화면이 재조회해도 여전히 미매핑이라
 *    준비 표시에 머물므로, 저장하지 못한 경우는 'none'(자동 불가 + 후보 비노출)으로 답한다.
 */
export async function prepareStaffNotionMappingRow(
  staffId: string,
  actorTenantId: string,
  canWrite: boolean,
): Promise<MappingPrep> {
  if (!notionConfigFor(actorTenantId)) return { state: "none" };
  const { notionUserId, email } = await staffMappingRow(staffId);
  if (notionUserId) return { state: "matched" };
  // 읽기 권한 — 저장도, 후보 노출도 하지 않는다(위 주석). 쓸 수 없으니 담당자 스캔(수 초)도 돌리지 않는다.
  if (!canWrite) return { state: "none" };

  const people = await cachedNotionAssignees(actorTenantId);
  const target = normEmail(email);
  const hit = target ? people.find((u) => normEmail(u.email) === target) : undefined;
  if (hit) {
    const saved = await setStaffNotionUserIdRow(staffId, hit.id, actorTenantId);
    if (!saved.ok) console.warn(`[notion] 이메일 자동매칭 저장 실패(${staffId}): ${saved.error}`);
    return { state: "matched" };
  }

  const used = await usedNotionIds();
  const available: NotionUserOption[] = [];
  const taken: TakenMapping[] = [];
  for (const p of people) {
    const owner = used.get(p.id);
    if (owner) taken.push({ notionName: p.name, staffName: owner });
    else available.push(p);
  }
  available.sort((a, b) => a.name.localeCompare(b.name, "ko"));
  taken.sort((a, b) => a.notionName.localeCompare(b.notionName, "ko"));
  return { state: "options", options: available, taken };
}

/**
 * 직원 1명의 특정 월(YYYY-MM) 업무 — Notion DB에서 마감일 기준으로 조회.
 * 연동 미설정/미매핑이면 API 호출 없이 즉시 상태 반환(토큰·컬럼 없어도 안전).
 */
export async function resolveMonthlyTasks(
  staffId: string,
  month: string,
  tenantId: string,
): Promise<MonthlyTasksResult> {
  const cfg = notionConfigFor(tenantId);
  if (!cfg) return { ok: true, state: "not_configured" };
  const dbId = cfg.dbId;

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

/** 태스크(페이지) 댓글 목록 — 작성자명은 담당자 후보(게스트 포함)에서 해결. aywa가 남긴 댓글(봇 명의)은
 *  본문 패턴을 파싱해 "이름 (aywa)"로 표시하고 표기용 접두는 본문에서 제거. 못 찾으면 "Notion" 폴백. */
export async function fetchTaskComments(pageId: string, tenantId: string): Promise<TaskComment[]> {
  const [comments, people] = await Promise.all([
    listCommentsAll(pageId),
    cachedNotionAssignees(tenantId).catch(() => [] as NotionUserOption[]),
  ]);
  const nameById = new Map(people.map((u) => [u.id, u.name]));
  return comments.map((c) => {
    let author = (c.created_by?.id ? nameById.get(c.created_by.id) : "") || "Notion";
    let text = (c.rich_text ?? [])
      .map((t) => t.plain_text ?? "")
      .join("")
      .trim();
    const m = AYWA_COMMENT_RE.exec(text) ?? AYWA_COMMENT_LEGACY_RE.exec(text);
    if (m) {
      author = `${m[1]} (에이와)`;
      text = (m[2] ?? "").trim();
    }
    return { id: c.id, author, time: c.created_time ?? null, text };
  });
}

/**
 * 태스크에 댓글 추가 — ⚠️ Notion API 한계로 작성자 명의는 항상 통합(봇). 대신 **굵은 이름 + " — aywa에서 작성"**
 * 서식으로 실작성자를 표기(Notion에서 읽기 좋게). aywa 화면은 이 패턴을 파싱해 작성자로 표시.
 */
export async function addTaskComment(pageId: string, text: string, authorName: string): Promise<void> {
  await createComment(pageId, [
    { text: { content: authorName.slice(0, 40) }, annotations: { bold: true } },
    { text: { content: ` — 에이와에서 작성\n${text.slice(0, 1800)}` } },
  ]);
}

// aywa가 남긴 댓글의 작성자 파싱(신형: "이름 — aywa에서 작성\n본문" / 구형: "[aywa · 이름] 본문").
// 🔴 옛 이름(eywa) 시절 댓글이 Notion에 그대로 남아 있다 — 두 이름을 다 받는다(2026-09-21 개명).
const AYWA_COMMENT_RE = /^(.{1,40}?) — (?:[ae]ywa|에이와)에서 작성\n?([\s\S]*)$/;
const AYWA_COMMENT_LEGACY_RE = /^\[[ae]ywa · (.{1,40}?)\] ?([\s\S]*)$/;

/** 업무 본문(Notion 블록) → 표시 라인. 상세창이 열릴 때만 지연 호출(첫 페인트 밖). */
export async function fetchTaskContent(pageId: string): Promise<ContentLine[]> {
  const blocks = await listBlockChildren(pageId);
  return notionBlocksToLines(blocks);
}

// === 쓰기(aywa → Notion) — 명시적 편집만. 자동 양방향 동기화 아님. 권한 게이트는 액션(canWriteTenant staff). ===

/** 업무완료 체크박스 토글 → Notion 반영. */
export async function setTaskDoneRow(pageId: string, done: boolean): Promise<void> {
  await updatePageProps(pageId, { [NOTION_TASK_PROPS.done]: { checkbox: done } });
}

/**
 * 마감일 이동 → Notion 반영. 기간 업무면 시작일도 같은 일수만큼 평행이동(기간 보존).
 * newDue = 드롭한 날짜(YYYY-MM-DD). oldStart/oldDue로 delta 계산.
 */
export async function moveTaskDueRow(
  pageId: string,
  newDue: string,
  oldStart: string | null,
  oldDue: string,
): Promise<void> {
  const props: Record<string, unknown> = { [NOTION_TASK_PROPS.due]: { date: { start: newDue } } };
  if (oldStart && oldStart !== oldDue) {
    // 기간 보존: 시작일을 마감 이동량만큼 평행이동. delta = newDue - oldDue.
    const deltaDays = Math.round(
      (Date.parse(`${newDue}T00:00:00Z`) - Date.parse(`${oldDue}T00:00:00Z`)) / 86400000,
    );
    props[NOTION_TASK_PROPS.start] = { date: { start: shiftDays(oldStart, deltaDays) } };
  }
  await updatePageProps(pageId, props);
}

/** 이 직원의 저장된 notion_user_id(새 업무의 담당자로 필요). 미매핑이면 null. */
export async function resolveStaffNotionId(staffId: string): Promise<string | null> {
  const { notionUserId } = await staffMappingRow(staffId);
  return notionUserId;
}

/** 새 업무 생성 → Notion. 담당자(정) = 이 직원(notionUserId), 제목/마감/시작. 생성 page id 반환. */
export async function createStaffTaskRow(
  dbId: string,
  notionUserId: string,
  input: { title: string; due: string; start?: string | null },
): Promise<string> {
  const titleProp = await titlePropertyName(dbId);
  const properties: Record<string, unknown> = {
    [titleProp]: { title: [{ text: { content: input.title.slice(0, 200) } }] },
    [NOTION_TASK_PROPS.due]: { date: { start: input.due } },
    [NOTION_TASK_PROPS.assigneePrimary]: { people: [{ id: notionUserId }] },
  };
  if (input.start && input.start !== input.due) {
    properties[NOTION_TASK_PROPS.start] = { date: { start: input.start } };
  }
  return createPage(dbId, properties);
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
  if (readErr || !target) {
    logDbError(readErr, "staff.setStaffNotionUserIdRow");
    return { ok: false, error: "대상 직원을 찾을 수 없습니다" };
  }
  if ((target as { tenant_id: string }).tenant_id !== actorTenantId)
    return { ok: false, error: "다른 지점의 계정은 변경할 수 없습니다" };

  // 중복 연결 방지 — 같은 테넌트의 다른 직원이 이미 이 Notion 계정을 쓰고 있으면 거부(UI 필터의 백스톱, DB 부분유니크와 정합).
  if (notionUserId) {
    const { data: dup } = await admin
      .from("users")
      .select("display_name")
      .eq("tenant_id", actorTenantId)
      .eq("notion_user_id", notionUserId)
      .neq("id", staffId)
      .maybeSingle();
    if (dup) return { ok: false, error: `이 Notion 계정은 이미 ${(dup as { display_name: string }).display_name}에 연결되어 있습니다` };
  }

  const { error } = await admin.from("users").update({ notion_user_id: notionUserId }).eq("id", staffId);
  if (error) {
    logDbError(error, "staff.setStaffNotionUserIdRow");
    return { ok: false, error: "매핑 저장에 실패했습니다" };
  }
  return { ok: true };
}
