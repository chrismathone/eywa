export default function Loading() {
  return <div className="space-y-3 p-5" aria-busy="true" aria-label="학생 통합보기 불러오는 중">
    <div className="h-24 animate-pulse rounded-xl border border-line bg-card" />
    <div className="h-72 animate-pulse rounded-xl border border-line bg-card" />
  </div>;
}
