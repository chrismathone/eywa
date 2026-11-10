/**
 * '계기판' 화면(`instrument-board.tsx`) 로딩 뼈대 — `loading.tsx` · 운영실 Suspense fallback(`overview-server.tsx`) · 계기판 동적 로드의
 * `loading`(`dashboard-board.tsx`)이 **같은 이것**을 그린다. 계기판은 브라우저에서만 그려져(ssr:false) 서버 HTML이 곧
 * `loading`이라, 둘이 같아야 fallback → 서버 HTML → 계기판 사이에 빈 화면이나 다른 모양이 끼지 않는다.
 * ⚠️ instruments.css는 고른 사람만 받는 묶음이라(B5) 여기서 불러오지 않는다 — 치수는 그 파일의 셸(.body·.head)·KPI 격자·
 *    구역(.block 26px)·카드 격자(틈 12px) 값을 옮겨 적은 **근삿값**이다. 계기판 머리·격자를 바꾸면 여기도 같이 본다.
 * 열 수·여백은 실물처럼 이 화면 폭(`@container aywa`)을 본다 — instruments.css 반응형 절과 같은 경계:
 *   카드 3열 · 1504px 이상 4열 · 1044px 이하 2열 · 524px 이하 1열 / KPI 3열 · 704px 이하 2열(마지막 칸 한 줄) · 524px 이하 1열.
 *   (CSS의 `max-width: Npx`는 N 포함이라 Tailwind 경계는 N+1 미만으로 적는다.)
 */
const PULSE = "bg-bg-soft animate-pulse rounded";
const CARD_COLS = "grid-cols-3 @min-[1504px]/aywa:grid-cols-4 @max-[1045px]/aywa:grid-cols-2 @max-[525px]/aywa:grid-cols-1";
const KPI_COLS = "grid-cols-3 @max-[705px]/aywa:grid-cols-2 @max-[525px]/aywa:grid-cols-1";

function BlockSkeleton({ cards, height }: { cards: number; height: number }) {
  return (
    <div className="mt-[26px]">
      <div className="border-line mb-3 flex items-baseline justify-between gap-3 border-b-2 pb-2">
        <span className={`${PULSE} block h-6 w-32`} />
        <span className={`${PULSE} block h-4 w-48`} />
      </div>
      <div className={`grid gap-3 ${CARD_COLS}`}>
        {Array.from({ length: cards }, (_, i) => (
          <div key={i} className="border-line bg-card flex flex-col gap-3 rounded-[10px] border px-4 pt-3.5 pb-4" style={{ height }}>
            <span className={`${PULSE} block h-5 w-36`} />
            <span className={`${PULSE} block min-h-0 flex-1`} />
          </div>
        ))}
      </div>
    </div>
  );
}

/** 시안: 새 대시보드 모양(핵심 업무 3칸 · 보기 전환 · 오늘의 브리핑 + KPI 6칸 · 현황 필터 · 카드 2열)의 뼈대 — 색도 같은 계기판 톤. */
export function InstrumentsSkeleton() {
  return (
    <div className="@container/aywa w-full" aria-busy="true" aria-label="학원 전체 현황을 불러오는 중">
      <div className="mx-auto w-full max-w-[1760px] px-1 pt-1 pb-10">
        <div className="mb-[18px] grid grid-cols-3 gap-3 @max-[651px]/aywa:grid-cols-1">
          {Array.from({ length: 3 }, (_, i) => (
            <div key={i} className="border-line bg-card rounded-[10px] border px-4 py-3.5"><span className={`${PULSE} block h-5 w-40`} /><span className={`${PULSE} mt-2 block h-4 w-56`} /></div>
          ))}
        </div>
        <div className="mb-3.5 flex items-end justify-between gap-4">
          <div><span className={`${PULSE} mb-0.5 block h-[18px] w-40`} /><span className={`${PULSE} block h-[30px] w-72`} /></div>
          <span className={`${PULSE} block h-5 w-36`} />
        </div>
        <div className="mb-4 flex items-center gap-4"><span className={`${PULSE} block h-[42px] w-80`} /><span className={`${PULSE} block h-4 w-64`} /></div>
        <div className="mb-3.5 grid grid-cols-[minmax(300px,1fr)_minmax(0,2fr)] gap-3 @max-[1101px]/aywa:grid-cols-1">
          <div className="min-h-[180px] animate-pulse rounded-[10px] bg-primary" />
          <div className={`border-line bg-card grid overflow-hidden rounded-[10px] border ${KPI_COLS} [grid-template-rows:1fr_1fr]`}>
            {Array.from({ length: 6 }, (_, i) => (
              <div key={i} className="border-line border-r border-b px-4 py-3"><span className={`${PULSE} block h-5 w-24`} /><span className={`${PULSE} mt-1 block h-[30px] w-20`} /><span className={`${PULSE} mt-1 block h-4 w-36`} /></div>
            ))}
          </div>
        </div>
        <div className="border-line bg-card flex items-center gap-4 rounded-[10px] border px-4 py-2.5"><span className={`${PULSE} block h-5 w-28`} /><span className={`${PULSE} block h-8 w-72`} /></div>
        <BlockSkeleton cards={4} height={260} />
      </div>
    </div>
  );
}
