/**
 * 매출 기여 — 시간표 기준 수강료 배분. 급여·현금 수납·이월 정산 결과가 아니다.
 *
 * 할인·유효 환불을 반영한 월 수강료를 저장된 반 배분 또는 정확한 반명·코드로 반에 잇고,
 * 수강 기간·등원 요일·휴원일·당시 담임과 교시 담당을 따라 계획 시수로 나눈다.
 * 분모는 **담당 과목 전체**다. 담당을 잇지 못한 금액도 과목이 확인되면 그 과목 합계에 넣고,
 * 과목 자체를 모르는 금액은 어느 과목으로도 짐작하지 않는다. 청구서별 원 단위 합계는 보존한다.
 */
import { teacherLessonsOn, type TermShareSchedule } from "@/features/attendance/teacher-term-share";
import { distributeReceipt, effectiveAllocations, receiptLines, type AllocationTerm } from "@/features/billing/session-terms/receipt-allocation";
import { enrollmentAttendsOnDay, isEnrollmentActiveOn } from "@/features/enrollments/eligibility";
import { dowOf, monthDays } from "./dates";
import { asLine, isTuitionLine, matchesClass, netReceipt, receiptSubject, revenuePoints, sum } from "./receipt";
import type { PeriodWindow, RevenueResult, SnapshotClass, SnapshotEnrollment, SnapshotInvoice, SnapshotSchedule, SnapshotTerm } from "./types";

export { isTuitionLine, matchesClass, netReceipt, receiptSubject, revenuePoints } from "./receipt";

const numberOrNull = (v: number | string | null | undefined) => (v == null ? null : Number(v));

type Plan = { day: string; teacherId: string; classId: string; weight: number };
type Entry = { day: string; teacherId: string; classId: string; subject: string | null; amount: number; reason: string };

export function buildRevenue(input: {
  classes: readonly SnapshotClass[];
  schedules: readonly SnapshotSchedule[];
  enrollments: readonly SnapshotEnrollment[];
  invoices: readonly SnapshotInvoice[];
  terms: readonly SnapshotTerm[];
  holidays: ReadonlySet<string>;
  subjectLabel: (key: string) => string;
  owner: (c: SnapshotClass, day: string) => string | null;
  /** 그날 재직 중인가(2026-11-11) — 아니면 그 교시는 담당 미확인(시간표 이관이 교시 담당 시작일을 입사 전으로 적은 줄). 없으면 자르지 않는다. */
  employed?: (teacherId: string, day: string) => boolean;
}) {
  const { holidays, owner } = input;
  const classes = new Map(input.classes.map((c) => [c.id, c]));
  const scheduleCache = new Map<string, TermShareSchedule[]>();
  const lessonCache = new Map<string, ReturnType<typeof teacherLessonsOn>>();
  const enrollmentCache = new Map<string, SnapshotEnrollment[]>();
  const entries: Entry[] = [];
  const audit: { month: string; amount: number; allocated: number }[] = [];

  function plan(classId: string, studentId: string, month: string): Plan[] {
    const c = classes.get(classId);
    if (!c || c.is_makeup_pool) return [];
    const ek = `${studentId}|${classId}`;
    let es = enrollmentCache.get(ek);
    if (!es) enrollmentCache.set(ek, (es = input.enrollments.filter((e) => e.student_id === studentId && e.class_id === classId)));
    let slots = scheduleCache.get(classId);
    if (!slots) {
      slots = input.schedules.filter((s) => s.class_id === classId).map((s) => ({
        dayOfWeek: s.day_of_week, startTime: s.start_time, endTime: s.end_time, teacherId: s.teacher_id,
        slotTeacherLabel: s.slot_teacher_label, labSeparate: s.lab_separate, validFrom: s.valid_from, validTo: s.valid_to,
      }) as TermShareSchedule);
      scheduleCache.set(classId, slots);
    }
    const out: Plan[] = [];
    for (const day of monthDays(month)) {
      if (holidays.has(day) || (c.closed_at && day > c.closed_at)) continue;
      const attends = es.some((e) => isEnrollmentActiveOn({ startDate: e.start_date, endDate: e.end_date, onHold: e.on_hold, isTransferred: e.is_transferred }, day)
        && enrollmentAttendsOnDay(e.attendance_days, dowOf(day)));
      if (!attends) continue;
      const k = `${classId}|${day}`;
      let lessons = lessonCache.get(k);
      if (!lessons) {
        lessons = teacherLessonsOn({ date: day, schedules: slots, homeroomTeacherId: owner(c, day), englishTrack: c.english_track ?? null, className: c.class_name });
        lessonCache.set(k, lessons);
      }
      for (const l of lessons) {
        const teacherId = l.owner && input.employed && !input.employed(l.owner, day) ? "" : l.owner;
        out.push({ day, teacherId, classId, weight: l.units });
      }
    }
    return out;
  }

  function allocate(amount: number | undefined, plans: readonly Plan[], month: string, reason: string, subject: string | null = null) {
    if (!amount) return;
    const weights = new Map<string, { id: string; day: string; teacherId: string; classId: string; amount: number }>();
    for (const p of plans) {
      const id = [p.day, p.teacherId, p.classId].join("|");
      const old = weights.get(id);
      if (old) old.amount += p.weight;
      else weights.set(id, { id, day: p.day, teacherId: p.teacherId, classId: p.classId, amount: p.weight });
    }
    // 반을 잇지 못하면 그 달 날짜에 고르게 둔다(진행 중인 달은 기준일까지만 집계된다).
    if (!weights.size) for (const day of monthDays(month)) weights.set(`${day}||`, { id: `${day}||`, day, teacherId: "", classId: "", amount: 1 });
    const shares = distributeReceipt(amount, [...weights.values()]);
    for (const w of weights.values()) {
      if (!shares[w.id]) continue;
      entries.push({
        day: w.day, teacherId: w.teacherId, classId: w.classId, subject: classes.get(w.classId)?.subject ?? subject, amount: shares[w.id],
        reason: !w.teacherId ? (w.classId ? "시간표 담당 미확인" : reason) : reason,
      });
    }
  }

  for (const invoice of input.invoices) {
    const raw: unknown[] = Array.isArray(invoice.line_items) ? invoice.line_items : [];
    const lines = receiptLines(raw);
    const terms = input.terms.filter((t) => t.invoice_id === invoice.id).map((t) => ({
      id: t.id, classId: t.class_id, amount: numberOrNull(t.amount), confirmedSessions: numberOrNull(t.confirmed_sessions),
      lineIndex: t.allocation_line_index ?? null, allocatedAmount: numberOrNull(t.allocation_amount), source: t.allocation_source,
      baseAmount: numberOrNull(t.allocation_base_amount),
    }) satisfies AllocationTerm & { classId: string });
    const valid = effectiveAllocations(lines, terms);
    const days = monthDays(invoice.period);
    const first = days[0];
    const last = days[days.length - 1];
    const candidateIds = [...new Set(input.enrollments
      .filter((e) => e.student_id === invoice.student_id && e.start_date <= last && (!e.end_date || e.end_date >= first)).map((e) => e.class_id))];
    const candidates = candidateIds.map((id) => classes.get(id)).filter((c): c is SnapshotClass => Boolean(c) && !c!.is_makeup_pool);
    const start = entries.length;
    let invoiceNet = 0;
    // 자유 배분은 청구서 전체에 한 번 적용하고, 배분하지 않은 잔액은 보이게 남긴다.
    const free = terms.filter((t) => t.lineIndex === null && (valid.get(t.id) ?? 0) > 0);
    const tuition = raw.filter(isTuitionLine);
    const gross = sum(tuition.map((x) => Math.max(0, Number(asLine(x).amount) || 0)));
    if (free.length && !terms.some((t) => t.lineIndex !== null) && gross > 0) {
      invoiceNet = sum(tuition.map(netReceipt));
      const weights = free.map((t) => ({ id: t.id, amount: valid.get(t.id) ?? 0 }));
      weights.push({ id: "unassigned", amount: Math.max(0, gross - sum(weights.map((w) => w.amount))) });
      const amounts = distributeReceipt(invoiceNet, weights);
      for (const t of free) allocate(amounts[t.id], plan(t.classId, invoice.student_id, invoice.period), invoice.period, "저장된 반 배분", classes.get(t.classId)?.subject ?? null);
      const subjects = new Set(tuition.map((line) => receiptSubject(line)));
      allocate(amounts.unassigned, [], invoice.period, "청구 항목·반 연결 미확인", subjects.size === 1 ? [...subjects][0] : null);
    } else if (raw.length) {
      for (let i = 0; i < raw.length; i++) {
        const line = asLine(raw[i]);
        if (!isTuitionLine(line)) continue;
        const amount = netReceipt(line);
        invoiceNet += amount;
        if (!amount) continue;
        const linked = terms.filter((t) => t.lineIndex === i && valid.has(t.id));
        if (linked.length && sum(linked.map((t) => valid.get(t.id) ?? 0)) > 0) {
          const amounts = distributeReceipt(amount, linked.map((t) => ({ id: t.id, amount: valid.get(t.id) ?? 0 })));
          for (const t of linked) allocate(amounts[t.id], plan(t.classId, invoice.student_id, invoice.period), invoice.period, "저장된 반 배분", classes.get(t.classId)?.subject ?? null);
          continue;
        }
        // 합쳐진 수납 항목의 자식이 서로 다른 반일 수 있다. 실제 금액부터 나눈다.
        const children: unknown[] = Array.isArray(line.sourceItems) && line.sourceItems.length ? line.sourceItems : [line];
        for (const child of children) {
          const childAmount = netReceipt(child);
          if (!childAmount) continue;
          const hits = candidates.filter((c) => matchesClass(child, c));
          // 한 줄이 두 반의 매출이 될 수는 없다. 후보가 여럿이면 잇지 않는다.
          const matched = hits.length === 1 ? hits[0] : null;
          const subjects = new Set(hits.map((c) => c.subject));
          const subject = matched?.subject ?? (subjects.size === 1 ? [...subjects][0] : receiptSubject(child));
          allocate(childAmount, matched ? plan(matched.id, invoice.student_id, invoice.period) : [], invoice.period,
            matched ? "반명·시간표 연결" : "청구 항목·반 연결 미확인", subject);
        }
      }
    } else {
      invoiceNet = Math.max(0, Math.round(Number(invoice.amount_total) - Number(invoice.amount_discount || 0)));
      allocate(invoiceNet, [], invoice.period, "청구 세부 항목 없음");
    }
    const allocated = sum(entries.slice(start).map((e) => e.amount));
    if (allocated !== invoiceNet) throw new Error("Revenue conservation failed");
    audit.push({ month: invoice.period, amount: invoiceNet, allocated });
  }

  return {
    entries,
    audit,
    period(teacherId: string, w: Pick<PeriodWindow, "start" | "end">, scopeSubjects: readonly string[]): RevenueResult {
      const rows = entries.filter((e) => e.day >= w.start && e.day <= w.end);
      const mine = rows.filter((e) => e.teacherId === teacherId);
      const keys = [...new Set([...scopeSubjects, ...mine.map((r) => r.subject)].filter((k): k is string => Boolean(k)))];
      const subjects = keys.map((key) => ({
        key, label: input.subjectLabel(key),
        amount: sum(mine.filter((r) => r.subject === key).map((r) => r.amount)),
        total: sum(rows.filter((r) => r.subject === key).map((r) => r.amount)),
        unassigned: sum(rows.filter((r) => r.subject === key && !r.teacherId).map((r) => r.amount)),
      }));
      const amount = sum(subjects.map((s) => s.amount));
      const subjectTotal = sum(subjects.map((s) => s.total));
      const byClass = new Map<string, number>();
      for (const r of mine) byClass.set(r.classId, (byClass.get(r.classId) ?? 0) + r.amount);
      return {
        value: revenuePoints(amount, subjectTotal), amount, subjectTotal,
        subjectLabel: subjects.map((s) => s.label).join("·") || "담당 과목", subjects,
        unassigned: sum(subjects.map((s) => s.unassigned)),
        unclassified: sum(rows.filter((r) => !r.subject).map((r) => r.amount)),
        detail: [...byClass].map(([id, classAmount]) => ({ className: classes.get(id)?.class_name || "반 미확인", amount: classAmount }))
          .sort((a, b) => b.amount - a.amount),
      };
    },
  };
}
