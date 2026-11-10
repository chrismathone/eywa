import { requireAccess } from "@/lib/auth/require-access";
import { loadJourney } from "@/features/enrollment/journey/server";
import { JourneyWorkspace } from "@/features/enrollment/journey/workspace";

export const metadata = { title: "방문·등록 점검 — 에이와" };

/** 방문·등록 점검 — 전화·방문·등록 확인 기록(s2_0062)과 보완 대상 상담. 상담 열람 범위는 사용자 권한(RLS)으로 읽는다. */
export default async function Page({ searchParams }: { searchParams: Promise<{ year?: string }> }) {
  await requireAccess("enrollment");
  const p = await searchParams;
  return <JourneyWorkspace data={await loadJourney(undefined, Number(p.year))} />;
}
