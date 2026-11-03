import { OverviewDashboard } from "./_overview/overview-server";

export const metadata = { title: "대시보드 — 에이와" };
export const maxDuration = 60;

/** 기본 주소와 기존 one/design 주소는 확정된 같은 대시보드를 제공한다. */
export default async function DashboardPage({ searchParams }: {
  searchParams: Promise<{ subject?: string }>;
}) {
  const { subject } = await searchParams;
  return <OverviewDashboard subject={typeof subject === "string" ? subject : undefined} />;
}
