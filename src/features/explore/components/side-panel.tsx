"use client";

import { useRef, useState } from "react";
import { EyIcon, type AywaIconName } from "@/components/icons/aywa-icons";
import { ChevronRight } from "@/components/icons/aywa-icon-compat";
import { Pill } from "@/components/atoms/pill";
import { WindowLink } from "@/components/workspace/window-link";
import { CareExploreBlock } from "@/features/student-care/components/care-explore-block";
import { KIND_ICON, KIND_LABEL, TONE_BG_CLASS, TONE_INK_CLASS, type ExploreCarePanel, type ExploreCareChecks, type ExploreRow, type ExploreSector, type ExploreTarget } from "../model";
import { useScrollFade } from "./use-scroll-fade";
import styles from "./layout.module.css";

type Props = {
  sector: ExploreSector;
  onNavigate: (target: ExploreTarget) => void;
  pending: boolean;
};

/**
 * 오른쪽 위 '펼친 영역'(원장 2026-11-05 시안) — 칸을 꽉 채우는 카드 · 머리(그림 · 이름 · '총 N개') · 몸통만 스크롤(스크롤바 없이 페이드) ·
 * 바닥엔 영역 링크만(상세 열기는 왼쪽 기본 정보 카드 끝). 대상은 한 줄(이름 · 관계 · 설명 · 칩), 읽기 줄도 한 줄(제목 · 날짜·설명 · 오른쪽 값).
 * 상태를 가른다: 비어 있음 · 권한 없음 · 조회 실패는 각각 다른 문장이고, 실패를 0건으로 꾸미지 않는다.
 */
export function ExploreSidePanel({ sector, onNavigate, pending }: Props) {
  const bodyRef = useRef<HTMLDivElement>(null);
  useScrollFade(bodyRef);
  const targets = sector.targets ?? [];
  const groups = sector.groups ?? [];
  const rows = sector.rows ?? [];
  const links = sector.links ?? [];
  const total = targets.length + groups.reduce((n, g) => n + g.targets.length, 0);
  const unit = (targets[0] ?? groups[0]?.targets[0])?.kind === "student" ? "명" : "개";
  // 과목 조각이면 대상 줄에서 과목 이름을 되풀이하지 않는다(머리에 이미 있다 — 시안 '같은 사실은 한 자리에만').
  const omit = sector.key.startsWith("subject:") ? sector.label : null;

  return (
    <aside className={`bg-card shadow-card min-h-0 flex-1 rounded-2xl px-4 py-3.5 ${styles.card} ${pending ? "opacity-50" : ""}`} aria-labelledby="explore-panel-title" aria-busy={pending || undefined}>
      <header className="border-line-faint mb-2.5 flex items-center gap-2 border-b pb-2.5">
        <span className={`flex size-7 shrink-0 items-center justify-center rounded-full ${TONE_BG_CLASS[sector.tone]}`}>
          <EyIcon name={sector.icon} size={16} className={TONE_INK_CLASS[sector.tone]} />
        </span>
        <h2 id="explore-panel-title" className="text-foreground min-w-0 truncate text-sm font-extrabold">
          {sector.label}
        </h2>
        {total > 0 ? (
          <Pill color="primary" className="ml-auto">
            총 {total}
            {unit}
          </Pill>
        ) : null}
      </header>

      <div ref={bodyRef} className={`flex flex-col gap-3 ${styles.scrollBody}`}>
        {sector.state === "denied" ? (
          <Notice tone="amber" title="열람 권한이 없습니다" body={sector.note ?? "이 영역은 다른 메뉴 권한이 필요합니다."} />
        ) : sector.state === "error" ? (
          <Notice tone="danger" title="조회하지 못했습니다" body={sector.note ?? "잠시 뒤 다시 열어 주세요."} />
        ) : sector.state === "empty" && total === 0 && rows.length === 0 && !sector.care ? (
          <Notice tone="neutral" title={sector.summary} body={links.length > 0 ? "아래 화면에서 기록을 확인하거나 입력할 수 있어요." : "아직 이어진 기록이 없어요."} />
        ) : null}

        {sector.focus ? (
          <button
            type="button"
            onClick={() => onNavigate(sector.focus!)}
            className="bg-primary text-primary-foreground hover:bg-primary-deep focus-visible:ring-ring flex h-9 w-full shrink-0 items-center justify-center gap-1.5 rounded-xl px-3 text-sm font-extrabold transition focus-visible:ring-2 focus-visible:outline-none"
          >
            이 {KIND_LABEL[sector.focus.kind]}을 중심으로 보기
            <ChevronRight className="size-4" />
          </button>
        ) : null}
        {targets.length > 0 ? <TargetList targets={targets} omit={omit} onNavigate={onNavigate} /> : null}
        {groups.map((g) => (
          <section key={g.label}>
            <p className="text-foreground mb-1.5 text-xs font-extrabold opacity-85">{g.label}</p>
            <TargetList targets={g.targets} omit={omit} onNavigate={onNavigate} />
          </section>
        ))}

        {sector.care ? <CareBlocks care={sector.care} /> : null}

        {rows.length > 0 ? <Rows rows={rows} /> : null}

        {sector.note && sector.state !== "denied" && sector.state !== "error" ? <p className="text-text-dim text-xs break-keep">{sector.note}</p> : null}
      </div>

      {/* 영역 링크만(원장 2026-11-05 — 상세 열기는 왼쪽 기본 정보 카드 끝 한 곳). 더블클릭이 같은 링크를 지난다. */}
      {links.length > 0 ? (
        <div className="border-line-faint mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 border-t pt-1 text-xs font-bold">
          {links.map((l) => (
            <WindowLink key={l.href} href={l.href} title={l.label} frameTarget="window" className="text-primary inline-flex items-center gap-0.5 hover:underline">
              {l.label}
              <ChevronRight className="size-3.5" />
            </WindowLink>
          ))}
        </div>
      ) : null}
    </aside>
  );
}

function TargetList({ targets, omit, onNavigate }: { targets: ExploreTarget[]; omit: string | null; onNavigate: (t: ExploreTarget) => void }) {
  return (
    <ul className="flex flex-col gap-1.5" role="list">
      {targets.map((t) => {
        const facts = (t.facts ?? []).filter((f) => f !== omit);
        const detail = omit && t.detail ? t.detail.split(" · ").filter((p) => p !== omit).join(" · ") : t.detail;
        return (
          <li key={`${t.kind}:${t.id}:${t.meta ?? ""}`}>
            <button
              type="button"
              onClick={() => onNavigate(t)}
              aria-label={`${t.label}${t.meta ? ` (${t.meta})` : ""} — 중심으로 보기`}
              className="group border-line bg-background hover:border-primary hover:bg-primary-softer focus-visible:ring-ring flex w-full items-center gap-2.5 rounded-xl border px-3 py-1.5 text-left transition focus-visible:ring-2 focus-visible:outline-none"
            >
              <span className="bg-bg-soft text-text-dim group-hover:bg-primary-soft group-hover:text-primary flex size-7 shrink-0 items-center justify-center rounded-full transition">
                <EyIcon name={KIND_ICON[t.kind]} size={15} />
              </span>
              <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-0.5">
                <span className="flex shrink-0 items-center gap-2">
                  <span className="text-foreground text-sm font-extrabold">{t.label}</span>
                  {t.meta ? <span className="text-text-dim text-xs">{t.meta}</span> : null}
                  {t.badge ? <Pill color={t.badge.color}>{t.badge.label}</Pill> : null}
                </span>
                {detail ? <span className="text-text-dim min-w-[8ch] flex-1 truncate text-xs">{detail}</span> : null}
                {facts.length > 0 ? (
                  <span className="flex shrink-0 gap-1">
                    {facts.map((f) => (
                      <span key={f} className="bg-bg-soft text-foreground rounded-pill px-2 py-0.5 text-xs">
                        {f}
                      </span>
                    ))}
                  </span>
                ) : null}
              </span>
              <span className="text-primary shrink-0 text-xs font-extrabold opacity-0 transition group-hover:opacity-100 group-focus-visible:opacity-100">중심으로</span>
              <ChevronRight className="text-text-dim group-hover:text-primary size-4 shrink-0" />
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/** 읽기 줄 — 한 줄(제목 · 날짜·설명 말줄임 · 오른쪽 값). 전문(body)이 있는 줄은 눌러 펼친다. */
function Rows({ rows }: { rows: ExploreRow[] }) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <ul className="divide-line-faint divide-y">
      {rows.map((r) => {
        const expandable = !!r.body;
        const isOpen = open === r.id;
        return (
          <li key={r.id} className={`flex items-start justify-between gap-3 py-1.5 ${expandable ? "hover:bg-primary-softer -mx-1.5 cursor-pointer rounded-lg px-1.5" : ""}`} onClick={expandable ? () => setOpen(isOpen ? null : r.id) : undefined}>
            <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2">
              <p className="text-foreground shrink-0 text-sm font-semibold break-keep">{r.title}</p>
              {r.date || r.detail ? (
                <p className="text-text-dim min-w-0 flex-1 truncate text-xs">
                  {r.date ? <span className="num">{r.date}</span> : null}
                  {r.date && r.detail ? " · " : null}
                  {r.detail}
                </p>
              ) : null}
              {isOpen && r.body ? <p className="text-foreground mt-0.5 basis-full text-sm leading-relaxed break-keep whitespace-pre-wrap">{r.body}</p> : null}
            </div>
            {r.right ? <span className="num text-foreground shrink-0 text-sm font-extrabold">{r.right}</span> : null}
          </li>
        );
      })}
    </ul>
  );
}

// 점검 칸 표시 — 글자 기호 대신 아이콘(가드 aywa-icon-mapping '아이콘 자리에 글자 기호 금지').
const CHECK_BOX: Record<ExploreCareChecks["items"][number]["status"], { icon: AywaIconName; cls: string }> = {
  done: { icon: "check", cls: "bg-green-soft text-green" },
  overdue: { icon: "alert", cls: "bg-danger-soft text-danger" },
  due: { icon: "alert", cls: "bg-amber-soft text-amber" },
  upcoming: { icon: "dot", cls: "bg-bg-soft text-text-dim" },
  pending: { icon: "help", cls: "bg-bg-soft text-text-dim" },
  waived: { icon: "minus", cls: "bg-bg-soft text-text-dim" },
};

/** 약속·할 일 — 입학 요구(입학상담 원본) · 약속·인계(student-care) · 신규생 90일 점검(신규생 관리와 같은 판정). 시안 careBlock과 같은 차례. */
function CareBlocks({ care }: { care: ExploreCarePanel }) {
  const { checks, commitments } = care;
  const intake = commitments.intake;
  const [open, setOpen] = useState(false);
  return (
    <>
      {intake ? (
        <section>
          <p className="text-foreground mb-1.5 text-xs font-extrabold opacity-85">입학 요구</p>
          <div className={`py-0.5 ${intake.body ? "hover:bg-primary-softer -mx-1.5 cursor-pointer rounded-lg px-1.5" : ""}`} onClick={intake.body ? () => setOpen(!open) : undefined}>
            <div className="flex flex-wrap items-baseline gap-x-2">
              <p className="text-foreground text-sm font-semibold break-keep">{intake.title}</p>
              <p className="text-text-dim text-xs">
                {intake.date ? <span className="num">{intake.date}</span> : null}
                {intake.date ? " · " : null}
                <span onClick={(e) => e.stopPropagation()}>
                  <WindowLink href={intake.href} title="입학상담 원본" frameTarget="window" className="text-primary font-bold hover:underline">
                    원본 ›
                  </WindowLink>
                </span>
              </p>
            </div>
            {open && intake.body ? <p className="text-foreground mt-0.5 text-sm leading-relaxed break-keep whitespace-pre-wrap">{intake.body}</p> : null}
          </div>
        </section>
      ) : null}
      <section>
        <p className="text-foreground mb-1.5 text-xs font-extrabold opacity-85">약속·인계</p>
        <CareExploreBlock studentId={care.studentId} view={commitments} />
      </section>
      {checks.state === "off" ? null : (
      <section>
        <p className="text-foreground mb-1.5 flex items-center gap-2 text-xs font-extrabold opacity-85">
          신규생 90일 점검
          {checks.enrolledOn ? <span className="text-text-dim num font-medium">등록일 {checks.enrolledOn.slice(5).replace("-", ".")} 기준</span> : null}
        </p>
        {checks.state === "ready" ? (
          checks.items.length > 0 ? (
            <ul className="flex flex-col gap-1.5">
              {checks.items.map((k) => {
                const box = CHECK_BOX[k.status];
                return (
                  <li key={k.key} className="flex items-center gap-2 text-sm">
                    <span className={`flex size-5 shrink-0 items-center justify-center rounded-md text-xs font-extrabold ${box.cls}`} aria-hidden="true">
                      <EyIcon name={box.icon} size={13} />
                    </span>
                    <span className="text-foreground min-w-0 flex-1 break-keep">{k.label}</span>
                    <span className="text-text-dim num shrink-0 text-xs">{k.when}</span>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-text-dim text-xs">점검 항목이 없습니다.</p>
          )
        ) : (
          <p className="text-text-dim text-xs break-keep">
            {checks.state === "notNewcomer"
              ? "등록 90일이 지났거나 신규생 명단에 없는 원생입니다."
              : checks.state === "denied"
                ? "신규생 관리 권한이 있어야 점검을 볼 수 있습니다."
                : checks.state === "unavailable"
                  ? "점검 기록 표가 아직 연결되지 않았습니다."
                  : "점검을 불러오지 못했습니다."}
          </p>
        )}
      </section>
      )}
    </>
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
