import { EmbedLink } from "@/components/embed-link";
import { EARLY_SPANS, unjudgedText, type EarlyKey } from "@/features/withdrawals/early-exit";

/**
 * **등록 후 3개월 내 퇴원** 띠 — 1·2·3개월 이내 퇴원 수(누적, `early-exit.ts`). 칸을 누르면 목록·차트·사유가 그 기간으로
 * 걸러지고, 고른 칸을 다시 누르면 푼다(툴바 '등록 후' 필터와 같은 주소 `early=`).
 * 원장 2026-10-15 *"등록일 기준으로 3개월 이내에 퇴원한 학생들을 추적 … 1개월, 2개월, 3개월을 기간으로 두고"*.
 * 🔑 띠는 자기 축(등록 후)만 빼고 나머지 필터를 따른다(다른 카드와 같은 패싯) — 고른 칸에 갇혀 나머지 두 칸이 0이 되지 않게.
 */
export function EarlyExitBand({
  counts,
  judged,
  unjudged,
  active,
  hrefs,
  scope,
}: {
  counts: Record<EarlyKey, number>;
  /** 며칠 만인지 판정한 퇴원 수 — 비율의 분모. */
  judged: number;
  /** 등록일을 알 수 없어(비었거나 퇴원일보다 늦음 · 시스템 정리) 판정하지 못한 퇴원 수. */
  unjudged: number;
  active: EarlyKey | null;
  /** 칸마다 누르면 갈 주소(고른 칸은 해제 주소). */
  hrefs: Record<EarlyKey, string>;
  /** 기간 · 범위 문구. */
  scope: string;
}) {
  return (
    <section aria-label="등록 후 3개월 내 퇴원" className="bg-card shadow-card rounded-2xl px-5 py-4 compact-chrome:px-4 compact-chrome:py-3">
      <header className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 className="text-foreground text-base font-bold">등록 후 3개월 내 퇴원</h2>
        <p className="text-text-faint text-xs">
          퇴원 {judged}명 기준 · {scope} · 등록일부터 30·60·90일
          {unjudged ? ` · ${unjudgedText(unjudged)}` : ""}
        </p>
      </header>
      <ul className="mt-3 grid grid-cols-3 gap-2">
        {EARLY_SPANS.map((span) => {
          const on = active === span.key;
          const count = counts[span.key];
          return (
            <li key={span.key} className="min-w-0">
              <EmbedLink
                href={hrefs[span.key]}
                scroll={false}
                aria-current={on ? "true" : undefined}
                aria-label={`등록 후 ${span.label} 퇴원 ${count}명${on ? " · 필터 해제" : " · 목록 거르기"}`}
                className={`block rounded-lg px-3 py-2.5 transition ${
                  on ? "bg-rose-soft ring-rose ring-1 ring-inset" : "bg-bg-soft hover:ring-line-strong hover:ring-1 hover:ring-inset"
                }`}
              >
                <span className="text-text-dim block truncate text-sm font-medium">{span.label}</span>
                <span className="mt-1 flex items-baseline gap-1">
                  <span className="num text-foreground text-2xl leading-none font-bold">{count}</span>
                  <span className="text-text-dim text-sm">명</span>
                  {judged ? (
                    <span className="text-text-faint num ml-auto text-xs">{Math.round((count / judged) * 100)}%</span>
                  ) : null}
                </span>
              </EmbedLink>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
