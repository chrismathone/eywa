// 환불요청서 "학생 이름 고르면 자동입력" — DB 원본 → 폼 필드값 **순수 변환**(클라/서버 공용, server-only 금지 [[#61]]).
//
// ⚠️ 원칙: 추측해서 채우지 않는다. 환불요청서는 결재가 붙는 서류라, 자동으로 들어간 값은
// "확인된 사실"처럼 읽힌다. 그래서 DB에 근거가 있는 칸만 만들고(학교/학년·주소·수강반·담당·수강기간·납부내역),
// 사람이 판단하는 칸(환불사유·차감내역·총 환불금액·총수업횟수·환불방식)은 **비운 채로 둔다**.
// 총수업횟수는 계획 회차·실제 출석·청구 회차가 서로 달라 하나로 단정할 수 없어 의도적으로 제외.

import { kstMonth, shiftMonth } from "@/lib/date-kst";
import { schoolGradeLabel } from "@/lib/format/school-grade";

export type RefundPrefillEnrollment = {
  className: string;
  teacherName: string | null;
  startDate: string;
  endDate: string | null;
};

/** 청구서 한 줄(makeedu 라인 단위) — 구데이터는 상세(paid/unpaid/method/paidDate)가 없을 수 있어 optional. */
export type RefundPrefillLine = {
  kind: string; // 구분: 수업/교재/차량비… (makeedu 한글 taxonomy)
  description: string; // 수납명(강의명 등)
  amount: number; // 청구액
  discount?: number;
  paid?: number;
  unpaid?: number;
  method?: string | null;
  paidDate?: string | null;
};

export type RefundPrefillInvoice = {
  period: string; // "2026-07"
  status: string;
  amountTotal: number;
  amountPaid: number;
  amountDiscount: number;
  paymentMethod: string | null;
  paidAt: string | null;
  lineItems: RefundPrefillLine[];
};

export type RefundPrefillSource = {
  name: string;
  school: string | null;
  grade: string | null;
  address: string | null;
  /** 시작일 내림차순(최근 먼저) — 서버 쿼리가 이 순서로 준다. */
  enrollments: RefundPrefillEnrollment[];
  /** 청구서 전건, **월 오름차순**(오래된 달 먼저 — 결제내역은 시간순 원장으로 읽힌다). */
  invoices: RefundPrefillInvoice[];
};

/** 자동입력이 건드리는 폼 필드 — 화면 안내 문구·테스트가 이 목록을 단일 소스로 쓴다. */
export const REFUND_PREFILL_FIELDS = [
  "s_name",
  "s_schoolGrade",
  "s_address",
  "s_className",
  "s_staffTeacher",
  "s_homeroomTeacher",
  "s_classDate",
  "r_paymentDetails",
] as const;

/** 필드 → 서식 한글 라벨(화면 안내용) — UI에 필드명(s_className 등) 노출 금지. */
export const REFUND_PREFILL_LABELS: Record<string, string> = {
  s_name: "이름",
  s_schoolGrade: "학교/학년",
  s_address: "주소",
  s_className: "수강반",
  s_staffTeacher: "담당선생님",
  s_homeroomTeacher: "담임선생님",
  s_classDate: "수업날짜",
  r_paymentDetails: "결제내역",
};

/** 결제수단 코드 → 한글. **모르는 코드는 아예 안 적는다**(raw 코드 노출 금지 — 빈 괄호보다 생략이 낫다). */
const METHOD_LABEL: Record<string, string> = {
  card: "카드",
  transfer: "계좌이체",
  cash: "현금",
  other: "기타",
};
/** 레거시 영문 kind(구 eywa 폼·구 임포터) → 한글. makeedu 산 데이터는 이미 한글이라 그대로 통과. */
const KIND_LEGACY_LABEL: Record<string, string> = {
  tuition: "수업",
  material: "교재",
  exam: "시험",
  other: "기타",
};

const won = (n: number) => `${n.toLocaleString("ko-KR")}원`;

/**
 * 자동입력할 수강 이력 — 진행 중(종료일 없음)이 있으면 그 전부, 없으면 가장 최근 1건.
 * 환불 대상은 대개 막 그만둔 학생이라 "진행 중이 없으면 빈칸"이면 정작 필요한 때 안 채워진다.
 */
function relevantEnrollments(list: RefundPrefillEnrollment[]): RefundPrefillEnrollment[] {
  const active = list.filter((e) => !e.endDate);
  return active.length > 0 ? active : list.slice(0, 1);
}

/** "2026-03-02 ~ 수강중" / "2026-03-02 ~ 2026-07-22" — 수강 시작~종료(여러 반이면 최소 시작·최대 종료). */
function classDateRange(list: RefundPrefillEnrollment[]): string {
  if (list.length === 0) return "";
  const starts = list.map((e) => e.startDate).filter(Boolean).sort();
  const start = starts[0] ?? "";
  const ongoing = list.some((e) => !e.endDate);
  const ends = list.map((e) => e.endDate ?? "").filter(Boolean).sort();
  const end = ongoing ? "수강중" : (ends[ends.length - 1] ?? "");
  if (!start) return end;
  return end ? `${start} ~ ${end}` : start;
}

/** 결제내역 기간 선택지 — `null`=전체. 화면 세그먼트 버튼과 서버 검증이 이 목록을 공유한다. */
export const PAYMENT_MONTH_CHOICES = [1, 2, 3, 6, 12, null] as const;
export type PaymentMonths = (typeof PAYMENT_MONTH_CHOICES)[number];
/** 기본 = 최근 3개월(전건은 20줄까지 나와 서식이 결제내역으로 뒤덮인다). */
export const DEFAULT_PAYMENT_MONTHS: PaymentMonths = 3;

export function paymentMonthsLabel(months: PaymentMonths): string {
  if (months === null) return "전체";
  return months === 1 ? "이번 달" : `${months}개월`;
}

/**
 * 결제내역에 넣을 청구서를 **최근 N개월**로 자른다(1 = 이번 달, 2 = 이번 달+지난달).
 * `months`가 null이면 전건.
 *
 * ⚠️ **다음 달 선청구(2026-08 등)는 자르지 않는다** — 환불은 대개 그 선청구분을 되돌리는 일이라
 * 창을 "이번 달까지"로 막으면 정작 환불 대상이 사라진다. 즉 창은 과거 방향으로만 N개월.
 */
export function limitInvoicesToMonths(
  invoices: RefundPrefillInvoice[],
  months: PaymentMonths,
  currentMonth: string = kstMonth(),
): RefundPrefillInvoice[] {
  if (months === null || months <= 0) return invoices;
  const from = shiftMonth(currentMonth, -(months - 1));
  return invoices.filter((i) => i.period >= from);
}

/** `2026-01 수업 정규반 182,000원 납부 (계좌이체 · 2025-12-29 · 할인 10,000원)` 한 줄 조립. */
function paymentLine(
  head: string,
  amounts: { amount: number; discount: number; paid?: number; unpaid?: number },
  meta: { method?: string | null; paidDate?: string | null; refunded?: boolean },
): string {
  const { amount, discount, paid, unpaid } = amounts;
  const quals: string[] = [];
  let main: string;
  if (paid !== undefined && paid > 0) {
    main = `${won(paid)} 납부`;
    // 모르는 결제수단 코드는 아예 안 적는다 — raw 코드(vbank 등)를 서류에 흘리지 않는다.
    if (meta.method && METHOD_LABEL[meta.method]) quals.push(METHOD_LABEL[meta.method]!);
    if (meta.paidDate) quals.push(meta.paidDate);
    if (discount > 0) quals.push(`할인 ${won(discount)}`);
    if (unpaid !== undefined && unpaid > 0) quals.push(`미납 ${won(unpaid)}`);
  } else if (unpaid !== undefined && unpaid > 0) {
    main = `${won(unpaid)} 미납`;
    if (amount !== unpaid) quals.push(`청구 ${won(amount)}`);
    if (discount > 0) quals.push(`할인 ${won(discount)}`);
  } else {
    main = `${won(amount)} 청구`;
    if (discount > 0) quals.push(`할인 ${won(discount)}`);
  }
  if (meta.refunded) quals.push("환불 처리됨");
  return `${head} ${main}${quals.length ? ` (${quals.join(" · ")})` : ""}`;
}

/**
 * 결제내역 = **월별로 한 줄씩, 항목(수납명)까지 분리**(원장 지시 2026-07-23 — 뭉뚱그린 월 합계 금지).
 * 예: `2026-01 수업 김화영반 중고등M_정규반 월목 3교시 182,000원 납부 (계좌이체 · 2025-12-29 · 할인 10,000원)`
 *
 * ⚠️ 항목별 상세(paid/unpaid)가 **전무한 구형 청구서**는 어느 항목이 얼마 내졌는지 알 수 없다.
 * 수납관리 표처럼 첫 항목에 청구서 값을 합성하면 "270,000원짜리 항목이 314,000원 미납"처럼
 * **없는 사실**이 서류에 찍힌다(실데이터에서 확인). → 항목은 '청구'로만 적고 납부/미납은 **'합계' 한 줄**로 분리.
 * 무효(void) 청구는 통째로 제외 — 없던 결제를 서류에 남기지 않는다.
 */
export function formatPaymentLines(invoices: RefundPrefillInvoice[]): string[] {
  const out: string[] = [];
  for (const inv of invoices) {
    if (inv.status === "void") continue;
    const refunded = inv.status === "refunded";
    const hasDetail = inv.lineItems.some((li) => li.paid !== undefined || li.unpaid !== undefined);

    if (inv.lineItems.length === 0) {
      out.push(
        paymentLine(
          inv.period,
          {
            amount: inv.amountTotal,
            discount: inv.amountDiscount,
            paid: inv.amountPaid,
            unpaid: Math.max(0, inv.amountTotal - inv.amountDiscount - inv.amountPaid),
          },
          { method: inv.paymentMethod, paidDate: inv.paidAt?.slice(0, 10), refunded },
        ),
      );
      continue;
    }

    for (const li of inv.lineItems) {
      const head = [inv.period, KIND_LEGACY_LABEL[li.kind] ?? li.kind, li.description.trim()]
        .filter(Boolean)
        .join(" ");
      out.push(
        paymentLine(
          head,
          {
            amount: li.amount,
            discount: li.discount ?? 0,
            paid: hasDetail ? li.paid : undefined,
            unpaid: hasDetail ? li.unpaid : undefined,
          },
          { method: li.method, paidDate: li.paidDate, refunded: hasDetail && refunded },
        ),
      );
    }

    if (!hasDetail) {
      out.push(
        paymentLine(
          `${inv.period} 합계`,
          {
            amount: inv.amountTotal,
            discount: inv.amountDiscount,
            paid: inv.amountPaid,
            unpaid: Math.max(0, inv.amountTotal - inv.amountDiscount - inv.amountPaid),
          },
          { method: inv.paymentMethod, paidDate: inv.paidAt?.slice(0, 10), refunded },
        ),
      );
    }
  }
  return out;
}

/**
 * 학생 원본 → 폼 필드값. 값이 없는 칸은 **키 자체를 안 넣는다**(호출부가 "채울 게 있는 칸"만 구분).
 * 담임선생님은 담당강사가 **정확히 1명일 때만** 채운다 — eywa는 담임 개념을 폐기(과목별 담당)했고,
 * 여러 명을 나열하면 "담임이 여럿"이라는 없는 사실이 서류에 남는다.
 */
export function buildRefundPrefill(
  src: RefundPrefillSource,
  opts: { months?: PaymentMonths; currentMonth?: string } = {},
): Record<string, string> {
  const out: Record<string, string> = {};
  const put = (k: string, v: string) => {
    const t = v.trim();
    if (t) out[k] = t;
  };

  put("s_name", src.name);
  put("s_schoolGrade", schoolGradeLabel(src.school, src.grade));
  put("s_address", src.address ?? "");

  const rel = relevantEnrollments(src.enrollments);
  put("s_className", rel.map((e) => e.className).filter(Boolean).join("\n"));

  const teachers = [...new Set(rel.map((e) => e.teacherName).filter((t): t is string => !!t?.trim()))];
  put("s_staffTeacher", teachers.join(" · "));
  if (teachers.length === 1) put("s_homeroomTeacher", teachers[0]!);

  put("s_classDate", classDateRange(rel));

  const months = opts.months === undefined ? DEFAULT_PAYMENT_MONTHS : opts.months;
  put("r_paymentDetails", formatPaymentLines(limitInvoicesToMonths(src.invoices, months, opts.currentMonth)).join("\n"));

  return out;
}

/**
 * 자동입력 적용 대상 갈라내기 — **비어 있는 칸만** 채운다(사람이 이미 쓴 값을 덮지 않는다).
 * `current`는 폼 DOM에서 읽은 현재값. 이미 값이 있고 내용이 다른 칸은 skipped로 돌려 화면에 알린다.
 */
export function splitPrefill(
  values: Record<string, string>,
  current: Record<string, string>,
): { fill: Record<string, string>; skipped: string[] } {
  const fill: Record<string, string> = {};
  const skipped: string[] = [];
  for (const [k, v] of Object.entries(values)) {
    const cur = (current[k] ?? "").trim();
    if (!cur) fill[k] = v;
    else if (cur !== v.trim()) skipped.push(k);
  }
  return { fill, skipped };
}
