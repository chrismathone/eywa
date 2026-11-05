import { KPI_KEYS } from "@/features/dashboard/overview/layout";
import { KpiStripSkeleton, OverviewFrameSkeleton } from "./_overview/overview-skeleton";

// 운영실 첫 로드 — 페이지가 배치(역할·저장 배치·디자인)를 알아내기 전 잠깐 Next가 이 loading을 Suspense fallback으로 흘린다.
//
// 🔑 **머리와 KPI 띠까지만** 그린다(원장 2026-11-05) — 본문은 역할마다 다르다(원장·총괄 기본 격자 23장 / 회계 등 역할 배치는
//    자유 격자 · 계기판). 본문 뼈대는 `overview-server.tsx`가 배치를 안 뒤 그 모양으로 Suspense fallback에 그린다(`OverviewSkeleton`).
// 모양은 실물과 같은 래퍼·표식·클래스를 입힌 공용 뼈대(`overview-skeleton.tsx`) — 손으로 치수를 다시 짓지 않는다.
// KPI 아홉 칸 = 원장 기본 띠(배치를 아직 모른다).
export default function DashboardLoading() {
  return (
    <OverviewFrameSkeleton>
      <KpiStripSkeleton keys={KPI_KEYS} />
    </OverviewFrameSkeleton>
  );
}
