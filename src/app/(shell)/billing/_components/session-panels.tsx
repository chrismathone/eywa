import { EmbedLink } from "@/components/embed-link";
import { sessionPanelHref } from "@/features/billing/session-terms/panel-href";
import { TOOLBAR_CHIP, TOOLBAR_CHIP_OFF, TOOLBAR_CHIP_ON } from "@/components/toolbar-controls";

export function SessionPanels({ period, params, active }: {
  period: string; params: Record<string, string | undefined>; active: "confirm" | "verify";
}) {
  return <nav className="flex flex-wrap items-center gap-2 px-1" aria-label="회차 확정 화면 전환">
    {([{ key: "confirm", label: "확정·배분" }, { key: "verify", label: "청구 시수 대조" }] as const).map(({ key, label }) =>
      <EmbedLink key={key} href={sessionPanelHref(params, period, key)} aria-current={active === key ? "page" : undefined}
        className={`${TOOLBAR_CHIP} ${active === key ? TOOLBAR_CHIP_ON : TOOLBAR_CHIP_OFF}`}>{label}</EmbedLink>)}
  </nav>;
}
