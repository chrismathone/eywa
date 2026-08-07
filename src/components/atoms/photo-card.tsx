import Image from "next/image";

/**
 * PhotoCard — Editorial 문법 ④(실사 사진 + 좌하단 캡션 오버레이). Server Component.
 * 이미지는 public/photos/*.webp — 전 파일명의 placeholder가 먼저 커밋돼 있어(그라데이션),
 * 실사 사진 도착 시 같은 파일명으로 덮어쓰기만 하면 반영된다.
 * - alt 필수: 장식 사진이면 alt=""를 명시적으로 넘긴다.
 * - sizes 필수: next/image 반응형 최적화(예: "(max-width: 1024px) 100vw, 480px").
 * - preload는 LCP 사진(로그인·인테이크 헤더)에만 true. (Next 16: priority 폐기 → preload)
 *
 * 🔴 **`w-full`은 장식이 아니라 오버플로 방어다** — `aspect-ratio`가 붙은 박스는 grid/flex 아이템일 때
 * `justify-self:normal`이 stretch가 아니라 **start**로 동작한다(비율을 지키려는 규격 규칙). 그래서 높이가
 * 정해지면(예 호출부의 `h-full` + `items-stretch`) 폭을 **높이×비율로 되계산**해 제 열을 넘어 옆 칸을 덮는다.
 * 2026-08-07 실측(출석부 반 미선택 허브, 1536px 창): 열 폭 658px인데 figure가 **926px**로 그려져 우측
 * '바로 열기' 목록을 **253px 가렸다**. 게다가 폭이 **창 높이**에서 나오므로 창을 넓혀도 안 줄어든다
 * (원장 제보: *"창 크기에 따라 변하지 않고?"* — 맞다, 폭은 높이만 따라갔다).
 * `w-full`로 폭을 확정하면 두 축이 모두 정해져 `aspect-ratio`는 폴백이 되고(높이를 안 주는 호출부에선
 * 그대로 비율이 산다), 사진은 언제나 제 칸 안에 머문다. 크롭은 `object-cover`가 이미 담당한다.
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
      className={`relative w-full overflow-hidden rounded-3xl ${className ?? ""}`}
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
