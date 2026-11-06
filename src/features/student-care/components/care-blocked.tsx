import type { CareFailure } from "../server/errors";

/**
 * 약속 화면을 열 수 없을 때 — 까닭마다 다른 안내(권한 · 준비 안 됨 · 조회 실패). 오류 경계로 보내면 운영 빌드에서 문장이 사라져
 * "불러오지 못했습니다" 하나로 뭉개진다. 문장은 우리 도메인 문구만(`CareAccessError.message`) — DB 원문은 싣지 않는다.
 */
export function CareBlocked({ reason, message }: { reason: CareFailure; message: string }) {
  const lead = reason === "denied" ? "이 약속을 볼 권한이 없습니다." : reason === "unavailable" ? "약속·인계 기능이 아직 준비되지 않았습니다." : "약속 정보를 불러오지 못했습니다.";
  return (
    <div className="border-line flex flex-col gap-1 rounded-2xl border p-4 text-sm" role="status">
      <p className="font-semibold">{lead}</p>
      {message && message !== lead ? <p className="text-text-dim">{message}</p> : null}
    </div>
  );
}
