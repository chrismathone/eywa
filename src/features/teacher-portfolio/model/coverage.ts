/**
 * 보강관리 — 결석 하루에 의무 하나, 보강 한 번은 결석 하나만 채운다.
 *
 * 기한은 결석 다음 달 같은 날(없으면 말일)이고 당일까지 인정한다. 기한이 끝나는 달에 한 번 평가한다.
 * 예정·취소·날짜 없는 메모는 완료로 바꾸지 않고, 후보가 여럿이면 확인 전까지 점수를 주지 않는다.
 */
import { isCalendarDate, sameDayNextMonth } from "./dates";
import type { CoverageResult, CoverageRow, PeriodWindow, SnapshotAttendance, SnapshotClass, SnapshotMakeup } from "./types";

/** 보강 기한 — 결석 다음 달 같은 날(없으면 말일). 당일까지 인정한다. */
export const monthDeadline = sameDayNextMonth;

/** 메모에 적힌 날짜들. 연도가 없으면 기준일에 가장 가까운 해로 읽는다. */
export function datesInNote(note: string | null | undefined, reference: string): string[] {
  const result = new Set<string>();
  for (const m of String(note || "").matchAll(/(?:(20\d{2})[./-])?(\d{1,2})\s*(?:[./-]|월)\s*(\d{1,2})(?:일)?/g)) {
    const year = Number(reference.slice(0, 4));
    const years = m[1] ? [Number(m[1])] : [year - 1, year, year + 1];
    const dates = years
      .map((y) => `${y}-${String(Number(m[2])).padStart(2, "0")}-${String(Number(m[3])).padStart(2, "0")}`)
      .filter(isCalendarDate);
    dates.sort((a, b) => Math.abs(Date.parse(a) - Date.parse(reference)) - Math.abs(Date.parse(b) - Date.parse(reference)));
    if (dates[0]) result.add(dates[0]);
  }
  return [...result];
}

const blocked = (note: string) =>
  /예정|예약|취소|미실시|미완료|미진행|미보강|보강\s*(?:[xX×]|안|못|없|불가|필요)|하지\s*않|안\s*했|못\s*했|완료\s*(?:안|아님)/.test(note);
const completed = (note: string) =>
  /보강/.test(note) && !blocked(note) && /보강\s*(?:완료|실시|함|했|진행\s*완료)|보강.{0,35}수업\s*완료|보강.{0,8}마침/.test(note);

type Absence = {
  id: string; studentId: string; classId: string; subject: string; teacherId: string | null;
  day: string; deadline: string; notes: string[];
};
type MakeupEvent = { key: string; studentId: string; classId: string; day: string; refs: string[]; sources: Set<string> };
type Resolved = {
  obligations: Absence[]; matched: Map<string, { day: string; evidence: string }>; ambiguous: Set<string>; late: Set<string>;
};

export function buildCoverage(input: {
  classes: readonly SnapshotClass[];
  /** 마감 시각까지의 최신 출결(정정 줄은 최신 하나). */
  attendance: readonly SnapshotAttendance[];
  /** 마감 시각까지 완료된 보강 예약. */
  makeupLegacy: readonly SnapshotMakeup[];
  owner: (c: SnapshotClass, day: string) => string | null;
}) {
  const classes = new Map(input.classes.map((c) => [c.id, c]));
  const days = new Map<string, SnapshotAttendance[]>();
  for (const r of input.attendance) {
    if (r.seat_label || r.recorded_via === "seat") continue;
    const k = [r.student_id, r.class_id, r.session_date].join("|");
    const rows = days.get(k);
    if (rows) rows.push(r);
    else days.set(k, [r]);
  }
  const absences: Absence[] = [];
  for (const [id, rows] of days) {
    const r = rows[0];
    const c = classes.get(r.class_id);
    if (!c || c.is_makeup_pool || !rows.some((a) => a.status === "absent")) continue;
    // 일부 교시만 결석해도 그날 의무는 하나다.
    absences.push({
      id, studentId: r.student_id, classId: c.id, subject: c.subject, teacherId: input.owner(c, r.session_date),
      day: r.session_date, deadline: monthDeadline(r.session_date),
      notes: rows.filter((a) => a.status === "absent").map((a) => a.note || ""),
    });
  }
  absences.sort((a, b) => a.day.localeCompare(b.day) || a.id.localeCompare(b.id));

  function resolve(asOf: string): Resolved {
    const obligations = absences.filter((a) => a.day <= asOf);
    const events = new Map<string, MakeupEvent>();
    const add = (event: { studentId: string; classId: string; day: string; refs: string[]; source: string }) => {
      if (event.day > asOf) return;
      const key = [event.studentId, event.classId, event.day].join("|");
      const old = events.get(key);
      if (old) {
        old.refs.push(...event.refs);
        old.sources.add(event.source);
      } else {
        events.set(key, { key, studentId: event.studentId, classId: event.classId, day: event.day, refs: [...event.refs], sources: new Set([event.source]) });
      }
    };
    for (const rows of days.values()) {
      const r = rows[0];
      if (r.session_date > asOf) continue;
      const evidence = rows.filter((a) => a.status === "makeup"
        || (["present", "late", "early_leave"].includes(a.status) && /보강/.test(a.note || "") && !blocked(a.note || "")));
      if (!evidence.length) continue;
      // 상태를 미리 찍어 둔 예정·취소 메모는 보강이 아니다.
      if (evidence.every((a) => blocked(a.note || ""))) continue;
      const refs = [...new Set(evidence.flatMap((a) => datesInNote(a.note, r.session_date)))];
      add({ studentId: r.student_id, classId: r.class_id, day: r.session_date, refs, source: "보강 출결" });
    }
    for (const r of input.makeupLegacy) {
      if (r.status !== "done" || !r.absence_date || !r.makeup_date) continue;
      add({ studentId: r.student_id, classId: r.class_id, day: r.makeup_date, refs: [r.absence_date], source: "완료된 보강 예약" });
    }
    for (const a of obligations) for (const note of a.notes) {
      if (!completed(note)) continue;
      const dates = datesInNote(note, a.day).filter((day) => day >= a.day && day <= asOf);
      if (dates.length !== 1) continue;
      add({ studentId: a.studentId, classId: a.classId, day: dates[0], refs: [a.day], source: "출석부 완료 메모" });
    }
    const matched = new Map<string, { day: string; evidence: string }>();
    const used = new Set<string>();
    const ambiguous = new Set<string>();
    const late = new Set<string>();
    const eventRows = [...events.values()].sort((a, b) => a.day.localeCompare(b.day) || a.key.localeCompare(b.key));
    // 결석일을 명시한 기록이 먼저 자리를 잡는다. 날짜 없는 보강이 그 자리를 먼저 쓰지 않는다.
    for (const explicit of [true, false]) for (const e of eventRows) {
      if (used.has(e.key) || Boolean(e.refs.length) !== explicit) continue;
      const c = classes.get(e.classId);
      let candidates = obligations.filter((a) => a.studentId === e.studentId && a.day <= e.day && !matched.has(a.id)
        && (!explicit || e.refs.includes(a.day)));
      const exact = candidates.filter((a) => a.classId === e.classId);
      candidates = exact.length ? exact : explicit ? candidates.filter((a) => Boolean(c?.subject) && a.subject === c?.subject) : [];
      const inTime = candidates.filter((a) => e.day <= a.deadline);
      // 보강 한 건으로 여러 결석·여러 반을 짐작하지 않는다.
      if (inTime.length === 1) {
        matched.set(inTime[0].id, { day: e.day, evidence: [...e.sources].join(" · ") });
        used.add(e.key);
      } else if (inTime.length > 1) inTime.forEach((a) => ambiguous.add(a.id));
      else if (explicit) candidates.forEach((a) => late.add(a.id));
    }
    return { obligations, matched, ambiguous, late };
  }

  const cache = new Map<string, Resolved>();
  return {
    period(teacherId: string, w: Pick<PeriodWindow, "start" | "end">): CoverageResult {
      let resolved = cache.get(w.end);
      if (!resolved) cache.set(w.end, (resolved = resolve(w.end)));
      const { obligations, matched, ambiguous, late } = resolved;
      const own = obligations.filter((a) => a.teacherId === teacherId);
      const due = own.filter((a) => a.deadline >= w.start && a.deadline <= w.end);
      const open = own.filter((a) => a.deadline > w.end);
      const done = due.filter((a) => matched.has(a.id)).length;
      const pending = open.filter((a) => !matched.has(a.id)).length;
      const detail: CoverageRow[] = [...due, ...open].map((a) => ({
        studentId: a.studentId, className: classes.get(a.classId)?.class_name || "", absence: a.day, deadline: a.deadline,
        makeup: matched.get(a.id)?.day ?? null, evidence: matched.get(a.id)?.evidence ?? "",
        state: a.deadline > w.end
          ? (matched.has(a.id) ? "기한 전 완료" : "기한 내 대기")
          : matched.has(a.id) ? "인정" : late.has(a.id) ? "기한 초과" : ambiguous.has(a.id) ? "연결 확인 필요" : "미완료",
        scored: a.deadline <= w.end,
      }));
      return {
        value: due.length ? Math.round((100 * done) / due.length) / 10 : 10,
        due: due.length, done, pending, early: open.length - pending,
        unconfirmed: due.filter((a) => ambiguous.has(a.id) && !matched.has(a.id)).length, detail,
      };
    },
  };
}
