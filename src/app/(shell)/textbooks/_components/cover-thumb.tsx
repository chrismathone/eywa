"use client";

/**
 * 교재 표지 썸네일 — 목록에서 "사진 + 교재이름"으로 바로 알아보게(원장 2026-09-16).
 *
 * 🔴 **폭을 고정한다**([[#99]]) — `aspect-ratio`에 높이만 주면 폭이 `높이 × 비율`로 되계산돼 제 열을
 *    넘고, `relative`가 붙어 있으면 옆 칸 위에 칠해진다(출석부 사진이 목록을 253px 가렸던 그 함정).
 * 🔴 `next/image`를 쓰지 않는다 — 표지 주소는 **매번 새로 서명되는 Storage URL**이라 최적화 캐시 키가
 *    계속 바뀌고, 도메인 allowlist(remotePatterns)도 따로 걸어야 한다. 48px 썸네일엔 값이 없다.
 */
export function CoverThumb({ src, alt, size = "sm" }: { src: string | null; alt: string; size?: "sm" | "lg" }) {
  const box = size === "lg" ? "h-28 w-21" : "h-12 w-9";
  if (!src) {
    return (
      <span
        className={`bg-bg-soft border-line-faint text-text-faint inline-flex ${box} shrink-0 items-center justify-center rounded border text-xs`}
        aria-hidden
      >
        사진
      </span>
    );
  }
  // eslint-disable-next-line @next/next/no-img-element -- 서명 URL(수명 2h)이라 next/image 캐시 키가 매번 바뀐다.
  return <img src={src} alt={alt} className={`${box} border-line-faint shrink-0 rounded border object-cover`} />;
}
