"use client";

import { useState } from "react";
import { EmbedAnchor } from "@/components/embed-link";
import { schoolGradeLabel } from "@/lib/format/school-grade";
import { DUTY_STATE_LABEL, dutyKindLabel, dutyState, type DutyState } from "../kinds";
import { buildDutyCards, classChips, dutyHref, type DutyCard } from "../view";
import type { DutyPayload } from "./my-duties-strip-button";

/**
 * '오늘' 보기 — 학생별 칸. 반 칩으로 거르고, 기한 초과 → 아직 → 완료 순. 칸 하나 = 의무 하나(색 = 상태) · 누르면 그 기록 화면.
 * 🔴 링크는 하드 이동(`EmbedAnchor`) — 같은 경로(/onescreen)에서 쿼리만 바뀌면 Next 16이 페이지를 다시 그리지 않아(#146) 원스크린이 학생 선택을 못 받는다.
 * 아래 띠 = 최근 7일(오늘 포함) 그 학생 의무 완료 비율(의무 없는 날은 빈 칸).
 */
export function MyDutiesPanel({ loaded }: { loaded: { payload: DutyPayload; at: number } }) {
  const [classId, setClassId] = useState<string | null>(null);
  const { payload, at: now } = loaded;
  const chips = classChips(payload.items, now);
  const items = classId ? payload.items.filter((i) => i.classId === classId) : payload.items;
  const cards = buildDutyCards(items, payload.week, payload.days, now);
  if (!payload.items.length) return <p className="text-text-dim mt-2 text-sm">오늘 수업 의무가 없습니다.</p>;
  return <div className="mt-2">
    {chips.length > 1 ? <div className="mb-2 flex flex-wrap gap-1.5">
      <Chip active={classId === null} onClick={() => setClassId(null)} label="전체" />
      {chips.map((c) => <Chip key={c.classId} active={classId === c.classId} onClick={() => setClassId(c.classId)}
        label={`${c.name} ${c.total - c.open - c.late}/${c.total}`} tone={c.late ? "danger" : c.open ? "amber" : "green"} />)}
    </div> : null}
    <ul className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
      {cards.map((g) => <Card key={g.key} card={g} now={now} />)}
    </ul>
  </div>;
}

function Chip({ active, onClick, label, tone }: { active: boolean; onClick: () => void; label: string; tone?: "danger" | "amber" | "green" }) {
  const dot = tone === "danger" ? "bg-danger" : tone === "amber" ? "bg-amber" : tone === "green" ? "bg-green" : null;
  return <button type="button" onClick={onClick} aria-pressed={active}
    className={`inline-flex h-7 items-center gap-1.5 rounded-full px-3 text-xs font-semibold ${active ? "bg-primary text-primary-foreground" : "bg-bg-soft text-text-dim hover:bg-primary-softer"}`}>
    {dot ? <span className={`h-1.5 w-1.5 rounded-full ${active ? "bg-primary-foreground" : dot}`} aria-hidden /> : null}{label}
  </button>;
}

const CHIP: Record<DutyState, string> = { done: "bg-green-soft text-green", late: "bg-danger-soft text-danger", open: "bg-amber-soft text-amber", void: "bg-bg-soft text-text-placeholder" };
const DOT: Record<DutyState, string> = { done: "bg-green", late: "bg-danger", open: "bg-amber", void: "bg-text-placeholder" };

function Card({ card, now }: { card: DutyCard; now: number }) {
  const ring = card.worst === "late" ? "border-danger/40" : card.worst === "open" ? "border-amber/40" : "border-line-faint";
  const first = card.items[0];
  const who = card.studentId && first ? schoolGradeLabel(first.school, first.grade) : null;
  return <li className={`rounded-xl border px-3 py-2 ${ring}`}>
    <div className="flex items-baseline justify-between gap-2">
      <span className="min-w-0 truncate text-sm font-bold">{card.title}{who ? <span className="text-text-dim ml-1.5 text-xs font-medium">{who}</span> : null}</span>
      <span className="text-text-dim shrink-0 text-xs">{card.sub}</span>
    </div>
    <div className="mt-1.5 flex flex-wrap gap-1">
      {card.items.map((it) => {
        const st = dutyState(it.status, it.dueAt, now);
        const text = `${dutyKindLabel(it.kind)} · ${DUTY_STATE_LABEL[st]}`;
        return <EmbedAnchor key={it.id} href={dutyHref(it)} title={st === "done" ? `${text} — 누르면 그 기록으로` : `${text} — 누르면 입력 화면으로`}
          className={`inline-flex h-6 items-center gap-1.5 rounded-md px-2 text-xs font-semibold hover:brightness-95 ${CHIP[st]}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${DOT[st]}`} aria-hidden />{text}
        </EmbedAnchor>;
      })}
    </div>
    <div className="mt-1.5 flex items-center justify-between gap-2">
      <span className="text-text-dim text-xs">최근 7일</span>
      <span className="flex gap-0.5" aria-label="최근 7일 완료 비율">
        {card.week.map((r, i) => <span key={i} className={`h-3.5 w-3.5 rounded-sm ${r == null ? "bg-bg-soft" : r >= 1 ? "bg-primary" : r > 0 ? "bg-primary-soft" : "bg-danger-soft"}`}
          title={r == null ? "의무 없음" : `${Math.round(r * 100)}%`} />)}
      </span>
    </div>
  </li>;
}
