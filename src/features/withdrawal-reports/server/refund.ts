import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { toPrefillLines } from "@/features/billing/server/refund-queries";
import { receiptHistoryLines } from "@/features/billing/invoice-line-items";
import { receiptRefundState } from "@/features/billing/session-terms/receipt-refund";
import type { RefundPrefillLine } from "@/features/billing/refund-prefill";
import { INVOICE_CATEGORY_LABEL } from "../prefill";
import type { WithdrawalReport } from "../model";
import { REFUND_TAG_PREFIX, claimedKeys, claimedLines, courseOfLine, lineBase, lineIds, norm, splitKey } from "../refund-keys";
import { billingWriters, type DeskStaffRow } from "../desk-staff";
import { platformAccountIds } from "@/features/owner/server/platform-settings";
import { getTenantSettings } from "@/features/owner/server/queries";
import { foldedReason } from "@/lib/folded-read";
import { missingReportSchema } from "../model";
import { orphanSubjects } from "../target-courses";
import type { RefundScope } from "../refund-decision";
import { kstToday } from "@/lib/date-kst";

/**
 * 퇴원월 **뒤** 청구 — 원장 2026-10-29 *"11월까지 납부했는데, 퇴원보고서상에는 10월납부밖에 없음… 이후에 납부한건 혹은 환불한 건에
 * 대해서도 표시할 수 있어야함"*(김덕현 — 영어만 수강종료 10-28 · 11월 청구에 영어 반 줄 315,000원 납부). 무효(void) 청구는 뺀다.
 * 환불은 **청구 줄 단위** — 원장 *"어떤건을 환불할건지 토글토글토글해서 선택선택선택해 그 건을 환불하게"*.
 * 환불 요청서(academy_documents · refund_request)는 설명 칸의 표식(`lines:<청구id>#<줄 식별값>,…`)으로 줄과 잇는다.
 */
export type RefundRef = { documentId: string; deskName: string | null; completed: boolean };
export type LaterLine = RefundPrefillLine & {
  /** `<청구 id>#<줄 식별값>` — 환불 선택·표식의 단위. 줄 내용(구분·반·수납명·묶음) 기준이라 동기화로 순서가 바뀌어도 같은 줄을 가리킨다. */
  key: string;
  /** 이 줄로 낸 돈(줄 기록이 없으면 대신 값 · 청구 납부액을 넘지 않게 맞춤). */
  paidNet: number;
  /** 과목 수강종료에서 어느 반에도 묶이지 않은 줄(차량비·교재 등) — 보이기만 하고 토글은 기본 꺼짐(원장 2026-10-29). */
  unbound?: boolean;
  /** 수납(makeedu)에 **전체** 환불 기록이 있는 줄 — 여기서 다시 환불하지 않는다(부분 환불이면 false · 남은 돈이 `paidNet` — 리뷰 #6). */
  billingRefund: boolean;
  /** makeedu 부분 환불액(취소되지 않은 환불 합) — 남은 낸 돈 = 줄 납부액 − 이 값. 금액을 모르는 환불이 섞이면 null(낸 돈 전부를 결정 대상으로 · 닫히는 쪽). */
  billingRefundAmount?: number | null;
  /** 줄별 납부 기록이 없어 청구 납부액이 줄에 다 나뉘지 않은 돈(리뷰 차단 2) — 확인 값에 든다(원장이 정한다). */
  unallocated?: true;
  /** 이 묶음(옛 단건은 이 보고서)에 이어진 요청서 — 이것만 줄을 잡는다(팀장 결정 2026-11-06). */
  refund: RefundRef | null;
  /**
   * **다른 묶음**에 이어진 요청서가 이 줄을 담고 있다 — 줄을 잡지 않는다(`refund`는 null · 이 묶음에선 원장 결정 대기). 화면은 참고로 그 요청서를 보인다.
   * `canceled` = 그 요청서가 이어진 보고서가 모두 취소됨. 다시 환불 승인은 '취소된 요청의 미완료 요청서'일 때만(`reapprovable`) — 그 밖엔 '환불하지 않음'으로만 정한다.
   */
  otherRefund?: OtherRefundRef;
};
export type OtherRefundRef = RefundRef & { canceled: boolean };
export type LaterInvoice = {
  id: string; period: string; category: string; status: string;
  /** 보이는 줄 합계(전체 퇴원 = 청구 전체 · 과목 수강종료 = 끝내는 반 이름 줄만). */
  amountBilled: number; amountPaid: number;
  lines: LaterLine[];
  partial: boolean;
};

export { LINE_KEY, REFUND_TAG_PREFIX, refundTag } from "../refund-keys";

/** 퇴원월 뒤 청구 상한 — 닿으면 잘렸을 수 있어 확인 값을 만들지 않는다. */
const LATER_LIMIT = 120;
/** 미배분 납부 줄의 식별값(줄 키 `<청구 id>#unalloc` — DB 줄 키 형식 안). */
export const UNALLOCATED_LINE = "unalloc";
/** makeedu 부분 환불액 — 취소되지 않은 환불의 금액 합. 금액을 모르는 환불이 섞이면 null. */
function partialRefundAmount(v: unknown): number | null {
  const refunds = Array.isArray((v as { refunds?: unknown } | null)?.refunds) ? ((v as { refunds: unknown[] }).refunds) : [];
  let total = 0;
  for (const r of refunds) {
    const row = (r ?? {}) as { status?: unknown; amount?: unknown };
    if (row.status === "cancelled") continue;
    const n = Number(row.amount);
    if (!Number.isFinite(n) || n < 0) return null;
    total += n;
  }
  return total;
}

/** 수업 줄인가 — makeedu 한글 '수업' · 옛 영문 'tuition'. */
const isLessonKind = (kind: string) => ["수업", "수강료", "tuition"].includes(kind.trim());

/** 줄을 환불할 수 있나 — 낸 돈이 있고 · 환불된 청구·줄이 아니고 · 아직 요청서가 없음(순수 판정은 `refund-decision.ts` — 화면·DB 확인 값과 같은 함수). */
export { lineRefundable } from "../refund-decision";

/** 이 청구들을 건드린 퇴원보고서 환불 요청서(표식으로 찾음) — 지점 전체가 아니라 청구 id로 좁혀 읽는다(상한에 잘려 빠지지 않게). */
async function docsForInvoices(tenantId: string, invoiceIds: string[]) {
  if (!invoiceIds.length) return [];
  const { data, error } = await createAdminClient().from("academy_documents").select("id,description,form_data,created_at")
    .eq("tenant_id", tenantId).eq("form_type", "refund_request").like("description", `${REFUND_TAG_PREFIX}%`)
    .or(invoiceIds.map(id => `description.like.*${id}*`).join(",")).order("created_at").limit(1000);
  if (error) throw new Error(`환불 요청서 조회 실패: ${error.message}`);
  return data ?? [];
}

/** 요청서의 환불완료일자가 들어갔나(데스크가 돈을 돌려줬다). */
const docCompleted = (d: { form_data?: unknown }) => !!((d.form_data ?? {}) as { result?: { completedDate?: string } }).result?.completedDate?.trim();

/**
 * 요청서 문서를 연결로 가른다 — 줄을 '잡는' 것은 **보고서에 이어진 요청서**(s2_0025 `withdrawal_report_refunds`)뿐이다(검토 2026-11-06). 표식(설명)은 자료실에서
 * 고칠 수 있어, 이어지지 않은 문서에 표식을 적어 환불 가능 줄을 숨기면 원장 결정·데스크 환불 없이 처리될 수 있었다. 이어진 요청서의 표식·번호·서식은 DB 트리거가 막는다(s2_0033).
 * - `own` = **이 묶음(옛 단건은 이 보고서)에 이어진 요청서** — 🔴 이 묶음의 줄을 잡는 것은 이것뿐이다(팀장 결정 2026-11-06 · DB 결정도 묶음마다).
 *   다른 묶음(취소된 요청 · 끝난 과목 수강종료 등)에 이어진 요청서가 담은 줄은 이 묶음에선 결정 안 됨 → 원장 환불 결정 대기.
 * - `other` = 다른 묶음에 이어진 요청서 — 줄을 잡지 않고 화면이 참고로 보인다(`otherRefund` · 같은 돈을 두 번 돌려주지 않게 원장·데스크가 본다).
 * - `blocking` = 동시 승인 겹침 확인(`claimedEarlier`)이 '먼저 잡은 요청서'로 치는 것 — 이어진 요청서 중 **환불완료일자가 들어갔거나 취소되지 않은 보고서에
 *   이어진 것**(돈을 돌려줬거나 진행 중) + `recentMs` 안에 만든 이어지지 않은 문서(막 만들어 아직 잇기 전). 취소된 요청에만 이어진 미완료 요청서는 막지 않는다
 *   — 새 요청의 원장이 그 줄을 다시 환불 승인할 수 있다(`reapprovable`).
 * 연결 표가 없는 DB(s2_0025 전)는 종전처럼 표식만 본다(모두 own). 연결·보고서 상태를 못 읽으면 던진다(확인 값을 못 만들면 처리하지 않는다).
 */
async function classifyDocs<D extends { id: unknown; created_at?: unknown; form_data?: unknown }>(
  tenantId: string, docs: D[], scope: { groupId?: string | null; reportId?: string | null }, recentMs = 0,
): Promise<{ own: D[]; other: D[]; blocking: D[]; canceledOnly: (d: D) => boolean }> {
  const none = () => false;
  if (!docs.length) return { own: docs, other: [], blocking: docs, canceledOnly: none };
  const db = createAdminClient();
  const { data, error } = await db.from("withdrawal_report_refunds").select("document_id,report_id,group_id").eq("tenant_id", tenantId).in("document_id", docs.map(d => String(d.id)));
  if (missingReportSchema(error)) return { own: docs, other: [], blocking: docs, canceledOnly: none };
  if (error) throw new Error(`환불 요청서 연결 조회 실패: ${error.message}`);
  const links = (data ?? []).map(r => ({ doc: String(r.document_id), report: String(r.report_id), group: r.group_id ? String(r.group_id) : null }));
  const reportIds = [...new Set(links.map(l => l.report))];
  const { data: reports, error: reportError } = reportIds.length
    ? await db.from("withdrawal_reports").select("id,status").eq("tenant_id", tenantId).in("id", reportIds)
    : { data: [], error: null };
  if (reportError) throw new Error(`환불 요청서의 보고서 상태 조회 실패: ${reportError.message}`);
  const canceled = new Set((reports ?? []).filter(r => r.status === "canceled").map(r => String(r.id)));
  const linksOf = (d: D) => links.filter(l => l.doc === String(d.id));
  const isOwn = (d: D) => linksOf(d).some(l => (!!scope.groupId && l.group === scope.groupId) || (!!scope.reportId && l.report === scope.reportId));
  // 이어진 보고서가 모두 취소됐다(못 찾은 보고서는 살아 있는 쪽으로 — 막는 쪽).
  const canceledOnly = (d: D) => { const ls = linksOf(d); return ls.length > 0 && ls.every(l => canceled.has(l.report)); };
  const since = Date.now() - recentMs;
  const blocks = (d: D) => linksOf(d).length ? !canceledOnly(d) || docCompleted(d) : recentMs > 0 && Date.parse(String(d.created_at ?? "")) >= since;
  return {
    own: docs.filter(isOwn),
    other: docs.filter(d => linksOf(d).length > 0 && !isOwn(d)),
    blocking: docs.filter(blocks),
    canceledOnly,
  };
}

/**
 * - 전체 퇴원: 퇴원월 뒤 청구 전체 줄.
 * - 과목 수강종료: 청구는 학생 단위라, **끝내는 반 이름과 같은 줄**(makeedu 청구 줄 `description` = 반 이름)만. 그런 줄이 없는 청구는 빠진다.
 * - 다시 등록하기 전까지만 — 퇴원일 뒤에 시작한 수강(과목 수강종료면 같은 과목)이 있으면 그 달부터는 새로 다니는 청구다.
 * - 이 묶음에 이어진 요청서가 잡은 줄은 그 요청서를 보인다(`refund`). 다른 묶음에 이어진 요청서가 담은 줄은 잡지 않고 참고로 보인다(`otherRefund` ·
 *   팀장 결정 2026-11-06 — 이 묶음에선 결정 안 됨). 요청서 표식이 지금 줄과 맞지 않으면(동기화로 줄이 바뀜·옛 표식) 그 청구 전체를 잡힌 것으로 본다
 *   — 같은 돈을 두 번 돌려주지 않는 쪽으로(리뷰 2026-10-29).
 * - 🔴 작성 강사가 둘 이상인 과목 수강종료의 **대표 보고서**는 작성 강사가 하나도 없는 대상 과목(`orphanSubjects`)의 줄까지 보인다(결정 2026-11-06) —
 *   그 줄이 어느 화면에도 없으면 원장이 정할 수 없고, 확인 값에서 빠지면 결정 없이 처리된다. 그 과목은 따로 계산해 줄 단위로 합친다
 *   (재등록 달 자르기가 대표 보고서 과목 줄까지 번지지 않게). `opts.orphans`를 주면 묶음을 다시 읽지 않는다.
 */
type LaterReport = Pick<WithdrawalReport, "id" | "tenant_id" | "student_id" | "effective_date" | "exit_kind" | "subjects" | "snapshot"> & { group_id?: string | null; group_leader?: boolean; enrollment_ids?: string[] | null };
export async function loadLaterInvoices(report: LaterReport, opts?: { orphans?: readonly string[]; scope?: RefundScope }): Promise<LaterInvoice[]> {
  // 처리 범위(리뷰 #13) — 과목 수강종료인데 남는 수강이 없으면 처리 함수가 전체 퇴원으로 바꾼다 → 화면·확인 값도 전체 범위(퇴원월 뒤 청구 전체)로.
  const scope = opts?.scope ?? await refundScopeOf(report);
  if (scope === "withdrawal" && report.exit_kind !== "withdrawal") return laterInvoicesFor({ ...report, exit_kind: "withdrawal" });
  const orphans = opts?.orphans ?? await orphanSubjectsFor(report);
  const own = await laterInvoicesFor(report);
  return orphans.length ? mergeLater(own, await laterInvoicesFor({ ...report, subjects: [...orphans] })) : own;
}

/**
 * 처리 범위 — 처리 함수(`transition_withdrawal_report` 처리 갈래 · DB note)와 같은 판정: 과목 수강종료 묶음인데 끝낼 수강(`enrollment_ids`) 밖에
 * 운영 중인 반의 수강이 마지막 수업일·오늘 뒤까지 남지 않으면 전체 퇴원. 못 읽으면 던진다(확인 값을 못 만들면 처리하지 않는다).
 */
export async function refundScopeOf(report: Pick<LaterReport, "tenant_id" | "student_id" | "exit_kind" | "group_id">): Promise<RefundScope> {
  if (report.exit_kind === "withdrawal" || !report.group_id) return report.exit_kind === "withdrawal" ? "withdrawal" : "subject_end";
  const db = createAdminClient();
  const { data: g, error } = await db.from("withdrawal_report_groups").select("exit_kind,enrollment_ids,effective_date").eq("tenant_id", report.tenant_id).eq("id", report.group_id).maybeSingle();
  if (error) throw new Error(`처리 범위 확인 실패: ${error.message}`);
  if (!g) throw new Error("처리 범위를 확인할 묶음을 찾지 못했습니다.");
  if (g.exit_kind === "withdrawal") return "withdrawal";
  const targets = new Set(((g.enrollment_ids ?? []) as string[]).map(String));
  const { data: rest, error: restError } = await db.from("enrollments").select("id,end_date,classes!inner(is_active,closed_at,tenant_id)")
    .eq("tenant_id", report.tenant_id).eq("student_id", report.student_id).limit(500);
  if (restError) throw new Error(`처리 범위 확인 실패: ${restError.message}`);
  const today = kstToday();
  const cutoff = String(g.effective_date) > today ? String(g.effective_date) : today;
  const remains = (rest ?? []).some(e => {
    const c = e.classes as unknown as { is_active: boolean; closed_at: string | null; tenant_id: string } | null;
    return !targets.has(String(e.id)) && !!c && c.is_active && !c.closed_at && String(c.tenant_id) === report.tenant_id && (!e.end_date || String(e.end_date) > cutoff);
  });
  return remains ? "subject_end" : "withdrawal";
}

/**
 * 대표 보고서가 더 맡는 과목 — 작성 강사가 둘 이상인 과목 수강종료 묶음의 대표 보고서만(`orphanSubjects` · 묶음 과목 − 보고서들의 과목).
 * 못 읽으면 던진다(부르는 쪽은 확인 값을 만들지 못한 것으로 보고 처리하지 않는다 · 화면은 빈 목록).
 */
export async function orphanSubjectsFor(report: Pick<LaterReport, "tenant_id" | "exit_kind" | "group_id" | "group_leader">): Promise<string[]> {
  if (report.exit_kind !== "subject_end" || !report.group_id || !report.group_leader) return [];
  const db = createAdminClient();
  const [group, siblings] = await Promise.all([
    db.from("withdrawal_report_groups").select("subjects").eq("tenant_id", report.tenant_id).eq("id", report.group_id).maybeSingle(),
    db.from("withdrawal_reports").select("subjects").eq("tenant_id", report.tenant_id).eq("group_id", report.group_id).limit(30),
  ]);
  if (group.error || siblings.error) throw new Error(`묶음 과목 조회 실패: ${(group.error ?? siblings.error)!.message}`);
  if (!group.data) throw new Error("묶음을 찾지 못했습니다.");
  return orphanSubjects((group.data.subjects ?? []) as string[], (siblings.data ?? []).map(r => (r.subjects ?? []) as string[]));
}

/** 두 계산을 청구·줄 키로 합친다(같은 줄은 앞 계산 것) — 과목 수강종료(부분 청구)면 보이는 줄 합계를 다시 센다. */
function mergeLater(a: LaterInvoice[], b: LaterInvoice[]): LaterInvoice[] {
  const byId = new Map(a.map(inv => [inv.id, { ...inv, lines: [...inv.lines] }]));
  for (const inv of b) {
    const cur = byId.get(inv.id);
    if (!cur) { byId.set(inv.id, { ...inv, lines: [...inv.lines] }); continue; }
    for (const l of inv.lines) if (!cur.lines.some(x => x.key === l.key)) cur.lines.push(l);
    if (cur.partial) {
      cur.amountBilled = cur.lines.reduce((s, l) => s + Math.max(0, l.amount - (l.discount ?? 0)), 0);
      cur.amountPaid = cur.lines.reduce((s, l) => s + l.paidNet, 0);
    }
  }
  return [...byId.values()].sort((x, y) => x.period.localeCompare(y.period));
}

/**
 * 한 과목 범위(`report.subjects`)의 퇴원월 뒤 청구 — `loadLaterInvoices`의 본체 · 확인 값의 묶음 전체 계산(`loadGroupRefundCheck`)도 쓴다.
 * 줄을 잡는 요청서는 `report.group_id` 묶음(없으면 이 보고서)에 이어진 것뿐이다 — 묶음을 모르고 부르면 이 보고서에 이어진 것만 친다(결정 대기 쪽).
 */
export async function laterInvoicesFor(report: Pick<WithdrawalReport, "id" | "tenant_id" | "student_id" | "effective_date" | "exit_kind" | "subjects" | "snapshot"> & { group_id?: string | null }): Promise<LaterInvoice[]> {
  const month = report.effective_date.slice(0, 7);
  const admin = createAdminClient();
  const ended = report.exit_kind === "withdrawal" ? null
    // 끝내는 반(classId) — 줄이 어느 반 몫인지는 courseOfLine(반 id 또는 반 이름으로 시작하는 수납명).
    : new Set(report.snapshot.courses.filter(c => report.subjects.includes(c.subject)).map(c => c.classId));
  const [{ data: rows, error }, { data: again, error: againError }] = await Promise.all([
    admin.from("invoices").select("id,period,category,status,amount_total,amount_discount,amount_paid,line_items")
      .eq("tenant_id", report.tenant_id).eq("student_id", report.student_id).gt("period", month).neq("status", "void")
      .order("period").limit(LATER_LIMIT),
    admin.from("enrollments").select("id, start_date, end_date, classes!inner(subject)")
      .eq("tenant_id", report.tenant_id).eq("student_id", report.student_id).gt("start_date", report.effective_date).order("start_date").limit(50),
  ]);
  if (error) throw new Error(`퇴원 뒤 청구 조회 실패: ${error.message}`);
  if (againError) throw new Error(`재등록 확인 실패: ${againError.message}`);
  // 상한에 닿으면 뒤 청구가 잘렸을 수 있다 — 확인 값을 만들지 않는다(닫히는 쪽 · 운영 학생당 청구 최대 11건).
  if ((rows ?? []).length >= LATER_LIMIT) throw new Error("퇴원월 뒤 청구가 너무 많아 환불할 수 있는 청구를 다 확인하지 못했습니다.");
  // 과목 수강종료 — 수납 줄의 과목을 가리려고 지점 반 목록(이 학생이 안 다니는 같은 과목 반·보강 반도 맞추게).
  const { data: tenantClasses, error: classError } = ended
    ? await admin.from("classes").select("id,class_name,subject").eq("tenant_id", report.tenant_id).limit(2000)
    : { data: [], error: null };
  if (classError) throw new Error(`반 목록 조회 실패: ${classError.message}`);
  // 끝내는 반 이름·그 반 강사 이름(두 글자 이상) — 반을 못 찾은 수업 줄이 같은 과목인지 가리는 단서.
  const endedHints = ended ? [...new Set(report.snapshot.courses.filter(c => ended.has(c.classId))
    .flatMap(c => [norm(c.className), norm(c.teacherName ?? "")]).filter(h => h.length >= 2))] : [];
  const allClasses = (tenantClasses ?? []).map(c => ({ classId: String(c.id), className: String(c.class_name ?? ""), subject: String(c.subject ?? "") }));
  // 재등록 판정(리뷰 차단 1) — 이 묶음이 끝낼 수강(요청 때 스냅숏의 열린 수강 · 보고서 종료 대상)과 처리 뒤 생기는 0일 수강(시작일 = 종료일)은
  // 다시 등록한 것이 아니다. 미래 시작으로 옮겨 둔 반이 함께 닫히는데 그 달부터 청구를 자르면 낸 돈이 확인 값에서 빠졌다.
  const ending = new Set([...report.snapshot.courses.map(c => String(c.id)), ...((report as { enrollment_ids?: string[] | null }).enrollment_ids ?? []).map(String)]);
  const restart = (again ?? []).find(e => {
    if (ending.has(String(e.id))) return false;
    if (e.end_date && String(e.end_date) <= String(e.start_date)) return false;
    const subject = (e.classes as unknown as { subject: string } | null)?.subject;
    return report.exit_kind === "withdrawal" || (subject != null && report.subjects.includes(subject));
  });
  const reenrolled = restart?.start_date ? String(restart.start_date).slice(0, 7) : null;
  const invoices = (rows ?? []).filter(r => !(reenrolled && String(r.period) >= reenrolled));
  const docs = await classifyDocs(report.tenant_id, await docsForInvoices(report.tenant_id, invoices.map(r => String(r.id))), { groupId: report.group_id ?? null, reportId: report.id });

  // 청구 id → (줄 식별값 | "*") → 요청서. 먼저 만든 요청서가 이긴다(created_at 순). `otherClaims` = 다른 묶음에 이어진 요청서(줄을 잡지 않음 · 참고).
  const claimMap = (list: typeof docs.own) => {
    const claims = new Map<string, Map<string, OtherRefundRef>>();
    for (const d of list) {
      const form = (d.form_data ?? {}) as { approval?: { staff?: string } };
      const ref: OtherRefundRef = { documentId: String(d.id), deskName: form.approval?.staff?.trim() || null, completed: docCompleted(d), canceled: docs.canceledOnly(d) };
      for (const key of claimedKeys(String(d.description ?? ""))) {
        const [invoiceId, lineId] = splitKey(key);
        const map = claims.get(invoiceId) ?? new Map<string, OtherRefundRef>();
        if (!map.has(lineId)) map.set(lineId, ref);
        claims.set(invoiceId, map);
      }
    }
    return claims;
  };
  const claims = claimMap(docs.own);
  const otherClaims = claimMap(docs.other);

  const out: LaterInvoice[] = [];
  for (const r of invoices) {
    const id = String(r.id);
    const status = String(r.status);
    const amountPaidTotal = Number(r.amount_paid);
    if (!Number.isFinite(amountPaidTotal)) throw new Error("청구 납부액을 읽지 못했습니다.");
    const raw = receiptHistoryLines(r.line_items);
    let all = toPrefillLines(r.line_items);
    let ids = lineIds(raw);
    // makeedu 환불 — 전체 환불이면 다시 환불하지 않는다 · 부분 환불이면 남은 돈만 결정 대상(리뷰 #6) · 금액을 모르면 낸 돈 전부(닫히는 쪽).
    let refunded = raw.map(v => receiptRefundState(v) === "full");
    let refundedAmount: (number | null)[] = raw.map(v => receiptRefundState(v) === "partial" ? partialRefundAmount(v) : 0);
    // 줄 기록이 없는 청구는 청구 한 줄(`all`)로 본다.
    if (!all.length) {
      all = [{ kind: "", description: INVOICE_CATEGORY_LABEL[String(r.category)] ?? "기타", amount: Number(r.amount_total), discount: Number(r.amount_discount), paid: amountPaidTotal }];
      ids = ["all"];
      refunded = [false];
      refundedAmount = [0];
    }
    // 줄별 납부액 — 없으면 한 줄 청구는 청구 납부액, 완납 청구는 줄 청구액. 합이 청구 납부액을 넘으면 비율로 줄인다(청구 할인이 줄에 없을 때 과다 환불 방지).
    const rawPaid = all.map(l => l.paid ?? (all.length === 1 ? amountPaidTotal : status === "paid" ? Math.max(0, l.amount - (l.discount ?? 0)) : 0));
    const sum = rawPaid.reduce((s, v) => s + v, 0);
    const paid = sum > amountPaidTotal ? rawPaid.map(v => Math.floor(v * Math.max(0, amountPaidTotal) / sum)) : rawPaid;
    // 미배분 납부(리뷰 차단 2) — 청구 납부액 − 줄에 나뉜 납부액 > 0(부분 납부 여러 줄 청구에 줄별 납부 기록이 없음 · 줄 합보다 더 냄)이면 그 차액을 한 줄로.
    const unallocated = Math.max(0, amountPaidTotal - sum);
    const keyIds = unallocated > 0 ? [...ids, UNALLOCATED_LINE] : ids;
    const taken = claimedLines(keyIds, claims.get(id));
    const otherTaken = claimedLines(keyIds, otherClaims.get(id));
    const lines: LaterLine[] = [];
    all.forEach((l, i) => {
      // 과목 수강종료(원장 2026-10-29 *"반에 안 묶인 줄도 보이게 … 같은 과목이면 전부 환불요청 토글 가능하게"*):
      //   끝내는 반 줄 · 끝내는 과목의 다른 반 줄 → 보임 / 계속 다니는 과목 반 줄 → 뺌 / 어느 반에도 안 묶인 줄 → 보임(화면 표시 '기타 항목').
      let unbound = false;
      if (ended) {
        const line = { classId: (raw[i] as { classId?: unknown } | null)?.classId, description: l.description };
        const own = courseOfLine(line, report.snapshot.courses);
        const course = own ?? courseOfLine(line, allClasses);
        if (course) { if (!(ended.has(course.classId) || report.subjects.includes(course.subject))) return; }
        // 어느 반에도 안 맞는 '수업' 줄(다른 과목 보강·특강 등 — 김덕현 '이성우반 내신대비 주말보강')은 뺀다.
        // 기타 항목 = 수업이 아닌 줄(차량비·교재 등)만 — 원장 2026-10-30 *"다른 과목 기납건은 리스트에서 넣지말것 퇴원보고서 작성하거나 기타 항목에 대해서만"*.
        //   단, 수납명에 끝내는 반 이름이나 그 반 강사 이름이 보이면 같은 과목으로 남긴다(반 이름이 바뀌거나 앞에 글이 붙은 줄 — 리뷰).
        else if (isLessonKind(l.kind)) { if (!endedHints.some(h => norm(l.description).includes(h))) return; }
        else unbound = true;
      }
      const own = taken[i];
      const refund: RefundRef | null = own ? { documentId: own.documentId, deskName: own.deskName, completed: own.completed } : null;
      const otherRefund = refund ? null : otherTaken[i];
      const back = refundedAmount[i];
      const net = back == null ? paid[i]! : Math.max(0, paid[i]! - back);
      lines.push({ ...l, key: `${id}#${ids[i]}`, paidNet: net, billingRefund: refunded[i]!, refund, ...(unbound ? { unbound } : {}), ...(otherRefund ? { otherRefund } : {}),
        ...(back !== 0 ? { billingRefundAmount: back } : {}) });
    });
    if (unallocated > 0) {
      const i = keyIds.length - 1;
      const own = taken[i];
      const refund: RefundRef | null = own ? { documentId: own.documentId, deskName: own.deskName, completed: own.completed } : null;
      const otherRefund = refund ? null : otherTaken[i];
      lines.push({ kind: "미배분", description: "미배분 납부(줄별 납부 기록 없음)", amount: unallocated, paid: unallocated, key: `${id}#${UNALLOCATED_LINE}`, paidNet: unallocated,
        billingRefund: false, refund, unallocated: true, ...(ended ? { unbound: true as const } : {}), ...(otherRefund ? { otherRefund } : {}) });
    }
    if (!lines.length) continue;
    out.push({
      id, period: String(r.period), category: String(r.category), status,
      amountBilled: ended ? lines.reduce((s, l) => s + Math.max(0, l.amount - (l.discount ?? 0)), 0) : Math.max(0, Number(r.amount_total) - Number(r.amount_discount)),
      amountPaid: ended ? lines.reduce((s, l) => s + l.paidNet, 0) : amountPaidTotal,
      lines, partial: !!ended,
    });
  }
  return out;
}

/**
 * 방금 만든 요청서보다 **먼저** 같은 줄(또는 그 청구 전체)을 잡은 요청서가 있나 — 두 창에서 거의 동시에 승인하면 둘 다 미리 보기
 * 확인을 통과한다(리뷰 2026-10-29). 넣은 뒤 다시 보고, 늦은 쪽이 물러난다(created_at · id 순서가 같은 답을 준다).
 */
export async function claimedEarlier(tenantId: string, documentId: string, keys: string[]): Promise<boolean> {
  const invoiceIds = [...new Set(keys.map(k => splitKey(k)[0]))];
  // 이어진 요청서 + 10분 안에 만든(아직 잇기 전일 수 있는) 요청서 — 표식만 적은 옛 문서가 정상 승인을 막지 않게.
  // 취소된 요청에만 이어진 미완료 요청서는 치지 않는다(새 요청의 원장이 그 줄을 다시 환불 승인할 수 있게 — `classifyDocs`의 blocking).
  const { blocking: docs } = await classifyDocs(tenantId, await docsForInvoices(tenantId, invoiceIds), {}, 10 * 60 * 1000);
  const mine = docs.find(d => String(d.id) === documentId);
  if (!mine) return false;
  const at = (d: { created_at: unknown }) => Date.parse(String(d.created_at));
  // 같은 청구의 같은 식별값 형제면 겹친 것으로 본다(번호 밀림 대비).
  const want = new Set(keys.map(k => { const [inv, line] = splitKey(k); return `${inv}#${lineBase(line)}`; }));
  return docs.some(d => {
    if (String(d.id) === documentId) return false;
    if (at(d) > at(mine) || (at(d) === at(mine) && String(d.id) > documentId)) return false;
    return claimedKeys(String(d.description ?? "")).some(k => {
      const [inv, line] = splitKey(k);
      return line === "*" ? invoiceIds.includes(inv) : want.has(`${inv}#${lineBase(line)}`);
    });
  });
}

/**
 * 데스크 담당자로 고를 수 있는 사람 — **학원 설정 '데스크 담당자'로 지정한 사람**(원장 2026-11-06 · `specialAccess.withdrawalDeskIds`) 중
 * 같은 지점 재직 직원이고 **수납 쓰기 권한이 있는 사람**(`billingWriters` — 환불 요청서를 처리하는 수납 게이트와 같은 판정 · 지점 역할 권한 덮어쓰기 ·
 * 개인별 권한 · 꺼진 모듈 반영). 권한표는 지금 사용자의 지점 설정(같은 지점)으로 계산한다.
 * `designated` = 학원 설정에 지정한 사람이 있나(유효한 사람이 0명이어도) — 비었으면 환불 승인을 막는다(원장 등으로 대신하지 않는다 · DB attach도 같은 명단을 본다).
 * 🔴 학원 설정을 못 읽어 기본값으로 접혔으면 아무도 고를 수 없다(기본값의 명단은 비어 있다 — 지정 밖 사람으로 풀리지 않는다).
 */
export async function loadDeskStaff(tenantId: string): Promise<{ staff: { id: string; name: string }[]; designated: boolean }> {
  const settings = await getTenantSettings();
  const listed = foldedReason(settings) ? [] : settings.permissions.specialAccess.withdrawalDeskIds ?? [];
  if (!listed.length) return { staff: [], designated: false };
  const { data, error } = await createAdminClient().from("users").select("id,display_name,system_role")
    .eq("tenant_id", tenantId).eq("status", "active").neq("system_role", "student").in("id", listed).order("display_name").limit(100);
  if (error) throw new Error(`데스크 담당자 조회 실패: ${error.message}`);
  const rows = (data ?? []) as DeskStaffRow[];
  const superIds = await platformAccountIds(rows.map(r => r.id));
  return { staff: billingWriters(rows, superIds, settings), designated: true };
}
