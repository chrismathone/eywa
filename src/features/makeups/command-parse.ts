import { createHash } from "node:crypto";
import type { LegacyMap, MakeupCommandSuccess, MakeupQuantities, NativeParticipant, ParticipantRead, ParticipantStatus } from "./types";

const STATUSES = new Set<ParticipantStatus>(["unknown", "present", "partial", "no_show", "cancelled"]);
const SUCCESS_KEYS = [
  "id", "revision", "replayed", "effect_key", "action", "case_id", "session_id",
  "participant_id", "fulfillment_id", "case_ids", "quantities", "warnings",
] as const;

export function isMissingMakeupRpc(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  const msg = `${error.code ?? ""} ${error.message ?? ""}`;
  return error.code === "PGRST202" || error.code === "42883" || /could not find the function|schema cache|does not exist/i.test(msg);
}

export function isModeOffError(error: { code?: string; message?: string; details?: string } | null | undefined): boolean {
  if (!error) return false;
  return /mode_off/.test(`${error.code ?? ""} ${error.message ?? ""} ${error.details ?? ""}`);
}

/** RPC의 구조화된 권한 거절만 구분한다. 네트워크·파싱 오류는 권한 없음으로 바꾸지 않는다. */
export function isParticipantPermissionDenied(error: { code?: string; details?: string }): boolean {
  if (error.code !== "42501" || !error.details) return false;
  try {
    const details: unknown = JSON.parse(error.details);
    return typeof details === "object" && details !== null && "code" in details && details.code === "forbidden";
  } catch { return false; }
}

/** 같은 문자열은 같은 명령 id 다. 효과 키만 넣으면 본문이 바뀌어도 충돌한다. */
export function stableCommandId(effectKey: string): string {
  const hex = createHash("sha256").update(effectKey).digest("hex").slice(0, 32);
  const variant = ((Number.parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function canonicalPayload(payload: Record<string, unknown>): string {
  return JSON.stringify(Object.keys(payload).sort().map((key) => [key, payload[key]]));
}

/** 효과 키는 참여에 고정한다. 명령 id 는 로그인한 사람과 본문을 함께 해시한다. 같은 사람·같은 본문만 재전송이다. */
export function participationCommandId(
  effectKey: string,
  payload: Record<string, unknown>,
  actorId: string,
): string | null {
  const actor = actorId.trim();
  if (!actor) return null;
  return stableCommandId(`${effectKey}\n${actor}\n${canonicalPayload(payload)}`);
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function quantity(value: unknown): MakeupQuantities | null {
  if (value === null) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const num = (key: string) => (typeof row[key] === "number" ? row[key] as number : null);
  return {
    target: num("target"), adjusted: num("adjusted"), recognized: num("recognized"), waived: num("waived"),
    outstanding: num("outstanding"), committed: num("committed"), reservable: num("reservable"),
  };
}

export function parseCommandSuccess(data: unknown): { ok: true; value: MakeupCommandSuccess } | { ok: false; error: string } {
  if (!data || typeof data !== "object" || Array.isArray(data)) return { ok: false, error: "저장 결과를 확인하지 못했습니다" };
  const row = data as Record<string, unknown>;
  if (SUCCESS_KEYS.some((key) => !(key in row))) return { ok: false, error: "저장 결과를 확인하지 못했습니다" };
  if (typeof row.id !== "string" || typeof row.revision !== "number" || typeof row.replayed !== "boolean") {
    return { ok: false, error: "저장 결과를 확인하지 못했습니다" };
  }
  if (row.effect_key !== null && typeof row.effect_key !== "string") return { ok: false, error: "저장 결과를 확인하지 못했습니다" };
  if (row.quantities !== null && quantity(row.quantities) === null) return { ok: false, error: "저장 결과를 확인하지 못했습니다" };
  const ids = Array.isArray(row.case_ids) ? row.case_ids.filter((id): id is string => typeof id === "string") : [];
  const warnings = Array.isArray(row.warnings) ? row.warnings.filter((item): item is string => typeof item === "string") : [];
  return {
    ok: true,
    value: {
      id: row.id, revision: row.revision, replayed: row.replayed, effect_key: text(row.effect_key),
      action: text(row.action), case_id: text(row.case_id), session_id: text(row.session_id),
      participant_id: text(row.participant_id), fulfillment_id: text(row.fulfillment_id),
      case_ids: ids, quantities: quantity(row.quantities), warnings,
      projection_state: row.projection_state === "pending" || row.projection_state === "done" || row.projection_state === "failed" ? row.projection_state : null,
      verification_code: verificationField(row, "code"),
      verification_ok: verificationField(row, "ok") === "true",
    },
  };
}

function verificationField(row: Record<string, unknown>, key: "code" | "ok"): string | null {
  const verification = row.verification;
  if (!verification || typeof verification !== "object" || Array.isArray(verification)) return null;
  const value = (verification as Record<string, unknown>)[key];
  if (key === "ok") return value === true ? "true" : null;
  return text(value);
}

function participant(raw: unknown): NativeParticipant | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  if (typeof row.id !== "string" || typeof row.student_id !== "string" || typeof row.session_date !== "string") return null;
  const status = STATUSES.has(row.status as ParticipantStatus) ? row.status as ParticipantStatus : "unknown";
  const caseIds = Array.isArray(row.case_ids) ? row.case_ids.filter((id): id is string => typeof id === "string") : [];
  return {
    id: row.id, studentId: row.student_id, subjectKey: text(row.subject_key) ?? "", sessionDate: row.session_date.slice(0, 10),
    classId: text(row.class_id), teacherId: text(row.teacher_id), status, reportId: text(row.report_id),
    attendanceRecordId: text(row.attendance_record_id), legacyReservationId: text(row.legacy_reservation_id),
    originalDate: text(row.original_date), startTime: text(row.start_time), endTime: text(row.end_time),
    anchorClassId: text(row.anchor_class_id), hostClassId: text(row.host_class_id), sessionId: text(row.session_id), caseIds,
  };
}

function legacyMap(raw: unknown): LegacyMap | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  if (typeof row.id !== "string" || typeof row.legacy_reservation_id !== "string") return null;
  return {
    id: row.id, legacyReservationId: row.legacy_reservation_id, participantId: text(row.participant_id) ?? "",
    caseId: text(row.case_id) ?? "", effectKey: text(row.effect_key) ?? "", state: text(row.state) ?? "active",
  };
}

/** 케이스 목록 본문(rows)은 참여가 0건이라는 뜻이 아니다. */
export function parseParticipantBody(data: unknown): { ok: true; value: ParticipantRead } | { ok: false; error: string } {
  if (!data || typeof data !== "object" || Array.isArray(data)) return { ok: false, error: "보강 참여 목록 형식이 올바르지 않습니다" };
  const body = data as Record<string, unknown>;
  if (!("participants" in body) || !("legacy_maps" in body)) return { ok: false, error: "보강 참여 목록 형식이 올바르지 않습니다" };
  if (!Array.isArray(body.participants) || !Array.isArray(body.legacy_maps)) return { ok: false, error: "보강 참여 목록 형식이 올바르지 않습니다" };
  const participants: NativeParticipant[] = [];
  for (const raw of body.participants) {
    const row = participant(raw);
    if (!row) return { ok: false, error: "보강 참여 목록 형식이 올바르지 않습니다" };
    participants.push(row);
  }
  const legacyMaps: LegacyMap[] = [];
  for (const raw of body.legacy_maps) {
    const row = legacyMap(raw);
    if (!row) return { ok: false, error: "보강 참여 목록 형식이 올바르지 않습니다" };
    legacyMaps.push(row);
  }
  const total = typeof body.total === "number" && Number.isInteger(body.total) && body.total >= 0 ? body.total : null;
  return {
    ok: true,
    value: { participants, legacyMaps, truncated: body.truncated === true, total, nextAfter: pageCursor(body.next_after) },
  };
}

function pageCursor(raw: unknown): ParticipantRead["nextAfter"] {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  if (typeof row.session_date !== "string" || typeof row.id !== "string" || row.id.length === 0) return null;
  const start = typeof row.start_time === "string" && row.start_time.length > 0 ? row.start_time.slice(0, 5) : "00:00";
  return { session_date: row.session_date.slice(0, 10), start_time: start, id: row.id };
}

export type ParticipantCursor = { session_date: string; start_time: string; id: string };

/** 목록과 같은 정렬 키. 시작 시각이 없으면 맨 앞으로 둔다. */
export function participantCursor(row: { sessionDate: string; startTime: string | null; id: string }): ParticipantCursor {
  const start = row.startTime?.slice(0, 5) || "00:00";
  return { session_date: row.sessionDate, start_time: start, id: row.id };
}

export function sameParticipantCursor(a: ParticipantCursor, b: ParticipantCursor): boolean {
  return a.session_date === b.session_date && a.start_time === b.start_time && a.id === b.id;
}

/** 잘린 페이지에서 날짜가 끊긴 꼬리를 버리고 다음 날짜로 넘긴다. 하루가 한도를 넘으면 null. */
export function nextParticipantPage(rows: readonly { sessionDate: string }[], from: string): { keep: number; nextFrom: string } | null {
  if (rows.length === 0) return null;
  const last = rows[rows.length - 1]?.sessionDate ?? "";
  let keep = rows.length;
  while (keep > 0 && rows[keep - 1]?.sessionDate === last) keep -= 1;
  if (keep === 0) return null;
  const [year, month, day] = (rows[keep - 1]?.sessionDate ?? "").split("-").map(Number);
  if (!year || !month || !day) return null;
  const nextFrom = new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10);
  return nextFrom > from ? { keep, nextFrom } : null;
}
