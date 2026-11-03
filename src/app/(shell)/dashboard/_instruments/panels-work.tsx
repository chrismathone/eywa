"use client";

import { useState } from "react";
import { WindowLink } from "@/components/workspace/window-link";
import { foldExpenseTotals } from "@/features/dashboard/overview/expense-total";
import { isTestClass } from "@/features/dashboard/overview/test-class";
import { upcomingAdmissionsRows } from "@/features/dashboard/overview/display";
import { monthAheadNote, monthAheadWindow } from "@/features/dashboard/overview/upcoming-window";
import { careDue, scheduleWeeks, staffRows, timeline } from "@/features/dashboard/instruments/derive";
import { teacherBoard, teacherTabs } from "@/features/dashboard/instruments/teacher-board";
import { courseLabel, monthDay, monthNo, num, percent, programKeyOf, subjectStyle } from "@/features/dashboard/instruments/labels";
import { V } from "./engine";
import { Card, PANEL_H, SubjectTabs, VizSlot, useBoard } from "./parts";

export function NewcomerChecksCard() {
  const { v, title } = useBoard();
  const care = v.newcomers?.data;
  const available = care?.checksAvailable;
  const rows = care?.items.map((i): [string, number[]] => [`${i.label}${i.optional ? " (선택)" : ""}`, [i.done, i.overdue, i.due, i.upcoming + i.pending + i.waived]]) ?? [];
  const total = care?.total ?? 0;
  return (
    <Card id="newcomerChecks" tone="alert" title={title("newcomerChecks", "신규생 체크 진행")} note="등록 후 90일 · 필수 6항목 · 2개월 콜은 선택" sections={[v.newcomers]} value={care && available ? { label: "확인 필요", num: num(careDue(care).people), unit: "명" } : undefined}>
      {available
        ? <VizSlot h={Math.max(176, rows.length * 25)} draw={(w, h) => V.stackRows(w, h, { rows, series: ["완료", "기한 경과", "3일 내", "예정"], tones: ["m-yellow", "m-red", "m-char", "m-pale"], track: total, endText: ([, p]: [string, number[]]) => `${p[0]} / ${total}`, title: "신규생 체크" })} />
        : <p className="foot">체크리스트 연결 확인이 필요합니다.</p>}
    </Card>
  );
}

export function SheetsCard() {
  const { v, title } = useBoard();
  const rows = ([{ label: "영어 시트", d: v.englishSheet, note: "영어 이번 주(보기 필터 기준)" }, { label: "수학 시트", d: v.mathSheet, note: "수학 이번 달" }] as const).filter((r) => r.d);
  return (
    <Card id="sheets" title={title("sheets", "강사 시트 작성 현황")} note={rows.map((r) => r.note).join(" · ")} sections={[v.englishSheet, v.mathSheet]}>
      <div className="sheet-pair">
        {rows.map(({ label, d }) => {
          const data = d?.data;
          const rate = data && data.total > 0 ? Math.round((data.filled / data.total) * 100) : 0;
          return (
            <section key={label}>
              {data ? <VizSlot h={136} className="gauge-slot" draw={(w, h) => V.gauge(w, h, { value: rate, label, caption: label, maxR: 76 })} /> : null}
              <p className="foot">{data ? <b>{data.period}</b> : "조회 실패"}</p>
            </section>
          );
        })}
      </div>
    </Card>
  );
}

export function NowClassesCard() {
  const { v, title, snapshot, subjects, eieOn, extras, clock } = useBoard();
  const [pick, setPick] = useState("전체");
  const schedule = v.schedule?.data?.filter((s) => !isTestClass(s.className));
  const eie = new Set(extras.eieClassIds);
  const keyOf = (slot: { classId: string; subject: string | null }) => programKeyOf(slot.subject, eie.has(slot.classId) ? "eie" : null, subjects, eieOn) ?? "";
  const labelOf = (key: string) => courseLabel(key, snapshot.subjects, subjects, eieOn);
  const order = extras.subjects.map((s) => s.label);
  const rank = (label: string) => { const i = order.indexOf(label); return i < 0 ? order.length : i; };
  const labels = [...new Set((schedule ?? []).map((s) => labelOf(keyOf(s))))].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b, "ko"));
  const active = labels.includes(pick) ? pick : "전체";
  const shown = schedule?.filter((s) => active === "전체" || labelOf(keyOf(s)) === active);
  const model = shown ? timeline(shown, clock, (slot) => { const key = keyOf(slot); return { key, label: labelOf(key) }; }) : null;
  const tones = Object.fromEntries((model?.rows ?? []).map((r, i) => [r.subject, subjectStyle(r.key, i).tone]));
  return (
    <Card id="nowClasses" title={title("nowClasses", "현재 수업 현황")} note={`오늘 ${clock} 기준 · 과목별`} sections={[v.schedule]} tools={<SubjectTabs tabs={["전체", ...labels]} active={active} onPick={setPick} />} value={model ? { label: "진행 중", num: num(model.running), unit: "개" } : undefined}>
      {model && model.rows.length ? (
        <div className="timeline-scroll">
          <VizSlot h={Math.max(PANEL_H, model.rows.length * 24 + 44)} draw={(w, h) => V.timeline(w, h, { from: model.from, to: model.to, now: model.now, rows: model.rows, tones, title: "오늘 수업" })} />
        </div>
      ) : <p className="foot">지금 진행 중인 수업이 없습니다.</p>}
    </Card>
  );
}

export function AdmissionsScheduleCard() {
  const { v, title, snapshot } = useBoard();
  const range = monthAheadWindow(snapshot.today);
  const rows = v.calendar?.data ? upcomingAdmissionsRows(v.calendar.data, snapshot.today) : [];
  const weeks = scheduleWeeks(rows, snapshot.today);
  return (
    <Card id="admissionsSchedule" title={title("admissionsSchedule", "레벨테스트 및 첫수업 일정")} note={monthAheadNote(range)} sections={[v.calendar]} value={{ label: "예정", num: num(weeks.total), unit: "건" }}>
      {weeks.total + weeks.cancelled > 0 ? (
        <>
          <VizSlot h={144} draw={(w, h) => V.trend(w, h, { labels: weeks.labels, series: [{ name: "입학 테스트", values: weeks.tests, tone: "m-yellow", stroke: "stroke-yellow" }, { name: "첫 수업", values: weeks.firsts, tone: "m-char" }], unit: "건", kind: "bar", valueLabels: "all", title: "주별 일정" })} />
          {weeks.cancelled ? <p className="foot">취소 {num(weeks.cancelled)}건</p> : null}
        </>
      ) : <p className="foot">오늘부터 한 달 동안 일정이 없습니다.</p>}
    </Card>
  );
}

export function StaffCard() {
  const { v, title } = useBoard();
  const staff = v.staff?.data;
  const g = staff ? staffRows(staff) : null;
  return (
    <Card id="staff" title={title("staff", "직원 구성")} note="현재 재직 중 · 운영 역할 기준" sections={[v.staff]} value={g ? { label: "재직 직원", num: num(g.total), unit: "명" } : undefined}>
      {g ? <VizSlot h={PANEL_H} draw={(w, h) => V.stackRows(w, h, { rows: g.rows, series: g.series, tones: ["m-char", "m-yellow", "m-l2", "m-gray", "m-l1"], unit: "명", title: "직원 구성" })} /> : null}
    </Card>
  );
}

export function OperationsCard() {
  const { v, title } = useBoard();
  const ops = v.operations?.data ?? [];
  return (
    <Card id="operations" title={title("operations", "행정 · 자산")} note="현재 · 누적 건수 · 열람 가능한 업무 기준" sections={[v.operations]}>
      {ops.length ? (
        <ul className="op-grid">
          {ops.map((o) => <li key={o.label}><WindowLink href={o.href}><span>{o.label}</span><b>{o.count === null ? "—" : num(o.count)}<small>{o.count === null ? "조회 실패" : o.unit}</small></b></WindowLink></li>)}
        </ul>
      ) : <p className="foot">열람 가능한 행정 업무가 없습니다.</p>}
    </Card>
  );
}

export function ExpensesCard() {
  const { v, title, snapshot } = useBoard();
  const data = v.expenses?.data;
  const total = data ? foldExpenseTotals(data.byCurrency) : null;
  const krw = data?.primaryCurrency === "KRW";
  const rows = (data?.byCategory ?? []).slice(0, 5).map((c): [string, number] => [c.category, c.amount]);
  return (
    <Card id="expenses" title={title("expenses", `${monthNo(snapshot.today)}월 지출 내역`)} note={data ? `이번 달 · 지출일 기준 · ${num(data.count)}건` : "이번 달 지출결의서 기준"} sections={[v.expenses]} value={total && data?.count ? { label: "지출 합계", num: V.money(total.krwTotal) } : undefined}>
      {data && data.count > 0
        ? <VizSlot h={PANEL_H} draw={(w, h) => V.rank(w, h, { rows, format: krw ? V.money : (n: number) => num(n), tones: rows.map(() => "m-yellow"), title: "분류별 지출" })} />
        : <p className="foot">이번 달 지출 내역이 없습니다.</p>}
    </Card>
  );
}

export function NoticesCard() {
  const { v, title } = useBoard();
  const notices = v.notices?.data ?? [];
  return (
    <Card id="notices" cls="span-2 xl-1" title={title("notices", "학원 공지")} note="최근 공지 · 대상 권한 반영" sections={[v.notices]}>
      {notices.length ? (
        <ul className="notice-list">
          {notices.map((n) => <li key={n.id}>{n.pinned ? <em>고정</em> : null}<b>{n.title}</b><time>{monthDay(n.createdAt.slice(0, 10))}</time></li>)}
        </ul>
      ) : <p className="foot">등록된 공지가 없습니다.</p>}
    </Card>
  );
}

/** 강사별 업무 — 업무 한 줄마다 같은 5칸 게이지 한 가지로 그린다. 과목 탭은 영어를 EiE · 인재원 영어로 가른 열을 고른다. */
export function TeacherWorkCard() {
  const { v, title, snapshot, subjects, eieOn, extras } = useBoard();
  const [pick, setPick] = useState("전체");
  const data = v.teacherWork?.data;
  const labelOf = (k: string) => courseLabel(k, snapshot.subjects, subjects, eieOn);
  const order = extras.subjects.map((s) => s.label);
  const labels = data ? teacherTabs(data, labelOf, order) : [];
  const active = labels.includes(pick) ? pick : "전체";
  const board = data ? teacherBoard(data, labelOf, order, active === "전체" ? undefined : active) : null;
  return (
    <Card id="teacherWork" cls="span-full" title={title("teacherWork", "강사별 업무 현황")} note="보고서·영상 숙제 최근 7일 · 출결 어제까지 7일" sections={[v.teacherWork]} tools={<SubjectTabs tabs={["전체", ...labels]} active={active} onPick={setPick} />}>
      {board ? (
        <div className="work-scroll">
          <div className="work-board" style={{ gridTemplateColumns: `112px repeat(${board.teachers.length}, minmax(92px, 1fr))`, minWidth: 112 + board.teachers.length * 106 }}>
            <div className="work-label" />
            {board.teachers.map((t) => <div className="work-head" key={t.key}><b>{t.name}</b><small>{t.subject} · {num(t.classes)}반</small></div>)}
            {board.metrics.map((m) => [
              <div className="work-label" key={m.name}>{m.name}</div>,
              ...m.cells.map((c, i) => (
                <div className="work-fuel" key={`${m.name}-${board.teachers[i]!.key}`}>
                  {c ? <VizSlot h={22} draw={(w, h) => V.fuel(w, h, { value: percent(c[0], c[1]), label: `${board.teachers[i]!.name} ${m.name}`, tip: `${num(c[0])} / ${num(c[1])}|${board.teachers[i]!.name} · ${m.name}` })} /> : <span className="foot">—</span>}
                </div>
              )),
            ])}
          </div>
        </div>
      ) : null}
    </Card>
  );
}
