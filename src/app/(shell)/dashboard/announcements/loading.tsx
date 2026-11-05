// 학원 공지(`page.tsx`) 로딩 뼈대 — 이 폴더에 없으면 위 운영실 loading(머리 + KPI 띠)을 받아 전혀 다른 화면이 번쩍인다.
// 실화면은 PageHeader가 없다: 가운데 좁은 단(max-w-4xl) + '운영실' 되돌아가기 링크 + 공지 카드 하나(`AnnouncementsCard` → `DashCard`).
// 같은 클래스에 투명 글자를 넣어 줄 높이를 그대로 얻는다(카드 머리·목록 줄 = `dash-card.tsx`·`announcements-card.tsx`).
const T = "text-transparent bg-bg-soft animate-pulse rounded";

export default function AnnouncementsLoading() {
  return (
    <div className="mx-auto max-w-4xl" aria-busy="true" aria-label="학원 공지를 불러오는 중">
      {/* 되돌아가기 링크 — 실화면은 창(임베드, x-embed)에서 이 줄을 안 그린다. 뼈대는 헤더를 못 읽어 같은 판정을 CSS로(`.embed-main`). */}
      <span aria-hidden className="mb-2 inline-flex text-sm print:hidden [.embed-main_&]:hidden">
        <span className={T}>운영실</span>
      </span>
      <section className="bg-card border-line shadow-card flex flex-1 flex-col overflow-hidden rounded-2xl border">
        <header className="flex items-baseline justify-between gap-2 px-4 pt-3.5 pb-2">
          <div className="flex items-baseline gap-2">
            <h3 className="text-sm font-bold">
              <span className={T}>학원 공지</span>
            </h3>
          </div>
        </header>
        <div className="flex min-h-0 flex-1 flex-col px-4 pb-4">
          <ul className="divide-border min-h-0 flex-1 divide-y">
            {["공지 제목 자리 — 보통 길이", "짧은 공지 제목", "조금 더 긴 공지 제목 자리입니다", "공지 제목 자리", "공지 제목 — 보통 길이"].map((title) => (
              <li key={title} className="flex flex-col gap-0.5 py-2">
                <div className="flex items-center gap-1.5">
                  <span className="truncate text-sm font-medium">
                    <span className={T}>{title}</span>
                  </span>
                </div>
                <p className="flex items-center gap-1.5 text-xs">
                  <span className={T}>0일 전 · 작성자</span>
                </p>
              </li>
            ))}
          </ul>
        </div>
      </section>
    </div>
  );
}
