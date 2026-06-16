/**
 * CtaButton — 랜딩 공통 CTA (primary). nav/hero/pricing/closing의 중복 마크업을 하나로.
 * focus-visible 링 포함(키보드 접근성), hover glow, 화살표 슬라이드(ey-cta/ey-arrow).
 */
import Link from "next/link";
import { EyIcon } from "@/components/icons/eywa-icons";

type Size = "sm" | "md" | "lg";

const SIZE: Record<Size, string> = {
  sm: "rounded-lg px-4 py-2 text-[13.5px] font-semibold gap-1.5",
  md: "rounded-xl px-6 py-3.5 text-[15px] font-bold gap-2",
  lg: "rounded-xl px-7 py-4 text-[16px] font-bold gap-2",
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
      className={`ey-cta bg-primary text-primary-foreground focus-visible:outline-primary inline-flex items-center transition-shadow hover:shadow-[0_10px_24px_rgba(26,95,60,0.26)] focus-visible:outline-2 focus-visible:outline-offset-2 ${SIZE[size]} ${className ?? ""}`}
    >
      {children}
      {arrow ? <EyIcon name="arrowRight" size={ARROW[size]} className="ey-arrow" /> : null}
    </Link>
  );
}
