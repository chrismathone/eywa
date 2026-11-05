import { PageHeaderSkeleton } from "@/components/page-header";

/** 글줄 자리 — 투명 글자라 실물과 같은 글자 크기면 같은 줄 높이가 된다. */
const BAR = "bg-bg-soft animate-pulse rounded text-transparent";

/**
 * 날짜별 출결 화면 스켈레톤 — 부모(/attendance)의 표 모양 스켈레톤이 여기까지 내려오면 레이아웃이
 * 크게 튄다(이 화면은 표가 아니라 목록 카드다). 모양이 맞는 걸 따로 둔다.
 * 순서는 page.tsx와 같다: 머리 → 처리 현황 큰 카드 → 요약 카드 → 반별 카드(접힌 `<details>`).
 * ⚠️ 결석 학생 보기(`?status=absent`)는 모양이 다르지만 주소 값을 못 읽으므로 기본 보기(처리 현황)에 맞춘다.
 *    '저장됨'·휴원일 안내 줄은 그때만 서는 줄이라 그리지 않는다.
 */
export default function AttendanceDateLoading() {
  return (
    <div className="space-y-6">
      <PageHeaderSkeleton />

      {/* 처리 현황 — page.tsx `bg-card border-line rounded-2xl border p-5`, 머리 2줄 + 반마다 한 줄(이름 줄 + 진행 막대 줄). */}
      <section aria-hidden className="bg-card border-line space-y-4 rounded-2xl border p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="eyebrow">
              <span className={BAR}>처리 현황</span>
            </p>
            <p className="mt-0.5 text-base font-bold">
              <span className={BAR}>오늘 출결 입력 추적</span>
            </p>
          </div>
          <p className="text-sm">
            <span className={BAR}>완료율 00% · 미처리 반 0/00</span>
          </p>
        </div>
        <ul className="divide-border divide-y">
          {Array.from({ length: 6 }, (_, i) => (
            <li key={i} className="flex items-center gap-3 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">
                  <span className={BAR}>반 이름 · 과목 · 담임</span>
                </p>
                <div className="mt-1 flex items-center gap-2">
                  <div className="bg-bg-soft h-1.5 w-32 animate-pulse rounded-full" />
                  <span className={`${BAR} text-xs`}>0/00</span>
                </div>
              </div>
              <span className={`${BAR} shrink-0 text-xs`}>입력</span>
            </li>
          ))}
        </ul>
      </section>

      {/* 요약 카드 — 4칸(소라벨 + 숫자 `text-xl`). */}
      <div aria-hidden className="bg-card border-line grid grid-cols-2 gap-4 rounded-2xl border p-5 sm:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="space-y-1">
            <p className="eyebrow">
              <span className={BAR}>전체</span>
            </p>
            <p className="text-xl font-bold">
              <span className={BAR}>000건</span>
            </p>
          </div>
        ))}
      </div>

      {/* 반별 카드 — 접힌 채로 머리 줄만(`border` · `px-5 py-3` · 반 이름 `text-sm` + 과목·인원 `text-xs`). */}
      <div aria-hidden className="space-y-3">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="bg-card border-line overflow-hidden rounded-2xl border">
            <div className="flex items-center justify-between gap-3 px-5 py-3">
              <div>
                <p className="text-sm font-bold">
                  <span className={BAR}>반 이름</span>
                </p>
                <p className="text-xs">
                  <span className={BAR}>과목 · 00명</span>
                </p>
              </div>
              <span className={`${BAR} text-xs`}>전원 출석</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
