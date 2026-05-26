import { createClient } from "@/lib/supabase/server";
import { AnnouncementsCard } from "./_components/announcements-card";
import { DashboardHero } from "./_components/dashboard-hero";
import { KpiGrid } from "./_components/kpi-grid";
import { TodayTimeline } from "./_components/today-timeline";
import { TrendCard } from "./_components/trend-card";

export const metadata = { title: "대시보드 — eywa" };

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const name = (user?.email ?? "").split("@")[0] || "원장";

  return (
    <div className="space-y-8">
      <DashboardHero name={name} />
      <KpiGrid />
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <div className="xl:col-span-1">
          <AnnouncementsCard />
        </div>
        <div className="xl:col-span-2">
          <TodayTimeline />
        </div>
      </div>
      <TrendCard />
    </div>
  );
}
