"use client";

import { useOpenDutyWork } from "./duty-work-context";
import { schoolGradeLabel } from "@/lib/format/school-grade";
import { DUTY_KIND_KEYS, DUTY_KINDS, DUTY_STATE_LABEL, dutyKindLabel, dutyState, type DutyKind, type DutyState } from "../kinds";
import { buildDutyCards, dutyHref, groupCardsByClass, type DutyCard } from "../view";
import type { DutyPayload } from "./my-duties-strip-button";

/**
 * '오늘' 보기 — **항상 반별로**(원장 2026-11-09) 표 하나씩: 줄 = 학생, 칸 = 출결 · 보고서 · 발송(상태 색) · 최근 7일. 늦은 반이 위.
 * 칸을 누르면 창 안에 그 기록 화면(원스크린 그 학생)이 간이 페이지로 뜬다(`useOpenDutyWork` · 이동은 창의 '이 화면으로 이동' 버튼).
 */
const DAILY: DutyKind[] = DUTY_KIND_KEYS.filter((k) => DUTY_KINDS[k].period === "daily");
const SHORT: Record<string, string> = { attendance: "출결", report_write: "보고서", report_send: "발송" };

export function MyDutiesPanel({ loaded }: { loaded: { payload: DutyPayload; at: number } }) {
  const { payload, at: now } = loaded;
  if (!payload.items.length) return <p className="text-text-dim mt-2 text-sm">오늘 수업 의무가 없습니다.</p>;
  const groups = groupCardsByClass(buildDutyCards(payload.items, payload.week, payload.days, now), now);
  return <div className="grid gap-3">
    {groups.map((g) => {
      const kinds = DAILY.filter((k) => g.cards.some((c) => c.items.some((i) => i.kind === k)));
      return <section key={g.classId ?? "none"} className="border-line-faint overflow-hidden rounded-xl border">
        <header className="bg-bg-soft flex flex-wrap items-center justify-between gap-2 px-3 py-1.5">
          <h4 className="text-sm font-bold">{g.name}<span className="text-text-dim ml-2 text-xs font-medium">{g.cards.length}명</span></h4>
          <span className="text-xs font-semibold tabular-nums"><span className={g.done === g.total ? "text-green" : "text-foreground"}>{g.done}/{g.total}</span>
            {g.late ? <span className="text-danger"> · 기한 초과 {g.late}</span> : g.open ? <span className="text-amber"> · 미완료 {g.open}</span> : null}</span>
        </header>
        <table className="w-full text-xs">
          <thead><tr className="text-text-dim">
            <th className="px-3 py-1 text-left font-semibold">학생</th>
            {kinds.map((k) => <th key={k} className="w-24 px-1 py-1 text-center font-semibold">{SHORT[k] ?? dutyKindLabel(k)}</th>)}
            <th className="w-28 px-2 py-1 text-right font-semibold">이번 주</th>
          </tr></thead>
          <tbody>{g.cards.map((c) => <Row key={c.key} card={c} kinds={kinds} now={now} />)}</tbody>
        </table>
      </section>;
    })}
  </div>;
}

const CELL: Record<DutyState, string> = { done: "bg-green-soft text-green", late: "bg-danger-soft text-danger", open: "bg-amber-soft text-amber", void: "bg-bg-soft text-text-placeholder" };

function Row({ card, kinds, now }: { card: DutyCard; kinds: DutyKind[]; now: number }) {
  const openWork = useOpenDutyWork();
  const first = card.items[0];
  const who = card.studentId && first ? schoolGradeLabel(first.school, first.grade) : null;
  return <tr className="border-line-faint border-t">
    <td className="px-3 py-1"><span className="font-bold">{card.title}</span>{who ? <span className="text-text-dim ml-1.5">{who}</span> : null}{!card.studentId ? <span className="text-text-dim ml-1.5">반 알림장</span> : null}</td>
    {kinds.map((k) => {
      const it = card.items.find((i) => i.kind === k);
      if (!it) {
        // 그 칸의 의무가 없는 까닭을 적는다 — 빈 '—'는 "왜?"를 낳는다(원장 2026-11-09). 발송은 보고서를 쓴 뒤에 생긴다.
        const writeOpen = k === "report_send" && card.items.some((i) => i.kind === "report_write" && i.status !== "done");
        const text = writeOpen ? "작성 뒤" : "의무 없음";
        const why = writeOpen ? "보고서를 쓰면 발송 의무가 생깁니다" : k === "attendance" ? "오늘 이 반 수업 명단에 없습니다" : "결석 · 휴원 · 미발송 반 · 작성 면제 등으로 오늘은 이 학생의 작성 의무가 없습니다";
        return <td key={k} className="px-1 py-1 text-center"><span title={why} className="text-text-placeholder inline-flex h-6 w-20 items-center justify-center rounded-md text-xs font-medium">{text}</span></td>;
      }
      const st = dutyState(it.status, it.dueAt, now);
      if (st === "void") {
        const text = it.voidReason === "absent" ? "결석" : "의무 없음";
        const why = it.voidReason === "absent" ? "결석이라 오늘 보고서 작성 의무가 없습니다(출결에서 정정하면 의무가 다시 생깁니다)" : "오늘은 이 칸의 의무가 없습니다";
        return <td key={k} className="px-1 py-1 text-center"><span title={why} className="text-text-placeholder inline-flex h-6 w-20 items-center justify-center rounded-md text-xs font-medium">{text}</span></td>;
      }
      if (st === "done") return <td key={k} className="px-1 py-1 text-center"><span title={`${dutyKindLabel(k)} · 완료`} className={`inline-flex h-6 w-20 items-center justify-center rounded-md font-semibold ${CELL[st]}`}>{DUTY_STATE_LABEL[st]}</span></td>;
      return <td key={k} className="px-1 py-1 text-center">
        <button type="button" onClick={() => openWork({ href: dutyHref(it), title: `${card.title} · ${it.className ?? ""} · ${dutyKindLabel(k)}` })}
          title={`${dutyKindLabel(k)} · ${DUTY_STATE_LABEL[st]} — 누르면 창 안에서 바로 처리`}
          className={`inline-flex h-6 w-20 items-center justify-center rounded-md font-semibold hover:brightness-95 ${CELL[st]}`}>{DUTY_STATE_LABEL[st]}</button>
      </td>;
    })}
    <td className="px-2 py-1">
      <span className="flex justify-end gap-0.5" aria-label="이번 주(월~일) 완료 비율">
        {card.week.map((r, i) => <span key={i} className={`h-3 w-3 rounded-sm ${r == null ? "bg-bg-soft" : r >= 1 ? "bg-primary" : r > 0 ? "bg-primary-soft" : "bg-danger-soft"}`} title={r == null ? "의무 없음" : `${Math.round(r * 100)}%`} />)}
      </span>
    </td>
  </tr>;
}
