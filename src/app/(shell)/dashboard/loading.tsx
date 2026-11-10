import { InstrumentsSkeleton } from "./_instruments/instruments-skeleton";

// 운영실 첫 로드 뼈대 — 새 대시보드가 곧 운영실이라(옛 화면은 2026-11-10 삭제) 새 모양·새 색 뼈대를 그린다.
// 옛 운영실 뼈대를 먼저 그리면 새로고침마다 옛 색이 한 번 비쳤다가 바뀐다(원장 2026-11-09 제보).
export default function DashboardLoading() {
  return <InstrumentsSkeleton />;
}
