import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { BookText, Clock, CircleDollarSign, Receipt } from "lucide-react";
import { Pagination } from "@/components/pagination";
import { SearchForm } from "@/components/search-form";
import {
  getStudentOptions,
  getTextbookOrdersPage,
  getTextbookStats,
  type TextbookStats,
} from "@/features/billing/server/textbook-queries";
import { getCatalogOptions } from "@/features/billing/server/catalog-queries";
import { getTenantSettings } from "@/features/owner/server/queries";
import { accountForTarget } from "@/features/owner/settings-types";
import { getCurrentUser } from "@/lib/auth/current-user";
import { kstToday } from "@/lib/date-kst";
import { resolveBrandingSrc } from "@/lib/storage/media-storage";
import { TextbooksTable } from "./textbooks-table";

const KRW = new Intl.NumberFormat("ko-KR");
const won = (n: number) => `${KRW.format(n)}원`;

// 하단 체크 버튼(등록·납부·주문)과 라벨·순서 일치. 각 칩 = "그 단계가 아직 안 된 것", 완료 = 3체크 전부.
const FILTERS: { key: string; label: string; title: string; count: (s: TextbookStats) => number }[] = [
  { key: "reg", label: "등록", title: "아직 등록 안 된 건", count: (s) => s.needReg },
  { key: "pay", label: "납부", title: "아직 납부 안 된 건", count: (s) => s.needPay },
  { key: "order", label: "주문", title: "아직 주문 안 된 건", count: (s) => s.needOrder },
  { key: "done", label: "완료", title: "등록·납부·주문 모두 완료", count: (s) => s.done },
];

type Sp = { status?: string; q?: string; page?: string };

export async function TextbooksPanel({ sp }: { sp: Sp }) {
  const status = sp.status ?? "all";
  const q = sp.q ?? "";
  const PAGE_SIZE = 50;
  const page = Math.max(1, Number(sp.page) || 1);

  // settings·user는 다이얼로그 실시간 미리보기(요청서 카드: 학원명·로고·계좌)용. 둘 다 React 캐시라 저비용.
  const [{ rows, total }, stats, students, catalog, settings, user] = await Promise.all([
    getTextbookOrdersPage({ filter: status, q }, page, PAGE_SIZE),
    getTextbookStats(),
    getStudentOptions(),
    getCatalogOptions(),
    getTenantSettings(),
    getCurrentUser(),
  ]);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const academyName = settings.profile.name || "인재원";
  const logoUrl = user ? await resolveBrandingSrc(settings.profile.logoUrl, user.tenantId) : null;
  const account = accountForTarget(settings.billing, "textbook");
  const todayKst = kstToday(); // 신청일 경과 라벨 계산 기준(서버 KST) — 클라에 주입.

  const chipHref = (s: string) => {
    const p = new URLSearchParams({ tab: "textbooks" });
    if (s !== "all") p.set("status", s);
    if (q) p.set("q", q);
    return `/billing?${p.toString()}`;
  };
  const pageHref = (n: number) => {
    const p = new URLSearchParams({ tab: "textbooks" });
    if (status !== "all") p.set("status", status);
    if (q) p.set("q", q);
    if (n > 1) p.set("page", String(n));
    return `/billing?${p.toString()}`;
  };

  return (
    <div className="space-y-4">
      {/* 필터 바 */}
      <div className="bg-card border-line shadow-card flex flex-wrap items-center gap-2 rounded-md border px-4 py-3">
        <Link
          href={chipHref("all")}
          className={`shrink-0 rounded-sm border px-2 py-0.5 text-xs transition ${
            status === "all"
              ? "border-foreground bg-foreground text-background font-medium"
              : "border-line text-text-dim hover:text-foreground hover:bg-bg-soft"
          }`}
        >
          전체 {stats.total}
        </Link>
        {FILTERS.map((s) => (
          <Link
            key={s.key}
            href={chipHref(s.key)}
            title={s.title}
            className={`shrink-0 rounded-sm border px-2 py-0.5 text-xs transition ${
              status === s.key
                ? "border-foreground bg-foreground text-background font-medium"
                : "border-line text-text-dim hover:text-foreground hover:bg-bg-soft"
            }`}
          >
            {s.label} {s.count(stats)}
          </Link>
        ))}
        <SearchForm placeholder="교재명·학생" defaultValue={q} />
      </div>

      {/* KPI */}
      <section className="grid grid-cols-2 gap-3.5 sm:grid-cols-4">
        <Kpi label="전체 신청" value={`${stats.total}건`} icon={BookText} color="blue" />
        <Kpi label="처리 대기" value={`${stats.pending}건`} icon={Clock} color="amber" hint="등록·납부·주문 미완" />
        <Kpi label="미납 합계" value={won(stats.unpaidAmount)} icon={CircleDollarSign} color="danger" />
        <Kpi label="총 신청액" value={won(stats.totalAmount)} icon={Receipt} color="primary" />
      </section>

      <div className="flex items-center justify-between">
        <p className="text-text-dim text-xs">
          교재신청 <span className="num text-foreground font-semibold">{total}</span>건
          {q ? <span className="ml-2">· &ldquo;{q}&rdquo; 검색</span> : null}
          {totalPages > 1 ? <span className="ml-2">· {page}/{totalPages} 페이지</span> : null}
        </p>
      </div>

      {total === 0 ? (
        <TextbooksTable
          rows={[]}
          students={students}
          catalog={catalog}
          academyName={academyName}
          logoUrl={logoUrl}
          account={account}
          todayKst={todayKst}
        />
      ) : (
        <>
          <TextbooksTable
            rows={rows}
            students={students}
            catalog={catalog}
            academyName={academyName}
            logoUrl={logoUrl}
            account={account}
            todayKst={todayKst}
          />
          <Pagination page={page} totalPages={totalPages} hrefForPage={pageHref} />
        </>
      )}
    </div>
  );
}

function Kpi({
  label,
  value,
  icon: Icon,
  color,
  hint,
}: {
  label: string;
  value: string;
  icon: LucideIcon;
  color: "primary" | "blue" | "amber" | "danger";
  hint?: string;
}) {
  const ICON_BG = {
    primary: "bg-primary-soft text-primary",
    blue: "bg-blue-soft text-blue",
    amber: "bg-amber-soft text-amber",
    danger: "bg-danger-soft text-danger",
  } as const;
  return (
    <article className="bg-card border-line shadow-card rounded-md border p-5">
      <header className="flex items-center justify-between">
        <p className="micro">{label}</p>
        <span className={`flex size-[26px] items-center justify-center rounded-sm ${ICON_BG[color]}`}>
          <Icon size={14} strokeWidth={2} />
        </span>
      </header>
      <p className="tabular text-foreground num mt-3 text-[18px] leading-tight">{value}</p>
      {hint ? (
        <p className="text-text-dim border-line mt-3 border-t pt-3 text-[11px]">{hint}</p>
      ) : (
        <div className="mt-3 h-[24px]" />
      )}
    </article>
  );
}
