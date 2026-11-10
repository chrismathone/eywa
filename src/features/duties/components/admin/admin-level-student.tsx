"use client";

import { schoolGradeLabel } from "@/lib/format/school-grade";
import { dutyKindLabel, NEWCOMER_ITEM_LABEL } from "../../kinds";
import { lateDays, lateLabel, type LateItem } from "../../view-admin";
import { judge, kindStatuses, sumCells } from "../../view-admin-levels";
import type { DutyWork } from "../duty-work-context";
import { KindStatusStrip } from "./admin-kind-status";
import { VerdictLine } from "./admin-verdict";
import type { StudentsPayload } from "./use-students";

const pill = (days: number) => (days >= 7 ? "bg-danger-soft text-danger" : "bg-amber-soft text-amber");
/** 건별 의무(신규생 정착)의 항목 이름 — 회차가 항목 키다("ojt" · "math:ojt"). 모르는 키는 종류 이름만. */
const itemLabel = (it: LateItem) => (it.period === "case" ? NEWCOMER_ITEM_LABEL[it.cycle] ?? NEWCOMER_ITEM_LABEL[it.cycle.split(":").pop() ?? ""] ?? "" : "");
const kstDay = (iso: string) => new Date(Date.parse(iso) + 9 * 3_600_000).toISOString().slice(0, 10);
const md = (ymd: string) => `${Number(ymd.slice(5, 7))}/${Number(ymd.slice(8, 10))}`;

/**
 * 학생 단계 — "이 학생의 상황"(원장 2026-11-10): 판정 + 근거 · 종류별 상태 · 지금 지연 목록(종류 · 항목 · 지난 날 수 · 기한) · 학생 상세 / 상담 작성(오버레이 간이 페이지).
 * 🔴 범위가 넓어진다 — 앞 단계는 '그 선생님 · 그 반'이지만 여기는 **이 학생의 전체 업무**(담당·반 무관 · 신규생 정착처럼 반 없는 의무도). 머리말에 그렇게 적는다.
 * 재료 = 학생 집계 GET + 열린 지연(이 학생 것만 · 이관 포함 — 이관은 표식을 단다).
 */
export function StudentLevel({ studentId, payload, late, nowMs, onWork }: {
  studentId: string; payload: StudentsPayload | null; late: LateItem[]; nowMs: number; onWork: (work: DutyWork) => void;
}) {
  const st = payload?.students[studentId] ?? null;
  const name = st?.name ?? late[0]?.studentName ?? "학생";
  const sub = st ? schoolGradeLabel(st.school, st.grade) : late[0] ? schoolGradeLabel(late[0].school, late[0].grade) : "";
  // 학생 집계는 그 학생으로 좁혀 받는다 — 반·담당 불문(신규생 콜처럼 반 없는 의무도 든다).
  const sum = payload ? sumCells(payload.rows, (r) => r.studentId === studentId) : null;
  const items = [...late].sort((a, b) => Number(a.inherited) - Number(b.inherited) || a.dueAt.localeCompare(b.dueAt));
  const btn = "border-line hover:bg-bg-soft h-8 rounded-lg border px-3 text-sm font-semibold";
  return <div className="grid gap-4">
    <header className="grid gap-1">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-xl font-bold">{name} {sub ? <span className="text-text-dim text-sm font-medium">{sub}</span> : null}</h3>
        <span className="text-text-dim text-sm font-medium">전체 업무(담당·반 무관)</span>
        <span className="ml-auto flex gap-1.5">
          <button type="button" onClick={() => onWork({ href: `/students/${studentId}`, title: name })} className={btn}>학생 상세</button>
          <button type="button" onClick={() => onWork({ href: `/consultations/new?studentId=${encodeURIComponent(studentId)}`, title: `${name} · 상담 작성` })} className={btn}>상담 작성</button>
        </span>
      </div>
      {sum ? <VerdictLine v={judge(sum.all)} /> : null}
    </header>
    {sum ? <KindStatusStrip statuses={kindStatuses(sum.cells)} /> : <p className="text-text-dim text-sm">불러오는 중…</p>}
    <section className="border-line bg-card rounded-xl border p-3">
      <h4 className="text-sm font-bold">현재 지연 <span className="text-text-dim text-xs font-medium">{items.length}건</span></h4>
      {!items.length ? <p className="text-green mt-2 text-sm font-semibold">지연 없음</p> : <ul className="mt-2 grid gap-1">
        {items.map((it) => <li key={it.id} className="flex flex-wrap items-center gap-2 rounded-lg px-2 py-1 text-sm">
          <span className={`rounded-full px-1.5 py-0.5 text-xs font-bold ${it.inherited ? "bg-bg-soft text-text-dim" : pill(lateDays(it.dueAt, nowMs))}`}>{it.inherited ? "이관" : lateLabel(lateDays(it.dueAt, nowMs))}</span>
          <span className="font-bold">{dutyKindLabel(it.kind)}{itemLabel(it) ? ` — ${itemLabel(it)}` : ""}</span>
          <span className="text-text-dim text-xs font-medium">{it.period === "daily" ? md(it.cycle) : it.period === "monthly" ? `${Number(it.cycle.slice(5, 7))}월` : ""}{it.className ? ` · ${it.className}` : ""}</span>
          <span className="text-danger ml-auto text-xs font-semibold tabular-nums">기한 {md(kstDay(new Date(Date.parse(it.dueAt) - 1).toISOString()))}</span>
        </li>)}
      </ul>}
    </section>
  </div>;
}
