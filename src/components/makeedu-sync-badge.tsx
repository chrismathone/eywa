import { getMakeeduSyncState, type MakeeduSyncDomain } from "@/features/integrations/server/makeedu-sync";
import { getCurrentUser } from "@/lib/auth/current-user";
import { canWriteTenant } from "@/lib/auth/perm-matrix";
import { MakeeduSyncNowButton } from "@/components/makeedu-sync-now-button";

function relativeKo(iso: string): string {
  const then = new Date(iso).getTime();
  const min = Math.floor((Date.now() - then) / 60000);
  if (min < 1) return "방금 전";
  if (min < 60) return `${min}분 전`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}시간 전`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}일 전`;
  return new Date(iso).toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul" });
}
function kstFull(iso: string): string {
  return new Date(iso).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", dateStyle: "medium", timeStyle: "short" });
}

/**
 * makeedu 동기화 화면 상단의 "마지막 동기화: N분 전" 배지 (서버 컴포넌트).
 * 도메인마다 동기화 주기가 달라 각 화면이 자기 도메인의 시각을 표시한다. 동기화 이력 없으면 미표시
 * (= makeedu 연동이 없는 테넌트엔 버튼도 안 뜬다).
 *
 * `integrations` 쓰기 권한(기본 master/admin/manager, 역할·권한 면에서 조정)이 있으면 배지 옆에
 * 컴팩트 '지금 동기화' 버튼을 함께 렌더 — owner 연동 면까지 안 가도 목록 화면에서 바로 동기화.
 * 권한 판정은 요청당 캐시된 getCurrentUser/getPermMatrix 재사용이라 추가 쿼리 0 (반응속도 B6).
 */
export async function MakeeduSyncBadge({ domain }: { domain: MakeeduSyncDomain }) {
  const state = await getMakeeduSyncState(domain);
  if (!state) return null;
  const user = await getCurrentUser();
  const canSync = user ? await canWriteTenant(user.systemRole, "integrations") : false;
  const failed = state.status !== "ok";
  // status='ok'인데 이슈 요약이 있는 경우 = "동기화는 됐지만 반영 못 한 게 있다"(삭제 보류·학생 미매칭 등).
  // 실패와는 다른 축이라 amber '확인 필요'로 구분해 보여준다 — 예전엔 이 값이 화면에 전혀 안 나와서
  // 유령 미수가 '정상' 배지 뒤에 숨었다(2026-07-30 적대 리뷰).
  const issue = !failed && state.issue ? state.issue : null;
  const tone = failed
    ? "text-[color:var(--danger)]"
    : issue
      ? "text-[color:var(--amber)]"
      : "text-[color:var(--text-faint)]";
  return (
    <div className="flex items-center justify-end gap-2">
      {canSync ? <MakeeduSyncNowButton /> : null}
      <span
        className={`inline-flex items-center gap-1 whitespace-nowrap text-[11px] ${issue || failed ? tone : "text-[color:var(--text-faint)]"}`}
        title={`makeedu 동기화: ${kstFull(state.syncedAt)}${state.rowCount != null ? ` · 신규 ${state.rowCount}건` : ""}${
          state.issue ? `\n확인 필요: ${state.issue}` : ""
        }`}
      >
        <span className={failed || issue ? tone : ""} aria-hidden>
          ↻
        </span>
        {failed ? "동기화 실패" : `동기화 ${relativeKo(state.syncedAt)}`}
        {issue ? <span className="font-medium">· 확인 필요</span> : null}
      </span>
    </div>
  );
}
