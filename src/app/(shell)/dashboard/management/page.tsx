import { unstable_rethrow } from "next/navigation";
import { EmbedLink as Link } from "@/components/embed-link";
import { requireAccess } from "@/lib/auth/require-access";
import { kstToday } from "@/lib/date-kst";
import { isFeatureLicensed } from "@/lib/license/server";
import { monthSchema } from "@/features/management/model";
import { managementAccess } from "@/features/management/server/access";
import { loadManagement } from "@/features/management/server/query";
import { loadLatestAiReview } from "@/features/management/server/ai-review";
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
 * 경영 분석 — 🔴 원장 전용 재무 화면. 문 = '경영 분석·지식그래프' 메뉴 권한(requireAccess) + 원장 역할·수납·원생·직원 권한(managementAccess).
 * 이 지점 DB를 읽는다(청구·수강·상담 + s2_0070 회계·대조 기록 + s2_0072 AI 검토 보관). AI는 화면을 열 때 부르지 않는다.
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
  let loaded: [Awaited<ReturnType<typeof loadManagement>>, Awaited<ReturnType<typeof loadLatestAiReview>>, boolean];
  try {
    loaded = await Promise.all([loadManagement(month), loadLatestAiReview(user.tenantId, month), isFeatureLicensed(user.tenantId, "ai_analysis")]);
  } catch (e) {
    unstable_rethrow(e);
    if (!(e instanceof ManagementInputError)) console.error("[dashboard/management] 조회 실패", e);
    return <section className="p-8"><h1 className="text-lg font-bold">경영 분석</h1><p className="mt-2">{e instanceof ManagementInputError ? e.message : "경영 분석 자료를 불러오지 못했습니다. 잠시 뒤 다시 시도해 주세요."}</p><Link href="/dashboard" className="mt-3 inline-block underline">대시보드로</Link></section>;
  }
  const [data, aiReview, aiLicensed] = loaded;
  // 그래프 본문(학생·청구마다 한 점)은 화면이 개수만 쓴다 — 브라우저로 통째로 보내지 않는다(B7 · 내려받기는 통합 지식그래프 쪽).
  const graphSize = { nodes: data.graph.nodes.length, edges: data.graph.edges.length };
  const view = { ...data, graph: { ...data.graph, nodes: [], edges: [] } };
  return <ManagementWorkspace data={view} graphSize={graphSize} months={months.includes(month) ? months : [...months, month]} aiReview={aiReview} aiEnabled={aiLicensed}/>;
}
