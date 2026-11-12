import "server-only";
import { ROLE_LABEL } from "@/lib/auth/role-hierarchy";
import { sanitizeRichHtml } from "@/lib/html/sanitize";
import { displayRoleFor } from "@/lib/auth/super-admin";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllPaged, fetchAllPagedInChunks } from "@/lib/supabase/batch";
import type { SystemRole } from "@/lib/permissions";
import { seesAll, type EventKind, type StepState, type WorkCategory, type WorkItem, type WorkOutcome, type WorkPerson, type WorkStatus } from "../model";
import { forAssignee } from "../recipient-body";
import { isRichBody } from "../rich-body";

type Req = {
  id: string; category: WorkCategory; title: string; body: string; done_criteria: string; source: string | null; requested_by: string | null; reviewer_id: string | null;
  due_on: string | null; status: WorkStatus; review_note: string | null; created_at: string; closed_at: string | null; closed_by: string | null;
};
type Step = { request_id: string; user_id: string; state: StepState; acked_at: string | null; reported_at: string | null; outcome: WorkOutcome | null; report_note: string | null; returned_note: string | null };
type Link = { request_id: string; target_id: string; assignee_id: string | null; label: string };
type Event = { id: number; request_id: string; at: string; actor_id: string | null; kind: EventKind; note: string | null };
type UserRow = { id: string; display_name: string | null; system_role: SystemRole; status: string; subjects: string[] | null };

/** 표가 아직 없다(SQL 적용 전 — #95). 이때는 구역을 그리지 않는다. */
export const isMissingTable = (error: { code?: string; message?: string } | null) => !!error && (error.code === "42P01" || error.code === "PGRST205" || /work_request/.test(error.message ?? "") && /does not exist|schema cache/.test(error.message ?? ""));

/** 직원 이름·역할(표시 역할 — 보호 계정은 관리자로 적는다). 퇴사자는 이름만 남긴다. */
export async function staffOf(tenantId: string, superAdmins: Set<string>, subjectLabel: (key: string) => string): Promise<{ all: Map<string, WorkPerson>; active: WorkPerson[] }> {
  const rows = await fetchAllPaged<UserRow>((from, to) =>
    createAdminClient().from("users").select("id, display_name, system_role, status, subjects").eq("tenant_id", tenantId).order("id").range(from, to));
  const person = (u: UserRow): WorkPerson => ({
    id: u.id, name: u.display_name?.trim() || "이름 없는 직원", role: ROLE_LABEL[displayRoleFor(u.id, u.system_role, superAdmins)] ?? "직원",
    subjects: [...new Set((u.subjects ?? []).map(subjectLabel))],
  });
  return {
    all: new Map(rows.map((u) => [u.id, person(u)])),
    // 업무 요청 대상 = 열람·아르바이트(2026-11-05)·학생을 뺀 재직 직원.
    active: rows.filter((u) => u.status === "active" && u.system_role !== "student" && u.system_role !== "viewer" && u.system_role !== "parttime").map(person),
  };
}

const REQ_COLS = "id, category, title, body, done_criteria, source, requested_by, reviewer_id, due_on, status, review_note, created_at, closed_at, closed_by";
export type WorkRows = { reqs: Req[]; steps: Step[]; links: Link[]; events: Event[] };

/**
 * 보이는 업무의 행 — 내가 요청했거나 · 맡았거나 · 검토하는 것. 업무 처리 현황 권한이 있으면 전부.
 * 진행 중은 전부, 끝난 것은 최근 60일만(지난 업무 탭). 표는 서버 전용이라 관리 키로 읽되 지점 조건을 늘 건다.
 * 🔴 끝까지 페이지로 읽는다(B2) — 상한으로 자르면 오래된 진행 중 요청 · 내가 맡은 요청이 조용히 빠져 보고를 못 한다.
 * 현황 권한이 없으면 지점 전체 머리를 훑지 않고 **내 것만** 먼저 좁힌다(강사 홈이 보일 때마다 다시 읽는다 — 요청이 쌓여도 내 몫만큼만).
 * 표가 아직 없으면(SQL 적용 전 — #95) null.
 */
export async function fetchWork(tenantId: string, me: string, monitor: boolean, today: string): Promise<WorkRows | null> {
  const admin = createAdminClient();
  const since = new Date(Date.parse(`${today}T00:00:00Z`) - 60 * 86_400_000).toISOString();
  try {
    // 볼 업무의 id만 먼저(내용은 볼 것만 읽는다). 진행 중 전부 + 최근 60일에 끝난 것.
    const live = `status.in.(working,review),closed_at.gte.${since}`;
    let ids: string[];
    if (monitor) {
      ids = (await fetchAllPaged<{ id: string }>((from, to) => admin.from("work_requests").select("id").eq("tenant_id", tenantId).or(live).order("id").range(from, to))).map((r) => r.id);
    } else {
      // 내가 요청한 것 ‖ 검토하는 것 ‖ 맡은 것 — 서로 독립(B4). 맡은 것은 기간 조건을 요청 표에서 한 번 더 건다.
      const byCol = (col: "requested_by" | "reviewer_id") => fetchAllPaged<{ id: string }>((from, to) => admin.from("work_requests").select("id").eq("tenant_id", tenantId).eq(col, me).or(live).order("id").range(from, to));
      const [requested, reviewing, mine] = await Promise.all([
        byCol("requested_by"), byCol("reviewer_id"),
        fetchAllPaged<{ request_id: string }>((from, to) => admin.from("work_request_assignees").select("request_id").eq("tenant_id", tenantId).eq("user_id", me).order("request_id").range(from, to)),
      ]);
      const own = [...requested, ...reviewing];
      const assigned = await fetchAllPagedInChunks<{ id: string }>([...new Set(mine.map((r) => r.request_id))], (chunk, from, to) =>
        admin.from("work_requests").select("id").eq("tenant_id", tenantId).in("id", chunk).or(live).order("id").range(from, to));
      ids = [...new Set([...own, ...assigned].map((r) => r.id))];
    }
    const [reqs, steps, links, events] = await Promise.all([
      fetchAllPagedInChunks<Req>(ids, (chunk, from, to) => admin.from("work_requests").select(REQ_COLS).eq("tenant_id", tenantId).in("id", chunk).order("id").range(from, to)),
      // 청크 안에서도 1,000행에 닿을 수 있다(요청 100건 × 사건 10줄) — 청크 × 페이징(B2).
      fetchAllPagedInChunks<Step>(ids, (chunk, from, to) => admin.from("work_request_assignees").select("request_id, user_id, state, acked_at, reported_at, outcome, report_note, returned_note").eq("tenant_id", tenantId).in("request_id", chunk).order("request_id").order("user_id").range(from, to)),
      fetchAllPagedInChunks<Link>(ids, (chunk, from, to) => admin.from("work_request_links").select("request_id, target_id, assignee_id, label").eq("tenant_id", tenantId).in("request_id", chunk).order("id").range(from, to)),
      fetchAllPagedInChunks<Event>(ids, (chunk, from, to) => admin.from("work_request_events").select("id, request_id, at, actor_id, kind, note").eq("tenant_id", tenantId).in("request_id", chunk).order("id").range(from, to)),
    ]);
    return { reqs: reqs.sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at)), steps, links, events };
  } catch (error) {
    // 페이지 도우미는 원문을 메시지에 담아 던진다 — 표가 없을 때만 조용히(구역째 없음), 그 밖은 그대로 올린다.
    if (error instanceof Error && isMissingTable({ message: error.message })) return null;
    throw error;
  }
}

/** 행 → 화면 값. 담당자이기만 하면 자기 몫 글 · 자기 학생 · 자기 보고만(원장 2026-11-03 — 다른 선생님 몫은 브라우저에도 안 간다). */
export function buildWork(rows: WorkRows, me: string, monitor: boolean, people: Map<string, WorkPerson>): WorkItem[] {
  const who = (id: string | null): WorkPerson | null => (id ? people.get(id) ?? { id, name: "퇴사한 직원", role: "" } : null);
  const group = <T extends { request_id: string }>(list: T[]) => list.reduce((m, x) => m.set(x.request_id, [...(m.get(x.request_id) ?? []), x]), new Map<string, T[]>());
  const stepsBy = group(rows.steps), linksBy = group(rows.links), eventsBy = group(rows.events);
  const items: WorkItem[] = rows.reqs.map((r) => ({
    // 서식 글은 그리기 직전에 한 번 더 거른다(저장 때 거른 값을 믿지 않는다 — 전자결재 보기와 같은 규칙).
    id: r.id, category: r.category, title: r.title, body: isRichBody(r.body) ? sanitizeRichHtml(r.body) : r.body, criteria: r.done_criteria, source: r.source,
    requester: who(r.requested_by), reviewer: who(r.reviewer_id), dueOn: r.due_on, status: r.status, reviewNote: r.review_note,
    createdAt: r.created_at, closedAt: r.closed_at, closedBy: who(r.closed_by)?.name ?? null,
    steps: (stepsBy.get(r.id) ?? []).map((s) => ({ user: who(s.user_id)!, state: s.state, ackedAt: s.acked_at, reportedAt: s.reported_at, outcome: s.outcome, note: s.report_note, returnedNote: s.returned_note, returned: s.returned_note !== null }))
      .sort((a, b) => a.user.name.localeCompare(b.user.name, "ko")),
    links: (linksBy.get(r.id) ?? []).map((l) => ({ type: "student" as const, id: l.target_id, label: l.label, assigneeId: l.assignee_id })).sort((a, b) => a.label.localeCompare(b.label, "ko")),
    events: (eventsBy.get(r.id) ?? []).sort((a, b) => a.id - b.id).map((e) => ({ at: e.at, actor: who(e.actor_id)?.name ?? null, actorId: e.actor_id, kind: e.kind, note: e.note })),
  }));
  return items.map((i) => (seesAll(i, me, monitor) ? i : forAssignee(i, me)));
}
