import { Suspense } from "react";
import { LiveSectionView } from "./live-section-view";
import { CommunicationConnections, LearningConnections } from "./learning-connections";
import type { LiveSection } from "@/features/students/ontology/live-contract";
import { getLiveContext } from "../server/live-context";
import { liveReadersFor, readLiveSection } from "../server/live-query";
import { getTenantSettings } from "@/features/owner/server/queries";

async function Section({ pending }: { pending: Promise<LiveSection> }) {
  return <LiveSectionView section={await pending} />;
}
export function ConnectionSkeleton({ label = "현재 연결" }: { label?: string }) {
  return <div role="status" className="min-h-40 animate-pulse rounded-xl border border-line bg-secondary p-5 text-sm">{label} 불러오는 중…</div>;
}
export async function CurrentConnections({ studentId }: { studentId: string }) {
  const [context, settings] = await Promise.all([getLiveContext(studentId), getTenantSettings()]);
  if (!context) return <p className="rounded-xl border border-line p-5 text-sm">현재 연결을 보려면 해당 학생의 원본 열람 권한이 필요합니다.</p>;
  const readers = liveReadersFor(settings.modules.disabled);
  return <section className="space-y-3" aria-labelledby="current-connections-title">
    <div className="flex flex-wrap items-end justify-between gap-2"><div><h2 id="current-connections-title" className="font-semibold">현재 수강과 최근 기록</h2>
      <p className="mt-1 text-xs">지금 확인한 자료로, 월별 로열티와는 기준 시점이 다릅니다.</p></div><span className="text-xs tabular-nums">{context.today} 기준</span></div>
    <div className="grid grid-cols-1 items-start gap-4 md:grid-cols-2 lg:grid-cols-3">
      {[["classes", "family"], ["consultations", "memos"], ["reservations", "makeups"]].map((keys) => keys.map((key) => readers.find((r) => r.key === key)).filter((reader) => reader !== undefined)).filter((group) => group.length > 0).map((group) => <div key={group[0]!.key} className="min-w-0 space-y-4">
        {group.map((reader) => {
          return <Suspense key={reader.key} fallback={<ConnectionSkeleton label={reader.label} />}><Section pending={readLiveSection(reader.key, context)} /></Suspense>;
        })}
      </div>)}
    </div>
    <LearningConnections key={`${studentId}:${context.checkedAt}`} studentId={studentId} />
    <CommunicationConnections key={`communication:${studentId}:${context.checkedAt}`} studentId={studentId} />
  </section>;
}
