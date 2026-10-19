import { PageHeader } from "@/components/page-header";
import { kstToday } from "@/lib/date-kst";
import { AnalyticsPanel } from "./analytics-panel";

export function AnalyticsFace({ tenantId }: { tenantId: string }) {
  return <div className="space-y-4">
    <PageHeader title="경영분석" eyebrow="경영" description="MakeEdu CSV 검증과 실적 분석" />
    <AnalyticsPanel key={tenantId} tenantId={tenantId} today={kstToday()} />
  </div>;
}
