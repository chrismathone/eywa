import { EyIcon } from "@/components/icons/aywa-icons";
import { ConnectionSkeleton } from "@/features/student-contribution/components/current-connections";
import { ContributionDetailHeadingSkeleton } from "../_components/contribution-skeleton";

/**
 * 원생 로열티 학생 상세 스켈레톤 — page가 게이트를 확인한 뒤 **먼저 세우는 껍데기**(`StudentOntologyPanel`)와 똑같이 그린다:
 * 머리 자리 `ContributionDetailHeadingSkeleton`(머리글 한 줄 + 면 탭 — 패널의 머리 Suspense 폴백과 같은 부품) · '로열티 랭킹으로' 링크 · 본문 자리 `ConnectionSkeleton`('월별 로열티') · 접힌 '현재 연결' 상자.
 * 🔴 옛 것(목록 막대 재수출)과 껍데기가 달라 loading → 껍데기 → 내용으로 두 번 튀었다. 같은 부품을 import해 껍데기가 바뀌면 따라온다.
 * '현재 연결' 상자는 고정 문구라 실물 요약 줄을 그대로 옮겼다(누르는 동작만 없다).
 */
export default function Loading() {
  return (
    <div className="w-full min-w-0 space-y-5 pb-6">
      <ContributionDetailHeadingSkeleton />
      {/* '로열티 랭킹으로' 링크 자리 — 실물과 같은 상자 클래스·같은 글자(투명). */}
      <span aria-hidden className="border-line bg-card inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-semibold">
        <EyIcon name="chevronLeft" size={16} />
        <span className="bg-bg-soft animate-pulse rounded text-transparent">로열티 랭킹으로</span>
      </span>
      <ConnectionSkeleton label="월별 로열티" />
      <div aria-hidden className="border-line rounded-xl border">
        <div className="flex items-center justify-between gap-4 px-5 py-4">
          <span>
            <span className="block font-semibold">현재 연결</span>
            <span className="mt-1 block text-xs">현재 수강·담당자, 상담·메모와 최근 기록 요약</span>
          </span>
          <span className="text-primary flex shrink-0 items-center gap-2 text-sm">
            <span>펼치기</span>
            <span>
              <EyIcon name="chevronDown" size={16} />
            </span>
          </span>
        </div>
      </div>
    </div>
  );
}
