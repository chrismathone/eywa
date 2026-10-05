/** 명령이 성공해도 출결·시수·담당·보고서가 확인되기 전에는 반영 완료가 아니다. */

export type ProjectionEvidence = {
  attendanceRecordId: string | null;
  sessionUnits: number | null;
  sessionUnitsRead: boolean;
  taughtBy: string | null;
  taughtByRead: boolean;
  reportId: string | null;
  actualTeacherId: string | null;
};

export type ProjectionRetryResult = {
  effectKey: string;
  state: "done" | "pending" | "failed";
  commandAccepted: boolean;
  evidence: ProjectionEvidence;
  error: string | null;
  retry: { action: "participation"; effectKey: string; participantId: string };
};

export function judgeProjectionEvidence(input: {
  commandSent: boolean;
  commandAccepted: boolean;
  commandError: string | null;
  evidence: ProjectionEvidence;
}): { state: "done" | "pending" | "failed"; error: string | null } {
  if (!input.commandSent) return { state: "pending", error: null };
  if (!input.commandAccepted) return { state: "failed", error: input.commandError ?? "보강 참여를 저장하지 못했습니다" };
  const row = input.evidence;
  const ready = !!row.attendanceRecordId && row.sessionUnitsRead && row.taughtByRead && !!row.actualTeacherId && !!row.reportId;
  return ready ? { state: "done", error: null } : { state: "pending", error: null };
}

export type SqlProjection = {
  readable: boolean;
  state: "pending" | "done" | "failed" | null;
  verificationOk: boolean;
  evidence: ProjectionEvidence;
};

const EMPTY_EVIDENCE: ProjectionEvidence = {
  attendanceRecordId: null, sessionUnits: null, sessionUnitsRead: false,
  taughtBy: null, taughtByRead: false, reportId: null, actualTeacherId: null,
};

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value !== "" && Number.isFinite(Number(value))) return Number(value);
  return null;
}

function asText(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function evidenceFrom(raw: unknown): ProjectionEvidence {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ...EMPTY_EVIDENCE };
  const row = raw as Record<string, unknown>;
  return {
    attendanceRecordId: asText(row.attendance_record_id),
    sessionUnits: asNumber(row.session_units),
    sessionUnitsRead: Object.prototype.hasOwnProperty.call(row, "session_units"),
    taughtBy: asText(row.taught_by),
    taughtByRead: Object.prototype.hasOwnProperty.call(row, "taught_by"),
    reportId: asText(row.report_id),
    actualTeacherId: asText(row.actual_teacher_id),
  };
}

/** makeup_projection_evidence 본문. state 가 없거나 깨지면 완료로 읽지 않는다. */
export function parseSqlProjection(data: unknown): SqlProjection {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return { readable: false, state: null, verificationOk: false, evidence: { ...EMPTY_EVIDENCE } };
  }
  const row = data as Record<string, unknown>;
  const raw = row.projection_state ?? row.state;
  const state = raw === "pending" || raw === "done" || raw === "failed" ? raw : null;
  const verification = row.verification;
  const verificationOk = !!verification && typeof verification === "object" && !Array.isArray(verification)
    && (verification as Record<string, unknown>).ok === true;
  return { readable: true, state, verificationOk, evidence: evidenceFrom(row.evidence) };
}

function evidenceReady(row: ProjectionEvidence): boolean {
  return !!row.attendanceRecordId && row.sessionUnitsRead && row.taughtByRead && !!row.actualTeacherId;
}

/**
 * 완료는 SQL state=done, verification.ok, 증거 칸이 모두 있을 때만.
 * 빈 응답·부분 증거·대기 상태는 완료가 아니다. 이 함수는 시수·청구를 쓰지 않는다.
 */
export function judgeSqlProjection(input: SqlProjection): { state: "done" | "pending" | "failed"; error: string | null } {
  if (!input.readable) return { state: "pending", error: "보강 반영을 확인하지 못했습니다" };
  if (input.state === "failed") return { state: "failed", error: "보강 반영을 확인하지 못했습니다" };
  if (input.state === "done" && input.verificationOk && evidenceReady(input.evidence)) return { state: "done", error: null };
  return { state: "pending", error: null };
}
