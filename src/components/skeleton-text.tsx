import type { ReactNode } from "react";

/**
 * 글자 자리 스켈레톤 — `loading.tsx`에서 글자 줄 높이를 `h-4`·`h-5`로 **손으로 적지 않는다**.
 * 🔴 이 저장소의 글자 토큰은 Tailwind 기본보다 한 단계 크다(globals.css `--text-*`): `text-xs` 14px×1.45 ≈ 20px ·
 *    `text-sm` 16px×1.5 = **24px** · `text-base` 18px×1.5 = 27px · `text-xl` 24px×1.25 = 30px. 기본값 기억으로 `text-sm` = `h-5`라
 *    적은 스켈레톤들이 줄마다 4~8px 짧아 도착 때 아래가 누적해 밀렸다(2026-11-05 스켈레톤 2차 검수 리뷰).
 *
 * - `SkeletonLine` — 한 줄 자리. 높이 = 받은 글자 클래스의 줄 높이(`1lh`), 막대는 그 안 가운데. 폭은 `w-*`로.
 * - `SkeletonText` — **실물 문구를 투명 글자로** 깐다. 줄바꿈이 실물과 같은 폭에서 일어나 여러 줄 문장·긴 라벨에 맞다.
 *   줄마다 막대가 서도록 `box-decoration-clone`. 글자 클래스는 실물과 같은 것을 준다.
 */
export function SkeletonLine({ className = "w-40 text-sm" }: { className?: string }) {
  return (
    <span aria-hidden className={`flex h-[1lh] items-center ${className}`}>
      <span className="bg-bg-soft block h-[0.75em] w-full animate-pulse rounded" />
    </span>
  );
}

export function SkeletonText({
  children,
  className = "text-sm",
  as: Tag = "p",
}: {
  children: ReactNode;
  className?: string;
  as?: "p" | "span" | "div";
}) {
  return (
    // 투명 글자는 **안쪽**에도 — 바깥에 CSS 모듈 클래스(레이어 밖)를 주면 그 글자색이 바깥 `text-transparent`를 이겨 글자가 드러난다.
    <Tag aria-hidden className={`text-transparent select-none ${className}`}>
      <span className="bg-bg-soft animate-pulse rounded text-transparent box-decoration-clone">{children}</span>
    </Tag>
  );
}
