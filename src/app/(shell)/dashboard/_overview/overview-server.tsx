import { loadOverview } from "@/features/dashboard/overview/server";
import { Overview } from "./overview";

export async function OverviewDashboard() {
  return <Overview initial={await loadOverview()} />;
}
