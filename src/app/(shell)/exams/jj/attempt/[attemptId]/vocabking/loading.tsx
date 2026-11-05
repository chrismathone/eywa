import { SkeletonText } from "@/components/skeleton-text";

const BAR = "bg-bg-soft text-transparent animate-pulse rounded";
// 점수 블록(bg-primary) 위 자리 — 실물이 그 블록 안에서 쓰는 흰 반투명 면과 같은 값.
const ON_PRIMARY = "bg-white/12 animate-pulse";

/**
 * 보카킹 종합평가 리포트 창 스켈레톤(B7) — 인재원 호출(최대 8초)이 창 첫 페인트를 막지 않게.
 * 🔴 결과지(attempt) 스켈레톤의 복사본이었다 — 리포트는 결과지와 다른 모양이다. 줄 = 실물(vocabking-report.tsx):
 * 링크 줄 → 리포트 카드(`px-6 py-6 gap-6`) 안에 머리(VkHeader: 소라벨 · text-2xl 제목 · 설명 + 오른쪽 이름·학년·응시일, `border-b-2 pb-4`)
 * → primary 점수 블록(VkScore: 원 그래프 + 정답 수 · 한 줄 최대 3칸(의미 이해·철자 정확도 + 소요 시간 — 종합 정답률은 뺀다) · 점수 막대)
 * → 아래 단(학습 위치 이하)은 한 덩어리 자리.
 */
export default function VocabkingReportLoading() {
  return (
    <div className="space-y-4">
      {/* 링크 줄(시험 결과지 · 학생 상세) — 실물 nav와 같은 text-sm 한 줄. */}
      <div aria-hidden className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
        <span className={BAR}>시험 결과지</span>
        <span className={BAR}>학생 이름 학생 상세</span>
      </div>
      <div aria-hidden className="bg-card shadow-card @container flex flex-col gap-6 rounded-2xl px-6 py-6">
        <header className="border-line flex flex-wrap items-end justify-between gap-4 border-b-2 pb-4">
          <div className="min-w-0">
            <SkeletonText className="text-xs font-bold tracking-wide">VOCABKING · 종합평가 리포트</SkeletonText>
            <SkeletonText className="mt-1 text-2xl font-bold">시험 이름 자리</SkeletonText>
            <SkeletonText className="mt-1 text-sm">어휘 평가와 학습 데이터를 분석해 현재 위치와 다음 학습 방향을 정리했습니다.</SkeletonText>
          </div>
          <div className="grid grid-cols-[auto_auto] gap-x-4 gap-y-1 text-sm">
            {["이름", "학년", "응시일"].map((k) => (
              <span key={k} className="contents">
                <span className={BAR}>{k}</span>
                <span className={BAR}>0000.00.00</span>
              </span>
            ))}
          </div>
        </header>
        <section className="bg-primary flex flex-col gap-4 rounded-2xl px-5 py-5 @md:px-7">
          <div className="flex items-center gap-4 @md:gap-6">
            <span className={`size-24 shrink-0 rounded-full @md:size-32 ${ON_PRIMARY}`} />
            <div className="flex min-w-0 flex-col gap-2">
              <p className="text-xs font-bold"><span className={`${ON_PRIMARY} rounded text-transparent`}>이번 시험 결과</span></p>
              <p className="text-lg font-bold @md:text-xl">
                <span className={`${ON_PRIMARY} rounded text-transparent`}>00문제 중 <span className="text-2xl @md:text-3xl">00</span>개 정답</span>
              </p>
              <p className={`w-fit rounded-lg px-3 py-1 text-sm font-bold text-transparent ${ON_PRIMARY}`}>전체 00위 · 상위 00%</p>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {[0, 1, 2].map((i) => (
              <div key={i} className={`min-w-0 rounded-xl px-2 py-2 text-transparent @md:px-3 ${ON_PRIMARY}`}>
                <p className="text-xs">의미</p>
                <p className="text-sm font-bold @md:text-lg">00%</p>
              </div>
            ))}
          </div>
          {/* 점수 막대(ScoreLine) — h-3 막대 + 아래 눈금 글자 한 줄. */}
          <div className="flex flex-col gap-1.5">
            <div className="h-3 rounded-full bg-white/20" />
            <p className="text-xs text-transparent">0 100</p>
          </div>
        </section>
        <div className="bg-bg-soft h-40 animate-pulse rounded-xl" />
      </div>
    </div>
  );
}
