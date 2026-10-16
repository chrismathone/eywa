"use server";

// 학부모 만족도 — 확인 대기 글 반영/무시 · 반영 취소 · 클레임 넣기/취소(계획서 3번 · 원장 결정 8). 원장 게이트(강사평가 설정과 같은 문)를 지난 뒤에만.
// 🔴 마감한 달은 서버가 막는다(그 달 점수는 굳어 있어 바꿔도 반영되지 않는다 — 화면 버튼만 막으면 우회된다 #77).
// 점수 다시 매기기는 클릭마다가 아니라 창을 닫을 때 한 번(`refreshAfterSatisfaction`) — 무거운 지점 집계가 겹쳐 옛 결과가 덮지 않게.
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { z } from "zod";
import { logAction } from "@/features/audit/server/log";
import { reportWarning } from "@/lib/observability/report-error";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchInChunks } from "@/lib/supabase/batch";
import { kstToday } from "@/lib/date-kst";
import { schoolGradeLabel } from "@/lib/format/school-grade";
import { getPortfolioGate } from "./queries";
import { refreshTenantPortfolio } from "./refresh";
import { claimMonthClosed, floorOf, ownsJudgment } from "./satisfaction-guards";
import { EVALUATION_DENIED, evaluationWriteGate } from "./write-gate";

export type SatisfactionActionState = { ok: boolean; error?: string; notice?: string };
export type QueueItem = {
  id: string; day: string; student: string; school: string; board: string; content: string; verdict: "plus" | "minus" | null; reason: string | null; ai: boolean;
};
export type AppliedItem = { id: string; day: string; student: string; school: string; content: string; verdict: "plus" | "minus"; phrase: string | null };
export type ClaimItem = { id: string; day: string; student: string; points: number; content: string; cancelled: boolean };
export type SatisfactionBoard =
  | { ok: true; tableMissing: boolean; floor: string; queue: QueueItem[]; applied: AppliedItem[]; claims: ClaimItem[] }
  | { ok: false; error: string };

const J = "teacher_satisfaction_judgments";
const C = "teacher_satisfaction_claims";
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const IDS_LIMIT = 2000;
const uuid = z.string().uuid();
const missing = (e: { code?: string } | null) => Boolean(e && (e.code === "42P01" || e.code === "PGRST205"));
const monthEnd = (month: string) => new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).toISOString().slice(0, 10);
const CLOSED = "마감한 달이라 바꿔도 그 달 점수는 바뀌지 않습니다";
const NOT_MINE = "이 선생님 몫이 아닙니다. 창을 닫고 다시 열어 주세요";

/**
 * 관리 창이 열릴 때 — **이 강사 몫의 글만**(원장 2026-10-16 *"이성우라고 열었는데 전체가 다보이나본데, 오해를 일으키기에 충분함"*):
 * 화면이 그 달 근거 표(`detail`)의 글 판정 id를 넘기고(누구 몫인지는 집계가 정한다 — 그날 그 반 담임), 여기서 지금 상태로 가른다
 * (확인 대기 · 반영). 클레임은 이 강사·이 달 것. `month` = 점수 달 — 글·클레임 날짜는 그 달 안이다.
 */
export async function loadSatisfactionBoard(teacherId: string, month: string, judgmentIds: string[]): Promise<SatisfactionBoard> {
  const gate = await getPortfolioGate();
  if (!gate) return { ok: false, error: EVALUATION_DENIED };
  if (!MONTH.test(month) || !uuid.safeParse(teacherId).success || judgmentIds.length > IDS_LIMIT || judgmentIds.some((id) => !uuid.safeParse(id).success)) {
    return { ok: false, error: "입력 값을 확인해 주세요" };
  }
  const admin = createAdminClient();
  type J1 = { id: string; message_id: string; student_id: string | null; posted_on: string; verdict: "plus" | "minus" | null; reason: string | null; method: string;
    phrase: string | null; state: string };
  type C1 = { id: string; student_id: string | null; occurred_on: string; points: number | string; content: string; cancelled_at: string | null };
  try {
    const [floor, claims, found] = await Promise.all([
      floorOf(gate.tenantId),
      admin.from(C).select("id, student_id, occurred_on, points, content, cancelled_at").eq("tenant_id", gate.tenantId).eq("teacher_id", teacherId)
        .gte("occurred_on", `${month}-01`).lte("occurred_on", monthEnd(month)).order("occurred_on").limit(200),
      fetchInChunks<J1>(judgmentIds, (chunk) => admin.from(J).select("id, message_id, student_id, posted_on, verdict, reason, method, phrase, state")
        .eq("tenant_id", gate.tenantId).in("state", ["pending", "applied"]).in("id", chunk)).then((rows) => ({ rows, e: null }), (e: unknown) => ({ rows: null, e })),
    ]);
    if (missing(claims.error)) return { ok: true, tableMissing: true, floor, queue: [], applied: [], claims: [] };
    if (claims.error) throw new Error(claims.error.message);
    if (!found.rows) throw found.e;
    const judged: J1[] = found.rows;
    const pending = judged.filter((r) => r.state === "pending" && r.posted_on >= `${floor}-01`).sort((a, b) => b.posted_on.localeCompare(a.posted_on));
    const applied = judged.filter((r) => r.state === "applied").sort((a, b) => a.posted_on.localeCompare(b.posted_on));
    const claimRows = (claims.data ?? []) as C1[];
    const [messages, students] = await Promise.all([
      fetchInChunks<{ id: string; content: string | null; class_name: string | null }>([...new Set([...pending, ...applied].map((r) => r.message_id))], (chunk) =>
        admin.from("classnote_parent_messages").select("id, content, class_name").eq("tenant_id", gate.tenantId).in("id", chunk)),
      fetchInChunks<{ id: string; name: string; school: string | null; grade: string | null }>(
        [...new Set([...pending, ...applied, ...claimRows].map((r) => r.student_id).filter((v): v is string => !!v))], (chunk) =>
          admin.from("students").select("id, name, school, grade").eq("tenant_id", gate.tenantId).in("id", chunk)),
    ]);
    const msg = new Map(messages.map((m) => [m.id, m]));
    const studentOf = new Map(students.map((s) => [s.id, s]));
    const student = (id: string | null) => (id ? studentOf.get(id)?.name ?? "—" : "학생 모름");
    const school = (id: string | null) => { const s = id ? studentOf.get(id) : undefined; return s ? schoolGradeLabel(s.school, s.grade) : ""; };
    return {
      ok: true, tableMissing: false, floor,
      queue: pending.map((r) => ({
        id: r.id, day: r.posted_on, student: student(r.student_id), school: school(r.student_id), board: msg.get(r.message_id)?.class_name ?? "",
        content: msg.get(r.message_id)?.content ?? "", verdict: r.verdict, reason: r.reason, ai: r.method === "ai",
      })),
      applied: applied.filter((r) => r.verdict).map((r) => ({
        id: r.id, day: r.posted_on, student: student(r.student_id), school: school(r.student_id), content: msg.get(r.message_id)?.content ?? "",
        verdict: r.verdict!, phrase: r.phrase,
      })),
      claims: claimRows.map((c) => ({ id: c.id, day: c.occurred_on, student: student(c.student_id), points: Number(c.points), content: c.content, cancelled: Boolean(c.cancelled_at) })),
    };
  } catch (e) {
    reportWarning("만족도 관리 조회 실패", { scope: "loadSatisfactionBoard", message: e instanceof Error ? e.message : String(e) });
    return { ok: false, error: "불러오지 못했습니다. 잠시 후 다시 열어 주세요" };
  }
}

/** 확인 대기 글 반영(가점·감점)·무시 · 반영한 글 취소 — 고른 강사 몫의 글만. 기록은 지우지 않는다. 마감한 달의 글은 거절. */
export async function decideJudgment(id: string, decision: "plus" | "minus" | "dismiss" | "cancel", teacherId: string): Promise<SatisfactionActionState> {
  const gate = await evaluationWriteGate();
  if ("error" in gate) return { ok: false, error: gate.error };
  if (!uuid.safeParse(id).success || !uuid.safeParse(teacherId).success || !["plus", "minus", "dismiss", "cancel"].includes(decision)) {
    return { ok: false, error: "입력 값을 확인해 주세요" };
  }
  const admin = createAdminClient();
  const from = decision === "cancel" ? "applied" : "pending";
  const [{ data: row, error: readError }, floor] = await Promise.all([
    admin.from(J).select("posted_on, method").eq("tenant_id", gate.tenantId).eq("id", id).eq("state", from).maybeSingle(), floorOf(gate.tenantId),
  ]);
  if (readError) return { ok: false, error: "저장하지 못했습니다. 잠시 후 다시 시도해 주세요" };
  if (!row) return { ok: false, error: "이미 처리된 글입니다. 창을 닫고 다시 열어 주세요" };
  const posted = (row.posted_on as string).slice(0, 7);
  let owned: { closed: boolean } | null;
  try {
    owned = await ownsJudgment(gate.tenantId, teacherId, id, posted);
  } catch (e) {
    reportWarning("만족도 판정 담당 확인 실패", { scope: "decideJudgment", message: e instanceof Error ? e.message : String(e) });
    return { ok: false, error: "저장하지 못했습니다. 잠시 후 다시 시도해 주세요" };
  }
  if (!owned) return { ok: false, error: NOT_MINE };
  if (owned.closed || posted < floor) return { ok: false, error: CLOSED };
  // 문구 판정이 애매해 사람이 정한 것은 '사람 판정'으로 적는다(AI가 제안한 것은 'AI 판정 · 사람 확인' 그대로).
  const method = decision === "plus" || decision === "minus" ? { verdict: decision, state: "applied", ...(row.method === "rule" ? { method: "manual" } : {}) } : null;
  const patch = decision === "cancel" ? { state: "cancelled" } : decision === "dismiss" ? { state: "dismissed" } : method!;
  const { data, error } = await admin.from(J).update({ ...patch, decided_by: gate.userId, decided_at: new Date().toISOString() })
    .eq("tenant_id", gate.tenantId).eq("id", id).eq("state", from).select("id").maybeSingle();
  if (error) {
    reportWarning("만족도 판정 저장 실패", { scope: "decideJudgment", message: error.message });
    return { ok: false, error: "저장하지 못했습니다. 잠시 후 다시 시도해 주세요" };
  }
  if (!data) return { ok: false, error: "이미 처리된 글입니다. 창을 닫고 다시 열어 주세요" };
  await logAction({
    action: "teacher_evaluation_satisfaction", targetType: "teacher_portfolio", targetLabel: "학부모 만족도",
    metadata: { kind: decision === "cancel" ? "cancel" : decision === "dismiss" ? "dismiss" : "apply", verdict: decision === "plus" || decision === "minus" ? decision : null,
      postedOn: row.posted_on, teacherId, judgmentId: id },
  });
  return { ok: true, notice: decision === "dismiss" ? "무시했습니다" : decision === "cancel" ? "반영을 취소했습니다" : "반영했습니다" };
}

const claimSchema = z.object({
  teacherId: uuid, occurredOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  points: z.number().finite().min(-100).max(100).refine((n) => n !== 0, "점수는 0이 아니어야 합니다"),
  content: z.string().trim().min(1, "내용을 적어 주세요").max(500, "내용은 500자까지입니다"),
});

/** 클레임·칭찬 넣기 — 마감 안 한 달 · 오늘까지만. */
export async function addSatisfactionClaim(input: unknown): Promise<SatisfactionActionState> {
  const gate = await evaluationWriteGate();
  if ("error" in gate) return { ok: false, error: gate.error };
  const parsed = claimSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: /[가-힣]/.test(parsed.error.issues[0]?.message ?? "") ? parsed.error.issues[0]!.message : "입력 값을 확인해 주세요" };
  const c = parsed.data;
  if (c.occurredOn > kstToday()) return { ok: false, error: "앞으로의 날짜는 넣을 수 없습니다" };
  const admin = createAdminClient();
  const [user, closed] = await Promise.all([admin.from("users").select("id").eq("tenant_id", gate.tenantId).eq("id", c.teacherId).maybeSingle(),
    claimMonthClosed(gate.tenantId, c.teacherId, c.occurredOn)]);
  if (!user.data) return { ok: false, error: "이 학원의 선생님이 아닙니다" };
  if (closed) return { ok: false, error: CLOSED };
  const { error } = await admin.from(C).insert({ tenant_id: gate.tenantId, teacher_id: c.teacherId, occurred_on: c.occurredOn, points: c.points, content: c.content, entered_by: gate.userId });
  if (error) {
    reportWarning("클레임 저장 실패", { scope: "addSatisfactionClaim", message: error.message });
    return { ok: false, error: missing(error) ? "학부모 만족도 저장 표가 아직 준비되지 않았습니다" : "저장하지 못했습니다. 잠시 후 다시 시도해 주세요" };
  }
  await logAction({ action: "teacher_evaluation_satisfaction", targetType: "teacher_portfolio", targetLabel: "학부모 만족도",
    metadata: { kind: "claim_add", points: c.points, occurredOn: c.occurredOn, teacherId: c.teacherId } });
  return { ok: true, notice: "넣었습니다" };
}

/** 클레임·칭찬 취소 — 고른 강사의 것만(관리 창의 목록과 같은 강사). */
export async function cancelSatisfactionClaim(id: string, teacherId: string): Promise<SatisfactionActionState> {
  const gate = await evaluationWriteGate();
  if ("error" in gate) return { ok: false, error: gate.error };
  if (!uuid.safeParse(id).success || !uuid.safeParse(teacherId).success) return { ok: false, error: "입력 값을 확인해 주세요" };
  const admin = createAdminClient();
  const { data: claim } = await admin.from(C).select("occurred_on, teacher_id").eq("tenant_id", gate.tenantId).eq("id", id).is("cancelled_at", null).maybeSingle();
  if (!claim) return { ok: false, error: "이미 취소된 클레임입니다" };
  if (claim.teacher_id !== teacherId) return { ok: false, error: NOT_MINE };
  if (await claimMonthClosed(gate.tenantId, claim.teacher_id as string, claim.occurred_on as string)) return { ok: false, error: CLOSED };
  const { data, error } = await admin.from(C).update({ cancelled_at: new Date().toISOString(), cancelled_by: gate.userId })
    .eq("tenant_id", gate.tenantId).eq("id", id).is("cancelled_at", null).select("occurred_on, points").maybeSingle();
  if (error) return { ok: false, error: "취소하지 못했습니다. 잠시 후 다시 시도해 주세요" };
  if (!data) return { ok: false, error: "이미 취소된 클레임입니다" };
  await logAction({ action: "teacher_evaluation_satisfaction", targetType: "teacher_portfolio", targetLabel: "학부모 만족도", metadata: { kind: "claim_cancel", points: Number(data.points), occurredOn: data.occurred_on, teacherId, claimId: id } });
  return { ok: true, notice: "취소했습니다" };
}

/** 관리 창을 닫을 때 한 번 — 바뀐 게 있으면 진행 중인 달을 다시 매긴다(응답을 붙잡지 않는다). */
export async function refreshAfterSatisfaction(): Promise<SatisfactionActionState> {
  const gate = await evaluationWriteGate();
  if ("error" in gate) return { ok: false, error: gate.error };
  after(async () => {
    try { await refreshTenantPortfolio(createAdminClient(), gate.tenantId); } catch (e) {
      reportWarning("만족도 변경 뒤 다시 매기기 실패", { scope: "refreshAfterSatisfaction", message: e instanceof Error ? e.message : String(e) });
    }
  });
  revalidatePath("/class-review");
  return { ok: true, notice: "점수를 다시 매기고 있습니다" };
}
