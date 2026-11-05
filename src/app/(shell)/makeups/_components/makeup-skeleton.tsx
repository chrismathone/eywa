import type { ReactNode } from "react";
import { SkeletonLine, SkeletonText } from "@/components/skeleton-text";

/**
 * 보강관리 스켈레톤 공용 조각 — 목록·미연결 근거·사전 점검·대사·상세·접수 스켈레톤이 같은 실물 표면을 쓰므로 한 곳에 둔다.
 * 하위 화면 셋(미연결 근거·사전 점검·대사)은 필터 줄 모양이 서로 달라(툴바 / 위 라벨 폼 / 없음) 화면 골격은 각 loading이 갖고,
 * 같은 부분(표 상자·쪽 이동·머리글 '목록' 링크·입력칸·처리 칸)만 여기서 나눠 쓴다.
 * 🔴 글자 자리는 `h-4`·`h-5`로 적지 않는다 — 이 저장소 글자 토큰은 Tailwind 기본보다 한 단계 크다(`text-sm` = 24px 줄 ·
 *    클래스 없는 본문도 16px × 1.5 = 24px · `text-xl` = 30px). 공용 `SkeletonLine`(줄 높이 = 글자 클래스의 1lh)이나 실물 문구를
 *    투명 글자로 까는 `SkeletonText`를 쓴다. 표는 실물과 같은 `<table>`·칸 클래스라 행 높이를 실물 칸이 정한다.
 */

/** 머리글 오른쪽 '목록' 밑줄 링크(실물 `min-h-6` — 본문 한 줄). */
export function MakeupBackLinkSkeleton() {
  return <SkeletonLine className="w-10" />;
}

/**
 * 표 상자 — 실물 `border-line relative overflow-x-auto rounded-lg border` + `<table className="w-full text-left text-sm">`.
 * - `head` = 머리 칸 라벨(실물 문구 — 투명 글자) · `thClass` = 실물 th 클래스(`px-4 py-3` ≈ 48px · `px-3 py-2` ≈ 40px).
 * - `headClass` = 실물 thead 클래스(목록 표는 폰에서 머리줄을 숨긴다 — `hidden md:table-header-group`).
 * - `cells` = 한 행의 `<td>`들(실물 td 클래스 + 칸 내용) — 행 높이를 실물 칸이 정한다.
 */
export function MakeupTableSkeleton({
  head,
  thClass,
  cells,
  rows = 6,
  headClass = "bg-bg-soft",
}: {
  head: string[];
  thClass: string;
  cells: ReactNode;
  rows?: number;
  headClass?: string;
}) {
  return (
    <div aria-hidden className="border-line relative overflow-hidden rounded-lg border">
      <table className="w-full text-left text-sm">
        <thead className={headClass}>
          <tr>
            {head.map((label) => (
              <th key={label} scope="col" className={thClass}>
                <span className="bg-bg-soft animate-pulse rounded text-transparent">{label}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: rows }, (_, i) => (
            <tr key={i} className="border-line border-t align-top">
              {cells}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** 칸 안 글줄 — 실물 칸의 글줄(링크·`<p>`)을 투명 글자로 한 줄씩. 문구 길이로 폭이 정해진다. */
export function MakeupCellLines({ lines }: { lines: string[] }) {
  return (
    <>
      {lines.map((line) => (
        <SkeletonText key={line} className="">
          {line}
        </SkeletonText>
      ))}
    </>
  );
}

/**
 * 처리 칸 — 실물 CandidateAction(= CommandForm `space-y-3`: 안내 `p.text-sm` → 버튼 줄). 원장 경로(쓰기 권한 ∧ 운영 중)라 늘 선다.
 * 안내 문구가 좁은 칸에서 감기는 것까지 실물과 같게 실물 문구를 깐다.
 */
export function MakeupActionCellSkeleton({ text }: { text: string }) {
  return (
    <div className="space-y-3">
      <SkeletonText className="text-sm">{text}</SkeletonText>
      <div className="flex flex-wrap items-center gap-3">
        <div className="bg-bg-soft h-(--control-h) w-24 animate-pulse rounded-lg" />
      </div>
    </div>
  );
}

/** 표 아래 쪽 이동 줄(이전 · n / m · 다음 — 실물 `flex items-center justify-between gap-3`, 본문 한 줄). */
export function MakeupPagerSkeleton() {
  return (
    <div aria-hidden className="flex items-center justify-between gap-3">
      <SkeletonLine className="w-10" />
      <SkeletonLine className="w-12" />
      <SkeletonLine className="w-10" />
    </div>
  );
}

/** 위 라벨 + 입력칸(실물 `space-y-1` · `block font-medium` 라벨(본문 한 줄) · `min-h-10 rounded-md border` 선택칸). */
export function MakeupFieldSkeleton({ control = "min-h-10", label = "w-16" }: { control?: string; label?: string }) {
  return (
    <div className="space-y-1">
      <SkeletonLine className={`${label} font-medium`} />
      <div className={`border-line bg-bg-soft w-full animate-pulse rounded-md border ${control}`} />
    </div>
  );
}
