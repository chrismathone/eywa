import "server-only";
import { createClient } from "@/lib/supabase/server";
import { fetchAllPaged, fetchInChunks } from "@/lib/supabase/batch";
import { classInvoiceAmount, type LineItemLike } from "../class-amount";
import { getTenantSettings } from "@/features/owner/server/queries";
import { isEieMonthlyClass, sessionPriceOptions, type SessionPrice, type SessionPricingMode } from "@/features/billing/session-pricing";
import { effectiveAllocations, receiptLines } from "../receipt-allocation";
import { loadLivePlans, type PlanHistory } from "./live-plans";
import { mergeHolidays } from "@/features/billing/tuition-calc";
import { receiptOriginalItems, receiptRefundState, type ReceiptRefundState } from "../receipt-refund";
import { receiptMatchesClass } from "../receipt-suggestion";
import { suggestFromLastMonth, type TermSuggestion } from "../last-month-suggestion";
import { loadLastMonthBasis, type LastMonthBasis } from "./last-month";
import { monthRosterKey, termRowState, virtualTermId, type MonthRosterPair, type MonthRosterSource, type TermRowState } from "../month-roster";
import { loadMonthRoster, type MonthRoster } from "./month-roster";

/** 회차 확정 면 한 행 — 청구서×반(반마다 단가가 달라 합산 금지). subject는 raw key(라벨은 소비처가 buildSubjectMaps로). */
export type SessionTermRow = {
  id: string;
  /** 청구서 id — 회차 행이 없고 청구서도 없거나 취소된 줄(`termState` no_invoice·void_invoice)은 null(배분 버튼·배분 표시 없음). */
  invoiceId: string | null;
  studentId: string;
  studentName: string;
  studentGrade: string | null;
  /** 학교 원문 — 화면은 `schoolGradeLabel(studentSchool, studentGrade)`로 "칠성초6"처럼 붙여 쓴다. */
  studentSchool?: string | null;
  /** 이 반의 그 달 배치 요일(0=일) — 반 이름 옆 표시. */
  classDays?: number[];
  /** 반 요일과 다른 이 학생의 개별 등원 요일 — 학생 이름 옆 표시(같으면 없음). */
  attendDays?: number[] | null;
  /** 미확정 행에 미리 채울 지난 달 확정 기준 단가·시수(`getSessionTermsView(…, { lastMonth: true })`일 때만). */
  lastMonth?: TermSuggestion | null;
  subject: string;
  classId: string | null;
  className: string | null;
  /**
   * 그 반의 **현재 담임** 이름(`classes.teacher_id`) — 표시 전용. 시수 검증 면의 담당 강사·분배와 같은 축이다.
   * ⚠️ 지난 달을 열어도 지금 담임이 나온다(담임엔 시간 축이 없다 — 되살리기는 teacher-as-of, 여기선 안 쓴다).
   */
  homeroomTeacherName?: string | null;
  monthlyPrice: number | null; // 현재 설정의 EiE 월 수강료. 기존 확정 스냅샷과 구분한다.
  pricingMode: SessionPricingMode; // 확정 시점 단위. 설정·반 구분을 바꿔도 과거 계산은 불변.
  plannedSessions: number | null;
  /** 예정이 휴원·반 비활성(시간 축 없음) 때문에 실제보다 작을 수 있다 — 화면의 '확정 ≠ 예정' 표시를 끈다(`loadLivePlans.uncertain`). */
  planUncertain?: boolean;
  confirmedSessions: number | null;
  unitPrice: number | null;
  amount: number | null;
  confirmedAt: string | null;
  quantityBasis?: "days" | "attendance_units";
  allocatedAmount?: number | null;
  allocationStale?: boolean;
  allocationLineIndex?: number | null;
  invoiceHasAllocations?: boolean;
  refundState?: ReceiptRefundState;
  /** 회차 확정 표의 메모(특이사항) — 0102a부터 있던 칸. 쓰기는 `updateSessionTermNote` 한 곳. */
  note: string | null;
  // 참고 표시용 — 그 **반**의 청구액(line_items에서 반 매칭, 학생 전체 아님). 매칭 실패 시 null("—").
  // N2: 자동 일치화 금지 — 확정값(회차×단가)이 진실, 이 값은 makeedu 대조 힌트일 뿐.
  classAmount: number | null;
  /**
   * 줄의 회차 상태(원장 2026-09-18 "출석부 행 개수 = 회차 확정 행 개수") — `term`(행 있음) · `missing`(청구서는 있는데 행이 없다 —
   * 확정·배분을 저장하는 순간 만든다, id는 `virtualTermId`) · `no_invoice`/`void_invoice`(붙일 청구서가 없어 잠근다).
   * 🔴 raw 코드 — 화면은 `TERM_STATE_LABEL`을 거친 한글만 내보낸다.
   */
  termState: TermRowState;
  /** 회차 행은 있는데 그 달 줄 집합(출석부)엔 없는 줄(종강·반이동·휴원 뒤 남은 행) — 감추지 않고 표식만(`NO_LESSON_LABEL`). */
  noLesson?: boolean;
  /** 그 달 그 반에 찍힌 실제 시수 합(줄 집합의 값, RPC 0267a와 같은 셈법) — 기록이 없으면 null. 회차 행이 없는 줄의 '실제 N시수'·시수 검증의 실 소비. */
  recordedUnits?: number | null;
  /** 줄이 서는 근거(수강·기록·예약) — 그 달 줄 집합에 있는 줄만. */
  rosterSources?: MonthRosterSource[];
  /**
   * 같은 학생·반의 회차 행이 이 달 **살아 있는 청구서 여러 장**에 있다(청구서 중복) — 출석부는 1줄인데 여기선 청구서마다 1줄이라
   * 줄 수 차이를 표식으로 밝힌다(감추지 않는다 — 돈이 걸려 있다). 운영 실측 2026-09-18: 0건.
   */
  duplicateInvoice?: boolean;
};

type TermClassEmbed = {
  class_name?: string;
  english_track?: string | null;
  teacher?: { display_name?: string | null } | { display_name?: string | null }[] | null;
};

type InvoiceRow = { id: string; student_id: string; line_items: unknown; status: string | null };

export type SessionTermsView = {
  enrollmentHistory?: PlanHistory[];
  rows: SessionTermRow[];
  invoiceCount: number; // 그 달 청구서 수(void 제외 — 계획 갱신 대상 규모)
  confirmedCount: number;
  /** 회차 행이 없는 줄(청구서 있음) — 확정·배분하면 만들어진다. */
  missingCount: number;
  /** 회차 행도 청구서도 없는 줄 — 청구서가 생기면 여기서 확정한다. */
  noInvoiceCount: number;
  /** 청구서가 취소(void)된 줄. */
  voidInvoiceCount: number;
  /** 회차 행은 있는데 이번 달 줄 집합엔 없는 줄. */
  noLessonCount: number;
  /** 청구서 중복으로 한 학생·반이 여러 줄인 행 수(`duplicateInvoice`). */
  duplicateCount: number;
  catalog: SessionPrice[]; // 학원 설정의 공통 회당 단가. 월 금액은 섞지 않는다.
};

const EMPTY_ROSTER: MonthRoster = { pairs: [], byKey: new Map(), classes: new Map(), windows: new Map() };

/** 청구서 한 장에서 이 반 몫의 환불 상태 — 회차 행·가상 행이 같은 판정을 쓴다. */
function refundBits(inv: InvoiceRow, lineItems: LineItemLike[], classId: string | null, className: string | null) {
  const matching = lineItems.flatMap(receiptOriginalItems).filter((line) => receiptMatchesClass(line, { classId, className }));
  const states = matching.map(receiptRefundState);
  const fullyRefunded = inv.status === "refunded" || (states.length > 0 && states.every((s) => s === "full"));
  const refundReview = lineItems.some((line) => receiptRefundState(line) === "partial" || (receiptRefundState(line) === "mixed" && "receiptGroupId" in line));
  const refundState: ReceiptRefundState = fullyRefunded ? "full" : refundReview ? "partial" : states.some((s) => s !== "none") ? "mixed" : "none";
  return { fullyRefunded, refundState };
}

const itemsOf = (inv: InvoiceRow) => (Array.isArray(inv.line_items) ? inv.line_items : []) as LineItemLike[];

/**
 * 청구월의 회차 확정 목록 + 회당 단가 프리셋. (B2: 전건은 fetchAllPaged / B3: .in은 청크 / B4: 병렬)
 *
 * **줄 = 그 달 (학생 × 반) 줄 집합(`loadMonthRoster`, 월별 출석부와 같은 규칙) ∪ 그 달 청구서(void 아님)의 기존 회차 행**
 * (원장 2026-09-18 *"출석부에 존재하는 행 개수와, 회차 확정의 행 개수가 서로 유기적으로 일치해야해"*).
 *  · 쌍에 회차 행이 있으면 종전 행(`termState: "term"`).
 *  · 쌍에 회차 행이 없으면 **가상 행**(`id = virtualTermId`) — 상태는 그 학생의 이 달 청구서로(`missing`/`no_invoice`/`void_invoice`).
 *    DB엔 없다 — 확정·배분을 저장하는 순간 `term-materialize.ts`가 만든다.
 *  · 회차 행은 있는데 쌍이 없으면 종전 행 + `noLesson`(감추지 않는다 — 돈이 걸려 있다).
 * 🔴 청구서는 **void까지** 읽되 회차 행·배분·계획은 종전대로 void 아닌 청구서만 — void는 줄 상태 판정('청구서 취소')에만 쓴다.
 * ⚠️ `invoiceId` 모드(배분 창)는 그 학생의 줄만 세우고 `missing` 가상 행만 더한다(청구서 한 장에 붙이는 일이라 그 밖 상태는 없다).
 *    회차 행 유무는 **그 학생의 이 달 청구서 전부**로 본다 — 중복 청구서의 다른 장에 행이 있으면 여기선 가상 행이 아니다.
 */
export async function getSessionTermsView(period: string, invoiceId?: string, options: { lastMonth?: boolean } = {}): Promise<SessionTermsView> {
  const supabase = await createClient();

  const [invoices, settings, fullRoster] = await Promise.all([
    // ⚠️ 페이징에는 안정 정렬 필수 — 무순서 offset 페이징은 1000행 초과 시 중복/누락 위험(적대 리뷰 픽스).
    fetchAllPaged<InvoiceRow>((from, to) => {
      const query = supabase.from("invoices").select("id, student_id, line_items, status").eq("period", period).order("id").range(from, to);
      return invoiceId ? query.eq("id", invoiceId) : query;
    }),
    getTenantSettings(),
    // 줄 집합은 청구서와 무관하게 선다(청구서가 0장이어도 '청구서 없음' 줄이 선다) — 청구서 조회와 나란히.
    invoiceId ? Promise.resolve<MonthRoster | null>(null) : loadMonthRoster(supabase, period),
  ]);
  const catalog = sessionPriceOptions(settings.billing.sessionPrices);
  const empty: SessionTermsView = { rows: [], invoiceCount: 0, confirmedCount: 0, missingCount: 0, noInvoiceCount: 0, voidInvoiceCount: 0, noLessonCount: 0, duplicateCount: 0, catalog };

  // invoiceId 모드: 판정에 쓰는 청구서 = 그 학생의 이 달 청구서 전부(형제 청구서 포함), 행을 세우는 청구서 = 그 한 장.
  const shownInvoice = invoiceId ? invoices[0] ?? null : null;
  // 배분 창: 형제 청구서 조회와 그 학생의 줄 집합은 서로를 기다릴 이유가 없다(B4) — 둘 다 이미 아는 학생 id만 쓴다.
  const [judged, studentRoster]: [InvoiceRow[], MonthRoster | null] = shownInvoice
    ? await Promise.all([
        fetchAllPaged<InvoiceRow>((from, to) =>
          supabase.from("invoices").select("id, student_id, line_items, status").eq("period", period).eq("student_id", shownInvoice.student_id).order("id").range(from, to),
        ),
        shownInvoice.status !== "void" ? loadMonthRoster(supabase, period, { studentIds: [shownInvoice.student_id] }) : Promise.resolve(EMPTY_ROSTER),
      ])
    : [invoices, null];
  const liveJudged = judged.filter((i) => i.status !== "void");
  const liveShown = invoiceId ? liveJudged.filter((i) => i.id === invoiceId) : liveJudged;
  const roster: MonthRoster = fullRoster ?? studentRoster ?? EMPTY_ROSTER;
  if (liveJudged.length === 0 && roster.pairs.length === 0) return empty;

  const liveInvoiceIds = liveJudged.map((i) => i.id);
  const invoiceById = new Map(liveJudged.map((i) => [i.id, i]));
  const shownInvoiceIds = new Set(liveShown.map((i) => i.id));
  // 학생마다 유효 청구서(id 순 — 가상 행이 붙는 청구서 = `term-materialize.ts`가 만드는 청구서와 같은 순서)와 취소 여부.
  const studentInvoice = new Map<string, { live: InvoiceRow | null; voided: boolean }>();
  for (const inv of judged) {
    const s = studentInvoice.get(inv.student_id) ?? studentInvoice.set(inv.student_id, { live: null, voided: false }).get(inv.student_id)!;
    if (inv.status === "void") s.voided = true;
    else s.live ??= inv;
  }
  // 학생 집합 = 청구서 학생 ∪ 줄 집합 학생 — 이름·예정·지난 달 기준을 이 집합으로 읽는다.
  const studentIds = [...new Set([...liveJudged.map((i) => i.student_id), ...roster.pairs.map((p) => p.studentId)])];
  const holidaysOf = (year: number) => mergeHolidays(year, settings.operations.holidays.map((h) => h.date), true);

  // 회차 행·학생·예정·지난 달 기준은 서로 기다릴 이유가 없다(B4) — 청구서 목록만 있으면 넷 다 시작한다.
  // 지난 달 기준 미리 채우기는 회차 확정 면만 쓴다(검증·배분 창은 안 읽는다 — 왕복 절약).
  const [terms, students, live, lastMonthBasis] = await Promise.all([fetchInChunks<{
    id: string;
    invoice_id: string;
    subject: string;
    class_id: string | null;
    planned_sessions: number | null;
    confirmed_sessions: number | null;
    unit_price: number | null;
    pricing_mode: SessionPricingMode;
    amount: number | null;
    confirmed_at: string | null;
    quantity_basis: "days" | "attendance_units";
    allocation_line_index: number | null;
    allocation_amount: number | null;
    allocation_source: unknown;
    allocation_base_amount: number | null;
    note: string | null;
    class: TermClassEmbed | TermClassEmbed[] | null;
  }>(liveInvoiceIds, (chunk) =>
    supabase
      .from("invoice_session_terms")
      .select(
        "id, invoice_id, subject, class_id, planned_sessions, confirmed_sessions, unit_price, pricing_mode, amount, confirmed_at, quantity_basis, allocation_line_index, allocation_amount, allocation_source, allocation_base_amount, note, class:class_id ( class_name, english_track, teacher:teacher_id ( display_name ) )",
      )
      .in("invoice_id", chunk),
  ), fetchInChunks<{ id: string; name: string; grade: string | null; school: string | null }>(studentIds, (chunk) =>
    supabase.from("students").select("id, name, grade, school").in("id", chunk),
  ), loadLivePlans(supabase, period, studentIds, holidaysOf(Number(period.slice(0, 4)))),
  options.lastMonth && !invoiceId ? loadLastMonthBasis(supabase, period, studentIds, holidaysOf) : Promise.resolve<LastMonthBasis>(new Map())]);
  const studentById = new Map(students.map((s) => [s.id, s]));
  // 같은 학생·반의 회차 행이 이 달에 둘 이상이면(청구서 중복 — 한쪽이 이미 확정이어도) 미리 채우지 않는다.
  // 채우면 반 전체 선택 한 번에 같은 반이 두 번 확정된다(리뷰 2026-09-17 — 종전엔 빈 단가가 막았다).
  const termsPerKey = new Map<string, number>();
  for (const t of terms) {
    const inv = invoiceById.get(t.invoice_id);
    if (inv && t.class_id) termsPerKey.set(monthRosterKey(inv.student_id, t.class_id), (termsPerKey.get(monthRosterKey(inv.student_id, t.class_id)) ?? 0) + 1);
  }
  const allocated = new Map<string, number>();
  // 연결 없이 0원으로 저장한 반(0269a — 항목 null · 금액 0)도 배분을 저장한 청구서다.
  const invoicesWithAllocations = new Set(terms.filter((term) => term.allocation_line_index != null || term.allocation_amount != null).map((term) => term.invoice_id));
  for (const invoice of liveJudged) {
    const values = effectiveAllocations(receiptLines(invoice.line_items), terms.filter((term) => term.invoice_id === invoice.id).map((term) => ({
      id: term.id, amount: term.amount === null ? null : Number(term.amount), confirmedSessions: term.confirmed_sessions,
      lineIndex: term.allocation_line_index ?? null, allocatedAmount: term.allocation_amount == null ? null : Number(term.allocation_amount),
      source: term.allocation_source, baseAmount: term.allocation_base_amount == null ? null : Number(term.allocation_base_amount),
    })));
    for (const [id, amount] of values) allocated.set(id, amount);
  }
  // 지난 달 기준 제안 — 회차 행·가상 행(missing) 같은 규칙. 예정을 믿을 수 없는 행(휴원·비활성 반) · 회차 행 중복 · EiE 월 정액은 채우지 않는다(리뷰 2026-09-17).
  const lastMonthFor = (studentId: string, classId: string, subject: string, englishTrack: string | null | undefined): TermSuggestion | null => {
    const key = monthRosterKey(studentId, classId);
    const basis = lastMonthBasis.get(key);
    if (!basis || live.uncertain.has(key) || (termsPerKey.get(key) ?? 0) > 1 || isEieMonthlyClass(subject, englishTrack)) return null;
    return suggestFromLastMonth(live.plans.get(studentId)?.get(classId) ?? 0, basis.last, basis.lastPlan);
  };

  const termRows = terms
    .map<SessionTermRow | null>((t) => {
      const inv = invoiceById.get(t.invoice_id);
      if (!inv || !shownInvoiceIds.has(inv.id)) return null;
      const stu = studentById.get(inv.student_id);
      const cls = Array.isArray(t.class) ? t.class[0] : t.class;
      const className = cls?.class_name ?? null;
      const teacher = Array.isArray(cls?.teacher) ? cls.teacher[0] : cls?.teacher;
      const lineItems = itemsOf(inv);
      const { fullyRefunded, refundState } = refundBits(inv, lineItems, t.class_id, className);
      const key = t.class_id ? monthRosterKey(inv.student_id, t.class_id) : null;
      const pair = key ? roster.byKey.get(key) : undefined;
      // 예정: 수강 근거가 있으면 live plan(종전), 기록·예약만으로 서는 줄은 없음(null — 그 줄엔 '확정 ≠ 예정'을 칠하지 않는다). 줄 집합 밖 행은 종전 계산 그대로.
      const enrolled = !pair || pair.sources.includes("enrolled");
      return {
        id: t.id,
        invoiceId: t.invoice_id,
        studentId: inv.student_id,
        studentName: stu?.name ?? "—",
        studentGrade: stu?.grade ?? null,
        studentSchool: stu?.school ?? null,
        subject: t.subject,
        classId: t.class_id,
        className,
        homeroomTeacherName: teacher?.display_name ?? null,
        monthlyPrice: isEieMonthlyClass(t.subject, cls?.english_track) ? settings.billing.eieMonthlyPrice : null,
        pricingMode: t.pricing_mode ?? "per_session",
        plannedSessions: !enrolled ? null : t.class_id ? live.plans.get(inv.student_id)?.get(t.class_id) ?? 0 : t.planned_sessions === null ? null : Number(t.planned_sessions),
        planUncertain: t.class_id ? live.uncertain.has(key!) : false,
        classDays: t.class_id ? live.classDays.get(t.class_id) ?? [] : [],
        attendDays: t.class_id ? live.attendDays.get(key!) ?? null : null,
        lastMonth: t.class_id && t.confirmed_sessions === null && enrolled ? lastMonthFor(inv.student_id, t.class_id, t.subject, cls?.english_track) : null,
        confirmedSessions: t.confirmed_sessions === null ? null : Number(t.confirmed_sessions),
        unitPrice: t.unit_price === null ? null : Number(t.unit_price),
        amount: t.amount === null ? null : Number(t.amount),
        confirmedAt: t.confirmed_at,
        quantityBasis: t.quantity_basis ?? "days",
        refundState,
        allocatedAmount: fullyRefunded ? 0 : allocated.get(t.id) ?? null,
        allocationStale: !fullyRefunded && (refundState === "partial" || ((t.allocation_line_index != null || t.allocation_amount != null || (invoicesWithAllocations.has(t.invoice_id) && t.confirmed_sessions !== null)) && !allocated.has(t.id))),
        allocationLineIndex: t.allocation_line_index ?? null,
        invoiceHasAllocations: invoicesWithAllocations.has(t.invoice_id),
        note: t.note,
        classAmount: fullyRefunded ? 0 : className ? classInvoiceAmount(className, lineItems) : null,
        termState: "term",
        noLesson: t.class_id !== null && !pair,
        recordedUnits: pair?.recordedUnits ?? null,
        rosterSources: pair?.sources,
        duplicateInvoice: key !== null && (termsPerKey.get(key) ?? 0) > 1,
      } satisfies SessionTermRow;
    })
    .filter((r): r is SessionTermRow => r !== null);

  // 가상 행 — 줄 집합에 있는데 회차 행이 없는 쌍. 청구서 상태로 `missing`/`no_invoice`/`void_invoice`.
  const hasTerm = new Set(termsPerKey.keys());
  const virtualRow = (pair: MonthRosterPair): SessionTermRow | null => {
    const cls = roster.classes.get(pair.classId);
    if (!cls) return null; // 줄은 반 축에서 세우므로 있을 수 없다 — 방어.
    const info = studentInvoice.get(pair.studentId);
    const inv = invoiceId ? (liveShown[0] ?? null) : (info?.live ?? null);
    if (invoiceId && !inv) return null;
    // 판정은 청구서가 **있는지**로 — 상태 값이 비어 있어도(`status` null) 살아 있는 청구서는 살아 있다.
    const termState = termRowState({ hasTerm: false, invoiceStatus: inv ? (inv.status ?? "live") : info?.voided ? "void" : null });
    const stu = studentById.get(pair.studentId);
    const lineItems = inv ? itemsOf(inv) : [];
    const bits = inv ? refundBits(inv, lineItems, pair.classId, cls.className) : null;
    const enrolled = pair.sources.includes("enrolled");
    const key = monthRosterKey(pair.studentId, pair.classId);
    return {
      id: virtualTermId(pair.studentId, pair.classId),
      invoiceId: inv?.id ?? null,
      studentId: pair.studentId,
      studentName: stu?.name ?? "—",
      studentGrade: stu?.grade ?? null,
      studentSchool: stu?.school ?? null,
      subject: cls.subject,
      classId: pair.classId,
      className: cls.className,
      homeroomTeacherName: cls.homeroomTeacherName,
      monthlyPrice: isEieMonthlyClass(cls.subject, cls.englishTrack) ? settings.billing.eieMonthlyPrice : null,
      pricingMode: "per_session",
      plannedSessions: enrolled ? live.plans.get(pair.studentId)?.get(pair.classId) ?? 0 : null,
      planUncertain: enrolled ? live.uncertain.has(key) : false,
      classDays: live.classDays.get(pair.classId) ?? [],
      attendDays: live.attendDays.get(key) ?? null,
      lastMonth: termState === "missing" && enrolled ? lastMonthFor(pair.studentId, pair.classId, cls.subject, cls.englishTrack) : null,
      confirmedSessions: null,
      unitPrice: null,
      amount: null,
      confirmedAt: null,
      quantityBasis: "attendance_units",
      refundState: bits?.refundState ?? "none",
      allocatedAmount: bits?.fullyRefunded ? 0 : null,
      allocationStale: bits ? !bits.fullyRefunded && bits.refundState === "partial" : false,
      allocationLineIndex: null,
      invoiceHasAllocations: inv ? invoicesWithAllocations.has(inv.id) : false,
      note: null,
      classAmount: bits ? (bits.fullyRefunded ? 0 : classInvoiceAmount(cls.className, lineItems)) : null,
      termState,
      noLesson: false,
      recordedUnits: pair.recordedUnits,
      rosterSources: pair.sources,
    } satisfies SessionTermRow;
  };
  const virtualRows = roster.pairs
    .filter((p) => !hasTerm.has(monthRosterKey(p.studentId, p.classId)))
    .map(virtualRow)
    .filter((r): r is SessionTermRow => r !== null);

  const rows = [...termRows, ...virtualRows].sort(
    (a, b) =>
      a.studentName.localeCompare(b.studentName, "ko") ||
      a.subject.localeCompare(b.subject) ||
      (a.className ?? "").localeCompare(b.className ?? "", "ko"),
  );

  return {
    enrollmentHistory: live.history,
    rows,
    invoiceCount: liveShown.length,
    confirmedCount: rows.filter((r) => r.confirmedSessions !== null).length,
    missingCount: rows.filter((r) => r.termState === "missing").length,
    noInvoiceCount: rows.filter((r) => r.termState === "no_invoice").length,
    voidInvoiceCount: rows.filter((r) => r.termState === "void_invoice").length,
    noLessonCount: rows.filter((r) => r.noLesson).length,
    duplicateCount: rows.filter((r) => r.duplicateInvoice).length,
    catalog,
  };
}
