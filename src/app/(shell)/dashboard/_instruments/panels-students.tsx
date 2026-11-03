"use client";

import { admissionMonths, attendance14, consultSteps, gradeColumns, repeatRows, schoolGroups } from "@/features/dashboard/instruments/derive";
import { consultBoard, consultNote } from "@/features/dashboard/instruments/consult";
import { reportBoard } from "@/features/dashboard/instruments/report-board";
import { MIX_SERIES, MIX_TONES, courseLabel, monthDay, num, percent, subjectStyle } from "@/features/dashboard/instruments/labels";
import { V } from "./engine";
import { Card, PANEL_H, Stat, StatRow, TripleCard, VizSlot, useBoard } from "./parts";

/** 과목별 수강 — 강좌수 칸과 같은 값(학생마다 과목 1개)이라 EiE · 인재원 영어 구분도 같다. */
export function SubjectsCard() {
  const { v, title, snapshot, subjects, eieOn } = useBoard();
  const s = v.students?.data;
  const course = v.courses?.data?.basis === "student-subject" ? v.courses.data : null;
  const label = (k: string) => courseLabel(k, snapshot.subjects, subjects, eieOn);
  const rows: [string, number, string][] = course
    ? Object.entries(course.subjects).sort((a, b) => b[1] - a[1]).map(([k, n], i) => [label(k), n, subjectStyle(k, i).tone])
    : (s?.subjects ?? []).map((r, i) => [snapshot.subjects[r.label] ?? r.label, r.value, subjectStyle(r.label, i).tone]);
  const singles = (course?.combos ?? []).filter((c) => c.bucket === 1).map((c) => ({ name: `${label(c.parts[0]!.subject)}만`, value: c.students }));
  return (
    <Card id="subjects" title={title("subjects", "과목별 수강")} note="현재 재원생 · 과목별 수강과 동시 수강" sections={[v.students]}>
      {s ? (
        <>
          <VizSlot h={Math.max(112, rows.length * 28)} draw={(w, h) => V.rank(w, h, { rows: rows.map(([n, c]) => [n, c]), unit: "명", tones: rows.map((r) => r[2]), title: "과목별 수강" })} />
          <StatRow><Stat label="동시 수강(영어+수학)" value={`${num(s.concurrent)}명 (${percent(s.concurrent, s.enrolled)}%)`} /></StatRow>
          {singles.length ? <StatRow>{singles.map((c) => <Stat key={c.name} label={c.name} value={`${num(c.value)}명`} />)}</StatRow> : null}
        </>
      ) : null}
    </Card>
  );
}

export function GradesCard() {
  const { v, title } = useBoard();
  const s = v.students?.data;
  const g = s ? gradeColumns(s) : null;
  return (
    <Card id="grades" title={title("grades", "학년별 재원생")} note="현재 재원생 · 학원설정 학년 순 · 영어·수학 수강 구성" sections={[v.students]}>
      {g ? <VizSlot h={176} draw={(w, h) => V.stackColumns(w, h, { rows: g.rows, series: MIX_SERIES, tones: MIX_TONES, unit: "명", groups: g.groups, title: "학년별 재원생" })} /> : null}
    </Card>
  );
}

export function SchoolsCard() {
  const { v, title } = useBoard();
  const s = v.students?.data;
  const groups = s ? schoolGroups(s) : [];
  return (
    <Card id="schools" cls="xl-2" title={title("schools", "학교별 학생")} note="현재 재원생 · 초등·중등·고등" sections={[v.students]}>
      {groups.length ? <VizSlot h={176} draw={(w, h) => V.schoolGroups(w, h, { groups, title: "학교별 학생" })} /> : null}
    </Card>
  );
}

export function AdmissionsCard() {
  const { v, title, snapshot } = useBoard();
  const stats = v.admissions?.data;
  const months = stats ? admissionMonths(stats, snapshot.today) : [];
  return (
    <Card id="admissions" title={title("admissions", "신규 콜&상담 전환")} note="지난달 · 이번 달 · 접수일 기준" sections={[v.admissions]}>
      <div className="admission-months">
        {months.map((m) => (
          <section key={m.key}>
            <header><b>{Number(m.key.slice(5))}월</b><span>{m.tag}</span></header>
            <strong>{m.rate}</strong>
            <p>등록 전환율 · 접수 {m.total === null ? "—" : num(m.total)}건</p>
            {m.parts ? (
              <>
                <VizSlot h={12} draw={(w, h) => V.thinBar(w, h, { parts: m.parts, tones: ["m-yellow", "m-char", "m-l2", "m-l1"], unit: "건", title: `${Number(m.key.slice(5))}월 상담 결과` })} />
                <ul>{m.parts.map(([n, c]) => <li key={n}><span>{n}</span><b>{num(c)}건</b></li>)}</ul>
              </>
            ) : <p>조회 확인 필요</p>}
          </section>
        ))}
      </div>
    </Card>
  );
}

export function RepeatAbsenceCard() {
  const { v, title } = useBoard();
  const data = v.absences?.data;
  const total = data?.rows.length ?? 0;
  const rows = data ? repeatRows(data.rows) : [];
  return (
    <Card id="repeatAbsence" tone="alert" title={title("repeatAbsence", "반복 결석 학생")} note={data?.anchor ? `${monthDay(data.anchor)}까지 14일 · 사전 통보 제외 3회 이상` : "최근 14일 · 사전 통보 제외"} sections={[v.absences]} value={{ label: "확인 필요", num: num(total), unit: "명" }}>
      {total > 0 ? (
        <VizSlot h={132} draw={(w, h) => V.unitRows(w, h, { rows, unit: "명", tone: "m-red", title: "반복 결석 학생" })} />
      ) : <p className="foot">이 기준에 해당하는 학생이 없습니다.</p>}
    </Card>
  );
}

export function Attendance14Card() {
  const { v, title } = useBoard();
  const points = v.attendanceTrend?.data;
  const a = points ? attendance14(points) : null;
  return (
    <Card id="attendance14" title={title("attendance14", "최근 14일 등원율")} note="오늘 포함 14일 · (출석 + 지각) / 유효 출결 칸" sections={[v.attendanceTrend]}>
      {a ? (
        <div className="gauge-card">
          <VizSlot h={PANEL_H} className="gauge-slot" draw={(w, h) => V.gauge(w, h, { value: a.value, label: "14일 등원율", caption: "등원율" })} />
          <div className="gauge-side">
            <VizSlot h={118} draw={(w, h) => V.trend(w, h, { labels: a.days.map((d) => monthDay(d[0])), series: [{ name: "등원율", values: a.days.map((d) => d[1]), tone: "m-char" }], unit: "%", kind: "bar", valueLabels: "none", title: "최근 14일 등원율" })} />
            <p className="foot">출석 + 지각 {num(a.attended)} / 유효 {num(a.valid)}칸</p>
          </div>
        </div>
      ) : null}
    </Card>
  );
}

export function ConsultProgressCard() {
  const { v, title } = useBoard();
  const data = v.consultProgress?.data;
  const steps = data ? consultSteps(data.summary.counts) : [];
  return (
    <Card id="consultProgress" tone="alert" title={title("consultProgress", "상담 진행")} note={data ? `접수일 기준 ${monthDay(data.summary.from)}부터 · 접수 → 수업 시작` : "접수일 기준 최근 30일 · 접수 → 수업 시작"} sections={[v.consultProgress]} value={data ? { label: "멈춘 상담", num: num(data.summary.stalled.length), unit: "건" } : undefined}>
      {data && data.summary.counts.received > 0
        ? <VizSlot h={PANEL_H} draw={(w, h) => V.funnel(w, h, { steps, unit: "건", title: "상담 진행" })} />
        : <p className="foot">최근 30일 신규 콜&amp;상담이 없습니다.</p>}
    </Card>
  );
}

export function ReportsCard() {
  const { v, title, snapshot, extras } = useBoard();
  const homework = v.homework?.data;
  const unread = v.unread?.data;
  const names = (homework?.subjects ?? []).map((k) => snapshot.subjects[k] ?? k).join("·") || "전체 과목";
  const board = extras.report ? reportBoard(extras.report) : null;
  const rate = unread ? board?.rate ?? null : null;
  const values = board?.values.map((n) => n ?? 0) ?? [];
  const note = board ? `학부모 확인 · 주별 숙제 60% 미만 · ${names}` : homework ? `최근 ${homework.windowDays}일 숙제 · ${names}` : "수업보고서 기준";
  return (
    <Card id="reports" cls="xl-2" tone="alert" title={title("reports", "학습 · 학부모 보고")} note={note} sections={[v.homework, v.unread]} value={homework ? { label: "수행률 60% 미만", num: num(homework.students), unit: "명" } : undefined}>
      <TripleCard
        rate={rate === null ? null : { value: rate, label: "48시간 안 학부모 확인", caption: "학부모 확인" }}
        chart={board && values.some((n) => n > 0) ? (w, h) => V.trend(w, h, { labels: board.labels, series: [{ name: "숙제 60% 미만", values: board.values, tone: "m-char" }], format: (n: number) => `${n}%`, kind: "bar", valueLabels: "all", emphasis: board.values.length - 1, title: "주별 숙제 60% 미만" }) : null}
        rows={[
          ...(homework ? [["미제출 학생", `${num(homework.notSubmitted)}명`], ["수행률 0% 학생", `${num(homework.zero)}명`, homework.zero > 0]] as [string, string, boolean?][] : []),
          ...(unread ? [[`미확인(${unread.graceHours}시간 초과)`, `${num(unread.reports)}건`]] as [string, string][] : []),
        ]}
      />
    </Card>
  );
}

export function StudentConsultCard() {
  const { v, title, extras, snapshot } = useBoard();
  const c = v.consultations?.data;
  const board = extras.consult ? consultBoard(extras.consult, snapshot.today) : null;
  return (
    <Card id="studentConsult" cls="xl-2" title={title("studentConsult", "학생 상담")} note={consultNote(extras.consult)} sections={[v.consultations]} value={c ? { label: "최근 7일", num: num(c.lastWeek), unit: "건" } : undefined}>
      {c ? (
        <TripleCard
          rate={board && board.rate !== null ? { value: board.rate, label: "이번 달 담임 상담", caption: "담임 상담" } : null}
          chart={board ? (w, h) => V.trend(w, h, { labels: board.labels, series: [{ name: "상담", values: board.values, tone: "m-char" }], unit: "건", kind: "bar", valueLabels: "all", emphasis: board.values.length - 1, title: "주별 상담" }) : null}
          rows={[
            ...(board ? [["최근 4주", `${num(board.recent)}건${board.change ? ` ${board.change}` : ""}`]] as [string, string][] : []),
            ["이번 달 상담", `${num(c.thisMonth)}건`],
            ["기한 경과", `${num(c.overdueFollowUps)}건`, c.overdueFollowUps > 0],
            ["기한 예정", `${num(c.pendingFollowUps - c.overdueFollowUps)}건`],
          ]}
        />
      ) : null}
    </Card>
  );
}
