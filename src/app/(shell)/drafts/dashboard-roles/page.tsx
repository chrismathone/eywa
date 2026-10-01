import { notFound } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { loadDashboardChartKinds } from "@/features/dashboard/overview/chart-prefs-server";
import { loadOverview } from "@/features/dashboard/overview/server";
import { RoleBoard } from "./_components/role-board";
import { LAYOUT_IDS, NO_TOGGLES, ROLE_IDS, parseToggles, type LayoutId, type RoleId } from "./_lib/roles";
import { canOpenDraft } from "./_server/access";

export const metadata = { title: "역할별 운영실 시안 — 에이와" };
export const maxDuration = 60;

type Params = { role?: string; layout?: string; subject?: string; t?: string };

/**
 * 역할별 운영실 시안 — 원장 지시(2026-10-01) *"원장 이외에 보면 안되는 세부 데이터들을 관리자나 실장 등 일부 직원에게
 * 노출하면 안되기 때문"* · *"원장은 현재 대시보드를 그대로 … 그걸 바탕으로 관리자/실장 등 시안을 다시"*.
 *
 * 🔴 숨은 시안: 원장 + 슈퍼관리자만(범위 밖은 없는 주소처럼 `notFound()`), 메뉴·사이드바 미노출.
 * 🔴 **실제 운영실 데이터를 읽는다**(가짜 숫자 없음) — 읽기 전에 게이트를 한 번 더 지난다(레이아웃과 이중).
 *    역할 걸러내기는 화면(클라이언트)에서 하지만 보는 사람이 원장이라 새는 게 아니다. 실제 적용 땐 서버가 건다.
 * 🔴 저장하지 않는다 — 고른 역할·안·체크는 주소 쿼리에만 있다(시안 전용 상태).
 */
export default async function DashboardRoleDraftsPage({ searchParams }: { searchParams: Promise<Params> }) {
  if (!(await canOpenDraft())) notFound();
  const params = await searchParams;
  const [full, chartKinds] = await Promise.all([loadOverview(), loadDashboardChartKinds()]);
  const role = ROLE_IDS.find((r) => r === params.role) ?? "owner";
  const layout = LAYOUT_IDS.find((l) => l === params.layout) ?? "a";
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        eyebrow="숨은 시안 · 원장 · 슈퍼관리자만"
        title="역할별 운영실 시안"
        description="지금 운영실의 실제 카드와 실제 데이터를, 역할에 보이면 안 되는 칸만 빼고 다시 놓은 시안. 역할·체크 선택은 저장되지 않는다."
        embedLabel="역할별 운영실 시안 · 실제 데이터"
      />
      <RoleBoard
        full={full}
        chartKinds={chartKinds}
        initialRole={role satisfies RoleId}
        initialLayout={layout satisfies LayoutId}
        initialSubject={params.subject ?? ""}
        initialToggles={params.t ? parseToggles(params.t) : NO_TOGGLES}
      />
    </div>
  );
}
