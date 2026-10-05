import type { MakeupSettings } from "./config";

/** 외부 명령 이름. payload 키는 snake_case 이고 설정 키는 config.ts 의 camelCase 다. */
export const MAKEUP_ACTIONS = [
  "intake", "approve", "deny", "assign", "reserve", "reschedule", "cancel",
  "participation", "submit", "verify", "reverse", "waive", "adjust", "hold",
  "resume", "close", "link_legacy", "resolve_reconciliation", "reconcile", "configure",
] as const;
export type MakeupAction = (typeof MAKEUP_ACTIONS)[number];

export type MakeupRuntime = MakeupSettings & {
  /** RPC가 이 응답에서 확인된 경우만 true. 설정 mode 만으로 켜지지 않는다. */
  schemaReady: boolean;
};

export type Eligibility = "pending" | "approved" | "denied";
export type Lifecycle = "open" | "on_hold" | "closed";
export type ParticipantStatus = "unknown" | "present" | "partial" | "no_show" | "cancelled";
export type SourceKind = "attendance" | "manual" | "import";
export type OccurrenceCause = "absence" | "closure" | "additional" | "other";

export type MakeupCommandEnvelope = {
  command_id: string;
  action: MakeupAction;
  payload: Record<string, unknown>;
  expected_revision: number | null;
};

export type MakeupQuantities = {
  target: number | null;
  adjusted: number | null;
  recognized: number | null;
  waived: number | null;
  outstanding: number | null;
  committed: number | null;
  reservable: number | null;
};

/** 성공 본문. 없는 키는 실패다. 해당 없는 값은 null 이다. */
export type MakeupCommandSuccess = {
  id: string;
  revision: number;
  replayed: boolean;
  effect_key: string | null;
  action: string | null;
  case_id: string | null;
  session_id: string | null;
  participant_id: string | null;
  fulfillment_id: string | null;
  case_ids: string[];
  quantities: MakeupQuantities | null;
  warnings: string[];
  /** SQL이 검증 상태를 돌려주면 싣는다. 없으면 null 이고 완료로 치지 않는다. */
  projection_state: "pending" | "done" | "failed" | null;
  verification_code: string | null;
  /** verification.ok 가 참일 때만 참. 키가 없거나 거짓이면 완료가 아니다. */
  verification_ok: boolean;
};

/** 조회 실패를 빈 목록 성공으로 바꾸지 않는다. */
export type ReadOutcome<T> =
  | { status: "off" }
  | { status: "schema_missing" }
  | { status: "failed"; error: string }
  | { status: "ok"; value: T };

export type NativeParticipant = {
  id: string;
  studentId: string;
  subjectKey: string;
  sessionDate: string;
  classId: string | null;
  teacherId: string | null;
  status: ParticipantStatus;
  reportId: string | null;
  attendanceRecordId: string | null;
  legacyReservationId: string | null;
  originalDate: string | null;
  startTime: string | null;
  endTime: string | null;
  anchorClassId: string | null;
  hostClassId: string | null;
  sessionId: string | null;
  caseIds: string[];
};

export type LegacyMap = {
  id: string;
  legacyReservationId: string;
  participantId: string;
  caseId: string;
  effectKey: string;
  state: string;
};

export type ParticipantRead = {
  participants: NativeParticipant[];
  legacyMaps: LegacyMap[];
  truncated: boolean;
  /** 조건에 맞는 전체 줄 수. 응답에 없으면 null 이라 잘림 판정을 대신하지 않는다. */
  total: number | null;
  /** 다음 쪽 커서. 없으면 null. page 와 함께 쓰지 않는다. */
  nextAfter: { session_date: string; start_time: string; id: string } | null;
};

export function featureLive(mode: MakeupSettings["mode"]): boolean {
  return mode === "on" || mode === "draining";
}
