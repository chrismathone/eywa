import "server-only";
import { unstable_cache } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllPaged, fetchAllPagedInChunks } from "@/lib/supabase/batch";
import { summarizeInvoices } from "@/features/billing/calc";
import type { SlicePredicate } from "@/features/dashboard/layout/slices";
import {
  classifyInvoice,
  enrollmentInMonth,
  summarizeSubjectBilling,
  type ClassifiedInvoice,
  type InvoiceForSubject,
  type SubjectBillingSummary,
} from "./billing-subject";

/*
 * 청구월별 청구·수납 요약 **한 벌** — 운영실 '6개월 청구 · 수납'·'수납 현황'과 수납 통계(`/billing/stats`)가 같은 함수를 부른다
 * (달 수만 다르다 — 이번 달 칸 = 카드 값). 지난 달은 5분 캐시(지점·달 키), 이번 달은 요청마다 새로 읽는다.
 */

type InvoiceTrendRow = {
  period: string;
  amount_total: number;
  amount_paid: number;
  amount_discount: number | null;
  status: string;
};

function summarizeInvoiceMonths(rows: InvoiceTrendRow[], months: string[]) {
  return months.map((month) =>
    summarizeInvoices(
      rows
        .filter((r) => r.period === month)
        .map((r) => ({
          amountTotal: Number(r.amount_total),
          amountPaid: Number(r.amount_paid),
          amountDiscount: Number(r.amount_discount ?? 0),
          status: r.status,
        })),
      month,
    ),
  );
}

const invoiceTrendSelect = "period,amount_total,amount_paid,amount_discount,status";

/**
 * 지난 달들의 청구 요약 — tenantId별 `unstable_cache`(5분). 여러 달 청구서(실측 2026-09: 월 340~430행)를 30초 갱신마다 전건
 * 다시 받으면 B2 위반이라, 바뀌지 않는 지난 달은 캐시하고 **이번 달만** 요청마다 새로 읽는다(수납 현황 카드가 같은 값을 쓴다).
 * 캐시 안엔 쿠키가 없어 admin client + 신뢰된 tenantId 키(`loadTenantSettingsRaw`와 같은 패턴, `.eq(tenant_id)` 격리).
 * ⚠️ 지난 달 미수가 5분 뒤에 반영되는 것은 감수(추이 차트) — 이번 달 숫자는 즉시.
 */
const loadPastInvoiceMonths = (tenantId: string, months: string[]) =>
  unstable_cache(
    async () => {
      const admin = createAdminClient();
      const rows = await fetchAllPaged<InvoiceTrendRow>((from, to) =>
        admin
          .from("invoices")
          .select(invoiceTrendSelect)
          .eq("tenant_id", tenantId)
          .in("period", months)
          .neq("status", "void")
          .order("id")
          .range(from, to),
      );
      return summarizeInvoiceMonths(rows, months);
    },
    ["dashboard-invoice-trend-v2", tenantId, months.join(",")],
    { tags: [`dashboard-invoice-trend:${tenantId}`], revalidate: 300 },
  )();

type Db = Awaited<ReturnType<typeof createClient>> | ReturnType<typeof createAdminClient>;

/**
 * 그 달들의 청구서 줄마다 과목을 정한다(`billing-subject.ts`). 학생의 반 = 그 달에 수강이 걸린 반(종료된 수강 포함 — 지난 달 청구서).
 * 청구서는 달마다 수백 장이라 페이지로(B2), 수강은 학생 id 청크 × 페이지로(B3 · 청크 안 1,000행 절단 방지).
 * `tenantId`는 admin(캐시 안) 경로에서만 — RLS를 우회하므로 지점 필터가 필수다([[#104]]).
 */
async function classifiedInvoices(
  client: Db,
  months: string[],
  tenantId?: string,
  /** 줄의 과목을 무엇으로 볼지 — 없으면 반의 과목 그대로('대시보드 전환' 과목 탭은 영어를 EiE · 인재원 영어로 가른다). */
  subjectKeyOf?: (subject: string | null, englishTrack: string | null) => string | null,
): Promise<ClassifiedInvoice[]> {
  if (!months.length) return [];
  type Inv = InvoiceForSubject & { student_id: string | null };
  const invoices = await fetchAllPaged<Inv>((from, to) => {
    let q = client.from("invoices").select("student_id,period,status,amount_total,amount_paid,amount_discount,line_items").in("period", months).neq("status", "void");
    if (tenantId) q = q.eq("tenant_id", tenantId);
    return q.order("id").range(from, to);
  });
  type One<T> = T | T[] | null;
  const studentIds = [...new Set(invoices.map((i) => i.student_id).filter((id): id is string => !!id))];
  const enrollments = await fetchAllPagedInChunks<{ student_id: string; class_id: string; start_date: string | null; end_date: string | null; class: One<{ class_name: string | null; subject: string | null; english_track: string | null }> }>(
    studentIds,
    (chunk, from, to) => {
      let q = client.from("enrollments").select("student_id,class_id,start_date,end_date,class:class_id ( class_name, subject, english_track )").in("student_id", chunk);
      if (tenantId) q = q.eq("tenant_id", tenantId);
      return q.order("id").range(from, to);
    },
  );
  const byStudent = new Map<string, typeof enrollments>();
  for (const e of enrollments) byStudent.set(e.student_id, [...(byStudent.get(e.student_id) ?? []), e]);
  return invoices.map((inv) => {
    const classes = (inv.student_id ? byStudent.get(inv.student_id) ?? [] : [])
      .filter((e) => enrollmentInMonth({ start: e.start_date, end: e.end_date }, inv.period))
      .map((e) => {
        const klass = Array.isArray(e.class) ? e.class[0] : e.class;
        const subject = klass?.subject ?? null;
        return { classId: e.class_id, className: klass?.class_name ?? null, subject: subjectKeyOf ? subjectKeyOf(subject, klass?.english_track ?? null) : subject };
      });
    return classifyInvoice(inv, classes);
  });
}

/** 지난 달들의 과목 판정 결과 — 지난 달 요약(`loadPastInvoiceMonths`)과 같은 5분 캐시(지점·달 키, admin + 지점 필터). */
const loadPastClassifiedInvoices = (tenantId: string, months: string[]) =>
  unstable_cache(
    () => classifiedInvoices(createAdminClient(), months, tenantId),
    ["dashboard-invoice-subjects-v1", tenantId, months.join(",")],
    { tags: [`dashboard-invoice-trend:${tenantId}`], revalidate: 300 },
  )();

/**
 * 그 달들(오름차순 · 마지막 = 이번 달)의 청구 요약 — 학원 전체는 청구서 머리, 과목 관리자는 청구 항목별(`summarizeSubjectBilling`).
 * `withSubjects`가 false면 과목 값을 만들지 않는다(줄 항목·수강을 안 읽는다).
 */
export async function loadBillingMonths(
  tenantId: string,
  months: string[],
  withSubjects: boolean,
  subjectKeyOf?: (subject: string | null, englishTrack: string | null) => string | null,
): Promise<(pred: SlicePredicate | null) => SubjectBillingSummary[]> {
  const db = await createClient();
  const current = months[months.length - 1];
  const [past, currentRows, classified] = await Promise.all([
    loadPastInvoiceMonths(tenantId, months.slice(0, -1)),
    fetchAllPaged<InvoiceTrendRow>((from, to) =>
      db
        .from("invoices")
        .select(invoiceTrendSelect)
        .eq("period", current)
        .neq("status", "void")
        .order("id")
        .range(from, to),
    ),
    // 과목 관리자 값(원장 2026-10-14 2단계 — 청구 항목별)은 그 값이 필요할 때만 줄 항목·수강을 읽는다.
    subjectKeyOf
      ? classifiedInvoices(db, months, undefined, subjectKeyOf)
      : withSubjects
      ? Promise.all([loadPastClassifiedInvoices(tenantId, months.slice(0, -1)), classifiedInvoices(db, [current])]).then(([a, b]) => [...a, ...b])
      : Promise.resolve([] as ClassifiedInvoice[]),
  ]);
  const academy = [...past, ...summarizeInvoiceMonths(currentRows, [current])];
  return (pred) => (pred ? summarizeSubjectBilling(classified, months, (subject) => pred(subject)) : academy);
}

