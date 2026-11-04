import { BEFORE_CLASS_CARDS, cardLabel, type BeforeClassCard } from "../items";

const BADGE = "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap";

/**
 * 카드 색 = 받은 카드 그 색(원장 2026-10-28 *"받은 카드 색상으로"*) — 진한 바탕. 월별 현황 칸의 옅은 판정 색(파랑·주황·빨강)
 * 위에서도 카드가 따로 읽혀야 해서 옅은 톤을 쓰지 않는다. 카드 X는 중립(테두리).
 */
const CARD_TONE: Record<BeforeClassCard, string> = {
  blue: "bg-blue text-white",
  gold: "bg-gold-bright text-primary-deep",
  red: "bg-danger text-white",
  yellow: "bg-report-accent text-primary-deep",
  none: "bg-card text-text-dim border-line border",
};

export function CardBadge({ card, count }: { card: BeforeClassCard | null; count?: number }) {
  if (!card) return <span className="text-text-dim text-xs">—</span>;
  return (
    <span className={`${BADGE} ${CARD_TONE[card]}`}>
      {cardLabel(card)}
      {count !== undefined ? <span className="ml-1 font-bold tabular-nums">{count}</span> : null}
    </span>
  );
}

/** 받은 카드 묶음 — 0개인 종류는 뺀다. 하나도 없으면 '—'. 학생 통계의 합계·기간 칸이 같이 쓴다. */
export function CardCounts({ counts }: { counts: Record<BeforeClassCard, number> }) {
  const got = BEFORE_CLASS_CARDS.filter((c) => counts[c.key] > 0);
  if (got.length === 0) return <span className="text-text-dim text-xs">—</span>;
  return (
    <span className="inline-flex flex-wrap gap-1">
      {got.map((c) => <CardBadge key={c.key} card={c.key} count={counts[c.key]} />)}
    </span>
  );
}

/** 판정 — 결석(빨강) · 보충 필요(미흡 3개 이상, 주황) · 그 밖은 양호(파랑). 시트 조건부 서식과 같은 색 뜻. */
export function VerdictBadge({ absent, supplement, excused = false }: { absent: boolean; supplement: boolean; excused?: boolean }) {
  if (absent) return <span className={`${BADGE} bg-danger-soft text-danger`}>결석</span>;
  if (excused) return <span className={`${BADGE} bg-bg-soft text-text-dim`}>체크 제외</span>;
  if (supplement) return <span className={`${BADGE} bg-amber-soft text-amber`}>보충 필요</span>;
  return <span className={`${BADGE} bg-blue-soft text-blue`}>양호</span>;
}
