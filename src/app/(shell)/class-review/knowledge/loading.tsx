export default function Loading() {
  return <div className="space-y-3 p-5" aria-busy="true" aria-label="강사 지식그래프 불러오는 중">
    <div className="h-20 animate-pulse rounded-xl border border-line bg-card" />
    <div className="h-64 animate-pulse rounded-xl border border-line bg-card" />
    <div className="h-48 animate-pulse rounded-xl border border-line bg-card" />
  </div>;
}
