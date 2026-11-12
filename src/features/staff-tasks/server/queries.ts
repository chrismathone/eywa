import "server-only";
import { fetchAllPaged, fetchInChunks } from "@/lib/supabase/batch";
import { createAdminClient } from "@/lib/supabase/admin";
import { getTenantSettings } from "@/features/owner/server/queries";
import type { StaffTaskEvent, StaffTaskFilter, StaffTaskItem, StaffTaskList, StaffTaskPerson, StaffTaskStatus } from "../kinds";
import { hiddenStaffTaskKinds } from "../task-visibility";

/**
 * 할 일 조회 — 표는 서버 전용(0377a 정책 0개)이라 관리 키로 읽는다. 🔴 모든 조회에 지점(tenant_id) 조건 —
 * 사람 확인(맡은 사람 / 현황 권한)은 부르는 쪽이 `getStaffTaskViewer`로 먼저 한다.
 */
export const TASK_PAGE_SIZE = 30;

const COLUMNS = "id, kind, title, detail, link, status, opened_at, due_at, closed_at, closed_by, close_reason";
type Row = {
  id: string; kind: string; title: string; detail: string | null; link: string | null; status: StaffTaskStatus;
  opened_at: string; due_at: string | null; closed_at: string | null; closed_by: string | null; close_reason: string | null;
};

/** 사람별 열린 할 일 · 늦음(DB에서 센다 — B2). user를 주면 그 사람 것만. */
export async function countOpenTasks(
  tenantId: string,
  userId?: string,
  hiddenKinds?: readonly string[],
): Promise<Map<string, { open: number; late: number }>> {
  const admin = createAdminClient();
  const [{ data, error }, hidden] = await Promise.all([
    admin.rpc("staff_task_counts", { p_tenant: tenantId, p_user: userId ?? null }),
    hiddenKinds
      ? Promise.resolve([...hiddenKinds])
      : getTenantSettings().then(hiddenStaffTaskKinds),
  ]);
  if (error) throw new Error(`할 일 집계: ${error.message}`);
  const out = new Map<string, { open: number; late: number }>();
  for (const r of (data ?? []) as { user_id: string; open_count: number; late_count: number }[]) {
    out.set(r.user_id, { open: r.open_count, late: r.late_count });
  }
  if (!hidden.length) return out;

  type HiddenRow = {
    user_id: string;
    staff_tasks: { due_at: string | null } | { due_at: string | null }[] | null;
  };
  const hiddenRows = await fetchAllPaged<HiddenRow>((from, to) => {
    let q = admin
      .from("staff_task_assignees")
      .select("user_id, staff_tasks!staff_task_assignees_task_id_fkey!inner(due_at)")
      .eq("tenant_id", tenantId)
      .eq("staff_tasks.status", "open")
      .in("staff_tasks.kind", hidden)
      .order("task_id")
      .order("user_id")
      .range(from, to);
    if (userId) q = q.eq("user_id", userId);
    return q;
  });
  const now = Date.now();
  for (const row of hiddenRows) {
    const task = Array.isArray(row.staff_tasks) ? row.staff_tasks[0] : row.staff_tasks;
    const current = out.get(row.user_id) ?? { open: 0, late: 0 };
    out.set(row.user_id, {
      open: Math.max(0, current.open - 1),
      late: Math.max(0, current.late - (task?.due_at && Date.parse(task.due_at) < now ? 1 : 0)),
    });
  }
  return out;
}

async function names(tenantId: string, ids: readonly string[]): Promise<Map<string, string>> {
  if (!ids.length) return new Map();
  const { data, error } = await createAdminClient().from("users").select("id, display_name").eq("tenant_id", tenantId).in("id", [...new Set(ids)]);
  if (error) throw new Error(`직원 이름: ${error.message}`);
  return new Map((data ?? []).map((u) => [u.id as string, ((u.display_name as string | null) ?? "").trim() || "직원"]));
}

const person = (map: Map<string, string>, id: string | null): StaffTaskPerson | null => (id ? { id, name: map.get(id) ?? "퇴사한 직원" } : null);

export async function listTasks(args: {
  tenantId: string; assigneeId: string | null; filter: StaffTaskFilter; kind?: string | null; page: number;
}): Promise<StaffTaskList> {
  const admin = createAdminClient();
  const page = Math.max(0, Math.floor(args.page));
  const hidden = hiddenStaffTaskKinds(await getTenantSettings());
  if (args.kind && hidden.includes(args.kind)) return { items: [], total: 0, page, pageSize: TASK_PAGE_SIZE };
  const embed = args.assigneeId ? ", staff_task_assignees!staff_task_assignees_task_id_fkey!inner(user_id)" : "";
  let q = admin.from("staff_tasks").select(`${COLUMNS}${embed}`, { count: "exact" }).eq("tenant_id", args.tenantId);
  if (args.assigneeId) q = q.eq("staff_task_assignees.user_id", args.assigneeId);
  if (args.kind) q = q.eq("kind", args.kind);
  else if (hidden.length) q = q.not("kind", "in", `(${hidden.join(",")})`);
  const nowIso = new Date().toISOString();
  if (args.filter === "open") q = q.eq("status", "open").order("due_at", { ascending: true, nullsFirst: false });
  else if (args.filter === "late") q = q.eq("status", "open").lt("due_at", nowIso).order("due_at", { ascending: true });
  else if (args.filter === "closed") q = q.neq("status", "open").order("closed_at", { ascending: false, nullsFirst: false });
  else q = q.order("opened_at", { ascending: false });
  const { data, error, count } = await q.order("id").range(page * TASK_PAGE_SIZE, page * TASK_PAGE_SIZE + TASK_PAGE_SIZE - 1);
  if (error) throw new Error(`할 일 목록: ${error.message}`);
  const rows = (data ?? []) as unknown as Row[];
  const ids = rows.map((r) => r.id);
  const { data: links, error: linkError } = ids.length
    ? await admin.from("staff_task_assignees").select("task_id, user_id").eq("tenant_id", args.tenantId).in("task_id", ids)
    : { data: [], error: null };
  if (linkError) throw new Error(`할 일 담당: ${linkError.message}`);
  const byTask = new Map<string, string[]>();
  for (const l of (links ?? []) as { task_id: string; user_id: string }[]) byTask.set(l.task_id, [...(byTask.get(l.task_id) ?? []), l.user_id]);
  const nameMap = await names(args.tenantId, [...[...byTask.values()].flat(), ...rows.map((r) => r.closed_by).filter((v): v is string => !!v)]);
  const items: StaffTaskItem[] = rows.map((r) => ({
    id: r.id, kind: r.kind, title: r.title, detail: r.detail, link: r.link, status: r.status,
    openedAt: r.opened_at, dueAt: r.due_at, closedAt: r.closed_at, closedBy: person(nameMap, r.closed_by), closeReason: r.close_reason,
    assignees: (byTask.get(r.id) ?? []).map((id) => person(nameMap, id)!).sort((a, b) => a.name.localeCompare(b.name, "ko")),
  }));
  return { items, total: count ?? items.length, page, pageSize: TASK_PAGE_SIZE };
}

/** 할 일 하나 + 이력. 볼 수 없으면 null(맡은 사람이 아니고 현황 권한도 없음 · 다른 지점 · 없는 id). */
export async function taskDetail(tenantId: string, taskId: string, viewer: { userId: string; canMonitor: boolean }): Promise<{ item: StaffTaskItem; events: StaffTaskEvent[] } | null> {
  const admin = createAdminClient();
  const [hidden, { data: links, error: linkError }, { data: events, error: eventError }] = await Promise.all([
    getTenantSettings().then(hiddenStaffTaskKinds),
    admin.from("staff_task_assignees").select("user_id").eq("tenant_id", tenantId).eq("task_id", taskId),
    admin.from("staff_task_events").select("at, event, actor_id").eq("tenant_id", tenantId).eq("task_id", taskId).order("at").order("id").limit(200),
  ]);
  let taskQuery = admin.from("staff_tasks").select(COLUMNS).eq("tenant_id", tenantId).eq("id", taskId);
  if (hidden.length) taskQuery = taskQuery.not("kind", "in", `(${hidden.join(",")})`);
  const { data: row, error } = await taskQuery.maybeSingle();
  if (error || linkError || eventError) throw new Error(`할 일 상세: ${(error ?? linkError ?? eventError)!.message}`);
  if (!row) return null;
  const assigneeIds = (links ?? []).map((l) => l.user_id as string);
  if (!viewer.canMonitor && !assigneeIds.includes(viewer.userId)) return null;
  const r = row as Row;
  const ev = (events ?? []) as { at: string; event: string; actor_id: string | null }[];
  const nameMap = await names(tenantId, [...assigneeIds, ...(r.closed_by ? [r.closed_by] : []), ...ev.map((e) => e.actor_id).filter((v): v is string => !!v)]);
  return {
    item: {
      id: r.id, kind: r.kind, title: r.title, detail: r.detail, link: r.link, status: r.status,
      openedAt: r.opened_at, dueAt: r.due_at, closedAt: r.closed_at, closedBy: person(nameMap, r.closed_by), closeReason: r.close_reason,
      assignees: assigneeIds.map((id) => person(nameMap, id)!),
    },
    // '담당 지정' 이력은 맡은 사람 칸이 이미 말한다 — 줄을 줄인다.
    events: ev.filter((e) => e.event !== "assigned").map((e) => ({ at: e.at, event: e.event, actor: person(nameMap, e.actor_id) })),
  };
}

/** 벨 줄 → 그 알림의 할 일 상태(내가 맡은 할 일만 — 남의 할 일 id를 알림에 적어도 상태가 새지 않게). */
export async function taskBadgesFor(
  tenantId: string,
  userId: string,
  taskIds: readonly string[],
  hiddenKinds?: readonly string[],
): Promise<Map<string, { status: StaffTaskStatus; dueAt: string | null }>> {
  const ids = [...new Set(taskIds)];
  if (!ids.length) return new Map();
  const hidden = hiddenKinds ? [...hiddenKinds] : hiddenStaffTaskKinds(await getTenantSettings());
  // 묶음 알림이 여럿이면 할 일 id가 수백 개일 수 있다 — 청크로(B3).
  const admin = createAdminClient();
  const rows = await fetchInChunks<{ id: string; status: StaffTaskStatus; due_at: string | null }>(ids, (chunk) => {
    let q = admin
      .from("staff_tasks")
      .select("id, status, due_at, staff_task_assignees!staff_task_assignees_task_id_fkey!inner(user_id)")
      .eq("tenant_id", tenantId)
      .eq("staff_task_assignees.user_id", userId)
      .in("id", chunk);
    if (hidden.length) q = q.not("kind", "in", `(${hidden.join(",")})`);
    return q;
  });
  return new Map(rows.map((r) => [r.id, { status: r.status, dueAt: r.due_at }]));
}
