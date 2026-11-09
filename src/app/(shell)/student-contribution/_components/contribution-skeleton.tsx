import type { ReactNode } from "react";

/**
 * 원생 충성도 화면들의 스켈레톤 부품 — 다섯 화면이 같은 머리(`ContributionHeader`)와 같은 점수 구성 상자(`ScoreBreakdown`)를 쓴다.
 * 🔴 클래스는 실물(`features/student-contribution/components/contribution-shell.tsx` · `score-breakdown.tsx`)과 같은 문자열로 옮겼다 —
 *    실물을 고치면 여기도 같이 고칠 것(가능하면 실물 파일 옆으로 옮겨 상수를 함께 쓰는 게 낫다).
 * 글자 자리는 투명 글자 막대 — 실물과 같은 글로 줄 높이·줄바꿈을 잡는다(손 치수 대신).
 */
export const TEXT_BAR = "bg-bg-soft text-transparent animate-pulse rounded";

/** 투명 글자 한 토막. */
export function Bar({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <span className={`${TEXT_BAR} ${className}`}>{children}</span>;
}

const TABS = ["원생 충성도", "학생 기록 연결", "지난 소개 확인", "배점 설정"];

/**
 * `ContributionHeader` 자리 — 제목·설명(실물과 같은 글을 넘겨 줄바꿈까지 같게) + 오른쪽 동작 + 아래 탭 줄(`border-b`, 링크 `pb-3`).
 * 탭은 설정 권한이 있으면 넷 · 없으면 둘이지만 높이는 같다 — 넷으로 그린다.
 */
export function ContributionHeaderSkeleton({ title, description, actions }: { title: string; description: string; actions?: ReactNode }) {
  return (
    <header aria-hidden className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-2">
          <h1 className="text-xl font-bold tracking-tight">
            <Bar>{title}</Bar>
          </h1>
          <p className="max-w-3xl text-sm leading-relaxed">
            <Bar>{description}</Bar>
          </p>
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
      </div>
      <div className="border-line flex gap-5 overflow-x-auto border-b">
        {TABS.map((label) => (
          <span key={label} className="shrink-0 border-b-2 border-transparent px-1 pb-3 text-sm">
            <Bar>{label}</Bar>
          </span>
        ))}
      </div>
    </header>
  );
}

/**
 * `ScoreBreakdown` 자리 — 항목 줄(이름·점수 / 막대 / 계산식) × rows + 아래 합계 줄.
 * `contained` = 목록 오른쪽 상자 안(테두리 없이 남은 높이를 채움) · 아니면 제 테두리 상자(배점 설정 오른쪽).
 * 항목 수는 0점이 아닌 지표만 서므로 데이터마다 다르다 — 학원 전체 기준 흔한 10개(지표 11개 중 승인 전 설명회 제외).
 */
export function ScoreBreakdownSkeleton({ rows = 10, contained = false }: { rows?: number; contained?: boolean }) {
  return (
    <section aria-hidden className={`@container bg-card min-w-0 p-5 ${contained ? "flex flex-1 flex-col" : "border-line rounded-xl border"}`}>
      <h3 className="font-semibold">
        <Bar>점수는 어떻게 구성되나요?</Bar>
      </h3>
      <p className="mt-1 text-xs leading-relaxed">
        <Bar>누적 실적 × 현재 배점입니다. 막대는 항목별 점수 크기를 비교하며 만점이나 상한을 뜻하지 않습니다.</Bar>
      </p>
      <ul className="mt-5 mb-5 grid gap-x-10 gap-y-4 @2xl:grid-cols-2">
        {Array.from({ length: rows }, (_, i) => (
          <li key={i}>
            <div className="flex items-center justify-between gap-3 text-sm">
              <Bar>항목 이름</Bar>
              <Bar>000점</Bar>
            </div>
            <div className="bg-bg-soft my-2 h-1.5 animate-pulse rounded-full" />
            <p className="text-xs leading-relaxed">
              <Bar>실적 00건 × 0점</Bar>
            </p>
          </li>
        ))}
      </ul>
      <div className={`border-line flex items-center justify-between border-t pt-3 text-sm ${contained ? "mt-auto" : "mt-5"}`}>
        <Bar>누적 기여도</Bar>
        <Bar>000점</Bar>
      </div>
    </section>
  );
}

/** 접힌 아래쪽 구획 자리 — 내용 길이가 데이터를 따르는 상자(근사 높이는 부르는 쪽이 `className`으로). */
export function BlockSkeleton({ className }: { className: string }) {
  return <div aria-hidden className={`border-line bg-bg-soft/40 animate-pulse rounded-xl border ${className}`} />;
}
