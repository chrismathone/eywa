"use server";

// 강사평가 설정 저장 · 직접 만든 지표 입력 — 원장 게이트(직원 포트폴리오와 같은 문)를 지난 뒤에만.
// 저장하면 진행 중인 달을 바로 다시 매긴다(after — 응답을 붙잡지 않는다). 마감한 달은 그때의 설정으로 굳어 있다.
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { logAction } from "@/features/audit/server/log";
import { reportWarning } from "@/lib/observability/report-error";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchInChunks } from "@/lib/supabase/batch";
import { z } from "zod";
import { evaluationConfigSchema, issueMessage, PAY_OVERRIDE_KEY, resolveEvaluationConfig } from "../evaluation/config";
import { loadEvaluationConfig, loadTeacherEntries, saveEvaluationConfig, saveManualEntries } from "./evaluation-store";
import { getPortfolioGate } from "./queries";
import { refreshTenantPortfolio } from "./refresh";
import { EVALUATION_DENIED, evaluationWriteGate } from "./write-gate";

export type EvaluationActionState = { ok: boolean; error?: string; notice?: string };

const DENIED = EVALUATION_DENIED;
const writeGate = evaluationWriteGate;

function refreshLater(tenantId: string, scope: string) {
  after(async () => {
    try {
      await refreshTenantPortfolio(createAdminClient(), tenantId);
    } catch (e) {
      reportWarning("강사평가 저장 뒤 다시 매기기 실패", { scope, message: e instanceof Error ? e.message : String(e) });
    }
  });
}

export async function saveEvaluationSettings(input: unknown): Promise<EvaluationActionState> {
  const gate = await writeGate();
  if ("error" in gate) return { ok: false, error: gate.error };
  const parsed = evaluationConfigSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: issueMessage(parsed.error) };
  const config = resolveEvaluationConfig(parsed.data);
  const admin = createAdminClient();
  try {
    await saveEvaluationConfig(admin, gate.tenantId, config, gate.userId);
  } catch (e) {
    reportWarning("강사평가 설정 저장 실패", { scope: "saveEvaluationSettings", message: e instanceof Error ? e.message : String(e) });
    return { ok: false, error: e instanceof Error && e.message.includes("준비되지") ? e.message : "설정을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요" };
  }
  const on = [...Object.values(config.metrics), ...config.manual].filter((m) => m.enabled);
  await logAction({
    action: "teacher_evaluation_settings_save", targetType: "teacher_portfolio", targetLabel: "강사평가 설정",
    metadata: {
      enabled: on.length, maxTotal: on.reduce((n, m) => n + m.max, 0), manual: config.manual.length,
      churnExclude: config.metrics.churn.churn?.excludeReasons ?? null, churnCountEnded: config.metrics.churn.churn?.countEnded ?? null,
    },
  });
  refreshLater(gate.tenantId, "saveEvaluationSettings");
  revalidatePath("/owner");
  revalidatePath("/class-review");
  return { ok: true, notice: "저장했습니다. 진행 중인 달의 점수를 다시 매기고 있습니다" };
}

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const entriesSchema = z.array(z.object({
  teacherId: z.string().uuid(), metricKey: z.string().regex(/^[a-z0-9]{1,16}$/),
  value: z.number().finite().min(-1_000_000).max(100_000_000).nullable(), note: z.string().max(500).nullable(),
})).max(2000);

export type EntryDraft = Record<string, { value: number | null; note: string | null }>;

/** 직접 입력 창이 열릴 때의 값 — 포트폴리오 행이 아니라 입력 표에서(저장 직후 다시 매기기 전에도 방금 넣은 값이 보이게). */
export async function loadEvaluationEntries(teacherId: string, month: string): Promise<{ ok: true; entries: EntryDraft } | { ok: false; error: string }> {
  const gate = await getPortfolioGate();
  if (!gate) return { ok: false, error: DENIED };
  if (!MONTH.test(month) || !z.string().uuid().safeParse(teacherId).success) return { ok: false, error: "입력 값을 확인해 주세요" };
  try {
    const rows = await loadTeacherEntries(createAdminClient(), gate.tenantId, teacherId, month);
    return { ok: true, entries: Object.fromEntries(rows.map((r) => [r.metric_key, { value: r.value === null ? null : Number(r.value), note: r.note }])) };
  } catch (e) {
    reportWarning("직접 입력 지표 조회 실패", { scope: "loadEvaluationEntries", message: e instanceof Error ? e.message : String(e) });
    return { ok: false, error: "입력한 값을 불러오지 못했습니다. 잠시 후 다시 열어 주세요" };
  }
}

/** 바뀐 칸만 받는다 — 값과 메모가 둘 다 빈 줄은 그 입력을 지운다. */
export async function saveEvaluationEntries(month: string, input: unknown): Promise<EvaluationActionState> {
  const gate = await writeGate();
  if ("error" in gate) return { ok: false, error: gate.error };
  const parsed = entriesSchema.safeParse(input);
  if (!MONTH.test(month) || !parsed.success) return { ok: false, error: "입력 값을 확인해 주세요" };
  const rows = parsed.data;
  if (!rows.length) return { ok: true, notice: "바뀐 값이 없습니다" };
  const admin = createAdminClient();
  const teacherIds = [...new Set(rows.map((r) => r.teacherId))];
  let known: Set<string>;
  let closed: Set<string>;
  let keys: Set<string>;
  try {
    // 이 지점의 사람만 — 다른 지점 id를 실어 보내도 그 줄은 쓰지 않는다. 마감한 강사의 달은 점수가 그때 값으로 굳어 있다.
    const [{ config }, users, months] = await Promise.all([
      loadEvaluationConfig(admin, gate.tenantId),
      fetchInChunks<{ id: string }>(teacherIds, (chunk) => admin.from("users").select("id").eq("tenant_id", gate.tenantId).in("id", chunk)),
      fetchInChunks<{ teacher_id: string; closed_at: string | null }>(teacherIds, (chunk) =>
        admin.from("teacher_portfolio_months").select("teacher_id, closed_at").eq("tenant_id", gate.tenantId).eq("month", month).in("teacher_id", chunk)),
    ]);
    keys = new Set([...config.manual.map((m) => m.key), PAY_OVERRIDE_KEY]);
    known = new Set(users.map((u) => u.id));
    closed = new Set(months.filter((m) => m.closed_at).map((m) => m.teacher_id));
  } catch (e) {
    reportWarning("직접 입력 지표 확인 실패", { scope: "saveEvaluationEntries", message: e instanceof Error ? e.message : String(e) });
    return { ok: false, error: "입력을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요" };
  }
  if (rows.some((r) => closed.has(r.teacherId))) return { ok: false, error: "마감한 달이라 입력해도 점수가 바뀌지 않습니다" };
  // 칸마다 범위 — 원장이 만든 지표는 ±100만(총점 칸이 넘치지 않게), 급여 직접 입력은 10만~1억 원(한 달 급여, 세전).
  //   급여 칸에 0·1 같은 값이 들어가면 비율 0%로 만점이 된다 — 계약서 월급을 읽는 하한과 같은 10만 원부터 받는다.
  if (rows.some((r) => r.value !== null && (r.metricKey === PAY_OVERRIDE_KEY ? r.value < 100_000 : Math.abs(r.value) > 1_000_000))) {
    return { ok: false, error: "입력 값의 범위를 확인해 주세요(직접 만든 지표는 ±100만, 급여는 10만 원 이상)" };
  }
  const clean = rows.filter((r) => keys.has(r.metricKey) && known.has(r.teacherId));
  // 그사이 지표가 지워졌거나 사람이 이 지점에 없으면 그 칸은 쓸 곳이 없다 — 말없이 버리지 않고 다시 열게 한다.
  if (clean.length < rows.length) return { ok: false, error: "지표 설정이 바뀌었습니다. 창을 닫고 다시 열어 주세요" };
  try {
    const result = await saveManualEntries(admin, gate.tenantId, month, clean, gate.userId);
    await logAction({
      action: "teacher_evaluation_entries_save", targetType: "teacher_portfolio", targetLabel: `${Number(month.slice(5))}월 직접 입력 지표`,
      metadata: { month, saved: result.saved, cleared: result.cleared },
    });
  } catch (e) {
    reportWarning("직접 입력 지표 저장 실패", { scope: "saveEvaluationEntries", message: e instanceof Error ? e.message : String(e) });
    return { ok: false, error: e instanceof Error && e.message.includes("준비되지") ? e.message : "입력을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요" };
  }
  refreshLater(gate.tenantId, "saveEvaluationEntries");
  revalidatePath("/class-review");
  return { ok: true, notice: "저장했습니다. 점수를 다시 매기고 있습니다" };
}
