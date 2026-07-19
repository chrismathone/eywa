/**
 * CtaButton — 랜딩 공통 CTA (primary). nav/hero/pricing/closing의 중복 마크업을 하나로.
 * focus-visible 링 포함(키보드 접근성), hover 크리스프 그린 섀도, 화살표 슬라이드(ey-cta/ey-arrow).
 * 필 라운드 = 마케팅 전용 톤(앱 각진 라운드와 별개).
 */
import Link from "next/link";
import { EyIcon } from "@/components/icons/eywa-icons";

type Size = "sm" | "md" | "lg";

const SIZE: Record<Size, string> = {
  sm: "px-[18px] py-2 text-[13.5px] font-bold gap-1.5",
  md: "px-6 py-3.5 text-[15px] font-bold gap-2",
  lg: "px-7 py-4 text-[16px] font-bold gap-2",
};
const ARROW: Record<Size, number> = { sm: 14, md: 16, lg: 17 };

type Props = {
  href: string;
  children: React.ReactNode;
  size?: Size;
  arrow?: boolean;
  className?: string;
};

export function CtaButton({ href, children, size = "md", arrow = true, className }: Props) {
  return (
    <Link
      href={href}
      className={`ey-cta bg-primary text-primary-foreground focus-visible:outline-primary inline-flex items-center rounded-full shadow-[inset_0_1px_0_rgba(255,255,255,0.16),0_1px_2px_rgba(11,16,13,0.18)] transition-[box-shadow,filter] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.16),0_14px_30px_-10px_rgba(14,124,70,0.55)] hover:brightness-[1.05] focus-visible:outline-2 focus-visible:outline-offset-2 ${SIZE[size]} ${className ?? ""}`}
    >
      {children}
      {arrow ? <EyIcon name="arrowRight" size={ARROW[size]} className="ey-arrow" /> : null}
    </Link>
  );
}
