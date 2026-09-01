import { getMakeeduSyncState, type MakeeduSyncDomain } from "@/features/integrations/server/makeedu-sync";
import { EyIcon } from "@/components/icons/eywa-icons";

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
 * 🔴 옛 '지금 동기화' 버튼은 **없앴다**(원장 2026-09-01: *"지금 동기화 삭제해버려 … 필요없다"*).
 * 동기화는 담당 PC 워처가 스스로 돌고(정방향은 스케줄러, 역방향은 매주 일요일 06:00) 손으로 돌릴 일이
 * 남으면 **연동 면(/owner)의 동기화 카드**가 그 자리다 — 목록 화면마다 같은 버튼을 두면 "눌러야 하나"가
 * 된다. 여기 남는 건 "마지막 동기화 언제였나"라는 **사실 표시**뿐이다.
 * ⚠️ 되살릴 땐 이 배지가 아니라 연동 면에서.
 */
export async function MakeeduSyncBadge({ domain }: { domain: MakeeduSyncDomain }) {
  const state = await getMakeeduSyncState(domain);
  if (!state) return null;
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
      <span
        className={`inline-flex items-center gap-1 whitespace-nowrap text-[11px] ${issue || failed ? tone : "text-[color:var(--text-faint)]"}`}
        title={`makeedu 동기화: ${kstFull(state.syncedAt)}${state.rowCount != null ? ` · 신규 ${state.rowCount}건` : ""}${
          state.issue ? `\n확인 필요: ${state.issue}` : ""
        }`}
      >
        {/* 🔴 예전엔 텍스트 글리프 `↻`(U+21BB)였다 — Pretendard 서브셋에 없는 PC에서 두부(□)로
            깨졌다(원장 2026-08-05 제보). 아이콘 자리엔 항상 EyIcon을 쓴다. */}
        <EyIcon name="sync" size={11} strokeWidth={1.8} className={failed || issue ? tone : ""} />
        {failed ? "동기화 실패" : `동기화 ${relativeKo(state.syncedAt)}`}
        {issue ? <span className="font-medium">· 확인 필요</span> : null}
      </span>
    </div>
  );
}
