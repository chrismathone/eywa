import "server-only";
import { unstable_cache } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/auth/current-user";
import { fetchAllPaged } from "@/lib/supabase/batch";
import { summarizeInvoices, currentPeriod, type BillingSummary } from "../calc";

// 순수 요약 로직은 calc.ts(서버 전용 아님 → Vitest)로 분리. 기존 importer 호환 위해 re-export(#Q2).
export { summarizeInvoices };
export type { BillingSummary };

export type InvoiceLineItem = {
  kind: string; // 구분: 수업/교재/차량비/기타
  description: string; // 수납명
  classId?: string;
  amount: number; // 청구액
  // 라인 단위 수납 표(makeedu 동일)용 항목별 상세(임포터 보강, 2026-07-08). 구데이터는 없을 수 있어 optional.
  discount?: number; // 할인액
  points?: number; // 적립금
  paid?: number; // 실제낸금액
  unpaid?: number; // 미납금액
  method?: string | null; // 결제수단
  paidDate?: string | null; // 수납일
  receipt?: string | null; // 현금영수증
  dueDay?: number | null; // 청구일
};

export type InvoiceRow = {
  id: string;
  studentId: string;
  studentName: string;
  studentGrade: string | null;
  period: string;
  category: string;
  amountTotal: number;
  amountPaid: number;
  amountDiscount: number;
  status: string;
  dueDate: string | null;
  paidAt: string | null;
  notes: string | null;
  lineItems: InvoiceLineItem[];
  // 결제 상세(0042a)
  paymentMethod: string | null;
  cardCompany: string | null;
  cashReceiptNumber: string | null;
  pointsUsed: number;
  discountReason: string | null;
  billedAt: string | null;
  syncAddedAt: string | null; // 지난 동기화가 새로 추가(다음 동기화 성공 시 해제) → ↻ 동기화 배지
  /**
   * 이 행이 마지막으로 갱신된 시각. makeedu 임포터의 upsert는 값이 같아도 `updated_at = now()`를 쓰므로
   * **"이 달이 최근 스크랩에 포함됐는가"의 신뢰 프록시**다(월 커버리지 경고에 사용 — periodCoverage).
   */
  updatedAt: string | null;
};

export type SortKey =
  | "status"
  | "name"
  | "amount_total"
  | "amount_paid"
  | "amount_discount"
  | "due_date";

export type InvoiceFilters = {
  period?: string;
  q?: string;
  sort?: SortKey;
  desc?: boolean;
  category?: string; // "all" | "tuition" | "material" | "exam" | "other"
};

// line_items jsonb는 소스마다 형태가 다르다: 구 makeedu 동기화는 {name,amount}(description 없음),
// eywa 폼/POC는 {kind,description,amount}, 2026-07-08 재적재 이후는 항목별 상세 11-key. description을
// 단일 소스로 정규화(name→description)해 검색 필터가 `undefined.toLowerCase()`로 터지지 않게 하고,
// ⚠️ 항목별 상세(할인/실납/미납/결제 등)는 **있으면 통과**시킨다 — 미지 키 무언 드랍은 라인 단위 표를
// 조용히 비우는 write-only-orphan(2026-07-13 머지 검증에서 실측한 사고 — 타입만 확장되고 여기서 잘렸음).
function normalizeInvoiceLineItems(raw: unknown): InvoiceLineItem[] {
  if (!Array.isArray(raw)) return [];
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
  const str = (v: unknown) => (typeof v === "string" && v ? v : undefined);
  return raw.map((item) => {
    const o = (item ?? {}) as Record<string, unknown>;
    const description =
      typeof o.description === "string" && o.description
        ? o.description
        : typeof o.name === "string"
          ? o.name
          : "";
    const opt = {
      classId: str(o.classId),
      discount: num(o.discount),
      points: num(o.points),
      paid: num(o.paid),
      unpaid: num(o.unpaid),
      method: str(o.method),
      paidDate: str(o.paidDate),
      receipt: str(o.receipt),
      dueDay: num(o.dueDay),
    };
    return {
      kind: typeof o.kind === "string" ? o.kind : "tuition",
      description,
      amount: Number(o.amount) || 0,
      // undefined 필드는 키 자체를 생략(구데이터 optional 계약 유지)
      ...Object.fromEntries(Object.entries(opt).filter(([, v]) => v !== undefined)),
    };
  });
}

export async function getInvoicesForPeriod(
  options?: InvoiceFilters,
): Promise<InvoiceRow[]> {
  const supabase = await createClient();
  const periodKey = options?.period ?? currentPeriod();
  // B2: 이 결과는 summarizeInvoices가 합계·수납률로 집계한다 — 무페이징 select는 1000행 silent 절단
  // (invoices 전체 1606행 실측)이라 fetchAllPaged(에러도 throw — 실패가 '0건 요약'으로 위장되지 않게)로 전건.
  const data = await fetchAllPaged((from, to) => {
    let qb = supabase
      .from("invoices")
      .select(
        `id, period, category, amount_total, amount_paid, amount_discount, status, due_date, paid_at, notes, line_items,
         payment_method, card_company, cash_receipt_number, points_used, discount_reason, billed_at, sync_added_at, updated_at,
         student:student_id ( id, name, grade )`,
      )
      .eq("period", periodKey)
      // void = makeedu에서 삭제된 청구(동기화가 무효 처리) — 수납 표·KPI·엑셀은 makeedu 미러라 제외.
      // 행 자체는 DB에 보존(notes [동기화] 마커 = 근거), 학생 상세 수납 이력에는 '무효' 배지로 남는다.
      .neq("status", "void");
    if (options?.category && options.category !== "all") {
      qb = qb.eq("category", options.category);
    }
    // OFFSET 페이지 안정화 — unique tie-break order 필수(batch.ts 계약)
    return qb.order("id", { ascending: true }).range(from, to);
  });

  let rows: InvoiceRow[] = data.map((r) => {
    const stu = (Array.isArray(r.student) ? r.student[0] : r.student) as
      | {
          id: string;
          name: string;
          grade: string | null;
        }
      | undefined;
    return {
      id: r.id,
      studentId: stu?.id ?? "",
      studentName: stu?.name ?? "?",
      studentGrade: stu?.grade ?? null,
      period: r.period,
      category: (r as { category?: string }).category ?? "tuition",
      amountTotal: Number(r.amount_total),
      amountPaid: Number(r.amount_paid),
      amountDiscount: Number(r.amount_discount ?? 0),
      status: r.status,
      dueDate: r.due_date,
      paidAt: r.paid_at,
      notes: r.notes ?? null,
      lineItems: normalizeInvoiceLineItems(r.line_items),
      paymentMethod: (r as { payment_method?: string | null }).payment_method ?? null,
      cardCompany: (r as { card_company?: string | null }).card_company ?? null,
      cashReceiptNumber: (r as { cash_receipt_number?: string | null }).cash_receipt_number ?? null,
      pointsUsed: Number((r as { points_used?: number }).points_used ?? 0),
      discountReason: (r as { discount_reason?: string | null }).discount_reason ?? null,
      billedAt: (r as { billed_at?: string | null }).billed_at ?? null,
      syncAddedAt: (r as { sync_added_at?: string | null }).sync_added_at ?? null,
      updatedAt: (r as { updated_at?: string | null }).updated_at ?? null,
    };
  });

  // 검색
  if (options?.q) {
    const term = options.q.trim().toLowerCase();
    if (term) {
      rows = rows.filter((r) => {
        if (r.studentName.toLowerCase().includes(term)) return true;
        return r.lineItems.some((li) => li.description.toLowerCase().includes(term));
      });
    }
  }

  // 정렬
  const sort = options?.sort ?? "status";
  const desc = options?.desc ?? false;
  const dir = desc ? -1 : 1;
  rows.sort((a, b) => {
    switch (sort) {
      case "name":
        return a.studentName.localeCompare(b.studentName, "ko") * dir;
      case "amount_total":
        return (a.amountTotal - b.amountTotal) * dir;
      case "amount_paid":
        return (a.amountPaid - b.amountPaid) * dir;
      case "amount_discount":
        return (a.amountDiscount - b.amountDiscount) * dir;
      case "due_date":
        return ((a.dueDate ?? "").localeCompare(b.dueDate ?? "")) * dir;
      case "status":
      default: {
        const order = ["unpaid", "partial", "paid", "refunded", "void"];
        const ai = order.indexOf(a.status);
        const bi = order.indexOf(b.status);
        if (ai !== bi) return (ai - bi) * dir;
        return b.amountTotal - a.amountTotal;
      }
    }
  });

  return rows;
}

export async function getBillingSummary(period?: string): Promise<BillingSummary> {
  const rows = await getInvoicesForPeriod({ period });
  return summarizeInvoices(rows, period);
}

/**
 * 가용 청구 월 목록 (descending).
 *
 * ⚠️ **전건 fetch 금지(B2)** — 예전엔 `period` 한 컬럼을 fetchAllPaged로 전부 긁어 JS Set으로
 * distinct를 만들었다. 결과는 월 문자열 8개인데 비용은 **요청 4회 / 3,225행 / 245ms**였고(2026-07-31
 * 실측) 행이 1,000개 늘 때마다 왕복이 하나씩 더 붙는 구조였다. 이 화면이 여는 창마다 도는 비용이라
 * group-by RPC(0163a `invoice_periods`)로 옮겼다 — 단일 요청, 페이로드 수백 바이트.
 */
export async function getAvailablePeriods(): Promise<string[]> {
  const user = await getCurrentUser();
  // 창(iframe)마다 도는 값이라 테넌트 단위로 60초 공유한다(B6). 결과는 "2026-08" 꼴 **월 문자열 목록**이라
  // 개인정보도 금액도 없고, 이 화면 자체가 수납 권한 뒤에 있다. 새 월의 첫 청구서를 만들면 최대 60초 뒤
  // 칩이 뜬다 — 그 이상 기다리게 하지 않으려고 TTL을 짧게 잡았다.
  // ⚠️ 세션이 없으면(비로그인·cron) 캐시를 안 태우고 기존 경로로 간다(캐시 키가 테넌트라서).
  if (user?.tenantId) return getAvailablePeriodsCached(user.tenantId);
  return loadAvailablePeriods(await createClient());
}

/** 테넌트별 60초 캐시본 — 캐시 안엔 쿠키가 없어 admin 클라이언트를 쓴다(`loadTenantSettingsRaw`와 같은 규약). */
const getAvailablePeriodsCached = (tenantId: string): Promise<string[]> =>
  unstable_cache(
    async () => loadAvailablePeriods(createAdminClient(), tenantId),
    ["billing-available-periods", tenantId],
    { revalidate: 60 },
  )();

/**
 * 실제 조회 — 세션 경로는 RPC(`invoice_periods`), **admin 경로(캐시 안)는 RPC를 쓰지 않는다.**
 *
 * 🔴 그 RPC는 `where tenant_id = auth_tenant_id()`라 service_role로 부르면 **에러 없이 0행**이다
 *    (0114a가 dashboard_*_admin 변형을 따로 만든 것과 같은 함정). 그러면 월 칩이 "이번 달 하나"로
 *    조용히 줄어든다 — 그래서 admin 경로는 tenant를 명시한 페이지네이션 조회로 간다(느리지만 캐시라
 *    60초에 한 번뿐이고, 결과는 RPC와 동일하다).
 */
async function loadAvailablePeriods(
  supabase: Awaited<ReturnType<typeof createClient>> | ReturnType<typeof createAdminClient>,
  tenantId?: string,
): Promise<string[]> {
  const { data, error } = tenantId
    ? { data: null, error: null }
    : await supabase.rpc("invoice_periods");
  // 마이그레이션 미적용 환경(로컬 등)에서 월 칩이 통째로 사라지지 않게 구 경로로 폴백한다.
  // 결과는 동일하고 느릴 뿐이라 '조용한 오작동'은 아니지만 **화면이 똑같아 폴백 중인지 알 수 없다** —
  // 실패는 반드시 로그로 남긴다(gotcha #89: 폴백 있는 기능은 실패를 따로 계측해야 보인다).
  // 에러 종류를 안 가리는 건 의도다: 미적용·타임아웃·권한·스키마캐시 어느 쪽이든 월 칩은 떠야 한다.
  if (error) {
    console.warn(
      `[billing] invoice_periods RPC 실패 — 전건 스캔으로 폴백(느림). 0163a 적용 여부 확인 필요: ${error.message}`,
    );
  }
  const rows: { period: string }[] = error || tenantId
    ? await fetchAllPaged<{ period: string }>((from, to) => {
        // ⚠️ admin 경로는 RLS를 안 타므로 tenant 필터가 **필수**(교차 테넌트 유출 방지).
        const q = supabase.from("invoices").select("period").order("period", { ascending: false });
        return (tenantId ? q.eq("tenant_id", tenantId) : q).range(from, to);
      })
    : ((data ?? []) as { period: string }[]);
  const set = new Set<string>();
  for (const r of rows) set.add(r.period);
  const arr = Array.from(set).sort((a, b) => b.localeCompare(a));
  // 현재 월이 비어 있어도 selector에는 노출
  const now = currentPeriod();
  if (!set.has(now)) arr.unshift(now);
  return arr;
}
