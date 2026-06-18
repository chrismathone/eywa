import { headers } from "next/headers";
import { requireAccess } from "@/lib/auth/require-access";
import { BillingContent } from "./_components/billing-content";
import { TextbooksPanel } from "./_components/textbooks-panel";
import { ExpensesPanel } from "./_components/expenses-panel";
import { CalculatorPanel } from "./_components/calculator-panel";
import { BillingTabs, type BillingTab } from "./_components/billing-tabs";
import { BillingTabSync } from "./_components/billing-tab-sync";

type Sp = Record<string, string | undefined>;

function resolveTab(sp: Sp): BillingTab {
  return sp.tab === "textbooks"
    ? "textbooks"
    : sp.tab === "expenses"
      ? "expenses"
      : sp.tab === "calculator"
        ? "calculator"
        : "billing";
}

// 면(책갈피)마다 문서 제목을 달리해 창 타이틀바가 "수납관리 · 교재신청"으로 라이브 갱신(route-window 관찰).
export async function generateMetadata({ searchParams }: { searchParams: Promise<Sp> }) {
  const tab = resolveTab(await searchParams);
  const suffix =
    tab === "textbooks"
      ? " · 교재신청"
      : tab === "expenses"
        ? " · 지출관리"
        : tab === "calculator"
          ? " · 수강료 계산기"
          : "";
  return { title: `수납관리${suffix} — eywa` };
}

export default async function BillingPage({ searchParams }: { searchParams: Promise<Sp> }) {
  await requireAccess("billing");
  const sp = await searchParams;
  const tab = resolveTab(sp);
  // 창(임베드)에선 외부 책갈피가 프레임 밖에 있어 우측 여백 불필요. 배경 풀페이지에선 in-page 책갈피 레일 너비 확보.
  const embed = (await headers()).get("x-embed") === "1";

  return (
    <div className="relative">
      <div className={embed ? "" : "pr-11"}>
        {tab === "textbooks" ? (
          <TextbooksPanel sp={sp} />
        ) : tab === "expenses" ? (
          <ExpensesPanel sp={sp} />
        ) : tab === "calculator" ? (
          <CalculatorPanel />
        ) : (
          <BillingContent sp={sp} />
        )}
      </div>
      <BillingTabs active={tab} />
      <BillingTabSync />
    </div>
  );
}
