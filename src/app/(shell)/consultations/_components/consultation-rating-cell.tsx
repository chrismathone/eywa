import { tipProps } from "@/components/hover-tip/tip";
import { consultationRatingTip, type ConsultationRating } from "@/features/consultation-rating/rating";
import { formatPoints } from "@/features/report-admin/report-rating";

/**
 * 원생상담 목록 '상담 평점' 칸(참고용) — `3` + 마우스를 올리면 근거 카드(넓은 카드, `data-tip` 레이어). 같은 값에 `title`을 달지 않는다.
 * 🔴 `title=""` — 행 전체에 걸린 전문 툴팁(`li title`)이 이 칸 위에서 근거 카드와 겹쳐 뜨지 않게 막는다(빈 title은 조상의 툴팁을 끈다).
 * 🔴 수업보고서 평점 칸(lesson-reports/_components/rating-cell.tsx)과 달리 **주의색을 칠하지 않는다** — 상담자의 기록을 평가한 값이라 빨간·주황 숫자가
 *    직원 평가로 읽히는 것을 막는다(Codex 협의 2026-11-11 · 결정 로그 students.md). 점수 순위·평균 비교도 만들지 않는다.
 * 평점이 아직 없는 상담(배치가 아직 안 봤다 · 평점 대상이 아니다)은 '—'.
 */
export function ConsultationRatingCell({ rating }: { rating: ConsultationRating | null | undefined }) {
  if (!rating) return <span className="text-text-faint">—</span>;
  return (
    <span className="inline-flex items-center" title="" {...tipProps(consultationRatingTip(rating))}>
      <span className="num text-foreground font-bold">{formatPoints(rating.points)}</span>
    </span>
  );
}
