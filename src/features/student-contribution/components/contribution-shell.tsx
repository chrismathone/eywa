import { ContributionLink as Link } from "./student-contribution-scope";
import type { ReactNode } from "react";
import { ContributionNavigationHint } from "./navigation-hint";
const tabs = [
  { key: "ranking", label: "로열티 랭킹", href: "/student-contribution/ranking" },
  { key: "students", label: "누적 활동기록", href: "/student-contribution" },
  { key: "ontology", label: "학생 기록 연결", href: "/student-contribution/ontology" },
  { key: "referrals", label: "지난 소개 확인", href: "/student-contribution/referrals" },
  { key: "settings", label: "배점 설정", href: "/student-contribution/settings" },
] as const;
export function ContributionHeader({ title, description, active, canConfigure, actions }: {
  title: string; description: string; active: typeof tabs[number]["key"]; canConfigure?: boolean; actions?: ReactNode;
}) {
  return <header className="space-y-5">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="space-y-2"><h1 className="text-xl font-bold tracking-tight">{title}</h1><p className="max-w-3xl text-sm leading-relaxed">{description}</p></div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
    <nav aria-label="원생 충성도 메뉴" className="flex gap-5 overflow-x-auto border-b border-line">
      {tabs.filter((tab) => canConfigure || tab.key === "ranking" || tab.key === "students" || tab.key === "ontology").map((tab) => <Link key={tab.key} href={tab.href}
        aria-current={active === tab.key ? "page" : undefined}
        className={`shrink-0 border-b-2 px-1 pb-3 text-sm transition-colors focus-visible:outline-primary ${active === tab.key ? "border-primary font-bold text-primary" : "border-transparent hover:border-line-strong"}`}><ContributionNavigationHint label={tab.label} /></Link>)}
    </nav>
  </header>;
}
