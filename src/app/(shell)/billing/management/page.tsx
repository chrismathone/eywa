import { redirect } from "next/navigation";

/** 옛 주소 — 경영 분석은 대시보드 아래로 옮겼다(시안). */
export default async function Page({ searchParams }: { searchParams: Promise<{ month?: string; embed?: string }> }) {
  const p = await searchParams, q = new URLSearchParams();
  if (p.month) q.set("month", p.month);
  if (p.embed === "1") q.set("embed", "1");
  redirect(`/dashboard/management${q.size ? `?${q}` : ""}`);
}
