import { PageHeaderSkeleton } from "@/components/page-header";
import { SkeletonLine, SkeletonText } from "@/components/skeleton-text";
import { Toolbar, ToolbarSkeletonItem } from "@/components/toolbar";
import { MakeupCellLines, MakeupPagerSkeleton, MakeupTableSkeleton } from "./_components/makeup-skeleton";

/** 업무 건수 카드 = MAKEUP_FLAG 10개(case-list) — 실물 라벨 그대로(좁은 칸에서 같은 줄 수로 감기게). '종결 후 확인 필요'는 건이 있을 때만 서서 뺐다. */
const FLAG_LABELS = ["미처리", "승인 대기", "담당 미지정", "예약 필요", "기한 임박", "기한 경과", "실시 기록 필요", "검토 대기", "대사 필요", "보류 재검토"];

/**
 * 보강 목록 스켈레톤 — 실 배치(page.tsx): 헤더(링크 3 + 보강 접수) → 툴바(list-toolbar) → 건수 카드 10장 → 조회 문장 → 표 → 쪽 이동.
 * 담당자·학생 조건 칩 줄과 '접수 중지' 안내는 주소·설정에 따라 서므로 그리지 않는다. 글자 자리는 줄 높이 = 실물 글자(공용 SkeletonLine·SkeletonText).
 */
export default function LoadingMakeups() {
  return (
    <div role="status" aria-label="보강 목록 불러오는 중" className="space-y-4 pb-6">
      <p className="sr-only">보강 기록을 불러오고 있습니다…</p>
      <PageHeaderSkeleton
        actions={
          // 실물: 미연결 근거 · 도입 사전 점검 · 대사·복구(밑줄 링크) + 보강 접수(쓰기 권한 ∧ 운영 중일 때 — 기본 경로로 그린다).
          <div className="flex items-center gap-3">
            <SkeletonLine className="w-16" />
            <SkeletonLine className="w-24" />
            <SkeletonLine className="w-14" />
            <div className="bg-bg-soft min-h-8 w-20 animate-pulse rounded-md" />
          </div>
        }
      />
      {/* 툴바 — 상태·다음 업무·과목(라벨 + `min-h-8` 선택칸) · 학생 검색(`Input` h-8, max-w-64) · 조회. 실물이 레일 없이(`rail={false}`) 감긴다. */}
      <Toolbar rail={false}>
        {["w-8", "w-16", "w-8"].map((label, i) => (
          <div key={i} className="flex items-center gap-2">
            <SkeletonLine className={label} />
            <div className="bg-bg-soft min-h-8 w-24 animate-pulse rounded-md" />
          </div>
        ))}
        <div className="bg-bg-soft h-8 w-full max-w-64 animate-pulse rounded-lg" />
        <ToolbarSkeletonItem className="w-14" />
      </Toolbar>
      <div className="space-y-4">
        <div aria-hidden className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {FLAG_LABELS.map((label) => (
            // 실물 카드 `border-line rounded-lg border p-3` — dt 링크(본문 한 줄) · dd 숫자(`mt-1 text-xl font-bold` = 30px).
            <div key={label} className="border-line rounded-lg border p-3">
              <SkeletonText as="div" className="">
                {label}
              </SkeletonText>
              <SkeletonText as="div" className="mt-1 text-xl font-bold">
                00
              </SkeletonText>
            </div>
          ))}
        </div>
        <SkeletonText className="text-sm">조회 000건 · 마지막 성공 2026. 11. 5. 오후 2:00:00</SkeletonText>
        {/* 표 — 머리줄 th `px-4 py-3`(≈ 48px, 폰에선 숨김) · 행 = 첫 칸 학생 링크 + 두 줄 + `py-3`(≈ 96px). */}
        <MakeupTableSkeleton
          head={["학생·원수업", "진행", "의무 잔량 / 예약 중 / 예약 가능", "다음 업무", "담당·기한"]}
          thClass="whitespace-nowrap px-4 py-3"
          headClass="bg-bg-soft hidden md:table-header-group"
          cells={
            <>
              <td className="px-4 py-3">
                <MakeupCellLines lines={["학생 이름", "과목 · 원수업 반 이름", "2026-11-05 · 결석"]} />
              </td>
              <td className="px-4 py-3">
                <MakeupCellLines lines={["승인 대기", "진행 중"]} />
              </td>
              <td className="px-4 py-3">
                <MakeupCellLines lines={["00분 / 00분 / 00분"]} />
              </td>
              <td className="px-4 py-3">
                <MakeupCellLines lines={["보강 시간 승인"]} />
              </td>
              <td className="px-4 py-3">
                <MakeupCellLines lines={["담당자", "기한 미지정"]} />
              </td>
            </>
          }
        />
        <MakeupPagerSkeleton />
      </div>
    </div>
  );
}
