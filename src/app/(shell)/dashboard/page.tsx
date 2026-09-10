import { OverviewDashboard } from "./_overview/overview-server";

export const metadata = { title: "대시보드 — eywa" };
export const maxDuration = 60;

/** 기본 대시보드와 기존 ?view=one 주소에서 같은 전체 현황을 제공한다. */
export default function DashboardPage() {
  return <OverviewDashboard />;
}
