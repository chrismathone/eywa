import { paymentRateOf } from "@/features/billing/calc";
import { kstToday } from "@/lib/date-kst";

const DAY_MS = 86_400_000;
const KO_DAYS = ["일", "월", "화", "수", "목", "금", "토"] as const;

export type TrendPoint = {
  date: string;
  day: string;
  /** null은 해당 날짜 출결 행 없음, 0은 기록은 있으나 출석 0%. */
  attendance: number | null;
  /** null은 해당 청구월 행 없음, 0은 청구가 있으나 수납 0%. */
  payment: number | null;
};

export type TrendAttendanceRow = {
  session_date: string;
  status: string;
};

export type TrendInvoiceRow = {
  id: string;
  period: string;
  amount_total: number;
  amount_paid: number;
  amount_discount: number | null;
  paid_at: string | null;
  line_items: unknown;
};

function utcDateMs(isoDate: string): number {
  const timestamp = Date.parse(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(timestamp)) throw new RangeError(`Invalid ISO date: ${isoDate}`);
  return timestamp;
}

function isoDatesInRange(startIso: string, endIso: string): string[] {
  const start = utcDateMs(startIso);
  const end = utcDateMs(endIso);
  if (start > end) return [];

  const dates: string[] = [];
  for (let timestamp = start; timestamp <= end; timestamp += DAY_MS) {
    dates.push(new Date(timestamp).toISOString().slice(0, 10));
  }
  return dates;
}

/** 7일 창이 월 경계를 넘을 때 조회해야 할 청구월을 중복 없이 반환한다. */
export function invoicePeriodsForRange(startIso: string, endIso: string): string[] {
  return [...new Set(isoDatesInRange(startIso, endIso).map((date) => date.slice(0, 7)))];
}

/** timestamptz를 서버 로컬 시간이 아닌 KST 달력 날짜로 변환한다. */
export function kstDateForTimestamp(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : kstToday(date);
}

/**
 * 청구서의 누적 수납액을 실제 라인별 수납일에 배분한다.
 * 구데이터처럼 상세 수납일이 없을 때만 청구서 대표 paid_at으로 남은 금액을 폴백한다.
 */
function invoicePaymentEvents(row: TrendInvoiceRow): Array<{ date: string; amount: number }> {
  let remaining = Math.max(0, Number(row.amount_paid) || 0);
  const payments: Array<{ date: string; amount: number }> = [];
  const items = Array.isArray(row.line_items) ? row.line_items : [];

  for (const raw of items) {
    if (remaining <= 0 || !raw || typeof raw !== "object") break;
    const item = raw as Record<string, unknown>;
    const paid = typeof item.paid === "number" && Number.isFinite(item.paid) ? Math.max(0, item.paid) : 0;
    const date = typeof item.paidDate === "string" ? kstDateForTimestamp(item.paidDate) : null;
    if (paid <= 0 || !date) continue;
    const amount = Math.min(paid, remaining);
    payments.push({ date, amount });
    remaining -= amount;
  }

  const fallbackDate = kstDateForTimestamp(row.paid_at);
  if (remaining > 0 && fallbackDate) payments.push({ date: fallbackDate, amount: remaining });
  return payments;
}

export function buildDashboardTrendPoints({
  startIso,
  endIso,
  attendanceRows,
  invoiceRows,
  includeAttendance,
  includeBilling,
}: {
  startIso: string;
  endIso: string;
  attendanceRows: readonly TrendAttendanceRow[];
  invoiceRows: readonly TrendInvoiceRow[];
  includeAttendance: boolean;
  includeBilling: boolean;
}): TrendPoint[] {
  const attendanceByDate = new Map<string, { total: number; present: number }>();
  if (includeAttendance) {
    for (const row of attendanceRows) {
      const stats = attendanceByDate.get(row.session_date) ?? { total: 0, present: 0 };
      stats.total += 1;
      if (row.status === "present") stats.present += 1;
      attendanceByDate.set(row.session_date, stats);
    }
  }

  const invoicesByPeriod = new Map<
    string,
    { netBilled: number; payments: Array<{ date: string; amount: number }> }
  >();
  if (includeBilling) {
    for (const row of invoiceRows) {
      const aggregate = invoicesByPeriod.get(row.period) ?? { netBilled: 0, payments: [] };
      aggregate.netBilled += Number(row.amount_total) - Number(row.amount_discount ?? 0);
      aggregate.payments.push(...invoicePaymentEvents(row));
      invoicesByPeriod.set(row.period, aggregate);
    }
  }

  return isoDatesInRange(startIso, endIso).map((iso): TrendPoint => {
    const day = new Date(`${iso}T00:00:00Z`);
    const attendanceStats = attendanceByDate.get(iso);
    const invoiceStats = invoicesByPeriod.get(iso.slice(0, 7));
    const paidSoFar = invoiceStats?.payments.reduce(
      (sum, payment) => sum + (payment.date <= iso ? payment.amount : 0),
      0,
    );

    return {
      date: `${day.getUTCMonth() + 1}/${day.getUTCDate()}`,
      day: KO_DAYS[day.getUTCDay()],
      attendance:
        includeAttendance && attendanceStats
          ? Number(((attendanceStats.present / attendanceStats.total) * 100).toFixed(1))
          : null,
      payment:
        includeBilling && invoiceStats
          ? Number(paymentRateOf(paidSoFar ?? 0, invoiceStats.netBilled).toFixed(1))
          : null,
    };
  });
}
