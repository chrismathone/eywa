"use client";

import type { ReactNode } from "react";
import type { CSSProperties } from "react";
import type { KpiKey } from "@/features/dashboard/overview/layout";
import { levelTestListIn } from "@/features/dashboard/overview/display";
import { previousDayRange, previousDayText } from "@/features/dashboard/overview/previous-day";
import { splitEnrolledRecent } from "@/features/dashboard/overview/enrolled-recent";
import { monthAheadWindow, windowUntilLabel } from "@/features/dashboard/overview/upcoming-window";
import { countWithdrawalPrograms } from "@/features/withdrawals/window";
import { programLabel, visiblePrograms } from "@/features/students/enrollment/program";
import { absentDaily, daysInMonth, makeupWeekly, newDates } from "@/features/dashboard/instruments/derive";
import { courseLabel, hhmm, monthDay, num, yyMm } from "@/features/dashboard/instruments/labels";
import { V } from "./engine";
import { GoIcon, VizSlot, useBoard } from "./parts";

type Kpi = { key: KpiKey; label: string; period?: string; value: string; unit: string; note: string; chart?: (w: number, h: number) => string; chips?: ReactNode };

/** 시각·구분을 그대로 적는 칩. 건수가 적은 칸은 축 위의 점보다 읽기 쉽다. */
function Chips({ title, items }: { title: string; items: { text: string; done: boolean; tip: string }[] }) {
  return (
    <ul className="time-chips" aria-label={title}>
      {items.slice(-4).map((item, i) => <li key={`${item.text}-${i}`} className={item.done ? "is-done" : "is-next"} data-viz-tip={item.tip}>{item.text}</li>)}
    </ul>
  );
}

function useKpis(): Kpi[] {
  const { v, snapshot, subjects, eieOn } = useBoard();
  const today = snapshot.today;
  const list: Kpi[] = [];
  const programs = (c: Record<"eie" | "injaewon" | "math", number>) => visiblePrograms(eieOn).map((p) => `${programLabel(p, subjects, eieOn)} ${num(c[p])}`).join(" · ");
  const trend = v.enrolledTrend?.data?.monthly ?? [];
  const courseTrend = v.courseTrend?.data?.monthly ?? [];
  const change = v.changes?.data;

  if (v.students) {
    const s = v.students.data;
    list.push({ key: "students", label: "재원생", period: "현재", value: s ? num(s.enrolled) : "—", unit: "명", note: s ? programs(s.programs) : "재원 상태 기준",
      chart: trend.length > 1 ? (w, h) => V.spark(w, h, { labels: trend.map((p) => yyMm(p.key)), values: trend.map((p) => p.count), unit: "명", title: "월말 재원생" }) : undefined });
  }
  if (v.courses) {
    const c = v.courses.data?.basis === "student-subject" ? v.courses.data : null;
    list.push({ key: "courses", label: "강좌수", period: "현재", value: c ? num(c.total) : "—", unit: "개", note: c ? Object.entries(c.subjects).map(([k, n]) => `${courseLabel(k, snapshot.subjects, subjects, eieOn)} ${num(n)}`).join(" · ") : "학생별 같은 과목은 1개",
      chart: courseTrend.length > 1 ? (w, h) => V.spark(w, h, { labels: courseTrend.map((p) => yyMm(p.key)), values: courseTrend.map((p) => p.count), unit: "개", title: "월말 강좌수" }) : undefined });
  }
  if (v.withdrawals) {
    const wd = v.withdrawals.data ? countWithdrawalPrograms(v.withdrawals.data.rows) : null;
    list.push({ key: "withdrawals", label: "퇴원&수업종료", period: "이번 달", value: wd ? num(wd.total) : "—", unit: "명", note: wd ? `${programs(wd)}${wd.other > 0 ? ` · 기타 ${num(wd.other)}` : ""}` : "이번 달 퇴원·수업종료 기준",
      chart: change ? (w, h) => V.miniColumns(w, h, { labels: change.map((r) => yyMm(r.month)), values: change.map((r) => r.withdrawn), unit: "명", title: "월별 퇴원" }) : undefined });
  }
  if (v.intake) {
    const rows = v.intake.data;
    list.push({ key: "intake", label: "신규문의", period: "오늘", value: rows ? num(rows.length) : "—", unit: "건", note: rows ? (rows.length ? `마지막 접수 ${rows[0]?.time ?? "—"}` : "오늘 접수 없음") : "오늘 접수 기준",
      chips: rows?.length ? <Chips title="오늘 접수" items={[...rows].reverse().map((r) => ({ text: r.time ?? "—", done: true, tip: `${r.time ?? "—"}|오늘 접수` }))} /> : undefined });
  }
  if (v.calendar) {
    const prev = previousDayRange(today);
    const text = previousDayText(prev);
    const tests = v.calendar.data ? levelTestListIn(v.calendar.data, prev) : null;
    const first = tests?.active[0];
    list.push({ key: "calendar", label: "전일 입테", value: tests ? num(tests.active.length) : "—", unit: "건",
      note: tests ? [tests.active.length ? (prev.from === prev.to ? `${text} · 첫 일정 ${hhmm(first?.startTime) || "종일"}` : text) : tests.cancelled ? text : `${text} 일정 없음`, tests.cancelled ? `취소 ${num(tests.cancelled)}` : null].filter(Boolean).join(" · ") : "학원 일정 기준",
      chips: tests?.active.length ? <Chips title="전일 입테" items={tests.active.map((e) => ({ text: hhmm(e.startTime) || "종일", done: true, tip: `${hhmm(e.startTime) || "종일"}|전일 입테` }))} /> : undefined });
  }
  if (v.enrolledToday) {
    const rows = v.enrolledToday.data;
    const recent = rows ? splitEnrolledRecent(rows, today) : null;
    const assigned = recent?.month.filter((r) => r.assigned).length ?? 0;
    const dates = recent ? newDates(recent.month) : [];
    list.push({ key: "enrolledToday", label: "전일 / 이달 신규", value: recent ? `${num(recent.yesterday.length)} / ${num(recent.month.length)}` : "—", unit: "명", note: recent ? `이달 반 배정 ${num(assigned)} · 배정 전 ${num(recent.month.length - assigned)}` : "신규 콜&상담 등록 완료 기준",
      chart: dates.length ? (w, h) => V.miniSteps(w, h, { dates, today: Number(today.slice(8, 10)), days: daysInMonth(today), unit: "명", title: "이달 신규 등록 누적" }) : undefined });
  }
  if (v.firstClass) {
    const rows = v.firstClass.data;
    const first = rows?.filter((r) => r.kind === "first").length ?? 0;
    const rest = (rows?.length ?? 0) - first;
    list.push({ key: "firstClass", label: "오늘첫수업", value: rows ? num(rows.length) : "—", unit: "명", note: rows ? `첫 등원 ${num(first)} · 처음 듣는 과목 ${num(rest)}` : "수강 시작일 기준",
      chips: rows?.length ? <Chips title="오늘첫수업" items={[...(first ? [{ text: `첫 등원 ${num(first)}`, done: true, tip: `${num(first)}명|첫 등원` }] : []), ...(rest ? [{ text: `새 과목 ${num(rest)}`, done: false, tip: `${num(rest)}명|처음 듣는 과목` }] : [])]} /> : undefined });
  }
  if (v.absent) {
    const data = v.absent.data;
    const times = data?.students.reduce((n, s) => n + s.count, 0) ?? 0;
    const contact = data?.students.filter((s) => s.unnotified > 0).length ?? 0;
    const daily = data ? absentDaily(data) : null;
    list.push({ key: "absent", label: "최근 결석", period: "7일", value: data ? num(data.students.length) : "—", unit: "명", note: data ? `${monthDay(data.from)}~${monthDay(data.to)} · 결석 ${num(times)}회 · 연락 필요 ${num(contact)}명` : "출결 기준",
      chart: daily ? (w, h) => V.miniColumns(w, h, { labels: daily.labels, values: daily.values, unit: "회", title: "일별 결석" }) : undefined });
  }
  if (v.makeup) {
    const data = v.makeup.data;
    const until = windowUntilLabel(data?.range ?? monthAheadWindow(today));
    const weekly = data ? makeupWeekly(data.rows, today) : null;
    const todayCount = data?.rows.filter((r) => r.makeupDate === today).length ?? 0;
    const overdue = data?.rows.filter((r) => r.overdue).length ?? 0;
    list.push({ key: "makeup", label: "보강예정", period: "한 달", value: data ? num(data.rows.length) : "—", unit: "건", note: data ? `${until} · 오늘 ${num(todayCount)}${overdue ? ` · 지남 ${num(overdue)}` : ""}${data.later ? ` · 그 뒤 ${num(data.later)}` : ""}` : "집계 없음",
      chart: weekly ? (w, h) => V.miniColumns(w, h, { ...weekly, unit: "건", emphasis: 0, title: "주별 보강 예약" }) : undefined });
  }
  return list;
}

export function KpiGrid({ only }: { only?: readonly KpiKey[] }) {
  const { snapshot, v } = useBoard();
  const custom = new Map((snapshot.view?.items ?? []).flatMap((i) => (i.title ? [[i.id, i.title] as const] : [])));
  const list = useKpis();
  const order = only ? only.flatMap((key) => list.filter((k) => k.key === key)) : list;
  if (!order.length) return null;
  const cols = order.length === 8 || order.length === 4 ? 4 : 3;
  const rest = order.length % cols;
  const style = { "--kpi-last": rest ? `span ${cols - rest + 1}` : "auto" } as CSSProperties;
  return (
    <section className="block" aria-label="핵심 수치">
      <div className="kpi-grid" data-cols={cols} style={style}>
        {order.map((k) => (
          <div className="kpi" data-kpi={k.key} data-detail={`kpi:${k.key}`} key={k.key}>
            <div className="kpi-head"><button type="button" className="card-open">{custom.get(`kpi:${k.key}`) ?? k.label}<GoIcon /></button>{k.period ? <small>{k.period}</small> : null}</div>
            <div className="kpi-body">
              <div className="kpi-value">{k.value}<em>{k.unit}</em></div>
              {k.chips ?? (k.chart ? <VizSlot h={44} className="kpi-chart" draw={k.chart} /> : null)}
            </div>
            <div className="kpi-note">{v[k.key]?.error ? "일부 갱신 실패 · 확인값 표시 중" : k.note}</div>
          </div>
        ))}
      </div>
    </section>
  );
}
