import { Pill } from "@/components/atoms/pill";
import { Pagination } from "@/components/pagination";
import type { MakeeduSyncRun } from "@/features/integrations/server/makeedu-sync";

/**
 * makeedu 동기화 실행 이력(0070a makeedu_sync_runs) — 연동 면, MakeeduSyncCard 바로 아래.
 * 매 실행(자동/버튼/원격 요청/수동)이 언제·어떻게 끝났는지 원장이 직접 확인("동기화 왜 안 되나" 예방).
 * 서버 컴포넌트(RLS read) — 행이 없으면(로그 도입 전) 섹션 자체를 숨긴다. 로그는 쌓이므로 페이지네이션.
 * ⚠️ 시각은 **KST 고정**(timeZone: Asia/Seoul, 24h) — 서버(Vercel=UTC) 렌더라 안 박으면 UTC로 나온다.
 */
export function MakeeduSyncRunsList({
  runs,
  page,
  totalPages,
  total,
  hrefForPage,
}: {
  runs: MakeeduSyncRun[];
  page: number;
  totalPages: number;
  total: number;
  hrefForPage: (page: number) => string;
}) {
  if (total === 0) return null;
  return (
    <section className="bg-card border-border rounded-md border p-6">
      <h3 className="text-foreground text-sm font-semibold">최근 동기화 실행</h3>
      <ul className="divide-border mt-3 divide-y">
        {runs.map((run) => {
          const affected = affectedRowCount(run);
          const breakdown = affectedBreakdown(run);
          // "누가 실행했는지"(0076a): 수동 실행자 이름 → 그 이름 / 자동(스케줄) → [자동 실행] / 구데이터·CLI → 트리거 라벨.
          const actor = run.triggeredByName
            ? run.triggeredByName
            : run.triggerSource === "scheduled"
              ? "[자동 실행]"
              : (TRIGGER_LABEL[run.triggerSource] ?? run.triggerSource);
          return (
            <li key={run.id} className="py-2 text-[13px]">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="text-foreground tabular whitespace-nowrap">
                  {new Date(run.startedAt).toLocaleString("ko-KR", {
                    timeZone: "Asia/Seoul",
                    month: "numeric",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                    hour12: false,
                  })}
                </span>
                <span className="text-text-dim whitespace-nowrap">{actor}</span>
                <StatusPill status={run.status} />
                <span className="text-text-faint whitespace-nowrap">
                  {run.durationMs != null ? `${Math.round(run.durationMs / 1000)}초` : null}
                  {affected > 0 ? ` · 반영 ${affected}건` : null}
                </span>
                {run.status === "partial" && run.failedDomains.length > 0 ? (
                  <span className="text-amber text-xs">실패: {run.failedDomains.join(", ")}</span>
                ) : null}
                {run.error ? (
                  <span className="text-chart-4 min-w-0 flex-1 truncate text-xs" title={run.error}>
                    {run.error}
                  </span>
                ) : null}
              </div>
              {/* 반영 N건이 어느 영역에서 나왔는지 다음 줄에 간단히 — 도메인 스냅샷의 rows>0만. */}
              {breakdown.length > 0 ? (
                <div className="text-text-faint mt-0.5 pl-1 text-xs">
                  {breakdown.map((b) => `${b.label} ${b.rows}`).join(" · ")}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
      <Pagination page={page} totalPages={totalPages} total={total} hrefForPage={hrefForPage} />
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

// 이번 실행이 반영한 행 합계(도메인 스냅샷 rows 합 — 임포터별 신규+백필 = "반영" 건수).
function affectedRowCount(run: MakeeduSyncRun): number {
  if (!run.domains) return 0;
  return Object.values(run.domains).reduce((sum, d) => sum + (d.rows ?? 0), 0);
}

const DOMAIN_LABEL: Record<string, string> = {
  students: "학생",
  classes: "반",
  prospects: "예비상담",
  invoices: "수납",
  consultations: "재원상담",
  catalog: "교재",
  enrollments: "수강",
  textbook_checks: "교재 체크",
};

// "반영 N건"의 도메인별 내역(rows>0만) — 다음 줄에 "학생 2 · 예비상담 1"처럼.
function affectedBreakdown(run: MakeeduSyncRun): { label: string; rows: number }[] {
  if (!run.domains) return [];
  return Object.entries(run.domains)
    .filter(([, d]) => (d.rows ?? 0) > 0)
    .map(([key, d]) => ({ label: DOMAIN_LABEL[key] ?? key, rows: d.rows ?? 0 }));
}
