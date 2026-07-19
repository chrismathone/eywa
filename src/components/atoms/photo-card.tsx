import Image from "next/image";

/**
 * PhotoCard — Editorial 문법 ④(실사 사진 + 좌하단 캡션 오버레이). Server Component.
 * 이미지는 public/photos/*.webp — 전 파일명의 placeholder가 먼저 커밋돼 있어(그라데이션),
 * 실사 사진 도착 시 같은 파일명으로 덮어쓰기만 하면 반영된다.
 * - alt 필수: 장식 사진이면 alt=""를 명시적으로 넘긴다.
 * - sizes 필수: next/image 반응형 최적화(예: "(max-width: 1024px) 100vw, 480px").
 * - preload는 LCP 사진(로그인·인테이크 헤더)에만 true. (Next 16: priority 폐기 → preload)
 */
export function PhotoCard({
  src,
  alt,
  caption,
  sub,
  aspect = "3/2",
  sizes,
  preload = false,
  className,
}: {
  src: string;
  alt: string;
  /** 좌하단 오버레이 타이틀. 없으면 오버레이 자체를 그리지 않는다(순수 사진). */
  caption?: string;
  sub?: string;
  /** CSS aspect-ratio 값 — "3/2" | "4/5" | "16/9" | "21/9" 등. */
  aspect?: string;
  sizes: string;
  preload?: boolean;
  className?: string;
}) {
  return (
    <figure
      className={`relative overflow-hidden rounded-3xl ${className ?? ""}`}
      style={{ aspectRatio: aspect }}
    >
      <Image src={src} alt={alt} fill sizes={sizes} preload={preload} className="object-cover" />
      {caption ? (
        <figcaption className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 via-black/30 to-transparent px-5 pt-10 pb-4 text-white">
          <p className="text-[14px] font-bold">{caption}</p>
          {sub ? <p className="mt-0.5 text-[12px] text-white/80">{sub}</p> : null}
        </figcaption>
      ) : null}
    </figure>
  );
}
