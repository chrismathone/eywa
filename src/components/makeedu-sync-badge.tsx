import { getMakeeduSyncState, type MakeeduSyncDomain } from "@/features/integrations/server/makeedu-sync";

function relativeKo(iso: string): string {
  const then = new Date(iso).getTime();
  const min = Math.floor((Date.now() - then) / 60000);
  if (min < 1) return "방금 전";
  if (min < 60) return `${min}분 전`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}시간 전`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}일 전`;
  return new Date(iso).toLocaleDateString("ko-KR");
}
function kstFull(iso: string): string {
  return new Date(iso).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", dateStyle: "medium", timeStyle: "short" });
}

/**
 * makeedu 동기화 화면 상단의 "마지막 동기화: N분 전" 배지 (서버 컴포넌트).
 * 도메인마다 동기화 주기가 달라 각 화면이 자기 도메인의 시각을 표시한다. 동기화 이력 없으면 미표시.
 */
export async function MakeeduSyncBadge({ domain }: { domain: MakeeduSyncDomain }) {
  const state = await getMakeeduSyncState(domain);
  if (!state) return null;
  const failed = state.status !== "ok";
  return (
    <div className="flex justify-end">
      <span
        className="inline-flex items-center gap-1 whitespace-nowrap text-[11px] text-[color:var(--text-faint)]"
        title={`makeedu 동기화: ${kstFull(state.syncedAt)}${state.rowCount != null ? ` · ${state.rowCount}건` : ""}`}
      >
        <span className={failed ? "text-[color:var(--danger)]" : ""} aria-hidden>
          ↻
        </span>
        {failed ? "동기화 실패" : `동기화 ${relativeKo(state.syncedAt)}`}
      </span>
    </div>
  );
}
