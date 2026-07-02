import { Pill } from "@/components/atoms/pill";
import type { MakeeduSyncRun } from "@/features/integrations/server/makeedu-sync";

/**
 * makeedu 동기화 최근 실행 이력(0070a makeedu_sync_runs) — 연동 면, MakeeduSyncCard 바로 아래.
 * 매 실행(자동/버튼/원격 요청/수동)이 언제·어떻게 끝났는지 원장이 직접 확인("동기화 왜 안 되나" 예방).
 * 서버 컴포넌트(RLS read) — 행이 없으면(로그 도입 전) 섹션 자체를 숨긴다.
 */
export function MakeeduSyncRunsList({ runs }: { runs: MakeeduSyncRun[] }) {
  if (runs.length === 0) return null;
  return (
    <section className="bg-card border-border rounded-md border p-6">
      <h3 className="text-foreground text-sm font-semibold">최근 동기화 실행</h3>
      <ul className="divide-border mt-3 divide-y">
        {runs.map((run) => (
          <li key={run.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-[13px]">
            <span className="text-foreground tabular whitespace-nowrap">
              {new Date(run.startedAt).toLocaleString("ko-KR", {
                month: "numeric",
                day: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
            <span className="text-text-dim whitespace-nowrap">{TRIGGER_LABEL[run.triggerSource] ?? run.triggerSource}</span>
            <StatusPill status={run.status} />
            <span className="text-text-faint whitespace-nowrap">
              {run.durationMs != null ? `${Math.round(run.durationMs / 1000)}초` : null}
              {newRowCount(run) > 0 ? ` · 신규 ${newRowCount(run)}건` : null}
            </span>
            {run.status === "partial" && run.failedDomains.length > 0 ? (
              <span className="text-amber text-xs">실패: {run.failedDomains.join(", ")}</span>
            ) : null}
            {run.error ? (
              <span className="text-chart-4 min-w-0 flex-1 truncate text-xs" title={run.error}>
                {run.error}
              </span>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

const TRIGGER_LABEL: Record<string, string> = {
  scheduled: "자동(스케줄)",
  button: "지금 동기화",
  relay: "지금 동기화(원격)",
  manual: "수동 실행",
};

function StatusPill({ status }: { status: string }) {
  if (status === "ok") return <Pill color="primary">완료</Pill>;
  if (status === "partial") return <Pill color="amber">일부 실패</Pill>;
  if (status === "error") return <Pill color="danger">실패</Pill>;
  if (status === "skipped") return <Pill color="neutral">건너뜀(OFF)</Pill>;
  return <Pill color="blue">실행 중</Pill>;
}

// 이번 실행에서 새로 추가된 행 합계(도메인 스냅샷의 rows 합).
function newRowCount(run: MakeeduSyncRun): number {
  if (!run.domains) return 0;
  return Object.values(run.domains).reduce((sum, d) => sum + (d.rows ?? 0), 0);
}
