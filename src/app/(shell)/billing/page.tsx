import { requireAccess } from "@/lib/auth/require-access";
import { BillingContent } from "./_components/billing-content";
import { TextbooksFace } from "./_components/textbooks-face";
import { ExpensesPanel } from "./_components/expenses-panel";
import { CalculatorPanel } from "./_components/calculator-panel";
import { FaceTabs, type Face } from "@/components/face-tabs";

type Sp = Record<string, string | undefined>;
type BillingTab = "billing" | "textbooks" | "expenses" | "calculator";

function resolveTab(sp: Sp): BillingTab {
  return sp.tab === "textbooks"
    ? "textbooks"
    : sp.tab === "expenses"
      ? "expenses"
      : sp.tab === "calculator"
        ? "calculator"
        : "billing";
}

// 교재 단가표는 교재 면과 수강료 계산기 면의 "내부탭"으로 들어가 두 곳에서 쓰인다(최상위 면 아님).
const FACES: Face[] = [
  { key: "billing", label: "수납", href: "/billing" },
  { key: "textbooks", label: "교재", href: "/billing?tab=textbooks" },
  { key: "expenses", label: "지출", href: "/billing?tab=expenses" },
  { key: "calculator", label: "수강료 계산기", href: "/billing?tab=calculator" },
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
          : "";
  return { title: `수납관리${suffix} — eywa` };
}

export default async function BillingPage({ searchParams }: { searchParams: Promise<Sp> }) {
  await requireAccess("billing");
  const sp = await searchParams;
  const tab = resolveTab(sp);

  return (
    <div className="space-y-4 print:space-y-0">
      <div className="print:hidden">
        <FaceTabs faces={FACES} active={tab} ariaLabel="수납관리 면 전환" />
      </div>
      {tab === "textbooks" ? (
        <TextbooksFace sp={sp} />
      ) : tab === "expenses" ? (
        <ExpensesPanel sp={sp} />
      ) : tab === "calculator" ? (
        <CalculatorPanel sp={sp} />
      ) : (
        <BillingContent sp={sp} />
      )}
    </div>
  );
}
