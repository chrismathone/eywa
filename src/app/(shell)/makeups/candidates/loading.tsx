import { PageHeaderSkeleton } from "@/components/page-header";
import { SkeletonLine, SkeletonText } from "@/components/skeleton-text";
import { Toolbar, ToolbarSkeletonItem } from "@/components/toolbar";
import {
  MakeupActionCellSkeleton,
  MakeupBackLinkSkeleton,
  MakeupCellLines,
  MakeupPagerSkeleton,
  MakeupTableSkeleton,
} from "../_components/makeup-skeleton";

/**
 * 미연결 근거 스켈레톤 — 실 배치(page.tsx): 헤더(목록) → 툴바(근거 · 검색 · 시작일 · 종료일 · 조회) → 건수 문장 → 표 → 쪽 이동.
 * 기본 근거 = 미연결 결석 · 원장 경로(쓰기 권한 ∧ 운영 중)라 '처리' 칸에 접수 폼(안내 문장 + 버튼, 행 ≈ 89px)이 선다.
 */
export default function Loading() {
  return (
    <div role="status" aria-label="미연결 근거 불러오는 중" className="space-y-4 pb-6">
      <p className="sr-only">미연결 근거를 불러오고 있습니다…</p>
      <PageHeaderSkeleton actions={<MakeupBackLinkSkeleton />} />
      {/* 툴바 — 라벨 붙은 선택칸(`min-h-8`) · 검색(`Input` h-8, max-w-64) · 날짜 둘(라벨 + `Input` h-8) · 조회. 레일 없이 감긴다. */}
      <Toolbar rail={false}>
        <div className="flex items-center gap-2">
          <SkeletonLine className="w-8" />
          <div className="bg-bg-soft min-h-8 w-28 animate-pulse rounded-md" />
        </div>
        <div className="bg-bg-soft h-8 w-full max-w-64 animate-pulse rounded-lg" />
        {[0, 1].map((i) => (
          <div key={i} className="flex items-center gap-2">
            <SkeletonLine className="w-24" />
            <div className="bg-bg-soft h-8 w-36 animate-pulse rounded-lg" />
          </div>
        ))}
        <ToolbarSkeletonItem className="w-14" />
      </Toolbar>
      <SkeletonText className="">000건 · 접수만으로 권리가 확정되거나 완료로 인정되지 않습니다.</SkeletonText>
      {/* 머리줄 th `px-4 py-3`(≈ 48px) · 행 = 처리 칸(안내 + 12px + 버튼) + `py-3`(≈ 89px). */}
      <MakeupTableSkeleton
        head={["학생", "원수업", "예정 일정", "처리"]}
        thClass="px-4 py-3"
        cells={
          <>
            <td className="px-4 py-3">
              <MakeupCellLines lines={["학생 이름", "과목"]} />
            </td>
            <td className="px-4 py-3">
              <MakeupCellLines lines={["2026-11-05", "원수업 반 이름"]} />
            </td>
            <td className="px-4 py-3">
              <MakeupCellLines lines={["—"]} />
            </td>
            <td className="px-4 py-3">
              <MakeupActionCellSkeleton text="접수 후 담당자가 보강 시간을 승인합니다." />
            </td>
          </>
        }
      />
      <MakeupPagerSkeleton />
    </div>
  );
}
