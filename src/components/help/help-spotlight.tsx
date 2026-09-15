import type { Box } from "@/features/help/overlay-layout";
import s from "./help-overlay.module.css";

export function HelpSpotlight({ hole }: { hole: Box }) {
  return (
    <div
      aria-hidden
      className={`${s.dim} pointer-events-none absolute rounded-lg`}
      style={{
        left: hole.x,
        top: hole.y,
        width: hole.w,
        height: hole.h,
        boxShadow: "0 0 0 9999px rgb(18 18 18 / 0.40)",
      }}
    />
  );
}
