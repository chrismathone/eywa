/**
 * 통계 카드가 오기 전 자리 — **같은 id**라 운영실 '상세'(`#first` 등)가 먼저 그 자리로 스크롤된다(내용이 오면 그 자리에 선다).
 * 표면 = 실카드 `StatCard`(stat-card.tsx)와 같은 테두리·라운드. 원생 통계 page의 Suspense 대체 화면과 두 통계 화면의 loading.tsx가 함께 쓴다.
 * 🔴 import 없는 순수 파일로 둔다 — sections.tsx(보드 넷을 import)에 두었을 땐 loading.tsx가 그 묶음을 통째로 끌어왔다.
 */
export function SectionSkeleton({ id, title, height = "h-96" }: { id: string; title: string; height?: string }) {
  return (
    <section id={id} aria-label={title} aria-busy="true" className={`border-line bg-bg-soft/40 scroll-mt-4 animate-pulse rounded-2xl border ${height}`}>
      <span className="sr-only">{title} 불러오는 중</span>
    </section>
  );
}
