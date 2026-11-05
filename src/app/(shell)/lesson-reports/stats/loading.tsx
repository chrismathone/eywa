import { PageHeaderSkeleton } from "@/components/page-header";
import { ToolbarSkeletonItem } from "@/components/toolbar";
import { SkeletonText } from "@/components/skeleton-text";

/**
 * 보고서 통계 틀 — 집계를 기다리는 동안 같은 자리의 빈 표면을 먼저(B7 · 보고서 목록 스켈레톤이 대신 뜨지 않게 이 라우트 것을 둔다).
 * 줄 = 실물(page.tsx): 머리 → '목록으로' 버튼 줄(px-1 · Toolbar 아님) → `CardNow`(안내 줄 + 숫자 상자) → 추이 카드(`StatCard` 껍데기 = 테두리 링).
 * 글자 자리는 실물 문구를 투명 글자로(`SkeletonText`) — 줄 높이·줄바꿈이 실물 글자 크기·문구 길이·`break-keep`에서 나온다(손 치수 없음).
 */
// CardNow 두 칸 — 실물 라벨·값 줄 보조 글(card-now.tsx) 그대로(흔한 값: 7일 · 30일 · 48시간). 문구 길이가 줄바꿈을 정한다.
const FACTS = [
  { label: "최근 7일 숙제 60% 미만 기록이 한 번 이상 있는 학생", value: "00명", sub: "그중 미제출 0명 · 0% 0명(겹칠 수 있음)" },
  { label: "최근 30일(수업일 기준) 학부모 미확인", value: "00건", sub: "보낸 뒤 48시간이 지나도 안 연 보고서" },
];

export default function ReportStatsLoading() {
  return (
    <div className="@container/panel space-y-4 compact-chrome:space-y-3">
      <PageHeaderSkeleton />
      <div aria-hidden className="flex flex-wrap items-center gap-2 px-1">
        <ToolbarSkeletonItem className="w-28" />
      </div>
      <div aria-hidden className="space-y-4 compact-chrome:space-y-3">
        {/* CardNow(card-now.tsx) — 안내 한 줄 + 숫자 상자(클래스노트가 켜진 지점은 2칸, 꺼지면 1칸 · sm 이상 한 줄이라 높이는 같다). */}
        <section className="space-y-1 px-1">
          <SkeletonText className="text-xs break-keep">현재 확인할 항목 · 운영실 카드와 같은 집계 기준 · 아래 기간 선택과 상관없이 지금 값</SkeletonText>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {FACTS.map((f) => (
              <div key={f.label} className="bg-bg-soft/40 rounded-lg px-3 py-2">
                <SkeletonText className="text-xs">{f.label}</SkeletonText>
                <SkeletonText className="num text-lg font-bold">
                  {f.value}
                  <span className="ml-1.5 text-xs font-medium">{f.sub}</span>
                </SkeletonText>
              </div>
            ))}
          </div>
        </section>
        {/* 추이 카드(report-trend-card.tsx) — StatCard 껍데기(stat-card.tsx: border rounded-2xl p-3) · 머리 = 제목·기준 + 오른쪽 기간 바. */}
        <section className="border-line space-y-3 rounded-2xl border p-3">
          <header className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <SkeletonText className="text-base font-bold">학습 · 학부모 보고 추이</SkeletonText>
              <SkeletonText className="text-xs break-keep">
                수업일 기준 · 수학·영어 보고서 · 숙제 비율은 숫자로 적힌 기록만(없음·빈칸 제외) · 학부모 확인은 발송 성공한 보고서(카드와 같은 조건)
              </SkeletonText>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <ToolbarSkeletonItem className="w-56" />
            </div>
          </header>
          <SkeletonText className="text-sm break-keep">보고서 000건 · 발송 000건 · 이 기간 보고서 중 지금도 미확인(보낸 뒤 48시간 경과) 00건</SkeletonText>
          {/* 그래프 자리 = 실 그래프(TrendChart) 지연 로딩 자리와 같은 높이 + 아래 범례 한 줄. */}
          <div className="space-y-1">
            <div className="bg-bg-soft/40 h-[300px] animate-pulse rounded-lg" />
            <SkeletonText className="px-1 text-sm">숙제 60% 미만 · 48시간 안 확인</SkeletonText>
          </div>
          <SkeletonText className="text-sm">수치 표 보기</SkeletonText>
        </section>
      </div>
    </div>
  );
}
