"use client";

import { schoolGradeLabel } from "@/lib/format/school-grade";
import { DUTY_KIND_KEYS, DUTY_KINDS, DUTY_STATE_LABEL, dutyKindLabel, dutyState, type DutyKind, type DutyState } from "../kinds";
import { buildDutyCards, groupCardsByClass, type DutyCard } from "../view";
import type { DutyPayload } from "./my-duties-strip-button";
import { useCollapse } from "./collapse";

/**
 * '오늘' 보기 — **항상 반별로**(원장 2026-11-09) 표 하나씩: 줄 = 학생, 칸 = 출결 · 보고서 · 발송(막대 색 = 상태 · 글자 = 종류). 머리 줄 없음(원장 2026-11-10 *"제목행 제거"*).
 * 칸을 누르면 창 안에 그 기록 화면(원스크린 그 학생)이 간이 페이지로 뜬다. 완료된 칸은 누를 수 없다. 결석은 "결석".
 */
const DAILY: DutyKind[] = DUTY_KIND_KEYS.filter((k) => DUTY_KINDS[k].period === "daily");
const SHORT: Record<string, string> = { attendance: "출결", report_write: "보고서", report_send: "발송" };
// 미완료 = 완료와 같은 초록이되 속은 흰색(채워지지 않은 것처럼) · 글자 초록(원장 2026-11-10). 기한 초과만 빨강.
const CELL: Record<DutyState, string> = { done: "bg-green text-primary-foreground border border-green", late: "bg-danger text-primary-foreground border border-danger", open: "bg-surface-hi text-green border border-green", void: "bg-bg-soft text-text-placeholder" };

export function MyDutiesPanel({ loaded, defaultClosed = false }: { loaded: { payload: DutyPayload; at: number }; defaultClosed?: boolean }) {
  const { payload, at: now } = loaded;
  if (!payload.items.length) return <p className="text-text-dim mt-2 text-sm">오늘 수업 의무가 없습니다.</p>;
  const groups = groupCardsByClass(buildDutyCards(payload.items, payload.week, payload.days, now), now);
  return <GroupsView groups={groups} now={now} defaultClosed={defaultClosed} />;
}

function GroupsView({ groups, now, defaultClosed }: { groups: ReturnType<typeof groupCardsByClass>; now: number; defaultClosed: boolean }) {
  const collapse = useCollapse(groups.map((g) => g.classId ?? ""), defaultClosed);
  return <div className="grid gap-3">
    {groups.map((g) => {
      const kinds = DAILY.filter((k) => g.cards.some((c) => c.items.some((i) => i.kind === k)));
      return <section key={g.classId ?? "none"} className="border-line-faint overflow-hidden rounded-xl border">
        <header className="bg-bg-soft flex cursor-pointer select-none flex-wrap items-center justify-between gap-2 px-3 py-1.5" onClick={() => collapse.toggle(g.classId ?? "")}>
          <h4 className="text-sm font-bold"><span className="text-text-dim mr-1.5 inline-block w-3">{collapse.isOpen(g.classId ?? "") ? "▾" : "▸"}</span>{g.name}<span className="text-text-dim ml-2 text-xs font-medium">{g.cards.length}명</span></h4>
          <span className="text-xs font-semibold tabular-nums"><span className={g.done === g.total ? "text-green" : "text-foreground"}>{g.done}/{g.total}</span>
            {g.late ? <span className="text-danger"> · 기한 초과 {g.late}</span> : g.open ? <span className="text-amber"> · 미완료 {g.open}</span> : null}</span>
        </header>
        {collapse.isOpen(g.classId ?? "") ? <table className="w-full table-fixed text-xs">
          <colgroup><col className="w-44" />{kinds.map((k) => <col key={k} />)}</colgroup>
          <tbody>{g.cards.map((c) => <Row key={c.key} card={c} kinds={kinds} now={now} />)}</tbody>
        </table> : null}
      </section>;
    })}
  </div>;
}

function Row({ card, kinds, now }: { card: DutyCard; kinds: DutyKind[]; now: number }) {
  const first = card.items[0];
  const who = card.studentId && first ? schoolGradeLabel(first.school, first.grade) : null;
  return <tr className="border-line-faint border-t">
    <td className="overflow-hidden px-3 py-1 whitespace-nowrap"><span className="font-bold">{card.title}</span>{who ? <span className="text-text-dim ml-1.5">{who}</span> : null}{!card.studentId ? <span className="text-text-dim ml-1.5">반 알림장</span> : null}</td>
    {kinds.map((k) => {
      const it = card.items.find((i) => i.kind === k);
      const label = SHORT[k] ?? dutyKindLabel(k);
      if (!it) {
        const writeOpen = k === "report_send" && card.items.some((i) => i.kind === "report_write" && i.status !== "done");
        const text = writeOpen ? `${label} · 작성 뒤` : `${label} · 의무 없음`;
        const why = writeOpen ? "보고서를 쓰면 발송 의무가 생깁니다" : k === "attendance" ? "오늘 이 반 수업 명단에 없습니다" : "휴원 · 미발송 반 · 작성 면제 등으로 오늘은 이 칸의 의무가 없습니다";
        return <td key={k} className="px-1 py-1"><span title={why} className="text-text-placeholder flex h-6 items-center justify-center rounded-md text-xs font-medium">{text}</span></td>;
      }
      const st = dutyState(it.status, it.dueAt, now);
      if (st === "void") {
        const text = it.voidReason === "absent" ? `${label} · 결석` : `${label} · 의무 없음`;
        const why = it.voidReason === "absent" ? "결석이라 오늘 보고서 작성 의무가 없습니다(출결에서 정정하면 의무가 다시 생깁니다)" : "오늘은 이 칸의 의무가 없습니다";
        return <td key={k} className="px-1 py-1"><span title={why} className="text-text-placeholder flex h-6 items-center justify-center rounded-md text-xs font-medium">{text}</span></td>;
      }
      // 일간 칸은 누르지 않는다 — 창을 닫으면 바로 원스크린이라 거기서 처리한다(원장 2026-11-10).
      const title = `${dutyKindLabel(k)} · ${DUTY_STATE_LABEL[st]}`;
      return <td key={k} className="px-1 py-1"><span title={title} className={`flex h-6 items-center justify-center rounded-md font-semibold ${CELL[st]}`}>{st === "done" ? label : `${label} · ${DUTY_STATE_LABEL[st]}`}</span></td>;
    })}
  </tr>;
}
