import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getTenantSettingsByTenantId } from "@/features/owner/server/queries";
import { isAttachOnlyContent } from "@/features/classnote-reply/notification-match";
import { resolveBoard } from "@/features/classnote-reply/server/reply-data";
import { isLaboratoryMenuAvailable } from "@/lib/laboratory/server";
import { isModuleEnabled } from "@/lib/modules";
import { kstToday } from "@/lib/date-kst";
import { reportWarning } from "@/lib/observability/report-error";
import { fetchAllPaged, fetchInChunks } from "@/lib/supabase/batch";
import { DEFAULT_SATISFACTION_OPTIONS } from "../evaluation/options";
import { portfolioFloor } from "../model/build";
import { judgeByRules } from "../model/satisfaction-rules";
import { judgeWithAi } from "./satisfaction-ai";
import { loadEvaluationConfig } from "./evaluation-store";

/**
 * 학부모 만족도 — 아직 판정하지 않은 학부모 글을 판정해 저장한다(계획서 3번 · 원장 결정 8). 출결 분류 킥 뒤에 같은 라우트가 부른다
 * (워커 킥 = 명시 트리거 — 🔴 페이지 로드로는 절대 돌지 않는다. AI도 여기서만).
 *
 * - 지점마다: 강사평가가 켜진 지점(직원 평가 모듈 · 실험실 메뉴 — 밤 집계와 같은 판정) · 만족도 지표를 켠 경우만.
 * - 대상 = **마감하지 않은 달**(그 지점 포트폴리오의 열린 가장 이른 달 1일부터)에 들어온, 출결 연락이 아닌 글(분류 끝 · `none`) 중
 *   판정 줄이 없는 것(글 id로 맞춘다) · 한 번에 60건. 마감한 달은 점수가 굳어 판정해도 바뀌지 않는다.
 * - 첨부만 있는 글·짧은 인사 = '판정 없음'(다시 읽지 않게). 확실한 문구 = 바로 반영 · 애매 = 확인 대기(AI를 켰으면 AI가 먼저 읽는다).
 *   🔴 보드로 과목·반을 못 가린 글은 확실해도 확인 대기 — 그 학생의 다른 과목 담임 점수까지 움직이지 않게(답글 정책과 같은 '모르면 짐작하지 않는다').
 * - 판정 표(0364a)가 없으면 아무것도 하지 않는다(#95).
 */
type Admin = SupabaseClient;
type Message = { id: string; student_id: string | null; class_name: string | null; content: string | null; posted_at: string | null; created_at: string };
const PER_RUN = 60;
const AI_BATCH = 12;
const TABLE = "teacher_satisfaction_judgments";
export type JudgeOutcome = { judged: number; applied: number; pending: number; failed: number };

const missingTable = (e: { code?: string } | null) => Boolean(e && (e.code === "42P01" || e.code === "PGRST205"));

/**
 * 지점 → 마감하지 않은 가장 이른 달(열린 포트폴리오 줄이 없으면 이번 달) — 단 계산 창(7개월) 밖은 다시 계산되지 않으니 창의 첫 달로 자른다.
 * 판정·확인 대기가 이 달부터만 움직인다(클레임은 강사×달 마감을 따로 본다 — 마감은 줄마다라서).
 */
export async function openFloorMonths(admin: Admin, tenantId?: string): Promise<Map<string, string>> {
  const rows = await fetchAllPaged<{ tenant_id: string; month: string }>((a, b) => {
    const q = admin.from("teacher_portfolio_months").select("tenant_id, month").is("closed_at", null);
    return (tenantId ? q.eq("tenant_id", tenantId) : q).order("tenant_id").order("month").range(a, b);
  });
  const out = new Map<string, string>();
  const windowStart = portfolioFloor(kstToday());
  for (const r of rows) {
    const month = r.month < windowStart ? windowStart : r.month;
    if (!out.has(r.tenant_id) || month < out.get(r.tenant_id)!) out.set(r.tenant_id, month);
  }
  if (tenantId && !out.has(tenantId)) out.set(tenantId, kstToday().slice(0, 7));
  return out;
}

async function tenantReady(tenantId: string): Promise<boolean> {
  const settings = await getTenantSettingsByTenantId(tenantId);
  return isModuleEnabled(settings.modules.disabled, "class_review") && (await isLaboratoryMenuAvailable(tenantId, "class_review"));
}

export async function judgeParentSatisfaction(admin: Admin, tenantId?: string): Promise<JudgeOutcome | null> {
  const probe = await admin.from(TABLE).select("id").limit(1);
  if (missingTable(probe.error)) return null;
  if (probe.error) throw new Error(`만족도 판정 표 확인 실패: ${probe.error.message}`);
  const out: JudgeOutcome = { judged: 0, applied: 0, pending: 0, failed: 0 };
  for (const [tenant, floor] of await openFloorMonths(admin, tenantId)) {
    if (!(await tenantReady(tenant))) continue;
    const { config } = await loadEvaluationConfig(admin, tenant);
    if (!config.metrics.satisfaction.enabled) continue;
    const r = await judgeTenant(admin, tenant, floor, config.metrics.satisfaction.satisfaction ?? DEFAULT_SATISFACTION_OPTIONS);
    out.judged += r.judged; out.applied += r.applied; out.pending += r.pending; out.failed += r.failed;
  }
  return out;
}

async function judgeTenant(admin: Admin, tenant: string, floor: string, o: typeof DEFAULT_SATISFACTION_OPTIONS): Promise<JudgeOutcome> {
  const out: JudgeOutcome = { judged: 0, applied: 0, pending: 0, failed: 0 };
  const sinceIso = new Date(`${floor}-01T00:00:00+09:00`).toISOString();
  const candidates = await fetchAllPaged<{ id: string }>((a, b) => admin.from("classnote_parent_messages").select("id").eq("tenant_id", tenant)
    .not("classified_at", "is", null).eq("category", "none").gte("created_at", sinceIso).order("created_at").order("id").range(a, b));
  // 판정 줄은 늘 그 글보다 늦게 생긴다 — 그 시각 뒤의 판정 줄만 읽으면 후보 전부를 덮는다(킥마다 한두 번 요청).
  const judged = new Set((await fetchAllPaged<{ message_id: string }>((a, b) => admin.from(TABLE).select("message_id").eq("tenant_id", tenant)
    .gte("created_at", sinceIso).order("id").range(a, b))).map((r) => r.message_id));
  const todo = candidates.filter((c) => !judged.has(c.id)).slice(0, PER_RUN).map((c) => c.id);
  if (!todo.length) return out;
  const batch = (await fetchInChunks<Message>(todo, (chunk) => admin.from("classnote_parent_messages")
    .select("id, student_id, class_name, content, posted_at, created_at").eq("tenant_id", tenant).in("id", chunk)))
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
  const boards = new Map<string, Promise<{ keys: string[]; classId: string | null }>>();
  const boardOf = (name: string | null) => {
    const key = (name ?? "").trim();
    if (!boards.has(key)) boards.set(key, resolveBoard(admin, tenant, key || null).catch(() => ({ keys: [], classId: null })));
    return boards.get(key)!;
  };
  // 줄마다 같은 칸을 다 싣는다(여러 줄 upsert는 칸 목록이 줄마다 같아야 빠진 칸이 null로 덮이지 않는다).
  type Row = { message_id: string; state: string } & Record<string, unknown>;
  type Verdict = { method: string; state: string; verdict?: string; phrase?: string | null; reason?: string; model?: string };
  const rowOf = async (m: Message, r: Verdict): Promise<Row> => {
    const board = await boardOf(m.class_name);
    return {
      tenant_id: tenant, message_id: m.id, student_id: m.student_id, posted_on: kstToday(new Date(m.posted_at ?? m.created_at)),
      class_id: board.classId, subjects: board.keys, verdict: null, phrase: null, reason: null, model: null,
      decided_at: r.state === "applied" ? new Date().toISOString() : null, ...r,
    };
  };
  const save = async (rows: Row[]) => {
    if (!rows.length) return;
    const { error } = await admin.from(TABLE).upsert(rows, { onConflict: "tenant_id,message_id", ignoreDuplicates: true });
    if (error) { out.failed += rows.length; reportWarning("학부모 만족도 판정 저장 실패", { scope: "judgeParentSatisfaction", message: error.message }); return; }
    out.judged += rows.length;
    out.applied += rows.filter((r) => r.state === "applied").length;
    out.pending += rows.filter((r) => r.state === "pending").length;
  };
  const decided: Row[] = [];
  const askAi: { m: Message; reason: string | null; phrase: string | null }[] = [];
  for (const m of batch) {
    const content = m.content ?? "";
    if (isAttachOnlyContent(content)) { decided.push(await rowOf(m, { method: "rule", state: "none", reason: "첨부만 있는 글" })); continue; }
    const v = judgeByRules(content, o);
    const board = await boardOf(m.class_name);
    const unknownSubject = !board.classId && !board.keys.length;
    if ((v.kind === "plus" || v.kind === "minus") && unknownSubject) decided.push(await rowOf(m, { method: "rule", state: "pending", verdict: v.kind, phrase: v.phrase, reason: "과목을 모르는 보드" }));
    else if (v.kind === "plus" || v.kind === "minus") decided.push(await rowOf(m, { method: "rule", state: "applied", verdict: v.kind, phrase: v.phrase }));
    else if (v.kind === "ambiguous" && o.ai !== "off") askAi.push({ m, reason: v.reason, phrase: v.phrase });
    else if (v.kind === "ambiguous") decided.push(await rowOf(m, { method: "rule", state: "pending", phrase: v.phrase, reason: v.reason }));
    else if (o.ai === "all" && content.trim()) askAi.push({ m, reason: null, phrase: null });
    else decided.push(await rowOf(m, { method: "rule", state: "none" }));
  }
  // 문구로 정한 것은 먼저 저장 — AI 묶음이 끊겨도 그 사이 판정이 사라지지 않게. AI 묶음도 묶음마다 저장한다.
  await save(decided);
  for (let i = 0; i < askAi.length; i += AI_BATCH) {
    const part = askAi.slice(i, i + AI_BATCH);
    let ai: Awaited<ReturnType<typeof judgeWithAi>> | null = null;
    try {
      ai = await judgeWithAi(tenant, part.map(({ m }) => ({ id: m.id, content: m.content ?? "" })));
    } catch (e) {
      // AI가 꺼졌거나 막혔으면 애매한 글은 사람이 보게(확인 대기) · 문구에 안 걸린 글은 판정 없음 — 매 킥마다 다시 묻지 않는다.
      reportWarning("학부모 만족도 AI 판정 실패", { scope: "judgeParentSatisfaction", message: e instanceof Error ? e.message : String(e) });
    }
    const rows: Row[] = [];
    for (const { m, reason, phrase } of part) {
      const got = ai?.verdicts.get(m.id);
      if (got && got.verdict !== "none") rows.push(await rowOf(m, { method: "ai", state: "pending", verdict: got.verdict, phrase: got.quote, reason: reason ?? "AI 판정", model: ai!.model }));
      else if (got) rows.push(await rowOf(m, { method: "ai", state: "none", reason: "AI 판정 — 해당 없음", model: ai!.model }));
      else if (reason) rows.push(await rowOf(m, { method: "rule", state: "pending", phrase, reason: `${reason} · AI 판정 못 함` }));
      else rows.push(await rowOf(m, { method: "rule", state: "none" }));
    }
    await save(rows);
  }
  return out;
}
