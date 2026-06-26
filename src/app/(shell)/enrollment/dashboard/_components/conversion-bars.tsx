"use client";

import dynamic from "next/dynamic";
import type { ConversionTrendPoint } from "@/features/enrollment/server/queries";

// recharts(~수백KB)는 차트가 보일 때만 클라에서 로드(ssr:false) — 페이지 첫 페인트 블로킹 제거.
const Impl = dynamic(() => import("./conversion-bars-impl").then((m) => m.ConversionBars), {
  ssr: false,
  loading: () => <div className="bg-bg-soft/40 h-[280px] animate-pulse rounded-lg" />,
});

export function ConversionBars(props: { data: ConversionTrendPoint[] }) {
  return <Impl {...props} />;
}
