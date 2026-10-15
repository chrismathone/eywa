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
import { kstToday, shiftMonth } from "@/lib/date-kst";
import { getPortfolioGate } from "./queries";
import { refreshTenantPortfolio } from "./refresh";
import { openFloorMonths } from "./satisfaction-judge";
import { EVALUATION_DENIED, evaluationWriteGate } from "./write-gate";

export type SatisfactionActionState = { ok: boolean; error?: string; notice?: string };
export type QueueItem = { id: string; day: string; student: string; board: string; content: string; verdict: "plus" | "minus" | null; reason: string | null; ai: boolean };
export type AppliedItem = { id: string; day: string; student: string; content: string; verdict: "plus" | "minus"; phrase: string | null };
export type ClaimItem = { id: string; day: string; student: string; points: number; content: string; cancelled: boolean };
export type SatisfactionBoard =
  | { ok: true; tableMissing: boolean; floor: string; queue: QueueItem[]; queueMore: boolean; applied: AppliedItem[]; claims: ClaimItem[] }
  | { ok: false; error: string };

const J = "teacher_satisfaction_judgments";
const C = "teacher_satisfaction_claims";
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const QUEUE_LIMIT = 100;
const uuid = z.string().uuid();
const missing = (e: { code?: string } | null) => Boolean(e && (e.code === "42P01" || e.code === "PGRST205"));
const monthEnd = (month: string) => new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).toISOString().slice(0, 10);
const CLOSED = "마감한 달이라 바꿔도 그 달 점수는 바뀌지 않습니다";
const floorOf = async (tenantId: string) => (await openFloorMonths(createAdminClient(), tenantId)).get(tenantId) ?? shiftMonth(kstToday().slice(0, 7), -1);
/**
 * 클레임은 강사가 정해져 있다 — 그 날짜가 쓰이는 점수 달(다음 달 — 10월 점수 = 9월 기록)의 그 강사 줄이 마감됐는지(마감은 줄마다) ·
 * 계산 창 안인지(지점의 재료 달 하한)를 함께 본다.
 */
async function claimMonthClosed(tenantId: string, teacherId: string, day: string): Promise<boolean> {
  if (day.slice(0, 7) < (await floorOf(tenantId))) return true;
  const { data } = await createAdminClient().from("teacher_portfolio_months").select("closed_at").eq("tenant_id", tenantId)
    .eq("teacher_id", teacherId).eq("month", shiftMonth(day.slice(0, 7), 1)).maybeSingle();
  return Boolean(data?.closed_at);
}

/**
 * 관리 창이 열릴 때 — 마감 안 한 달의 확인 대기 글(최근 것부터) · 이 강사·이 달에 반영된 글(근거 화면의 판정 id) · 이 강사·이 달 클레임.
 * `month` = **재료 달**(화면이 점수 달의 지난달을 넘긴다 · `dataMonthOf`) — 클레임 날짜는 그 달 안이다.
 */
export async function loadSatisfactionBoard(teacherId: string, month: string, appliedIds: string[]): Promise<SatisfactionBoard> {
  const gate = await getPortfolioGate();
  if (!gate) return { ok: false, error: EVALUATION_DENIED };
  if (!MONTH.test(month) || !uuid.safeParse(teacherId).success || appliedIds.some((id) => !uuid.safeParse(id).success)) return { ok: false, error: "입력 값을 확인해 주세요" };
  const admin = createAdminClient();
  type J1 = { id: string; message_id: string; student_id: string | null; posted_on: string; verdict: "plus" | "minus" | null; reason?: string | null; method?: string; phrase?: string | null };
  type C1 = { id: string; student_id: string | null; occurred_on: string; points: number | string; content: string; cancelled_at: string | null };
  try {
    const floor = await floorOf(gate.tenantId);
    const [queue, claims] = await Promise.all([
      admin.from(J).select("id, message_id, student_id, posted_on, verdict, reason, method").eq("tenant_id", gate.tenantId).eq("state", "pending")
        .gte("posted_on", `${floor}-01`).order("posted_on", { ascending: false }).limit(QUEUE_LIMIT + 1),
      admin.from(C).select("id, student_id, occurred_on, points, content, cancelled_at").eq("tenant_id", gate.tenantId).eq("teacher_id", teacherId)
        .gte("occurred_on", `${month}-01`).lte("occurred_on", monthEnd(month)).order("occurred_on").limit(200),
    ]);
    if (missing(queue.error) || missing(claims.error)) return { ok: true, tableMissing: true, floor, queue: [], queueMore: false, applied: [], claims: [] };
    if (queue.error || claims.error) throw new Error((queue.error ?? claims.error)!.message);
    const applied = await fetchInChunks<J1>(appliedIds, (chunk) => admin.from(J).select("id, message_id, student_id, posted_on, verdict, phrase")
      .eq("tenant_id", gate.tenantId).eq("state", "applied").in("id", chunk));
    const pending = ((queue.data ?? []) as J1[]).slice(0, QUEUE_LIMIT);
    const claimRows = (claims.data ?? []) as C1[];
    const [messages, students] = await Promise.all([
      fetchInChunks<{ id: string; content: string | null; class_name: string | null }>([...new Set([...pending, ...applied].map((r) => r.message_id))], (chunk) =>
        admin.from("classnote_parent_messages").select("id, content, class_name").eq("tenant_id", gate.tenantId).in("id", chunk)),
      fetchInChunks<{ id: string; name: string }>([...new Set([...pending, ...applied, ...claimRows].map((r) => r.student_id).filter((v): v is string => !!v))], (chunk) =>
        admin.from("students").select("id, name").eq("tenant_id", gate.tenantId).in("id", chunk)),
    ]);
    const msg = new Map(messages.map((m) => [m.id, m]));
    const nameOf = new Map(students.map((s) => [s.id, s.name]));
    const student = (id: string | null) => (id ? nameOf.get(id) ?? "—" : "학생 모름");
    return {
      ok: true, tableMissing: false, floor, queueMore: (queue.data ?? []).length > QUEUE_LIMIT,
      queue: pending.map((r) => ({
        id: r.id, day: r.posted_on, student: student(r.student_id), board: msg.get(r.message_id)?.class_name ?? "", content: msg.get(r.message_id)?.content ?? "",
        verdict: r.verdict, reason: r.reason ?? null, ai: r.method === "ai",
      })),
      applied: applied.filter((r) => r.verdict).map((r) => ({
        id: r.id, day: r.posted_on, student: student(r.student_id), content: msg.get(r.message_id)?.content ?? "", verdict: r.verdict!, phrase: r.phrase ?? null,
      })),
      claims: claimRows.map((c) => ({ id: c.id, day: c.occurred_on, student: student(c.student_id), points: Number(c.points), content: c.content, cancelled: Boolean(c.cancelled_at) })),
    };
  } catch (e) {
    reportWarning("만족도 관리 조회 실패", { scope: "loadSatisfactionBoard", message: e instanceof Error ? e.message : String(e) });
    return { ok: false, error: "불러오지 못했습니다. 잠시 후 다시 열어 주세요" };
  }
}

/** 확인 대기 글 반영(가점·감점)·무시 · 반영한 글 취소. 기록은 지우지 않는다. 마감한 달의 글은 거절. */
export async function decideJudgment(id: string, decision: "plus" | "minus" | "dismiss" | "cancel"): Promise<SatisfactionActionState> {
  const gate = await evaluationWriteGate();
  if ("error" in gate) return { ok: false, error: gate.error };
  if (!uuid.safeParse(id).success || !["plus", "minus", "dismiss", "cancel"].includes(decision)) return { ok: false, error: "입력 값을 확인해 주세요" };
  const admin = createAdminClient();
  const from = decision === "cancel" ? "applied" : "pending";
  const { data: row, error: readError } = await admin.from(J).select("posted_on, method").eq("tenant_id", gate.tenantId).eq("id", id).eq("state", from).maybeSingle();
  if (readError) return { ok: false, error: "저장하지 못했습니다. 잠시 후 다시 시도해 주세요" };
  if (!row) return { ok: false, error: "이미 처리된 글입니다. 창을 닫고 다시 열어 주세요" };
  if ((row.posted_on as string).slice(0, 7) < (await floorOf(gate.tenantId))) return { ok: false, error: CLOSED };
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
    metadata: { kind: decision === "cancel" ? "cancel" : decision === "dismiss" ? "dismiss" : "apply", verdict: decision === "plus" || decision === "minus" ? decision : null, postedOn: row.posted_on },
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
  await logAction({ action: "teacher_evaluation_satisfaction", targetType: "teacher_portfolio", targetLabel: "학부모 만족도", metadata: { kind: "claim_add", points: c.points, occurredOn: c.occurredOn } });
  return { ok: true, notice: "넣었습니다" };
}

export async function cancelSatisfactionClaim(id: string): Promise<SatisfactionActionState> {
  const gate = await evaluationWriteGate();
  if ("error" in gate) return { ok: false, error: gate.error };
  if (!uuid.safeParse(id).success) return { ok: false, error: "입력 값을 확인해 주세요" };
  const admin = createAdminClient();
  const { data: claim } = await admin.from(C).select("occurred_on, teacher_id").eq("tenant_id", gate.tenantId).eq("id", id).is("cancelled_at", null).maybeSingle();
  if (!claim) return { ok: false, error: "이미 취소된 클레임입니다" };
  if (await claimMonthClosed(gate.tenantId, claim.teacher_id as string, claim.occurred_on as string)) return { ok: false, error: CLOSED };
  const { data, error } = await admin.from(C).update({ cancelled_at: new Date().toISOString(), cancelled_by: gate.userId })
    .eq("tenant_id", gate.tenantId).eq("id", id).is("cancelled_at", null).select("occurred_on, points").maybeSingle();
  if (error) return { ok: false, error: "취소하지 못했습니다. 잠시 후 다시 시도해 주세요" };
  if (!data) return { ok: false, error: "이미 취소된 클레임입니다" };
  await logAction({ action: "teacher_evaluation_satisfaction", targetType: "teacher_portfolio", targetLabel: "학부모 만족도", metadata: { kind: "claim_cancel", points: Number(data.points), occurredOn: data.occurred_on } });
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
