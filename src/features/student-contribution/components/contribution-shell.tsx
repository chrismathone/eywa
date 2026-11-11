"use client";
import { ContributionLink as Link, useStudentContributionScope } from "./student-contribution-scope";
import type { ReactNode } from "react";
import { ContributionNavigationHint } from "./navigation-hint";
import { PageHeader } from "@/components/page-header";
import { FACE_TAB_ITEM, FACE_TABS_NAV, FACE_TABS_NAV_LEVEL } from "@/components/face-tabs-classes";
const tabs = [
  { key: "ranking", label: "로열티 랭킹", href: "/student-contribution/ranking" },
  { key: "students", label: "누적 활동기록", href: "/student-contribution" },
  { key: "ontology", label: "학생 기록 연결", href: "/student-contribution/ontology" },
  { key: "referrals", label: "지난 소개 확인", href: "/student-contribution/referrals" },
  { key: "settings", label: "배점 설정", href: "/student-contribution/settings" },
] as const;
/** 면 탭 한 칸 — 앱 면 탭(FaceTabs 1차)과 같은 치수·색. 이동은 로열티 링크(학생 상세 안에선 그 범위 안 이동)라 FaceTabs 부품 대신 같은 클래스. */
const TAB = `${FACE_TAB_ITEM} text-(length:--control-label) leading-none whitespace-nowrap transition focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-primary`;
const TAB_ON = "bg-primary text-primary-foreground font-medium";
const TAB_OFF = "text-text-dim hover:text-foreground hover:bg-bg-soft font-medium";

/**
 * 원생 로열티 머리 — 단독 화면은 앱 머리글(`PageHeader` 한 줄 · 원장 2026-11-11 디자인 통일), 학생 상세 안(로열티 범위)은
 * 그 화면이 이미 머리글을 가지므로 제목·설명 한 줄만. 아래 면 탭은 둘 다 앱 면 탭과 같은 모양.
 */
export function ContributionHeader({ title, description, active, canConfigure, actions }: {
  title: string; description: string; active: typeof tabs[number]["key"]; canConfigure?: boolean; actions?: ReactNode;
}) {
  const embedded = useStudentContributionScope() !== null;
  return <div className="space-y-4">
    {embedded ? <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="space-y-1"><h2 className="text-xl font-bold">{title}</h2><p className="text-sm">{description}</p></div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div> : <PageHeader title={title} description={description} actions={actions} />}
    <nav aria-label="원생 로열티 메뉴" className={`${FACE_TABS_NAV} ${FACE_TABS_NAV_LEVEL.primary}`}>
      {tabs.filter((tab) => canConfigure || tab.key === "ranking" || tab.key === "students" || tab.key === "ontology").map((tab) => <Link key={tab.key} href={tab.href}
        aria-current={active === tab.key ? "page" : undefined}
        className={`${TAB} ${active === tab.key ? TAB_ON : TAB_OFF}`}><ContributionNavigationHint label={tab.label} /></Link>)}
    </nav>
  </div>;
}
