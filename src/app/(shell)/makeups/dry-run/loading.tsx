import { PageHeaderSkeleton } from "@/components/page-header";
import { SkeletonLine, SkeletonText } from "@/components/skeleton-text";
import {
  MakeupActionCellSkeleton,
  MakeupBackLinkSkeleton,
  MakeupCellLines,
  MakeupPagerSkeleton,
  MakeupTableSkeleton,
} from "../_components/makeup-skeleton";

/** 근거 분류 A~E(page.tsx `grades`) — 실물 라벨 그대로. */
const GRADES = ["A · 일정 보존 대상", "B · 실시 근거 검토 대상", "C · 근거 추가 확인", "D · 분할·중복 확인", "E · 재원·원반 확인"];

/**
 * 도입 사전 점검 스켈레톤 — 실 배치(page.tsx): 헤더(목록) → 조회 폼(`Toolbar`가 아닌 `flex-wrap items-end` · 위 라벨 + `Input`) →
 * 건수 문장 → 분류 칸 5개(dt + dd ≈ 48px) → 표(머리 ≈ 40px · 행 ≈ 88px+, 처리 칸 문장 감김 포함) → 배치 문장(`text-sm`) → 쪽 이동.
 */
export default function Loading() {
  return (
    <div role="status" aria-label="도입 사전 점검 불러오는 중" className="space-y-4 pb-6">
      <p className="sr-only">기존 보강 약속을 불러오고 있습니다…</p>
      <PageHeaderSkeleton actions={<MakeupBackLinkSkeleton />} />
      <div className="flex flex-wrap items-end gap-3">
        {["w-16", "w-24", "w-24"].map((label, i) => (
          <div key={i} className="space-y-1">
            <SkeletonLine className={label} />
            <div className="bg-bg-soft h-8 w-48 animate-pulse rounded-lg" />
          </div>
        ))}
        <div className="bg-bg-soft h-(--control-h) w-14 animate-pulse rounded-lg" />
      </div>
      <SkeletonText className="">전체 000건 · 조회 쓰기 0건 · 연결해도 실시 인정은 별도 검토합니다.</SkeletonText>
      <div aria-hidden className="flex flex-wrap gap-3">
        {GRADES.map((label) => (
          // 실물 칸 `border-line rounded-md border p-2` — dt·dd 본문 두 줄.
          <div key={label} className="border-line rounded-md border p-2">
            <SkeletonText as="div" className="">
              {label}
            </SkeletonText>
            <SkeletonText as="div" className="">
              0건
            </SkeletonText>
          </div>
        ))}
      </div>
      <MakeupTableSkeleton
        head={["학생·원수업", "예정 일정", "근거 분류", "원본 확인", "처리"]}
        thClass="px-3 py-2"
        cells={
          <>
            <td className="px-3 py-2">
              <MakeupCellLines lines={["학생 이름", "과목 · 반 이름", "2026-11-05"]} />
            </td>
            <td className="px-3 py-2">
              <MakeupCellLines lines={["미정"]} />
            </td>
            <td className="min-w-48 px-3 py-2">
              <MakeupCellLines lines={["A · 일정 보존 대상", "검토 메모", "같은 원수업의 다른 약속 0건"]} />
            </td>
            <td className="px-3 py-2">
              <MakeupCellLines lines={["원본 해시·사건 키"]} />
            </td>
            <td className="min-w-40 px-3 py-2">
              <MakeupActionCellSkeleton text="기존 보강 예약을 보강관리 기록에 연결합니다." />
            </td>
          </>
        }
      />
      <SkeletonText className="break-all text-sm">
        현재 조회 배치 00000000-0000-0000-0000-000000000000 · 원본이 바뀌면 연결을 중단하고 다시 확인합니다.
      </SkeletonText>
      <MakeupPagerSkeleton />
    </div>
  );
}
