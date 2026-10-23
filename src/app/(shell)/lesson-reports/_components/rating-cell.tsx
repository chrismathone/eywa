import { tipProps } from "@/components/hover-tip/tip";
import { TONE_SOFT, TONE_TEXT } from "@/lib/design/semantic-color";
import {
  CLAIM_LABEL,
  claimNeedsAttention,
  formatPoints,
  isLowRating,
  ratingTipCard,
  type ReportRating,
} from "@/features/report-admin/report-rating";

/**
 * 보고서 목록 '평점' 칸(참고용, 0450a) — `3.4` + 마우스를 올리면 근거 카드(넓은 카드, `data-tip` 레이어).
 * 색은 절제한다: 3.0 미만만 주의(caution) 글자색, 검증에서 클레임 위험으로 남은 건만 숫자 옆 `!` 알약
 * (확정 = critical · 확인 필요 = caution). 풀렸거나 1차뿐인 클레임은 카드에만 적는다.
 * 🔴 같은 값에 `title`을 달지 않는다(카드 옆에 회색 상자가 겹친다 — 디자인 규약).
 */
export function RatingCell({ rating }: { rating: ReportRating | null | undefined }) {
  if (!rating) return <span className="text-text-faint">—</span>;
  const low = isLowRating(rating.points);
  const claim = rating.claim;
  return (
    <span className="inline-flex items-center gap-1" {...tipProps(ratingTipCard(rating))}>
      <span className={`tabular-nums font-bold ${low ? TONE_TEXT.caution : "text-foreground"}`}>
        {formatPoints(rating.points)}
      </span>
      {claimNeedsAttention(claim) ? (
        <span
          role="img"
          aria-label={`클레임 위험 ${CLAIM_LABEL[claim]}`}
          className={`${TONE_SOFT[claim === "confirmed" ? "critical" : "caution"]} rounded-full px-1.5 text-xs leading-4 font-bold`}
        >
          !
        </span>
      ) : null}
    </span>
  );
}
