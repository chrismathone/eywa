import type { ReactNode } from "react";
import { WindowLink } from "@/components/workspace/window-link";
import { EyIcon } from "@/components/icons/eywa-icons";
import type { TileTone } from "@/features/dashboard/onescreen/kpi";
import { SKINS, type SkinClasses } from "./skin";

/**
 * 한 화면 대시보드의 **타일과 패널** — 행1은 숫자 넷, 행2는 띠, 행3은 목록이다.
 *
 * 🔴 **색은 의미만 나른다**(설계서 §2) — 숫자까지 물들이면 타일 넷이 신호등이 되어 정작 급한 하나가
 *    안 보인다. 톤은 의미색 캐논 그대로(정상=초록 / 주의=앰버 / 위험=빨강 / 잴 것 없음·낡음=무채색).
 * 🔴 **숫자 카운트업 애니메이션 금지**(§6) — 실시간으로 갱신되는 화면이라 떨림의 절반이 트랜지션이다.
 * ⚠️ `sk`(껍데기)는 [`skin.ts`](./skin)에서 오는 **클래스 묶음 하나**다 — 두 안을 비교하는 동안만
 *    존재하고, 한쪽을 지울 땐 이 prop과 그 파일만 걷어내면 된다.
 */

export function KpiTile({
  label,
  shortLabel,
  value,
  unit,
  sub,
  tone = "inert",
  href,
  title,
  sk = SKINS.a,
}: {
  label: string;
  /** 밀도안에서 쓰는 짧은 이름(없으면 `label`). */
  shortLabel?: string;
  /** 주숫자. **모르면 `null`** — 0으로 그리지 않는다(조회 실패를 사실 주장으로 바꾸지 않는다). */
  value: string | null;
  unit?: string;
  /** 보조 한 줄 — 그 숫자를 보고 무엇을 할지 정하는 데 필요한 것만. */
  sub?: ReactNode;
  tone?: TileTone;
  /** 누르면 여는 화면. 없으면 그냥 숫자 판이다(못 여는 사람에겐 넘기지 않는다 — 죽은 링크 금지). */
  href?: string;
  title?: string;
  sk?: SkinClasses;
}) {
  const name = sk.shortLabels ? (shortLabel ?? label) : label;
  const numbers = (
    <>
      <p className="flex items-baseline gap-1">
        {/* 🔴 임의 픽셀 값이 아니라 **타입 스케일 토큰**이다 — 글자 크기가 앱 전역에서 한 번 더 오르면
            이 숫자도 함께 따라와야 한다.
            ⚠️ 가드(`control-scale`)는 **주석까지 훑는다** — 예시로라도 임의 픽셀 표기를 적지 말 것. */}
        <span className={`text-foreground num leading-none font-bold ${sk.kpiValue}`}>{value ?? "—"}</span>
        {value !== null && unit ? (
          <span className="text-text-dim text-xs font-medium">{unit}</span>
        ) : null}
      </p>
      <div className="text-text-dim mt-0.5 truncate text-xs">{sub ?? null}</div>
    </>
  );

  // 밀도안 = 머리에 옅은 띠(라벨) + 아래에 큰 숫자. 의미색은 그 띠의 위 테두리로 남는다.
  const inner = sk.kpiHead ? (
    <>
      <p
        className={`truncate px-2 py-0.5 text-xs font-bold ${sk.kpiHead} ${sk.kpiAccent[tone]} text-ink`}
      >
        {name}
      </p>
      <div className={`flex min-w-0 flex-1 flex-col justify-center ${sk.kpiPad}`}>{numbers}</div>
    </>
  ) : (
    <div className={`flex min-w-0 flex-1 flex-col justify-center ${sk.kpiPad} ${sk.kpiAccent[tone]}`}>
      <p className="text-text-dim truncate text-xs font-medium">{name}</p>
      <div className="mt-0.5">{numbers}</div>
    </div>
  );

  const cls = `${sk.card} shadow-card flex h-full min-w-0 flex-col overflow-hidden`;
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
 * 행3의 목록 칸. 🔴 **안쪽 스크롤을 만들지 않는다**(설계서 §4) — 칸이 넘치면 줄 수를 줄이고 나머지는
 * 원본 화면에 맡긴다. 한 화면 안에 스크롤 상자를 심으면 "스크롤 없이"가 말만 남는다.
 */
export function Panel({
  title,
  count,
  href,
  hrefLabel = "전체",
  sk = SKINS.a,
  children,
}: {
  title: string;
  count?: ReactNode;
  href?: string;
  hrefLabel?: string;
  sk?: SkinClasses;
  children: ReactNode;
}) {
  return (
    <section className={`${sk.card} shadow-card flex h-full min-h-0 flex-col overflow-hidden`}>
      <header className={`flex items-baseline justify-between gap-2 pt-2 pb-1 ${sk.panelPad}`}>
        <div className="flex min-w-0 items-baseline gap-1.5">
          <h3 className={`text-foreground truncate font-bold ${sk.panelTitle}`}>{title}</h3>
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
      <div className={`min-h-0 flex-1 overflow-hidden pb-2 ${sk.panelPad}`}>{children}</div>
    </section>
  );
}

/**
 * 행2(신규생·위험 띠)의 얇은 칸 — `Panel`보다 머리가 한 단 작다.
 *
 * 🔴 이 행의 높이는 **본문(1fr)에서 그대로 빠진다** — 그래서 머리를 KPI 타일과 같은 크기로 쓰고
 *    (`text-xs`) 건수·잘린 나머지는 제목 옆 한 줄에 붙인다(따로 줄을 만들면 칸이 넘쳐 잘린다).
 */
export function StripPanel({
  title,
  note,
  href,
  sk = SKINS.a,
  children,
}: {
  title: string;
  /** 제목 옆 한 줄 사실 — `대상 12명` · `외 4건`. */
  note?: ReactNode;
  /** 누르면 여는 화면. 못 여는 사람에겐 넘기지 않는다(죽은 링크 금지). */
  href?: string;
  sk?: SkinClasses;
  children: ReactNode;
}) {
  const head = (
    <div className="flex min-w-0 items-baseline gap-1.5">
      <h3 className="text-foreground shrink-0 text-xs font-bold">{title}</h3>
      {note != null ? <span className="text-text-dim min-w-0 truncate text-xs">{note}</span> : null}
    </div>
  );
  return (
    <section
      className={`${sk.card} shadow-card flex h-full min-h-0 flex-col overflow-hidden py-1.5 ${sk.panelPad}`}
    >
      {href ? (
        <WindowLink href={href} className="hover:text-primary -mx-1 min-w-0 rounded-md px-1">
          {head}
        </WindowLink>
      ) : (
        head
      )}
      <div className="mt-1 min-h-0 flex-1 overflow-hidden">{children}</div>
    </section>
  );
}

/**
 * 행2의 숫자 알약 — `사전 콜 3` · `퇴원위험 4명`.
 * 🔴 **모르면 `null`** — 0으로 그리지 않는다(조회 실패·미적용을 "할 일 없음"으로 위장하지 않는다).
 */
export function StatChip({
  label,
  value,
  unit,
  tone = "inert",
  title,
  href,
}: {
  label: string;
  value: string | null;
  unit?: string;
  tone?: TileTone;
  title?: string;
  href?: string;
}) {
  const body = (
    <>
      <span className="truncate">{label}</span>
      <span className="num font-bold">{value ?? "—"}</span>
      {value !== null && unit ? <span>{unit}</span> : null}
    </>
  );
  const cls = `inline-flex min-w-0 shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-xs leading-tight ${CHIP_TONE[tone]}`;
  if (!href) {
    return (
      <span title={title} className={cls}>
        {body}
      </span>
    );
  }
  return (
    <WindowLink href={href} title={title} className={`${cls} hover:ring-line-strong hover:ring-1`}>
      {body}
    </WindowLink>
  );
}

/** 🔴 색은 **뜻**만 나른다(의미색 캐논) — 지연=위험 / 확인 필요=주의 / 지금 할 것 없음·모름=무채색. */
const CHIP_TONE: Record<TileTone, string> = {
  positive: "bg-green-soft text-green",
  caution: "bg-amber-soft text-amber",
  critical: "bg-danger-soft text-danger",
  inert: "bg-bg-soft text-text-dim",
};

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
