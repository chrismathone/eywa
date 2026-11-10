/** 학원 지식그래프 첫 로드 뼈대 — 부모 화면의 스켈레톤을 물려받지 않게 자기 것(skeleton-pairs 가드 ②). */
export default function Loading() {
  return (
    <div className="space-y-3" aria-busy="true" aria-label="학원 지식그래프 불러오는 중">
      <div className="border-line bg-card h-20 animate-pulse rounded-2xl border" />
      <div className="border-line bg-card h-64 animate-pulse rounded-2xl border" />
      <div className="border-line bg-card h-48 animate-pulse rounded-2xl border" />
    </div>
  );
}
