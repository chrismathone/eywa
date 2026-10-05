import { kstToday } from "@/lib/date-kst";
import type { MakeupCaseDetail, MakeupFulfillment, MakeupParticipant, MakeupSession } from "../server/read-types";

const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value)
  ? value as Record<string, unknown> : {};

/** Reads are ordered by creation; version also handles a reordered read without mutating it. */
export function participantEvidence(records: MakeupFulfillment[], participantId: string) {
  const newest = (rows: MakeupFulfillment[]) => rows.reduce<MakeupFulfillment | undefined>((latest, row) =>
    !latest || typeof row.version !== "number" || typeof latest.version !== "number" || row.version >= latest.version ? row : latest, undefined);
  const own = records.filter(row => row.participant_id === participantId);
  return { active: newest(own.filter(row => row.state !== "reversed")), previous: newest(own.filter(row => row.state === "reversed")) };
}

export function participantAvailability(detail: MakeupCaseDetail, participant: MakeupParticipant, session: MakeupSession, actorId: string) {
  const records = detail.fulfillments.filter(row => row.participant_id === participant.id);
  const verified = records.some(row => row.state === "verified");
  const owned = session.teacher_id === actorId || detail.permissions.assign === true;
  const future = session.session_date > (typeof detail.today === "string" ? detail.today : kstToday());
  const cancelled = participant.status === "cancelled";
  const activeSession = ["confirmed", "finished"].includes(session.state);
  // Older detail responses only prove case-level permissions. Keep ownership and record checks per participant.
  const fallback = {
    record: !detail.permissions.participation ? "read_only" : cancelled ? "participant_cancelled" : !activeSession ? "session_closed"
      : verified ? "verified" : future ? "future_session" : !owned ? "not_conductor" : null,
    submit: !detail.permissions.submit ? "read_only" : cancelled ? "participant_cancelled" : verified ? "verified"
      : !activeSession ? "session_closed" : future ? "future_session" : !["present", "partial"].includes(participant.status)
        || !records.some(row => ["draft", "returned"].includes(row.state)) ? "no_open_record" : !owned ? "not_conductor" : null,
    cancel: !detail.permissions.cancel ? "read_only" : cancelled ? "participant_cancelled" : session.state !== "confirmed" ? "session_closed"
      : participant.status !== "unknown" ? "already_recorded" : !owned ? "out_of_scope" : null,
    reschedule: !detail.permissions.reschedule ? "read_only" : object(detail).mode === "draining" ? "draining" : cancelled ? "participant_cancelled"
      : session.state !== "confirmed" ? "session_closed" : participant.status !== "unknown" ? "already_recorded" : !owned ? "not_conductor" : null,
  };
  const actions = object(participant.actions), blocked = object(participant.blocked);
  const entry = (key: keyof typeof fallback) => {
    const allowed = typeof actions[key] === "boolean" ? actions[key] : fallback[key] === null;
    const reason = typeof blocked[key] === "string" ? blocked[key] as string : fallback[key];
    return { allowed, reason };
  };
  return { record: entry("record"), submit: entry("submit"), cancel: entry("cancel"), reschedule: entry("reschedule") };
}

export function participantAttendanceLink(detail: MakeupCaseDetail, participant: MakeupParticipant): string {
  if (typeof participant.attendance_link === "string") return participant.attendance_link;
  const jobs = detail.projection_jobs.filter(job => job.kind === "attendance_effect" && job.effect_key === `att:${participant.id}`);
  if (jobs.some(job => job.state === "failed")) return "failed";
  if (jobs.some(job => job.state === "pending")) return "pending";
  return participant.attendance_record_id ? "linked" : "none";
}

export function participantRecordHref(view: "teacher" | "attendance", caseId: string, participant: MakeupParticipant, session: MakeupSession) {
  const anchor = typeof participant.anchor_class_id === "string" ? participant.anchor_class_id : null;
  if (!anchor) return null;
  if (view === "attendance") return `/attendance?${new URLSearchParams({ class: anchor, month: session.session_date.slice(0, 7) })}`;
  const query = new URLSearchParams({ date: session.session_date, student: participant.student_id, class: anchor, return: `/makeups/${caseId}` });
  return `/onescreen?${query}`;
}
