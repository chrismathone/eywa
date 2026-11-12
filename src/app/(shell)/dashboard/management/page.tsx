import { unstable_rethrow } from "next/navigation";
import { EmbedLink as Link } from "@/components/embed-link";
import { requireAccess } from "@/lib/auth/require-access";
import { kstToday } from "@/lib/date-kst";
import { isFeatureLicensed } from "@/lib/license/server";
import { monthSchema } from "@/features/management/model";
import { managementAccess } from "@/features/management/server/access";
import { loadManagement } from "@/features/management/server/query";
import { loadLatestAiReview } from "@/features/management/server/ai-review";
import { accountingImportAllowed } from "@/features/management/server/accounting-scope";
import { isCollectorDeployed } from "@/features/management/collector-switch";
import { ManagementInputError } from "@/features/management/errors";
import { ManagementWorkspace } from "@/features/management/workspace";

export const metadata = { title: "경영 분석 · 대시보드 — 에이와" };
export const maxDuration = 60;

/** 고를 수 있는 분석 월 — 이번 달부터 거꾸로 36개월(미래 월 없음). */
function recentMonths(today: string) {
  const [y, m] = today.slice(0, 7).split("-").map(Number);
  return Array.from({ length: 36 }, (_, i) => new Date(Date.UTC(y!, m! - 1 - i, 1)).toISOString().slice(0, 7)).reverse();
}
/**
 * 월 선택지 = 최근 36개월 + 저장된 회계 자료의 시작 달 + 지금 보는 달(오름차순 · 미래 월 제외).
 * 36개월보다 오래된 회계 자료도 그 시작 달을 골라 다시 열 수 있게 한다(본문은 그 달에 걸친 기간만 읽는다 — server/query.ts).
 */
function monthOptions(recent: readonly string[], stored: readonly string[], month: string, current: string) {
  return [...new Set([...recent, ...stored.filter((m) => monthSchema.safeParse(m).success && m <= current), month])].sort();
}

/**
 * 경영 분석 — 🔴 원장 전용 재무 화면. 문 = '경영 분석·지식그래프' 메뉴 권한(requireAccess) + 원장 역할·수납·원생·직원 권한(managementAccess).
 * 이 지점 DB를 읽는다(청구·수강·상담 + s2_0052 회계·대조 기록 + s2_0054 AI 검토 보관). AI는 화면을 열 때 부르지 않는다.
 */
export default async function Page({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  await requireAccess("management");
  const today = kstToday(), months = recentMonths(today);
  const parsed = monthSchema.safeParse((await searchParams).month ?? today.slice(0, 7));
  const month = parsed.success && parsed.data <= today.slice(0, 7) ? parsed.data : today.slice(0, 7);
  let user;
  try { user = await managementAccess(); } catch (e) {
    unstable_rethrow(e);
    return <section className="p-8"><h1 className="text-lg font-bold">경영 분석</h1><p className="mt-2">학원 재무 자료라 원장 계정에서만 볼 수 있습니다.</p><Link href="/dashboard" className="mt-3 inline-block underline">대시보드로</Link></section>;
  }
  let loaded: [Awaited<ReturnType<typeof loadManagement>>, Awaited<ReturnType<typeof loadLatestAiReview>>, boolean, boolean];
  try {
    loaded = await Promise.all([loadManagement(month), loadLatestAiReview(user.tenantId, month), isFeatureLicensed(user.tenantId, "ai_analysis"), accountingImportAllowed(user.tenantId)]);
  } catch (e) {
    unstable_rethrow(e);
    if (!(e instanceof ManagementInputError)) console.error("[dashboard/management] 조회 실패", e);
    return <section className="p-8"><h1 className="text-lg font-bold">경영 분석</h1><p className="mt-2">{e instanceof ManagementInputError ? e.message : "경영 분석 자료를 불러오지 못했습니다. 잠시 뒤 다시 시도해 주세요."}</p><Link href="/dashboard" className="mt-3 inline-block underline">대시보드로</Link></section>;
  }
  const [data, aiReview, aiLicensed, accountingImport] = loaded;
  return <ManagementWorkspace data={data.snapshot} reportIndex={data.reportIndex} accountingImport={accountingImport} collectorAvailable={isCollectorDeployed()} months={monthOptions(months, data.reportIndex.map((r) => r.start.slice(0, 7)), month, today.slice(0, 7))} aiReview={aiReview} aiEnabled={aiLicensed}/>;
}
