/**
 * eywa botanical icon set — 22 stroke icons ported from design-files/eywa-shared.jsx
 *
 * 사용: `<EyIcon name="tree" size={18} />` 또는 명명 임포트 `<TreeIcon />`.
 * 모든 아이콘은 viewBox 24×24, currentColor, stroke 1.6, round cap/join.
 */
import type { SVGProps } from "react";

export type EywaIconName =
  | "tree"
  | "leaf"
  | "pulse"
  | "branch"
  | "seed"
  | "sprout"
  | "wave"
  | "falling"
  | "roots"
  | "pollen"
  | "rings"
  | "spore"
  | "search"
  | "bell"
  | "arrowUp"
  | "arrowDown"
  | "arrowRight"
  | "play"
  | "check"
  | "plus"
  | "dot"
  | "sparkle";

type Props = {
  name: EywaIconName;
  size?: number;
  strokeWidth?: number;
  className?: string;
} & Omit<SVGProps<SVGSVGElement>, "name">;

export function EyIcon({
  name,
  size = 18,
  strokeWidth = 1.6,
  className,
  ...rest
}: Props) {
  const common: SVGProps<SVGSVGElement> = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    className,
    ...rest,
  };

  switch (name) {
    case "tree":
      return (
        <svg {...common}>
          <path d="M12 22V11" />
          <path d="M12 11c0-3 -2-4 -4-5 -3 -1.5 -3 -5 0-6 3-1 4 1 4 3" />
          <path d="M12 11c0-3 2-4 4-5 3-1.5 3-5 0-6 -3-1 -4 1 -4 3" />
          <path d="M9 22h6" />
        </svg>
      );
    case "leaf":
      return (
        <svg {...common}>
          <path d="M4 20c0-8 6-14 16-16-1 11-7 16-15 16" />
          <path d="M4 20l8-8" />
        </svg>
      );
    case "pulse":
      return (
        <svg {...common}>
          <path d="M3 12h4l2-6 4 12 2-6h6" />
        </svg>
      );
    case "branch":
      return (
        <svg {...common}>
          <path d="M4 22V4" />
          <path d="M4 10c4 0 6-2 6-6" />
          <path d="M4 16c5 0 8-3 8-8" />
          <circle cx="10" cy="4" r="1.4" />
          <circle cx="12" cy="8" r="1.4" />
        </svg>
      );
    case "seed":
      return (
        <svg {...common}>
          <ellipse cx="12" cy="13" rx="6" ry="8" />
          <path d="M12 5v16" />
        </svg>
      );
    case "sprout":
      return (
        <svg {...common}>
          <path d="M12 22V12" />
          <path d="M12 12c0-4-4-6-8-6 0 6 4 9 8 9" />
          <path d="M12 14c0-3 3-5 7-5 0 5-3 8-7 8" />
        </svg>
      );
    case "wave":
      return (
        <svg {...common}>
          <path d="M3 10c3-3 5-3 8 0s5 3 8 0" />
          <path d="M3 16c3-3 5-3 8 0s5 3 8 0" />
        </svg>
      );
    case "falling":
      return (
        <svg {...common}>
          <path d="M12 3v14" />
          <path d="M7 12l5 5 5-5" />
          <path d="M5 21h14" />
        </svg>
      );
    case "roots":
      return (
        <svg {...common}>
          <path d="M12 3v8" />
          <path d="M12 11c-3 0-5 2-5 5v5" />
          <path d="M12 11c3 0 5 2 5 5v5" />
          <path d="M12 11v10" />
          <path d="M3 21h18" />
        </svg>
      );
    case "pollen":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="3" />
          <path d="M12 4v2" />
          <path d="M12 18v2" />
          <path d="M4 12h2" />
          <path d="M18 12h2" />
          <path d="M6 6l1.5 1.5" />
          <path d="M16.5 16.5L18 18" />
          <path d="M6 18l1.5-1.5" />
          <path d="M16.5 7.5L18 6" />
        </svg>
      );
    case "rings":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="3" />
          <circle cx="12" cy="12" r="6.5" />
          <circle cx="12" cy="12" r="10" />
        </svg>
      );
    case "spore":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" />
          <circle cx="12" cy="12" r="0.5" fill="currentColor" />
          <path d="M12 8.5v0.5" />
          <path d="M12 15v0.5" />
          <path d="M8.5 12h-0.5" />
          <path d="M15.5 12h0.5" />
        </svg>
      );
    case "search":
      return (
        <svg {...common}>
          <circle cx="11" cy="11" r="7" />
          <path d="M21 21l-4.5-4.5" />
        </svg>
      );
    case "bell":
      return (
        <svg {...common}>
          <path d="M6 9a6 6 0 0112 0v4l2 3H4l2-3V9z" />
          <path d="M10 19a2 2 0 004 0" />
        </svg>
      );
    case "arrowUp":
      return (
        <svg {...common}>
          <path d="M7 11l5-5 5 5" />
          <path d="M12 6v14" />
        </svg>
      );
    case "arrowDown":
      return (
        <svg {...common}>
          <path d="M7 13l5 5 5-5" />
          <path d="M12 18V4" />
        </svg>
      );
    case "arrowRight":
      return (
        <svg {...common}>
          <path d="M5 12h14" />
          <path d="M13 6l6 6-6 6" />
        </svg>
      );
    case "play":
      return (
        <svg {...common}>
          <path d="M6 4l14 8-14 8V4z" />
        </svg>
      );
    case "check":
      return (
        <svg {...common}>
          <path d="M4 12l5 5L20 6" />
        </svg>
      );
    case "plus":
      return (
        <svg {...common}>
          <path d="M12 5v14M5 12h14" />
        </svg>
      );
    case "dot":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="3" fill="currentColor" stroke="none" />
        </svg>
      );
    case "sparkle":
      return (
        <svg {...common}>
          <path d="M12 3l1.8 5.6L19 10l-5.2 1.4L12 17l-1.8-5.6L5 10l5.2-1.4L12 3z" />
        </svg>
      );
    default:
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" />
        </svg>
      );
  }
}

// ─────────────────────────── 메뉴 → 아이콘 매핑 ───────────────────────────
// 시안 EYWA_MENUS 매핑 그대로 (src/lib/navigation.ts에서 사용)
export const MENU_ICON: Record<string, EywaIconName> = {
  dashboard: "tree",
  timetable: "leaf",
  attendance: "pulse",
  classes: "branch",
  students: "seed",
  enrollment: "sprout",
  consultations: "wave",
  withdrawals: "falling",
  withdrawal: "falling",
  staff: "roots",
  billing: "pollen",
  meetings: "rings",
  help: "spore",
};
