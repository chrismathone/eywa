import Image, { type StaticImageData } from "next/image";

/**
 * EditorialPhoto — 랜딩 전용 사진 프레임.
 * 제품 UI(목업)가 주연이므로 사진은 한 톤 가라앉혀 "실제 학원의 하루"를 조용히 증명한다.
 * 정적 import(StaticImageData) → next/image가 WebP·blur 플레이스홀더·지연로딩을 자동 처리.
 */
type Props = {
  src: StaticImageData;
  alt: string;
  /** 하단 스크림 위 캡션 (mono). 없으면 스크림도 없음 */
  caption?: string;
  /** 종횡비 유틸 (기본 3:2 크롭) */
  aspect?: string;
  /** 부모 카드가 테두리를 책임질 때 true — 자체 테두리/라운드/그림자 제거 */
  bare?: boolean;
  sizes?: string;
  className?: string;
};

export function EditorialPhoto({
  src,
  alt,
  caption,
  aspect = "aspect-[3/2]",
  bare = false,
  sizes = "(min-width: 1024px) 460px, 90vw",
  className,
}: Props) {
  const frame = bare
    ? ""
    : "border-line rounded-xl border shadow-[0_24px_60px_-30px_rgba(29,29,31,0.28)]";
  return (
    <figure className={`bg-bg-soft relative overflow-hidden ${aspect} ${frame} ${className ?? ""}`}>
      <Image src={src} alt={alt} fill sizes={sizes} placeholder="blur" className="object-cover" />
      {caption ? (
        <>
          <span
            className="pointer-events-none absolute inset-0"
            style={{ background: "linear-gradient(180deg, rgba(29,29,31,0) 52%, rgba(29,29,31,0.5) 100%)" }}
            aria-hidden="true"
          />
          <figcaption className="absolute inset-x-0 bottom-0 px-4 py-3 font-mono text-[11px] font-semibold tracking-[0.06em] text-white/90">
            {caption}
          </figcaption>
        </>
      ) : null}
    </figure>
  );
}
