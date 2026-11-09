import { WindowLink } from "@/components/workspace/window-link";

/**
 * 퇴원보고서에 **이어진** 환불 요청서의 사정(원장 결정 2026-11-06·11-09 · 리뷰 r2 I4·I6) — 보기·수정 화면 맨 위에 늘 보인다(돈이 나가기 전에 읽게).
 * `superseded` = 원장 C.3로 대체된 옛 요청서(이 요청서로 환불하지 말 것 · 새 요청서 링크와 담당) · `lock` = 환불완료일자 잠금 사유 ·
 * `cap` = 원장 승인 줄의 낸 돈 합(상한 · 모르면 null — '상한 모름 — 원장 확인').
 */
export type LinkedRequestView = {
  superseded: { documentId: string; deskName: string | null } | null;
  lock: string | null;
  cap: number | null;
  capLines: number;
  /** 이어진 보고서가 취소된 요청이다(삭제 확인 문구를 가른다 · 리뷰 r3 R2-m9). */
  canceledOnly: boolean;
  /** 완료일자를 비울 수 없는 까닭(원장만 — 리뷰 r2 D-13 · r3 R2-m8 화면에서도 잠금) · 통과면 null. */
  clearLock: string | null;
};

const won = (n: number) => `${n.toLocaleString("ko-KR")}원`;

export function LinkedRequestBanner({ view }: { view: LinkedRequestView }) {
  return (
    <div className="space-y-2 print:hidden">
      {view.superseded ? (
        <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
          <p className="font-bold">이 요청서로 환불하지 마세요 — 새 요청서로 처리합니다.</p>
          <p className="mt-1">
            같은 청구를 담은 새 퇴원 요청의 요청서가 있어 이 요청서는 환불완료일자를 넣을 수 없습니다.{" "}
            <WindowLink href={`/billing/refunds/${view.superseded.documentId}`} className="underline">새 요청서 열기</WindowLink>
            {view.superseded.deskName ? ` · 담당 ${view.superseded.deskName}` : ""}
          </p>
        </div>
      ) : view.lock ? (
        <p role="alert" className="rounded-lg border p-4 text-sm">{view.lock}</p>
      ) : null}
      <p className="text-text-dim text-xs" aria-label="원장 승인 상한">
        {view.cap === null
          ? "원장 승인 금액(상한) 모름 — 원장 확인. 총 환불금액·결제내역은 바꿀 수 없습니다."
          : `원장 승인 ${view.capLines}건 · 낸 돈 합계(상한) ${won(view.cap)} — 총 환불금액은 이 금액을 넘을 수 없습니다(숫자와 쉼표·'원'만 씁니다 — 예: 315,000원).`}
      </p>
    </div>
  );
}
