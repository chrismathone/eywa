import { Sparkles } from "@/components/icons/aywa-icon-compat";
import { consultationRatingTip, type ConsultationRating } from "@/features/consultation-rating/rating";
import { formatPoints } from "@/features/report-admin/report-rating";

/**
 * 상담 상세의 '상담 평점(참고용)' — 목록 칸의 마우스 오버 카드(consultation-rating-cell.tsx)와 **같은 재료**(`consultationRatingTip`)를 화면에 펼친다.
 * 마우스 오버는 폰·키보드에서 닿지 않고, 상담자가 기록을 보완할 곳('기록에 없음')은 점수만큼 중요한 정보라 상세에는 늘 보이게 한다.
 * 지점 스위치(consult_rating) + 상담 쓰기 권한 + 평점 있음, 셋 다일 때만 호출부가 그린다. 순위·평균 비교는 어디에도 두지 않는다.
 */
export function ConsultationRatingPanel({ rating }: { rating: ConsultationRating }) {
  const card = consultationRatingTip(rating);
  const rows = (card.rows ?? []).filter((r): r is readonly [string, string] => Array.isArray(r) && r[1] !== "");
  return (
    <section className="bg-card border-line rounded-2xl border p-4">
      <h2 className="text-primary mb-3 flex items-center gap-1.5 text-sm font-bold">
        <Sparkles className="size-4" />
        상담 평점
        <span className="text-text-dim font-medium">참고용</span>
      </h2>
      <p className="mb-3 flex items-baseline gap-1.5">
        <span className="num text-foreground text-3xl font-bold">{formatPoints(rating.points)}</span>
        <span className="text-text-dim text-sm">/ 5</span>
      </p>
      <dl className="space-y-1.5 text-sm">
        {rows.map(([label, value]) => (
          <div key={label} className="flex gap-3">
            <dt className="text-text-dim w-20 shrink-0 font-semibold">{label}</dt>
            <dd className="text-foreground min-w-0 whitespace-pre-wrap">{value}</dd>
          </div>
        ))}
      </dl>
      <p className="text-text-faint mt-3 text-sm whitespace-pre-line">{(card.lines ?? []).filter(Boolean).join("\n")}</p>
    </section>
  );
}
