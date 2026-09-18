import "server-only";
import { after } from "next/server";
import type { createClient } from "@/lib/supabase/server";
import { fetchInChunks } from "@/lib/supabase/batch";
import { logAction } from "@/features/audit/server/log";
import { getTenantSettings } from "@/features/owner/server/queries";
import { mergeHolidays } from "@/features/billing/tuition-calc";
import { monthRange } from "../plan";
import { canMaterializeTerm, monthRosterKey, parseVirtualTermId, termRowState, type MonthRosterPair } from "../month-roster";
import { loadMonthRoster, type MonthRoster } from "./month-roster";
import { loadLivePlans } from "./live-plans";

/**
 * **가상 회차 행을 실제 행으로** — 회차 확정 화면의 줄은 그 달 출석부 줄 집합(`loadMonthRoster`)과 같지만, 회차 행이 없는 줄은
 * DB에 미리 만들지 않고 화면용 가상 id(`virtualTermId`)로만 선다(원장 2026-09-18 *"보강 추가 등으로 출석부 행이 더 생길 수도
 * 있으니 거기에 맞춰서 자동으로 회차 확정에도 행이 추가되면 좋겠네"*). 확정(개별·선택·반 일괄)이나 수납 배분을 **저장하는 순간**에만
 * 여기서 만든다 — 미리 만들면 다음 '계획 갱신'이 지우고 시수 검증의 미확정 수를 부풀린다.
 *
 * 🔴 **서버가 가상 id를 풀어 다시 판정한다(#77)** — 화면이 보낸 id는 그 화면을 연 시점의 스냅샷이라, 그 쌍이 지금도 그 달 줄 집합에
 *    있는지 · 그 학생의 이 달 청구서가 취소되지 않았는지 · (배분이면) 그 청구서의 학생인지를 여기서 다시 본다. 어긋나면 한글 사유.
 * 🔴 만들 수 있는 상태는 `missing`뿐이다(`invoice_id NOT NULL` — 붙일 청구서가 있어야 한다). 청구서가 없거나 취소된 줄은 거절한다.
 * 🔴 **확정 필드는 절대 건드리지 않는다(N1)** — `upsert(ignoreDuplicates)`라 이미 있는 행은 한 글자도 안 바뀐다. 동시에 두 창이 같은 줄을
 *    만들어도 유니크 `(tenant, invoice, class)`가 한 행만 남기고, 그 뒤 `select`가 남은 행의 id를 준다.
 * 🔴 같은 학생·반의 회차 행이 **이 학생의 다른 청구서**(중복 청구서)에 이미 있으면 새로 만들지 않는다 — 확정 경로는 그 행을 쓰고,
 *    배분(청구서 한 장에 붙이는 일)은 거절한다(한 줄이 두 청구서에 서면 반 전체 선택 한 번에 같은 반이 두 번 확정된다).
 * ⚠️ 예정 시수는 수강 근거(`sources`에 `enrolled`)가 있을 때만 live plan(종전 계산)이고, 기록·예약만 있는 줄은 null이다 — 반 일괄
 *    확정은 예정 > 0인 줄만 대상이라(`plannedOnly` · actions.ts) 그 줄은 개별·선택 확정으로 한다.
 */

type Db = Awaited<ReturnType<typeof createClient>>;

/** 왜 행을 만드는가 — 감사로그 상세(describe.ts)가 같은 어휘로 한글화한다. */
export type MaterializeReason = "confirm" | "confirm_selected" | "confirm_class" | "allocate";

export type MaterializeContext = {
  tenantId: string;
  period: string;
  reason: MaterializeReason;
  /** 수납 배분 — 이 청구서에만 붙인다(그 학생의 청구서가 아니면 거절). */
  invoiceId?: string;
  /** 선택 확정·반 일괄 — 가상 id의 반이 이 반이어야 한다. */
  classId?: string;
  /** 이미 읽어 둔 줄 집합(반 일괄 확정이 한 번 읽은 것) — 없으면 학생만큼 좁혀 읽는다. */
  roster?: MonthRoster;
  /**
   * 반 일괄 확정 — **이번 달 예정이 있는 줄만** 만든다. 수강행 없는 보강 방문 줄(예정 없음)과 예정 0인 수강 줄(월초 당일 종료·반이동 전출 —
   * 그 반 수업 0회)은 반 전체에 한 숫자를 넣으면 틀린 시수가 확정되므로(8시수 반 일괄에 한 번 온 보강생·떠난 학생이 8시수로, EiE면 월 정액)
   * 실제 시수를 보고 개별·선택 확정으로 한다(적대 리뷰 2026-09-18 — 운영 9월 예정 0 수강 줄 6건).
   */
  plannedOnly?: boolean;
};

/** 판정을 통과한 가상 줄 — `existingId`가 있으면 만들 것 없이 그 행을 쓴다. */
export type ResolvedVirtualTerm = {
  virtualId: string;
  studentId: string;
  classId: string;
  invoiceId: string;
  subject: string;
  pair: MonthRosterPair;
  existingId: string | null;
};

export type MaterializeResult = {
  /** 가상 id → 실제 행 id(방금 만들었든 이미 있었든). */
  ids: Map<string, string>;
  /**
   * 이번 호출이 **실제로 새로 만든** 행 수(감사로그 수와 같다). ⚠️ 다른 창이 먼저 만들어 둔 행은 `ids`엔 있지만 여기엔 안 센다 —
   * 화면의 새로고침 판단은 이 수가 아니라 "가상 id를 보냈는가"로 한다(행이 이미 있었어도 화면의 줄은 여전히 가상 행이다).
   */
  created: number;
  /** 가상 id → 못 만든 이유(한글). */
  failed: Map<string, string>;
  /** 줄 집합·청구서를 읽지 못함 — 전부 실패. */
  error?: string;
};

/** 화면에 그대로 나가는 사유 — raw 코드 없이 전부 한글. */
export const MATERIALIZE_ERROR = {
  invalid: "회차 행을 확인할 수 없습니다. 화면을 새로고침한 뒤 다시 시도해 주세요",
  notInRoster: "이 달 출석부 줄에 없는 학생·반입니다. 화면을 새로고침한 뒤 다시 확인해 주세요",
  classUnknown: "반 정보를 읽지 못했습니다. 다시 시도해 주세요",
  noInvoice: "이 달 청구서가 없어 회차 행을 만들 수 없습니다",
  voidInvoice: "이 달 청구서가 취소(void)돼 회차 행을 만들 수 없습니다",
  otherInvoice: "이 청구서의 학생이 아닙니다",
  termOnOtherInvoice: "이 반의 회차 행이 이 학생의 다른 청구서에 있습니다",
  wrongClass: "이 반의 학생이 아닙니다",
  unplanned: "이번 달 예정이 없는 줄(보강 방문·월초 종료 등)은 반 일괄 확정에서 빠집니다 — 실제 시수를 보고 개별로 확정해 주세요",
  read: "출석부 줄을 읽지 못했습니다. 다시 시도해 주세요",
  create: "회차 행을 만들지 못했습니다. 다시 시도해 주세요",
} as const;

type InvoiceRow = { id: string; student_id: string; status: string | null };
type TermRow = { id: string; invoice_id: string; class_id: string | null };

/** upsert 한 번에 싣는 행 수 — 계획 갱신과 같은 값. */
const WRITE_CHUNK = 200;

/**
 * 가상 id들을 **판정만** 한다(쓰기 없음) — 줄 집합·청구서·기존 행을 한 번씩 읽고 id마다 통과/사유를 낸다.
 * 반 일괄 확정처럼 여러 줄을 한꺼번에 볼 때 왕복이 줄 수만큼 늘지 않게 묶음이 기본이다.
 */
export async function resolveVirtualTerms(
  db: Db,
  ctx: MaterializeContext,
  ids: readonly string[],
): Promise<{ resolved: ResolvedVirtualTerm[]; failed: Map<string, string>; error?: string }> {
  const failed = new Map<string, string>();
  const range = monthRange(ctx.period);
  const parsed: { id: string; studentId: string; classId: string }[] = [];
  for (const id of new Set(ids)) {
    const p = parseVirtualTermId(id);
    if (!p || !range) {
      failed.set(id, MATERIALIZE_ERROR.invalid);
      continue;
    }
    if (ctx.classId && p.classId !== ctx.classId) {
      failed.set(id, MATERIALIZE_ERROR.wrongClass);
      continue;
    }
    parsed.push({ id, ...p });
  }
  if (parsed.length === 0) return { resolved: [], failed };
  const studentIds = [...new Set(parsed.map((p) => p.studentId))];

  let roster: MonthRoster;
  let invoices: InvoiceRow[];
  try {
    [roster, invoices] = await Promise.all([
      // 반이 정해진 경로(선택·반 일괄)는 그 반만 읽는다 — 쌍은 반마다 독립이라 결과가 같고 테넌트 전체를 긁지 않는다.
      ctx.roster ? Promise.resolve(ctx.roster) : loadMonthRoster(db, ctx.period, { studentIds, classIds: ctx.classId ? [ctx.classId] : undefined }),
      // void까지 읽는다 — "청구서 없음"과 "청구서 취소"를 갈라 말해야 한다(둘 다 못 만들지만 사유가 다르다).
      fetchInChunks<InvoiceRow>(studentIds, (chunk) => db.from("invoices").select("id, student_id, status").eq("period", ctx.period).in("student_id", chunk)),
    ]);
  } catch {
    return { resolved: [], failed, error: MATERIALIZE_ERROR.read };
  }
  // 학생마다 유효 청구서(id 순 — 화면 `getSessionTermsView`가 가상 행에 붙이는 청구서와 같은 순서)와 취소 여부.
  const byStudent = new Map<string, { live: InvoiceRow[]; voided: boolean }>();
  for (const inv of [...invoices].sort((a, b) => a.id.localeCompare(b.id))) {
    if (!studentIds.includes(inv.student_id)) continue;
    const s = byStudent.get(inv.student_id) ?? byStudent.set(inv.student_id, { live: [], voided: false }).get(inv.student_id)!;
    if (inv.status === "void") s.voided = true;
    else s.live.push(inv);
  }
  const liveInvoiceIds = [...byStudent.values()].flatMap((s) => s.live.map((i) => i.id));
  const liveInvoiceSet = new Set(liveInvoiceIds);
  let existing: TermRow[];
  try {
    existing = await fetchInChunks<TermRow>(liveInvoiceIds, (chunk) => db.from("invoice_session_terms").select("id, invoice_id, class_id").in("invoice_id", chunk));
  } catch {
    return { resolved: [], failed, error: MATERIALIZE_ERROR.read };
  }
  const studentOfInvoice = new Map(invoices.map((i) => [i.id, i.student_id]));
  const existingByPair = new Map<string, TermRow>();
  for (const t of existing) {
    const student = studentOfInvoice.get(t.invoice_id);
    if (!student || !t.class_id || !liveInvoiceSet.has(t.invoice_id)) continue;
    const key = monthRosterKey(student, t.class_id);
    // 같은 쌍의 행이 둘이면(중복 청구서) 배분 대상 청구서의 것을 우선 — 없으면 먼저 읽힌 것.
    if (!existingByPair.has(key) || (ctx.invoiceId && t.invoice_id === ctx.invoiceId)) existingByPair.set(key, t);
  }

  const resolved: ResolvedVirtualTerm[] = [];
  for (const p of parsed) {
    const key = monthRosterKey(p.studentId, p.classId);
    const pair = roster.byKey.get(key);
    if (!pair) {
      failed.set(p.id, MATERIALIZE_ERROR.notInRoster);
      continue;
    }
    if (ctx.plannedOnly && !pair.sources.includes("enrolled")) {
      failed.set(p.id, MATERIALIZE_ERROR.unplanned);
      continue;
    }
    const cls = roster.classes.get(p.classId);
    if (!cls) {
      failed.set(p.id, MATERIALIZE_ERROR.classUnknown);
      continue;
    }
    const s = byStudent.get(p.studentId);
    // 판정은 살아 있는 청구서가 **있는지**로(상태 값이 비어 있어도 청구서는 청구서다) — 화면 `getSessionTermsView`와 같은 규칙.
    const live = s?.live[0];
    const state = termRowState({ hasTerm: false, invoiceStatus: live ? (live.status ?? "live") : s?.voided ? "void" : null });
    if (!s || !canMaterializeTerm(state)) {
      failed.set(p.id, state === "void_invoice" ? MATERIALIZE_ERROR.voidInvoice : MATERIALIZE_ERROR.noInvoice);
      continue;
    }
    if (ctx.invoiceId && !s.live.some((i) => i.id === ctx.invoiceId)) {
      failed.set(p.id, MATERIALIZE_ERROR.otherInvoice);
      continue;
    }
    const hit = existingByPair.get(key);
    if (hit && ctx.invoiceId && hit.invoice_id !== ctx.invoiceId) {
      failed.set(p.id, MATERIALIZE_ERROR.termOnOtherInvoice);
      continue;
    }
    resolved.push({
      virtualId: p.id,
      studentId: p.studentId,
      classId: p.classId,
      invoiceId: hit?.invoice_id ?? ctx.invoiceId ?? s.live[0]!.id,
      subject: cls.subject,
      pair,
      existingId: hit?.id ?? null,
    });
  }
  return { resolved, failed };
}

/** 한 줄 판정 — 개별 확정이 쓴다(묶음 판정의 얇은 껍데기). */
export async function resolveVirtualTerm(db: Db, period: string, id: string, opts: Omit<MaterializeContext, "period">): Promise<{ term: ResolvedVirtualTerm } | { error: string }> {
  const out = await resolveVirtualTerms(db, { ...opts, period }, [id]);
  const term = out.resolved[0];
  if (term) return { term };
  return { error: out.error ?? out.failed.get(id) ?? MATERIALIZE_ERROR.invalid };
}

/**
 * 판정을 통과한 줄의 행을 **만든다**(이미 있는 줄은 그대로 그 id). 생성 컬럼 = `tenant_id, invoice_id, subject, class_id, planned_sessions`뿐 —
 * 확정·배분·메모 필드는 만지지 않는다. 만든 행마다 감사로그 `session_term_create`(응답 뒤 — 확정·배분 로그와 같은 결).
 */
export async function ensureSessionTermRows(db: Db, ctx: MaterializeContext, terms: readonly ResolvedVirtualTerm[]): Promise<MaterializeResult> {
  const result: MaterializeResult = { ids: new Map(), created: 0, failed: new Map() };
  const toCreate: ResolvedVirtualTerm[] = [];
  for (const t of terms) {
    if (t.existingId) result.ids.set(t.virtualId, t.existingId);
    else toCreate.push(t);
  }
  if (toCreate.length === 0) return result;

  // 예정 시수 — 수강 근거가 있는 줄만 live plan(종전 계산), 기록·예약만 있는 줄은 null.
  const enrolledStudents = [...new Set(toCreate.filter((t) => t.pair.sources.includes("enrolled")).map((t) => t.studentId))];
  let plans = new Map<string, Map<string, number>>();
  if (enrolledStudents.length > 0) {
    try {
      const settings = await getTenantSettings();
      const holidays = mergeHolidays(Number(ctx.period.slice(0, 4)), settings.operations.holidays.map((h) => h.date), true);
      plans = (await loadLivePlans(db, ctx.period, enrolledStudents, holidays)).plans;
    } catch {
      for (const t of toCreate) result.failed.set(t.virtualId, MATERIALIZE_ERROR.read);
      return result;
    }
  }
  const plannedOf = (t: ResolvedVirtualTerm): number | null => (t.pair.sources.includes("enrolled") ? plans.get(t.studentId)?.get(t.classId) ?? 0 : null);
  // 반 일괄: 예정이 0 이하인 줄은 만들지 않는다(위 `plannedOnly` 설명).
  const creatable = ctx.plannedOnly ? toCreate.filter((t) => (plannedOf(t) ?? 0) > 0) : toCreate;
  for (const t of toCreate) if (!creatable.includes(t)) result.failed.set(t.virtualId, MATERIALIZE_ERROR.unplanned);
  if (creatable.length === 0) return result;
  const rows = creatable.map((t) => ({
    tenant_id: ctx.tenantId,
    invoice_id: t.invoiceId,
    subject: t.subject,
    class_id: t.classId,
    planned_sessions: plannedOf(t),
  }));
  // 실제로 들어간 행(`청구서|반`) — ON CONFLICT DO NOTHING의 RETURNING은 새로 넣은 행만 돌려준다. 감사로그는 이 행에만 남긴다.
  const inserted = new Set<string>();
  for (let i = 0; i < rows.length; i += WRITE_CHUNK) {
    // ignoreDuplicates — 동시에 다른 창이 먼저 만들었으면 그 행을 한 글자도 안 건드린다(아래 select가 그 id를 준다).
    const { data, error } = await db
      .from("invoice_session_terms")
      .upsert(rows.slice(i, i + WRITE_CHUNK), { onConflict: "tenant_id,invoice_id,class_id", ignoreDuplicates: true })
      .select("id, invoice_id, class_id");
    if (error) {
      for (const t of creatable) if (!result.ids.has(t.virtualId)) result.failed.set(t.virtualId, MATERIALIZE_ERROR.create);
      return result;
    }
    for (const r of (data ?? []) as TermRow[]) inserted.add(`${r.invoice_id}|${r.class_id}`);
  }
  let found: TermRow[];
  try {
    found = await fetchInChunks<TermRow>([...new Set(creatable.map((t) => t.invoiceId))], (chunk) =>
      db.from("invoice_session_terms").select("id, invoice_id, class_id").in("invoice_id", chunk),
    );
  } catch {
    for (const t of creatable) result.failed.set(t.virtualId, MATERIALIZE_ERROR.create);
    return result;
  }
  const idByKey = new Map(found.map((t) => [`${t.invoice_id}|${t.class_id}`, t.id]));
  const logs: Parameters<typeof logAction>[0][] = [];
  for (const t of creatable) {
    const id = idByKey.get(`${t.invoiceId}|${t.classId}`);
    if (!id) {
      result.failed.set(t.virtualId, MATERIALIZE_ERROR.create);
      continue;
    }
    result.ids.set(t.virtualId, id);
    if (!inserted.has(`${t.invoiceId}|${t.classId}`)) continue; // 다른 창이 먼저 만든 행 — 이번 호출의 생성이 아니다.
    result.created++;
    // 줄이 생긴 사실은 돈 계산의 모수가 바뀐 것이라 행마다 남긴다 — 반·학생은 뷰어가 이름으로 풀고, 왜(어느 저장이 만들었나)·예정 시수를 싣는다.
    logs.push({
      action: "session_term_create",
      targetType: "invoice_session_term",
      targetLabel: `${ctx.period} 회차 행 생성`,
      metadata: {
        period: ctx.period,
        termId: id,
        invoiceId: t.invoiceId,
        classId: t.classId,
        studentId: t.studentId,
        reason: ctx.reason,
        plannedSessions: plannedOf(t),
        sources: t.pair.sources,
        recordedUnits: t.pair.recordedUnits,
      },
    });
  }
  if (logs.length > 0) {
    after(async () => {
      for (const log of logs) await logAction(log);
    });
  }
  return result;
}

/** 한 줄 생성 — `resolveVirtualTerm`을 통과한 줄 하나(묶음의 얇은 껍데기). */
export async function ensureSessionTermRow(db: Db, tenantId: string, ctx: Omit<MaterializeContext, "tenantId">, term: ResolvedVirtualTerm): Promise<{ id: string; created: boolean } | { error: string }> {
  const out = await ensureSessionTermRows(db, { ...ctx, tenantId }, [term]);
  const id = out.ids.get(term.virtualId);
  if (id) return { id, created: out.created > 0 };
  return { error: out.error ?? out.failed.get(term.virtualId) ?? MATERIALIZE_ERROR.create };
}

/**
 * **판정 + 생성** 한 번에 — 확정 3경로·배분 저장이 쓰는 문. 가상 id가 아닌 id는 그대로 돌려준다(실 행은 만들 것이 없다).
 * 실패한 id는 `failed`에 사유와 함께 남고 나머지는 계속 간다(한 명이 막혀도 다른 학생의 확정을 세우지 않는다 — 선택 확정과 같은 결).
 */
export async function materializeVirtualTerms(db: Db, ctx: MaterializeContext, ids: readonly string[]): Promise<MaterializeResult> {
  const judged = await resolveVirtualTerms(db, ctx, ids);
  if (judged.error) return { ids: new Map(), created: 0, failed: judged.failed, error: judged.error };
  const made = await ensureSessionTermRows(db, ctx, judged.resolved);
  for (const [id, reason] of judged.failed) made.failed.set(id, reason);
  return made;
}
