import { kstDateOf } from "@/lib/date-kst";
import { enrollmentLastDate } from "@/features/enrollments/eligibility";
import { reasonDisplay } from "@/features/withdrawals/types";
import { enrollmentTimeline, type TimelineEnrollment } from "./enrollment/enrollment-timeline";

export type EnrollmentActivity = {
  id: string;
  row_id: string;
  op: string;
  target_label: string | null;
  actor_name: string | null;
  changed: unknown;
  created_at: string;
};
export type EnrollmentAudit = {
  id: string;
  action: string;
  actor_name: string | null;
  metadata: unknown;
  created_at: string;
};
export type EnrollmentHistoryEvent = {
  id?: string;
  date: string;
  kind: "enrollment_start" | "enrollment_end" | "enrollment_transfer" | "enrollment_schedule" | "enrollment_change" | "enrollment_delete";
  title: string;
  description?: string | null;
  registrant?: string | null;
  recordedAt?: string;
};
type ObjectValue = Record<string, unknown>;
const object = (v: unknown): ObjectValue => v && typeof v === "object" && !Array.isArray(v) ? v as ObjectValue : {};
const string = (v: unknown): string | null => typeof v === "string" && v.trim() ? v : null;
const DAY_ORDER = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const DAY_LABELS = ["월", "화", "수", "목", "금", "토", "일"];
/** 수강 행이 사라졌고 반 이름도 어디서도 못 찾았을 때만 쓰는 자리 표시. */
const UNKNOWN_CLASS = "수업";

function days(v: unknown): string[] | null {
  if (!Array.isArray(v) || v.some((d) => typeof d !== "string" || !DAY_ORDER.includes(d))) return null;
  return DAY_ORDER.filter((d) => v.includes(d));
}
export function timelineDaysLabel(value: unknown): string {
  const parsed = days(value);
  if (!parsed) return "요일 기록 없음";
  return parsed.length ? parsed.map((d) => DAY_LABELS[DAY_ORDER.indexOf(d)]).join("·") : "반 전체 요일";
}
const sameDays = (a: string[] | null, b: string[] | null) => JSON.stringify(a) === JSON.stringify(b);
/**
 * 요일 변경 한 줄. 당시 실제 요일로 풀면 앞뒤가 같은 글자가 될 때(금요일만 있는 반에서 금 → 전체 요일)는
 * 지정값으로 적고 당시 요일을 덧붙인다 — "금 → 금"은 변경으로 읽히지 않는다.
 */
function daysChangeLine(oldDays: unknown, newDays: unknown, oldEffective: string[] | null, newEffective: string[] | null): string {
  const from = timelineDaysLabel(oldEffective ?? oldDays);
  const to = timelineDaysLabel(newEffective ?? newDays);
  return from !== to ? `${from} → ${to}` : `${timelineDaysLabel(oldDays)} → ${timelineDaysLabel(newDays)} (당시 반 전체 요일: ${to})`;
}
type EndState = { transferred: boolean; end: string | null };
function actor(name: string | null): string {
  return !name || name.startsWith("system:") || name.startsWith("시스템(") ? "시스템 처리" : name;
}
function hasDiff(v: unknown): v is { old: unknown; new: unknown } {
  const diff = object(v);
  return Object.hasOwn(diff, "old") && Object.hasOwn(diff, "new");
}

/** 수강 행에서 파생한 이력에 실제 변경 기록을 보탠다. 급여 등 다른 로그 필드는 화면으로 내보내지 않는다. */
export function enrollmentHistoryTimeline({ studentId, enrollments, activity, audit = [], currentClassDays = new Map(), classNames = new Map() }: {
  studentId: string;
  enrollments: readonly TimelineEnrollment[];
  activity: readonly EnrollmentActivity[];
  audit?: readonly EnrollmentAudit[];
  currentClassDays?: ReadonlyMap<string, readonly string[]>;
  /** 삭제된 수강의 반 이름(반 id → 지금 이름). 로그에 당시 이름이 남아 있으면 그쪽이 먼저다. */
  classNames?: ReadonlyMap<string, string>;
}): EnrollmentHistoryEvent[] {
  const events: EnrollmentHistoryEvent[] = enrollmentTimeline(enrollments).map((e) => ({ ...e, description: reasonDisplay(e.description) }));
  const context = new Map(enrollments.map((e) => [e.id, e]));
  const currentIds = new Set(enrollments.map((e) => e.id));
  const deleted = new Map<string, ObjectValue>();
  const audits = audit.map((a) => ({ ...a, metadata: object(a.metadata) }));
  const usedDayEdits = new Set<ObjectValue>();
  const dayLogs: { rowId: string; old: string[]; next: string[]; at: string }[] = [];
  const deletedEvents = new Set<string>();
  // 수강 행이 사라진 수강(삭제됨 · 다른 학생에게 옮겨 감)은 생성·삭제 스냅샷에서 되살린다.
  // 삭제 줄이 마지막 상태다 — 예약 수강은 도착 반이 바뀔 수 있어 반·기간·이름 모두 삭제 줄을 먼저 본다.
  // 로그의 대상 이름("학생 · 반")은 비어 있는 기간이 있어(실측 2026-08~09) 같은 반을 가리키는 다른 줄의 이름으로 메운다.
  const offRoster = new Map<string, { snapshot: ObjectValue; classId: string; label: string | null }>();
  for (const row of activity) {
    if (row.op !== "INSERT" && row.op !== "DELETE") continue;
    const snapshot = object(row.changed);
    if (snapshot.student_id !== studentId) continue;
    const classId = string(snapshot.class_id);
    if (!classId) continue;
    const label = string(row.target_label?.split(" · ").slice(1).join(" · "));
    const seen = offRoster.get(row.row_id);
    if (!seen || row.op === "DELETE") offRoster.set(row.row_id, { snapshot, classId, label: label ?? (seen?.classId === classId ? seen.label : null) });
    else if (!seen.label && label && seen.classId === classId) seen.label = label;
    if (row.op === "DELETE") deleted.set(row.row_id, snapshot);
  }
  for (const [rowId, { snapshot, classId, label }] of offRoster) {
    if (context.has(rowId)) continue; // 지금 수강 행이 있으면 그쪽이 정본이다.
    const deletionAudit = audits.find((a) => a.action === "enrollment_delete" && object(a.metadata.snapshot).id === rowId && a.metadata.studentId === studentId);
    // 반 이름: 당시 기록(삭제 감사로그 → 로그의 대상 이름)이 먼저고, 없으면 반의 지금 이름(같은 반의 지금 수강 → 따로 읽은 이름).
    const className = string(deletionAudit?.metadata.className) ?? label
      ?? string(enrollments.find((e) => e.classId === classId)?.className) ?? string(classNames.get(classId)) ?? UNKNOWN_CLASS;
    context.set(rowId, {
      id: rowId, classId, className,
      subject: null, startDate: string(snapshot.start_date) ?? "", endDate: string(snapshot.end_date),
      isTransferred: snapshot.is_transferred === true, reason: string(snapshot.withdrawal_reason),
    });
  }

  const relevant = [...new Map(activity.map((a) => [a.id, a])).values()]
    .filter((a) => context.has(a.row_id)).sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
  // 로그 한 줄이 쓰인 시점의 종료 방식(반 이동 종료인지)과 종료일. 로그는 바뀐 칸만 담으므로 종료일만 고친 줄의
  // 종료 방식은 그때 값으로 되짚는다 — 지금 값으로 읽으면 뒤에 반이동된 수강의 옛 정정이 하루 어긋난다.
  // 마지막 상태를 아는 수강(지금 수강 행 · 삭제 직전 스냅샷)은 최신 → 과거로 되감고, 생성 스냅샷만 있는 수강은 앞으로 감는다.
  const endStates = new Map<string, { before: EndState; after: EndState }>();
  const updatesOf = new Map<string, EnrollmentActivity[]>();
  for (const row of relevant) if (row.op === "UPDATE") updatesOf.set(row.row_id, [...(updatesOf.get(row.row_id) ?? []), row]);
  for (const [rowId, rows] of updatesOf) {
    const enrollment = context.get(rowId)!;
    const gone = deleted.get(rowId);
    const fromLast = currentIds.has(rowId) || !!gone;
    let state: EndState = gone ? { transferred: gone.is_transferred === true, end: string(gone.end_date) } : { transferred: enrollment.isTransferred, end: enrollment.endDate };
    for (const row of fromLast ? [...rows].reverse() : rows) {
      const changes = object(row.changed);
      const transfer = hasDiff(changes.is_transferred) ? changes.is_transferred : null;
      const end = hasDiff(changes.end_date) ? changes.end_date : null;
      const before: EndState = { transferred: transfer ? transfer.old === true : state.transferred, end: end ? string(end.old) : state.end };
      const after: EndState = { transferred: transfer ? transfer.new === true : state.transferred, end: end ? string(end.new) : state.end };
      endStates.set(row.id, { before, after });
      state = fromLast ? before : after;
    }
  }
  for (const row of relevant) {
    const date = kstDateOf(row.created_at);
    if (!date) continue;
    const enrollment = context.get(row.row_id)!;
    const changes = object(row.changed);
    const stamp = { recordedAt: row.created_at, registrant: actor(row.actor_name) };
    if (row.op === "DELETE") {
      const snapshot = deleted.get(row.row_id);
      if (!snapshot) continue;
      const log = audits.find((a) => a.action === "enrollment_delete" && object(a.metadata.snapshot).id === row.row_id && a.metadata.studentId === studentId);
      const end = enrollmentLastDate(string(snapshot.end_date), snapshot.is_transferred === true);
      const draftCount = Array.isArray(log?.metadata.deletedDraftSnapshots) ? log.metadata.deletedDraftSnapshots.length : 0;
      events.push({
        ...stamp, id: `activity:${row.id}`, date, kind: "enrollment_delete", title: `${enrollment.className} 수강 이력 삭제`,
        registrant: actor(log?.actor_name ?? row.actor_name),
        description: [`삭제된 수강 기간: ${string(snapshot.start_date) ?? "시작일 기록 없음"} ~ ${end ?? "종료일 미지정"}`,
          draftCount ? `연결된 미확정 일지 초안 ${draftCount}건 함께 삭제` : null].filter(Boolean).join("\n"),
      });
      deletedEvents.add(row.row_id);
      continue;
    }
    if (row.op !== "UPDATE") continue;

    const attendance = changes.attendance_days;
    const oldDays = hasDiff(attendance) ? days(attendance.old) : null;
    const newDays = hasDiff(attendance) ? days(attendance.new) : null;
    if (oldDays && newDays && !sameDays(oldDays, newDays)) {
      const gap = (edit: ObjectValue, at: string) => Math.abs(Date.parse(string(edit.recordedAt) ?? at) - Date.parse(row.created_at));
      // 감사 기록이 변경 전후 값을 그대로 담고 있으면 같은 저장이다 — 응답이 늦어 5초를 넘겨도 짝짓는다(안 그러면 같은 변경이 두 줄).
      const exact = (edit: ObjectValue) => Object.hasOwn(edit, "beforeDays") && sameDays(days(edit.beforeDays), oldDays) && sameDays(days(edit.days), newDays);
      const matches = audits.filter((a) => a.action === "enrollment_days_update" && (!row.actor_name || a.actor_name === row.actor_name))
        .flatMap((a) => Array.isArray(a.metadata.edits) ? a.metadata.edits.map((e) => ({ edit: object(e), at: a.created_at })) : [])
        .filter(({ edit, at }) => edit.enrollmentId === row.row_id && !usedDayEdits.has(edit)
          && gap(edit, at) < (exact(edit) ? 120_000 : 5000)
          && (!Object.hasOwn(edit, "days") || sameDays(days(edit.days), newDays)))
        .sort((a, b) => Number(exact(b.edit)) - Number(exact(a.edit)) || gap(a.edit, a.at) - gap(b.edit, b.at));
      const edit = matches[0]?.edit ?? {};
      if (matches[0]) usedDayEdits.add(edit);
      dayLogs.push({ rowId: row.row_id, old: oldDays, next: newDays, at: row.created_at });
      const before = !Object.hasOwn(edit, "beforeDays") || sameDays(days(edit.beforeDays), oldDays) ? days(edit.beforeEffectiveDays) : null;
      const after = days(edit.effectiveDays);
      const current = currentClassDays.get(enrollment.classId);
      const unresolvedWholeDays = (!oldDays.length && !before) || (!newDays.length && !after);
      events.push({ ...stamp, id: `activity:${row.id}:days`, date, kind: "enrollment_schedule", title: `${enrollment.className} 등원 요일 변경`,
        description: [daysChangeLine(oldDays, newDays, before, after),
          unresolvedWholeDays && current?.length ? `현재 반 전체 요일: ${timelineDaysLabel(current)}` : null].filter(Boolean).join("\n") });
    }
    for (const field of ["start_date", "end_date"] as const) {
      const diff = changes[field];
      if (!hasDiff(diff)) continue;
      const at = endStates.get(row.id);
      const newTransferred = at ? at.after.transferred : enrollment.isTransferred;
      const oldTransferred = at ? at.before.transferred : enrollment.isTransferred;
      if (field === "end_date" && diff.old === null && string(diff.new)) {
        // 수강 종료/이동 자체는 기존 사건과 합쳐 중복을 피하고 처리자·기록 시각만 보탠다.
        // 파생 종료 사건의 날짜는 지금의 종료 방식으로 잡혀 있다 — 이 로그가 지정한 종료일이 지금도 그대로면 같은 기준으로 찾는다
        // (종료일은 두고 이동 표식만 뒤에 바뀐 수강에서 처리자·시각이 떨어지지 않게).
        const businessDate = string(diff.new) === enrollment.endDate
          ? enrollmentLastDate(enrollment.endDate, enrollment.isTransferred) : enrollmentLastDate(string(diff.new), newTransferred);
        const original = events.find((e) => e.kind === "enrollment_end" && e.date === businessDate && e.title === `${enrollment.className} 수강 종료`
          || e.kind === "enrollment_transfer" && e.date === diff.new && e.title.startsWith(`${enrollment.className} → `));
        if (original) Object.assign(original, stamp);
        continue;
      }
      const before = field === "end_date" ? enrollmentLastDate(string(diff.old), oldTransferred) : string(diff.old);
      const after = field === "end_date" ? enrollmentLastDate(string(diff.new), newTransferred) : string(diff.new);
      if (before === after) continue;
      events.push({ ...stamp, id: `activity:${row.id}:${field}`, date, kind: "enrollment_change", title: `${enrollment.className} ${field === "start_date" ? "시작일" : "종료일"} 정정`,
        description: `${before ?? "미지정"} → ${after ?? "미지정"}` });
    }
    const transfer = changes.is_transferred;
    const endAt = endStates.get(row.id);
    // 종료 방식 '정정'은 그 시점에 종료일이 앞뒤로 다 있을 때만이다. 종료를 새로 지정했거나(없음 → 날짜) 취소했거나(날짜 → 없음)
    // 종료일이 없는 수강의 표식만 풀린 변경에 "일반 수강 종료"라고 적으면 끝나지 않은 수강이 끝난 것으로 읽힌다
    // (운영 로그 표본 2026-10-12: 종료 방식이 바뀐 10건이 전부 종료 취소였다).
    if (hasDiff(transfer) && typeof transfer.old === "boolean" && typeof transfer.new === "boolean" && transfer.old !== transfer.new
      && endAt && endAt.before.end !== null && endAt.after.end !== null) {
      events.push({ ...stamp, id: `activity:${row.id}:end-mode`, date, kind: "enrollment_change", title: `${enrollment.className} 수강 종료 방식 정정`,
        description: `${transfer.old ? "반 이동 종료" : "일반 수강 종료"} → ${transfer.new ? "반 이동 종료" : "일반 수강 종료"}` });
    }
    if (hasDiff(changes.on_hold) && typeof changes.on_hold.new === "boolean") {
      events.push({ ...stamp, id: `activity:${row.id}:hold`, date, kind: "enrollment_change", title: `${enrollment.className} ${changes.on_hold.new ? "수강 휴원" : "수강 재개"}` });
    }
  }
  // 트리거 로그가 누락됐어도 작업 감사로그에 남은 변경 사실은 잃지 않는다.
  // 단 변경 전 값이 함께 적힌 기록만 쓴다 — 같은 값을 다시 저장하면 트리거 로그는 안 남고 감사로그만 남는데,
  // 변경 전 값이 없는 옛 기록은 그것이 실제 변경이었는지 가릴 수 없다(운영 실측 2026-08-19: 8초 뒤 같은 값 재저장).
  for (const log of audits) {
    if (log.action === "enrollment_days_update" && Array.isArray(log.metadata.edits)) {
      for (const [index, raw] of log.metadata.edits.entries()) {
        const edit = object(raw);
        const enrollment = context.get(string(edit.enrollmentId) ?? "");
        const before = days(edit.beforeDays);
        const after = days(edit.days);
        const at = string(edit.recordedAt) ?? log.created_at;
        const date = kstDateOf(at);
        if (!enrollment || !before || !after || !date || usedDayEdits.has(edit) || sameDays(before, after)) continue;
        // 두 저장이 겹치면 뒤 저장은 아무것도 안 바꾸고(트리거 로그 없음) 감사 기록만 남긴다 — 같은 수강·같은 전후 값의 로그가 가까이 있으면 이미 적힌 변경이다.
        if (dayLogs.some((l) => l.rowId === enrollment.id && sameDays(l.old, before) && sameDays(l.next, after) && Math.abs(Date.parse(l.at) - Date.parse(at)) < 120_000)) continue;
        events.push({ id: `audit:${log.id}:days:${index}`, date, kind: "enrollment_schedule", recordedAt: at,
          registrant: actor(log.actor_name), title: `${enrollment.className} 등원 요일 변경`,
          description: daysChangeLine(before, after, days(edit.beforeEffectiveDays), days(edit.effectiveDays)) });
      }
    }
    if (log.action === "enrollment_delete" && log.metadata.studentId === studentId) {
      const snapshot = object(log.metadata.snapshot);
      const id = string(snapshot.id);
      const name = string(log.metadata.className);
      const date = kstDateOf(log.created_at);
      if (!id || !name || !date || deletedEvents.has(id)) continue;
      events.push({ id: `audit:${log.id}:delete`, date, kind: "enrollment_delete", recordedAt: log.created_at,
        registrant: actor(log.actor_name), title: `${name} 수강 이력 삭제`,
        description: `삭제된 수강 기간: ${string(snapshot.startDate) ?? "시작일 기록 없음"} ~ ${enrollmentLastDate(string(snapshot.endDate), snapshot.isTransferred === true) ?? "종료일 미지정"}` });
    }
  }
  return events.sort((a, b) => b.date.localeCompare(a.date) || (b.recordedAt ?? "").localeCompare(a.recordedAt ?? "") || a.title.localeCompare(b.title));
}
