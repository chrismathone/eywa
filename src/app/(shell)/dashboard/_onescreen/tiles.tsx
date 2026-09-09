import type { ReactNode } from "react";
import { WindowLink } from "@/components/workspace/window-link";
import { EyIcon } from "@/components/icons/eywa-icons";
import type { TileTone } from "@/features/dashboard/onescreen/kpi";

/**
 * 한 화면 대시보드의 **타일과 패널** — 행1은 숫자 넷, 행2는 목록이다.
 *
 * 🔴 **색은 왼쪽 3px 테두리에만** 쓴다(설계서 §2) — 숫자까지 물들이면 타일 넷이 신호등이 되어
 *    정작 급한 하나가 안 보인다. 톤은 의미색 캐논 그대로(정상=초록 / 주의=앰버 / 위험=빨강 /
 *    잴 것 없음·낡음=무채색).
 * 🔴 **숫자 카운트업 애니메이션 금지**(§6) — 실시간으로 갱신되는 화면이라 떨림의 절반이 트랜지션이다.
 */

const TONE_BORDER: Record<TileTone, string> = {
  positive: "border-l-green",
  caution: "border-l-amber",
  critical: "border-l-danger",
  inert: "border-l-line-strong",
};

export function KpiTile({
  label,
  value,
  unit,
  sub,
  tone = "inert",
  href,
  title,
}: {
  label: string;
  /** 주숫자. **모르면 `null`** — 0으로 그리지 않는다(조회 실패를 사실 주장으로 바꾸지 않는다). */
  value: string | null;
  unit?: string;
  /** 보조 한 줄 — 그 숫자를 보고 무엇을 할지 정하는 데 필요한 것만. */
  sub?: ReactNode;
  tone?: TileTone;
  /** 누르면 여는 화면. 없으면 그냥 숫자 판이다(못 여는 사람에겐 넘기지 않는다 — 죽은 링크 금지). */
  href?: string;
  title?: string;
}) {
  const inner = (
    <>
      <p className="text-text-dim truncate text-xs font-medium">{label}</p>
      <p className="mt-0.5 flex items-baseline gap-1">
        <span className="text-foreground num text-[28px] leading-none font-bold">
          {value ?? "—"}
        </span>
        {value !== null && unit ? (
          <span className="text-text-dim text-xs font-medium">{unit}</span>
        ) : null}
      </p>
      <div className="text-text-dim mt-1 truncate text-xs">{sub ?? null}</div>
    </>
  );
  const cls = `bg-card shadow-card flex h-full min-w-0 flex-col justify-center rounded-2xl border-l-[3px] px-3 py-2 ${TONE_BORDER[tone]}`;
  if (!href) {
    return (
      <div className={cls} title={title}>
        {inner}
      </div>
    );
  }
  return (
    <WindowLink
      href={href}
      title={title}
      className={`${cls} hover:bg-bg-soft/40 focus-visible:outline-primary focus-visible:outline-2 focus-visible:outline-offset-2`}
    >
      {inner}
    </WindowLink>
  );
}

/**
 * 행2의 목록 칸. 🔴 **안쪽 스크롤을 만들지 않는다**(설계서 §4) — 칸이 넘치면 줄 수를 줄이고 나머지는
 * 원본 화면에 맡긴다. 한 화면 안에 스크롤 상자를 심으면 "스크롤 없이"가 말만 남는다.
 */
export function Panel({
  title,
  count,
  href,
  hrefLabel = "전체",
  children,
}: {
  title: string;
  count?: ReactNode;
  href?: string;
  hrefLabel?: string;
  children: ReactNode;
}) {
  return (
    <section className="bg-card shadow-card flex h-full min-h-0 flex-col overflow-hidden rounded-2xl">
      <header className="flex items-baseline justify-between gap-2 px-3 pt-2.5 pb-1.5">
        <div className="flex min-w-0 items-baseline gap-1.5">
          <h3 className="text-foreground truncate text-sm font-bold">{title}</h3>
          {count != null ? <span className="text-text-dim num shrink-0 text-xs">{count}</span> : null}
        </div>
        {href ? (
          <WindowLink
            href={href}
            className="text-text-dim hover:text-foreground shrink-0 rounded-md px-1 text-xs"
          >
            {hrefLabel}
            <EyIcon name="arrowRight" size={11} className="ml-0.5 inline align-[-1px]" />
          </WindowLink>
        ) : null}
      </header>
      {/* min-h-0 = 안쪽 목록이 길어도 칸이 늘어나지 않는다(늘어나면 화면에 스크롤이 생긴다). */}
      <div className="min-h-0 flex-1 overflow-hidden px-3 pb-2.5">{children}</div>
    </section>
  );
}

/**
 * 칸이 비었을 때. 🔴 **0건·조회 실패·권한 없음을 같은 말로 적지 않는다**(§8-4) — 권한 없음은 애초에
 * 칸이 안 서고, 여기서는 0건과 실패를 가른다.
 */
export function PanelEmpty({ children }: { children: ReactNode }) {
  return (
    <p className="text-text-dim flex h-full items-center justify-center text-center text-xs">
      {children}
    </p>
  );
}
