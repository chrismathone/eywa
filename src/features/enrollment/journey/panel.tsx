import { EmbedLink as Link } from "@/components/embed-link";
import { loadJourney } from "./server";
import { JourneyWorkspace } from "./workspace";

/** 상담 상세의 '전화·방문·등록 기록' 칸 — 그 상담의 기록만. 못 읽으면 0건으로 보이지 않고 그 사실을 밝힌다. */
export async function JourneyPanel({ id }: { id: string }) {
  let data;
  try { data = await loadJourney(id); }
  catch {
    return <section id="journey" className="rounded-2xl border border-line bg-card p-5"><h2 className="font-bold">전화·방문·등록 기록</h2>
      <p className="mt-2 text-sm">기록을 불러오지 못했습니다. <Link href="/enrollment/visits" className="underline">방문·등록 점검에서 확인</Link></p></section>;
  }
  return <JourneyWorkspace data={data} compact />;
}

/** 상담 상세가 기록을 기다리지 않게(B7) — 칸 자리만 먼저. */
export function JourneyPanelSkeleton() {
  return <section className="h-40 animate-pulse rounded-2xl border border-line bg-card" aria-label="전화·방문·등록 기록 불러오는 중" />;
}
