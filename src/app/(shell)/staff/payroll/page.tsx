import { canManageSalary } from "@/features/payroll/server/salary-access";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ChevronLeft, ChevronRight, Wallet, CheckCircle2, Clock } from "@/components/icons/aywa-icon-compat";
import { WindowLink } from "@/components/workspace/window-link";
import { BackLink } from "@/components/back-link";
import { Pill, type PillColor } from "@/components/atoms/pill";
import { EmptyState } from "@/components/empty-state";
import { SearchForm } from "@/components/search-form";
import {
  TOOLBAR_SEG_BOX,
  TOOLBAR_SEG_ITEM,
  TOOLBAR_SEG_OFF,
  TOOLBAR_SEG_ON_PRIMARY,
} from "@/components/toolbar-controls";
import { DragScrollArea } from "@/components/ui/drag-scroll-area";
import { requireAccess } from "@/lib/auth/require-access";
import { isPayrollEnabled } from "@/features/payroll/config";
import { getTenantSettings } from "@/features/owner/server/queries";
import { ROLE_LABEL } from "@/lib/auth/role-hierarchy";
import type { SystemRole } from "@/lib/permissions";
import { currentPeriod } from "@/features/billing/calc";
import {
  getMonthlyPayrollOverview,
  type PayrollOverviewRow,
} from "@/features/payroll/server/queries";

export const metadata = { title: "월별 급여 — 에이와" };

const won = (n: number) => `${n.toLocaleString("ko-KR")}원`;

const STATUS_META: Record<string, { label: string; color: PillColor }> = {
  paid: { label: "지급완료", color: "green" },
  saved: { label: "작성됨", color: "blue" },
  draft: { label: "미작성", color: "neutral" },
};

const STATUS_FILTERS = [
  { key: "all", label: "전체" },
  { key: "paid", label: "지급완료" },
  { key: "saved", label: "작성됨" },
  { key: "draft", label: "미작성" },
];

/** YYYY-MM ± n개월 — 모듈 함수라 RSC 본문 아님(new Date 허용, #11). */
function shiftPeriod(period: string, delta: number): string {
  const [y, m] = period.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export default async function StaffPayrollPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; q?: string; status?: string }>;
}) {
  await requireAccess("staff");
  if (!isPayrollEnabled(await getTenantSettings())) notFound();
  // 급여 노출은 원장(master) 전용 (schema.ts 주석 — 전직원 급여는 민감 정보).
  if (!(await canManageSalary())) redirect("/staff"); // 원장 + super_admin(D6)

  const sp = await searchParams;
  const period = /^\d{4}-\d{2}$/.test(sp.period ?? "") ? sp.period! : currentPeriod();
  const q = sp.q ?? "";
  const status = sp.status ?? "all";

  const overview = await getMonthlyPayrollOverview(period);

  let rows = overview.rows;
  if (status !== "all") rows = rows.filter((r) => r.status === status);
  if (q) {
    const term = q.toLowerCase();
    rows = rows.filter((r) => r.name.toLowerCase().includes(term));
  }

  const buildHref = (patch: { period?: string; status?: string; q?: string }) => {
    const next = { period, status, q, ...patch };
    const params = new URLSearchParams();
    if (next.period !== currentPeriod()) params.set("period", next.period);
    if (next.status !== "all") params.set("status", next.status);
    if (next.q) params.set("q", next.q);
    const s = params.toString();
    return s ? `/staff/payroll?${s}` : "/staff/payroll";
  };

  return (
    <div className="space-y-4">
      <BackLink href="/staff" label="직원관리로" />

      {/* Stat strip */}
      <section className="grid grid-cols-2 gap-3.5 sm:grid-cols-4">
        <Stat label="총 실수령" value={won(overview.totalNet)} icon={Wallet} color="primary" />
        <Stat label="총 기본급" value={won(overview.totalBase)} icon={Wallet} color="blue" />
        {/* 지급완료 = positive(green) — 같은 화면 아래 배지도 green이라 종전엔 KPI만 네이비로 어긋났다. */}
        <Stat label="지급완료" value={`${overview.paidCount}명`} icon={CheckCircle2} color="green" />
        <Stat
          label="미지급/미작성"
          value={`${overview.savedCount + overview.draftCount}명`}
          icon={Clock}
          color="amber"
        />
      </section>

      {/* Filter bar */}
      {/* 🔴 툴바 카드 껍데기 제거(원장 2026-09-01) — 아래 표가 자기 테두리를 가져 선이 겹쳤다. */}
      <div className="flex flex-wrap items-center gap-3 px-1 py-1">
        {/* 월 이동 */}
        <div className="flex items-center gap-1">
          <Link
            href={buildHref({ period: shiftPeriod(period, -1) })}
            className="border-line text-text-dim hover:bg-bg-soft inline-flex size-8 items-center justify-center rounded-lg border transition"
            aria-label="이전 달"
          >
            <ChevronLeft className="size-4" />
          </Link>
          <span className="text-foreground num min-w-[88px] text-center text-sm font-bold">{period}</span>
          <Link
            href={buildHref({ period: shiftPeriod(period, 1) })}
            className="border-line text-text-dim hover:bg-bg-soft inline-flex size-8 items-center justify-center rounded-lg border transition"
            aria-label="다음 달"
          >
            <ChevronRight className="size-4" />
          </Link>
        </div>

        <span className="bg-line h-4 w-px" aria-hidden />

        {/* 상태 칩 */}
        <div className="flex items-center gap-1.5">
          <span className="micro shrink-0">상태</span>
          <div className={TOOLBAR_SEG_BOX}>
          {STATUS_FILTERS.map((f) => (
            <Link
              key={f.key}
              href={buildHref({ status: f.key })}
              className={`${TOOLBAR_SEG_ITEM} shrink-0 ${status === f.key ? TOOLBAR_SEG_ON_PRIMARY : TOOLBAR_SEG_OFF}`}
            >
              {f.label}
            </Link>
          ))}
          </div>
        </div>

        {/* 검색 — 클라 내비(SearchForm)라 화면 깜빡 없이 결과만 교체(period·status 자동 보존) */}
        <SearchForm placeholder="직원명" defaultValue={q} inputWidth="w-28" />
      </div>

      <p className="micro">
        대상 <span className="text-foreground font-bold">{rows.length}</span>명
        <span className="text-text-faint ml-2 normal-case">· 전체 {overview.rows.length}명</span>
      </p>

      {rows.length === 0 ? (
        <EmptyState
          image="billing"
          icon={() => <Wallet size={32} strokeWidth={1.8} />}
          title="해당 조건의 급여 내역이 없습니다"
        />
      ) : (
        <PayrollTable rows={rows} totalBase={overview.totalBase} totalNet={overview.totalNet} />
      )}
    </div>
  );
}

function PayrollTable({
  rows,
  totalBase,
  totalNet,
}: {
  rows: PayrollOverviewRow[];
  totalBase: number;
  totalNet: number;
}) {
  return (
    <DragScrollArea className="bg-card border-line shadow-card rounded-2xl border">
      <table className="w-full text-sm [&_td]:whitespace-nowrap">
        <thead className="border-line border-b [&_th]:whitespace-nowrap">
          <tr>
            <th className="micro px-4 py-3 text-left">직원</th>
            <th className="micro px-4 py-3 text-left">역할</th>
            <th className="micro px-4 py-3 text-right">기본급</th>
            <th className="micro px-4 py-3 text-right">시급분</th>
            <th className="micro px-4 py-3 text-right">보너스</th>
            <th className="micro px-4 py-3 text-right">공제</th>
            <th className="micro px-4 py-3 text-right">실수령</th>
            <th className="micro px-4 py-3 text-left">상태</th>
          </tr>
        </thead>
        <tbody className="divide-line divide-y">
          {rows.map((r) => {
            const st = STATUS_META[r.status] ?? STATUS_META.draft!;
            return (
              <tr key={r.userId} className="hover:bg-bg-soft/50">
                <td className="px-4 py-2.5">
                  <WindowLink
                    href={`/staff/${r.userId}/payroll`}
                    title={`${r.name} 급여`}
                    className="text-foreground text-sm font-bold hover:underline"
                  >
                    {r.name}
                  </WindowLink>
                </td>
                <td className="text-text-dim px-4 py-2.5 text-xs">
                  {ROLE_LABEL[r.systemRole as SystemRole] ?? r.systemRole}
                </td>
                <td className="text-text-dim num px-4 py-2.5 text-right text-xs">
                  {r.baseAmount.toLocaleString("ko-KR")}
                </td>
                <td className="text-text-dim num px-4 py-2.5 text-right text-xs">
                  {r.hourlyAmount.toLocaleString("ko-KR")}
                  {r.hoursWorked > 0 ? (
                    <span className="text-text-faint ml-1">({r.hoursWorked}h)</span>
                  ) : null}
                </td>
                <td className="text-text-dim num px-4 py-2.5 text-right text-xs">
                  {r.bonus ? r.bonus.toLocaleString("ko-KR") : "—"}
                </td>
                <td className="text-text-dim num px-4 py-2.5 text-right text-xs">
                  {r.deduction ? `-${r.deduction.toLocaleString("ko-KR")}` : "—"}
                </td>
                <td className="text-foreground num px-4 py-2.5 text-right text-xs font-bold">
                  {r.total.toLocaleString("ko-KR")}
                </td>
                <td className="px-4 py-2.5">
                  <Pill color={st.color} soft={r.status !== "paid"}>
                    {st.label}
                  </Pill>
                </td>
              </tr>
            );
          })}
        </tbody>
        <tfoot className="border-line border-t-2">
          <tr className="bg-bg-soft/50">
            <td className="text-foreground px-4 py-2.5 text-xs font-bold" colSpan={2}>
              합계 ({rows.length}명)
            </td>
            <td className="text-foreground num px-4 py-2.5 text-right text-xs font-bold">
              {totalBase.toLocaleString("ko-KR")}
            </td>
            <td colSpan={3} />
            <td className="text-foreground num px-4 py-2.5 text-right text-xs font-bold">
              {totalNet.toLocaleString("ko-KR")}
            </td>
            <td />
          </tr>
        </tfoot>
      </table>
    </DragScrollArea>
  );
}

function Stat({
  label,
  value,
  icon: Icon,
  color,
}: {
  label: string;
  value: string;
  icon: typeof Wallet;
  color: "primary" | "green" | "blue" | "amber";
}) {
  const ICON_BG = {
    primary: "bg-primary-soft text-primary",
    blue: "bg-blue-soft text-blue",
    green: "bg-green-soft text-green",
    amber: "bg-amber-soft text-amber",
  } as const;
  return (
    <div className="bg-card border-line shadow-card rounded-2xl border p-4">
      <header className="flex items-center justify-between">
        <p className="micro truncate">{label}</p>
        <span className={`flex size-[26px] shrink-0 items-center justify-center rounded-sm ${ICON_BG[color]}`}>
          <Icon size={13} strokeWidth={1.8} />
        </span>
      </header>
      <p className="text-foreground mt-2 num text-lg font-bold leading-none">{value}</p>
    </div>
  );
}
