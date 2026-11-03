"use client";

import { EyIcon } from "@/components/icons/aywa-icons";
import { ChevronRight, ExternalLink } from "@/components/icons/aywa-icon-compat";
import { Pill } from "@/components/atoms/pill";
import { WindowLink } from "@/components/workspace/window-link";
import { KIND_ICON, TONE_BG_CLASS, TONE_INK_CLASS, type ExploreCenter, type ExploreSector, type ExploreTarget } from "../model";

type Props = {
  sector: ExploreSector;
  center: ExploreCenter;
  onNavigate: (target: ExploreTarget) => void;
  pending: boolean;
};

/**
 * 오른쪽 패널 — 도넛 안 요약을 되풀이하지 않고 **목록·상세**를 펼친다. 실제 대상은 버튼(누르면 중심 전환), 업무 화면은
 * 창 링크(`WindowLink frameTarget="window"` — 창 안에서도 탐색은 그대로 두고 그 화면을 따로 연다).
 * 상태를 가른다: 비어 있음 · 권한 없음 · 조회 실패는 각각 다른 문장이고, 실패를 0건으로 꾸미지 않는다.
 */
export function ExploreSidePanel({ sector, center, onNavigate, pending }: Props) {
  const targets = sector.targets ?? [];
  const groups = sector.groups ?? [];
  const rows = sector.rows ?? [];
  const links = sector.links ?? [];
  const total = targets.length + groups.reduce((n, g) => n + g.targets.length, 0);
  const unit = targets[0]?.kind === "student" ? "명" : "개";

  return (
    <aside className="bg-card shadow-card flex min-h-[32rem] flex-col rounded-2xl p-4 lg:p-5" aria-labelledby="explore-panel-title" aria-busy={pending || undefined}>
      <header className="flex items-center gap-2.5 pb-3">
        <span className={`flex size-10 shrink-0 items-center justify-center rounded-full ${TONE_BG_CLASS[sector.tone]}`}>
          <EyIcon name={sector.icon} size={22} className={TONE_INK_CLASS[sector.tone]} />
        </span>
        <h2 id="explore-panel-title" className="text-foreground text-xl font-bold">
          {sector.label}
        </h2>
        {total > 0 ? (
          <Pill color="primary" className="ml-auto">
            총 {total}
            {unit}
          </Pill>
        ) : null}
      </header>

      <div className="flex-1 space-y-4">
        {sector.state === "denied" ? (
          <Notice tone="amber" title="열람 권한이 없습니다" body={sector.note ?? "이 영역은 다른 메뉴 권한이 필요합니다."} />
        ) : sector.state === "error" ? (
          <Notice tone="danger" title="조회하지 못했습니다" body={sector.note ?? "잠시 뒤 다시 열어 주세요."} />
        ) : sector.state === "empty" && total === 0 && rows.length === 0 ? (
          <Notice tone="neutral" title={sector.summary} body={links.length > 0 ? "아래 화면에서 기록을 확인하거나 입력할 수 있어요." : "아직 이어진 기록이 없어요."} />
        ) : null}

        {targets.length > 0 ? <TargetList targets={targets} onNavigate={onNavigate} /> : null}
        {groups.map((g) => (
          <section key={g.label} className="space-y-2">
            <h3 className="text-text-dim text-xs font-bold">{g.label}</h3>
            <TargetList targets={g.targets} onNavigate={onNavigate} />
          </section>
        ))}

        {rows.length > 0 ? (
          <ul className="divide-line-faint divide-y">
            {rows.map((r) => (
              <li key={r.id} className="flex items-start justify-between gap-3 py-2">
                <div className="min-w-0">
                  <p className="text-foreground text-sm font-medium break-keep">{r.title}</p>
                  {r.date || r.detail ? (
                    <p className="text-text-dim text-xs break-keep">
                      {r.date ? <span className="num">{r.date}</span> : null}
                      {r.date && r.detail ? " · " : null}
                      {r.detail}
                    </p>
                  ) : null}
                </div>
                {r.right ? <span className="num text-foreground shrink-0 text-sm font-bold">{r.right}</span> : null}
              </li>
            ))}
          </ul>
        ) : null}

        {sector.note && sector.state !== "denied" && sector.state !== "error" ? <p className="text-text-dim text-xs break-keep">{sector.note}</p> : null}
      </div>

      {/* 기존 업무 화면으로 가는 문 — 작은 글자 링크 한 줄(큰 버튼 없음 · 더블클릭이 같은 링크를 지난다). */}
      {links.length > 0 || center.detailHref ? (
        <div className="border-line-faint mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 border-t pt-3 text-sm font-bold">
          {links.map((l) => (
            <WindowLink key={l.href} href={l.href} title={l.label} frameTarget="window" className="text-primary inline-flex items-center gap-0.5 hover:underline">
              {l.label}
              <ChevronRight className="size-3.5" />
            </WindowLink>
          ))}
          {center.detailHref ? (
            <WindowLink href={center.detailHref} title={center.detailLabel} frameTarget="window" className="text-foreground ml-auto inline-flex items-center gap-1 hover:underline">
              <ExternalLink className="size-3.5" />
              {center.detailLabel}
            </WindowLink>
          ) : null}
        </div>
      ) : null}
    </aside>
  );
}

function TargetList({ targets, onNavigate }: { targets: ExploreTarget[]; onNavigate: (t: ExploreTarget) => void }) {
  return (
    <ul className="space-y-2" role="list">
      {targets.map((t) => (
        <li key={`${t.kind}:${t.id}:${t.meta ?? ""}`}>
          <button
            type="button"
            onClick={() => onNavigate(t)}
            aria-label={`${t.label}${t.meta ? ` (${t.meta})` : ""} — 중심으로 보기`}
            className="group border-line bg-background hover:border-primary hover:bg-primary-softer focus-visible:ring-ring flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition focus-visible:ring-2 focus-visible:outline-none"
          >
            <span className="bg-bg-soft text-text-dim group-hover:bg-primary-soft group-hover:text-primary flex size-9 shrink-0 items-center justify-center rounded-full transition">
              <EyIcon name={KIND_ICON[t.kind]} size={18} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                <span className="text-foreground text-sm font-bold">{t.label}</span>
                {t.meta ? <span className="text-text-dim text-xs">{t.meta}</span> : null}
                {t.badge ? <Pill color={t.badge.color}>{t.badge.label}</Pill> : null}
              </span>
              {t.detail ? <span className="text-text-dim block truncate text-xs">{t.detail}</span> : null}
              {t.facts && t.facts.length > 0 ? (
                <span className="mt-1 flex flex-wrap gap-1">
                  {t.facts.map((f) => (
                    <span key={f} className="bg-bg-soft text-foreground rounded-pill px-2 py-0.5 text-xs">
                      {f}
                    </span>
                  ))}
                </span>
              ) : null}
            </span>
            <span className="text-primary shrink-0 text-xs font-bold opacity-0 transition group-hover:opacity-100 group-focus-visible:opacity-100">중심으로</span>
            <ChevronRight className="text-text-dim group-hover:text-primary size-4 shrink-0" />
          </button>
        </li>
      ))}
    </ul>
  );
}

function Notice({ tone, title, body }: { tone: "amber" | "danger" | "neutral"; title: string; body: string }) {
  const cls = tone === "amber" ? "bg-amber-soft text-amber" : tone === "danger" ? "bg-danger-soft text-danger" : "bg-bg-soft text-foreground";
  return (
    <div className={`rounded-xl px-3 py-2.5 ${cls}`} role={tone === "neutral" ? undefined : "status"}>
      <p className="text-sm font-bold break-keep">{title}</p>
      <p className="mt-0.5 text-xs break-keep">{body}</p>
    </div>
  );
}
