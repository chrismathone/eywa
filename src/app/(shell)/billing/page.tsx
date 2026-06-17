import { requireAccess } from "@/lib/auth/require-access";
import { BillingContent } from "./_components/billing-content";
import { TextbooksPanel } from "./_components/textbooks-panel";
import { ExpensesPanel } from "./_components/expenses-panel";
import { BillingTabs, type BillingTab } from "./_components/billing-tabs";

type Sp = Record<string, string | undefined>;

function resolveTab(sp: Sp): BillingTab {
  return sp.tab === "textbooks" ? "textbooks" : sp.tab === "expenses" ? "expenses" : "billing";
}

// 면(책갈피)마다 문서 제목을 달리해 창 타이틀바가 "수납관리 · 교재신청"으로 라이브 갱신(route-window 관찰).
export async function generateMetadata({ searchParams }: { searchParams: Promise<Sp> }) {
  const tab = resolveTab(await searchParams);
  const suffix = tab === "textbooks" ? " · 교재신청" : tab === "expenses" ? " · 지출관리" : "";
  return { title: `수납관리${suffix} — eywa` };
}

export default async function BillingPage({ searchParams }: { searchParams: Promise<Sp> }) {
  await requireAccess("billing");
  const sp = await searchParams;
  const tab = resolveTab(sp);

  return (
    <div className="relative">
      {/* 책갈피 레일 너비만큼 우측 여백 확보 */}
      <div className="pr-11">
        {tab === "textbooks" ? (
          <TextbooksPanel sp={sp} />
        ) : tab === "expenses" ? (
          <ExpensesPanel sp={sp} />
        ) : (
          <BillingContent sp={sp} />
        )}
      </div>
      <BillingTabs active={tab} />
    </div>
  );
}
