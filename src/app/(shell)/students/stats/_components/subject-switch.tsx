import { EmbedLink } from "@/components/embed-link";
import { TOOLBAR_SEG_BOX, TOOLBAR_SEG_ITEM, TOOLBAR_SEG_OFF, TOOLBAR_SEG_ON_PRIMARY } from "@/components/toolbar-controls";

/**
 * 과목 관리자 과목 전환 — 운영실처럼 한 번에 한 과목 묶음(`?subject=`). 담당 과목이 여럿일 때만 선다.
 * 같은 창 안 이동이라 `EmbedLink`(창이면 embed=1을 싣는다 — [[#133]]). 보기(`?view=`)는 들고 간다.
 */
export function SubjectSwitch({
  choices,
  active,
  view,
  keep = {},
}: {
  choices: { key: string; label: string }[];
  active: string;
  view?: string;
  /** 함께 들고 갈 쿼리(첫 수업 기간 `fc…` — 과목을 바꿔도 같은 기간을 비교한다). */
  keep?: Record<string, string | undefined>;
}) {
  const extra = Object.entries(keep)
    .filter(([, v]) => !!v)
    .map(([k, v]) => `&${encodeURIComponent(k)}=${encodeURIComponent(v!)}`)
    .join("");
  return (
    <div role="group" aria-label="볼 과목" className={TOOLBAR_SEG_BOX}>
      {choices.map((c) => (
        <EmbedLink
          key={c.key}
          href={`/students/stats?subject=${encodeURIComponent(c.key)}${view ? `&view=${encodeURIComponent(view)}` : ""}${extra}`}
          aria-current={c.key === active ? "page" : undefined}
          className={`${TOOLBAR_SEG_ITEM} ${c.key === active ? TOOLBAR_SEG_ON_PRIMARY : TOOLBAR_SEG_OFF}`}
        >
          {c.label}
        </EmbedLink>
      ))}
    </div>
  );
}
