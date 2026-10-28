import { cardLabel, type BeforeClassCard } from "../items";

const BADGE = "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap";

/** 카드 색 = 시트의 카드 이름 그대로(블루·골드·레드·옐로우) · 카드 X는 중립. */
const CARD_TONE: Record<BeforeClassCard, string> = {
  blue: "bg-blue-soft text-blue",
  gold: "bg-gold-soft text-gold",
  red: "bg-danger-soft text-danger",
  yellow: "bg-amber-soft text-amber",
  none: "bg-bg-soft text-text-dim",
};

export function CardBadge({ card }: { card: BeforeClassCard | null }) {
  if (!card) return <span className="text-text-dim text-xs">—</span>;
  return <span className={`${BADGE} ${CARD_TONE[card]}`}>{cardLabel(card)}</span>;
}

/** 판정 — 결석(빨강) · 보충 필요(미흡 3개 이상, 주황) · 그 밖은 양호(파랑). 시트 조건부 서식과 같은 색 뜻. */
export function VerdictBadge({ absent, supplement }: { absent: boolean; supplement: boolean }) {
  if (absent) return <span className={`${BADGE} bg-danger-soft text-danger`}>결석</span>;
  if (supplement) return <span className={`${BADGE} bg-amber-soft text-amber`}>보충 필요</span>;
  return <span className={`${BADGE} bg-blue-soft text-blue`}>양호</span>;
}
