// 명단 집계 — 순수(서버 전용 아님). eywa 원시 행 → 학생별 신호 → 위험 점수.
// queries.ts(서버)가 Supabase에서 받은 행을 이 함수에 넘긴다. fixtures/테스트도 동일 함수 사용.
import {
  scoreStudent,
  ownerFor,
  primaryAction,
  type RetentionSignals,
  type RiskResult,
} from "./risk";
import { averageHomeworkScore } from "./homework-score";
import { kstToday } from "@/lib/date-kst";

export const ATTEND_WINDOW_DAYS = 30;

/**
 * 그 순간의 **KST 날짜**(YYYY-MM-DD).
 * 🔴 `d.toISOString().slice(0, 10)`이었다 — 그건 **UTC 날짜**라 서버(Vercel=UTC)에서 한국 새벽
 *    (00~09시)에 하루 전이 나온다. 이 값이 출결 창의 경계·"오늘 이후" 판정에 쓰이므로 그대로 두면
 *    새벽에 명단이 통째로 하루 밀렸다(전역 KST 규칙, [`date-kst`](@/lib/date-kst)).
 */
export function toIsoDate(d: Date): string {
  return kstToday(d);
}
export function addDays(d: Date, days: number): Date {
  const n = new Date(d);
  n.setDate(n.getDate() + days);
  return n;
}
function pct(score: number | null, max: number | null): number | null {
  if (score == null || max == null || Number(max) <= 0) return null;
  return (Number(score) / Number(max)) * 100;
}
// === eywa 원시 행 형태(Supabase select 결과와 동일, snake_case) ===
export type RawStudentRow = {
  id: string;
  name: string;
  grade: string | null;
  school: string | null;
  notes: string | null;
  ai_care_summary: string | null;
  teacherNames: string[]; // 과목별 담당 강사(단일 담임 대체) — computeRetentionRoster가 수강 반에서 집계
};
export type RawAttendanceRow = {
  student_id: string;
  status: string;
  session_date: string;
  homework_required: boolean;
  homework_done: boolean;
};
/** 수업보고서의 숙제 수행 상태 — 숙제 신호의 1순위 소스(homework-score.ts 주석 참조). */
export type RawReportHomeworkRow = {
  student_id: string;
  report_date: string;
  homework_score: string | null;
};
export type RawGradeRow = {
  student_id: string;
  score: number | null;
  max_score: number | null;
  taken_on: string;
};
export type RawConsultRow = {
  student_id: string;
  consulted_at: string;
  summary: string | null;
  follow_up_date: string | null;
  follow_up_done: boolean;
};
export type RawInvoiceRow = { student_id: string; amount_total: number | string; period: string };
export type RawEnrollmentRow = { student_id: string; end_date: string | null; on_hold: boolean };

export type RetentionRawData = {
  students: RawStudentRow[];
  attendance: RawAttendanceRow[];
  /** 최근 ATTEND_WINDOW_DAYS일 수업보고서의 homework_score. 출석부 체크박스보다 우선. */
  reportHomework: RawReportHomeworkRow[];
  grades: RawGradeRow[];
  consultations: RawConsultRow[];
  invoices: RawInvoiceRow[];
  enrollments: RawEnrollmentRow[];
};

export type RosterStudent = {
  id: string;
  name: string;
  grade: string | null;
  school: string | null;
  teacherName: string | null;
  monthlyFee: number | null;
  nextContactDate: string | null;
  aiCareSummary: string | null;
  memo: string;
  signals: RetentionSignals;
  risk: RiskResult;
  owner: string;
  primaryAction: string;
};

/** 원시 행 → 위험 명단(위험도 내림차순). today를 인자로 받아 결정적·테스트 가능. */
export function buildRoster(raw: RetentionRawData, today: Date): RosterStudent[] {
  const attMid = toIsoDate(addDays(today, -Math.floor(ATTEND_WINDOW_DAYS / 2)));
  const todayIso = toIsoDate(today);

  type Att = { recReq: number; recDone: number; oldReq: number; oldDone: number; absent: number; late: number };
  const att = new Map<string, Att>();
  for (const r of raw.attendance) {
    const a = att.get(r.student_id) ?? { recReq: 0, recDone: 0, oldReq: 0, oldDone: 0, absent: 0, late: 0 };
    if (r.status === "absent") a.absent++;
    if (r.status === "late") a.late++;
    if (r.homework_required) {
      const recent = r.session_date >= attMid;
      if (recent) { a.recReq++; if (r.homework_done) a.recDone++; }
      else { a.oldReq++; if (r.homework_done) a.oldDone++; }
    }
    att.set(r.student_id, a);
  }

  // 숙제 신호는 수업보고서가 1순위 — 출석부 체크박스는 실사용 0건이라 여기에만 의존하면 전원 "숙제 기록 없음"이
  // 된다(homework-score.ts 주석). 윈도를 attMid로 반 갈라 최근/이전 이행률을 내고 하락폭 판정에 쓴다.
  type Hw = { recent: (string | null)[]; older: (string | null)[] };
  const hw = new Map<string, Hw>();
  for (const r of raw.reportHomework) {
    const h = hw.get(r.student_id) ?? { recent: [], older: [] };
    (r.report_date >= attMid ? h.recent : h.older).push(r.homework_score);
    hw.set(r.student_id, h);
  }

  const grades = new Map<string, { last: number | null; prev: number | null }>();
  for (const r of [...raw.grades].sort((a, b) => (a.taken_on < b.taken_on ? 1 : -1))) {
    const g = grades.get(r.student_id) ?? { last: null, prev: null };
    const value = pct(r.score, r.max_score);
    if (value == null) continue;
    if (g.last == null) g.last = value;
    else if (g.prev == null) g.prev = value;
    grades.set(r.student_id, g);
  }

  const consult = new Map<string, { last: string | null; texts: string[]; nextContact: string | null }>();
  for (const r of [...raw.consultations].sort((a, b) => (a.consulted_at < b.consulted_at ? 1 : -1))) {
    const c = consult.get(r.student_id) ?? { last: null, texts: [], nextContact: null };
    if (c.last == null) c.last = r.consulted_at;
    if (r.summary && c.texts.length < 3) c.texts.push(r.summary);
    if (!r.follow_up_done && r.follow_up_date) {
      if (c.nextContact == null || r.follow_up_date < c.nextContact) c.nextContact = r.follow_up_date;
    }
    consult.set(r.student_id, c);
  }

  const fee = new Map<string, number>();
  for (const r of [...raw.invoices].sort((a, b) => (a.period < b.period ? 1 : -1))) {
    if (!fee.has(r.student_id)) fee.set(r.student_id, Number(r.amount_total) || 0);
  }

  const endsIn = new Map<string, number>();
  for (const r of raw.enrollments) {
    if (r.on_hold || !r.end_date || r.end_date < todayIso) continue;
    const days = Math.round((new Date(r.end_date).getTime() - today.getTime()) / 86_400_000);
    const cur = endsIn.get(r.student_id);
    if (cur == null || days < cur) endsIn.set(r.student_id, days);
  }

  const roster = raw.students.map((s) => {
    const a = att.get(s.id);
    const g = grades.get(s.id);
    const c = consult.get(s.id);
    // 수업보고서 → (없으면) 출석부 체크박스 순으로 폴백. 나중에 출석부를 쓰기 시작해도 그대로 동작한다.
    const h = hw.get(s.id);
    const recentRate =
      (h ? averageHomeworkScore(h.recent) : null) ?? (a && a.recReq > 0 ? (a.recDone / a.recReq) * 100 : null);
    const olderRate =
      (h ? averageHomeworkScore(h.older) : null) ?? (a && a.oldReq > 0 ? (a.oldDone / a.oldReq) * 100 : null);
    const homeworkRate = recentRate ?? olderRate;
    // 하락폭은 최근·이전이 둘 다 있을 때만 의미가 있다(최근이 비면 olderRate가 곧 현재값이라 비교 대상 없음).
    const previousHomeworkRate = recentRate != null ? olderRate : null;
    const daysSinceCounsel = c?.last
      ? Math.max(0, Math.round((today.getTime() - new Date(c.last).getTime()) / 86_400_000))
      : null;
    const memo = [s.notes ?? "", ...(c?.texts ?? [])].filter(Boolean).join(" ");

    const signals: RetentionSignals = {
      lastScore: g?.last ?? null,
      previousScore: g?.prev ?? null,
      homeworkRate,
      previousHomeworkRate,
      absences: a?.absent ?? 0,
      lateCount: a?.late ?? 0,
      daysSinceCounsel,
      parentSignalText: memo,
      monthlyFee: fee.get(s.id) ?? null, // 청구 근거 없으면 null — 학년별 추정치 날조 금지
      enrollmentEndsInDays: endsIn.get(s.id) ?? null,
    };
    const risk = scoreStudent(signals);
    const teacherName = s.teacherNames.length > 0 ? s.teacherNames.join("·") : null;

    return {
      id: s.id,
      name: s.name,
      grade: s.grade,
      school: s.school,
      teacherName,
      monthlyFee: signals.monthlyFee,
      nextContactDate: c?.nextContact ?? null,
      aiCareSummary: s.ai_care_summary,
      memo,
      signals,
      risk,
      owner: ownerFor(risk.level, teacherName),
      primaryAction: primaryAction(risk, homeworkRate),
    } satisfies RosterStudent;
  });

  return roster.sort((x, y) => y.risk.score - x.risk.score || (y.monthlyFee ?? -1) - (x.monthlyFee ?? -1));
}

export type RetentionStats = {
  total: number;
  risk: number;
  warn: number;
  ok: number;
  revenueRisk: number;
  scheduled: number;
  renewalRisk: number;
};

/** 명단 → 대시보드 KPI 집계(파생, 순수). */
export function summarizeRoster(roster: RosterStudent[]): RetentionStats {
  let risk = 0, warn = 0, ok = 0, revenueRisk = 0, scheduled = 0, renewalRisk = 0;
  for (const r of roster) {
    if (r.risk.level === "risk") risk++;
    else if (r.risk.level === "warn") warn++;
    else ok++;
    if (r.risk.level !== "ok") revenueRisk += r.monthlyFee ?? 0; // 근거 없는 학생은 매출 위험에 안 싣는다
    if (r.nextContactDate) scheduled++;
    if (r.risk.renewal.tone === "risk") renewalRisk++;
  }
  return { total: roster.length, risk, warn, ok, revenueRisk, scheduled, renewalRisk };
}
