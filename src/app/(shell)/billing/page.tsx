import { requireAccess } from "@/lib/auth/require-access";
import { BillingContent } from "./_components/billing-content";
import { TextbooksPanel } from "./_components/textbooks-panel";
import { ExpensesPanel } from "./_components/expenses-panel";
import { CalculatorPanel } from "./_components/calculator-panel";
import { CatalogPanel } from "./_components/catalog-panel";
import { FaceTabs, type Face } from "@/components/face-tabs";

type Sp = Record<string, string | undefined>;
type BillingTab = "billing" | "textbooks" | "expenses" | "calculator" | "catalog";

function resolveTab(sp: Sp): BillingTab {
  return sp.tab === "textbooks"
    ? "textbooks"
    : sp.tab === "expenses"
      ? "expenses"
      : sp.tab === "calculator"
        ? "calculator"
        : sp.tab === "catalog"
          ? "catalog"
          : "billing";
}

const FACES: Face[] = [
  { key: "billing", label: "수납", href: "/billing" },
  { key: "textbooks", label: "교재", href: "/billing?tab=textbooks" },
  { key: "expenses", label: "지출", href: "/billing?tab=expenses" },
  { key: "calculator", label: "수강료 계산기", href: "/billing?tab=calculator" },
  { key: "catalog", label: "교재 단가표", href: "/billing?tab=catalog" },
];

// 면마다 문서 제목을 달리해 창 타이틀바가 "수납관리 · 교재"로 라이브 갱신(route-window 관찰).
export async function generateMetadata({ searchParams }: { searchParams: Promise<Sp> }) {
  const tab = resolveTab(await searchParams);
  const suffix =
    tab === "textbooks"
      ? " · 교재"
      : tab === "expenses"
        ? " · 지출"
        : tab === "calculator"
          ? " · 수강료 계산기"
          : tab === "catalog"
            ? " · 교재 단가표"
            : "";
  return { title: `수납관리${suffix} — eywa` };
}

export default async function BillingPage({ searchParams }: { searchParams: Promise<Sp> }) {
  await requireAccess("billing");
  const sp = await searchParams;
  const tab = resolveTab(sp);

  return (
    <div className="space-y-4">
      <FaceTabs faces={FACES} active={tab} ariaLabel="수납관리 면 전환" />
      {tab === "textbooks" ? (
        <TextbooksPanel sp={sp} />
      ) : tab === "expenses" ? (
        <ExpensesPanel sp={sp} />
      ) : tab === "calculator" ? (
        <CalculatorPanel />
      ) : tab === "catalog" ? (
        <CatalogPanel sp={sp} />
      ) : (
        <BillingContent sp={sp} />
      )}
    </div>
  );
}
