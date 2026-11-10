/** 통합 지식그래프(시안) 뼈대 — 머리 판 · 숫자 카드 줄 · 본문 판(같은 시안 화면들의 뼈대와 같은 모양). 부모 스켈레톤을 받지 않게 둔다(skeleton-pairs ②). */
export default function Loading() {
  return <div className="space-y-3 p-5" aria-busy="true" aria-label="통합 지식그래프 불러오는 중">
    <div className="h-28 animate-pulse rounded-xl border border-line bg-card" />
    <div className="h-72 animate-pulse rounded-xl border border-line bg-card" />
  </div>;
}
