import { HOMEWORK_VIDEO_MAX_BYTES } from "@/features/students/homework-video-limits";

/** Browser observations only. None of these values establish a completed submission. */
export const UPLOAD_EVENT_KINDS = ["started", "progress", "retry", "failed", "transferred", "confirming", "confirm_retry", "confirm_failed", "confirmed", "hidden", "visible", "page_left", "offline", "online", "stalled"] as const;
export const UPLOAD_FAILURE_REASONS = ["network", "timeout", "aborted", "session_gone", "server_rejected", "server_busy", "server_error", "no_progress", "retry_limit", "confirm_pending", "confirm_error", "confirm_unavailable", "confirm_invalid", "unknown"] as const;
export type UploadFailureReason = typeof UPLOAD_FAILURE_REASONS[number];
export type UploadEvent = {
  kind: typeof UPLOAD_EVENT_KINDS[number]; sequence: number; elapsedMs: number; sentBytes: number;
  phase: "transfer" | "confirm"; reason: UploadFailureReason | null; attempt: number; httpStatus: number | null;
  online: boolean; visibility: "visible" | "hidden"; browser: "kakaotalk" | "edge" | "chrome" | "safari" | "samsung" | "other";
};
export type StoredUploadEvent = UploadEvent & { receivedAt: string };
export type UploadDiagnostics = { last?: StoredUploadEvent; lastError?: StoredUploadEvent; history?: StoredUploadEvent[] };

const reasons: Record<UploadFailureReason, { label: string; help: string }> = {
  network: { label: "영상 서버에 연결하지 못했습니다", help: "Wi-Fi나 데이터를 확인해 주세요. 카카오톡 안에서 열었다면 기본 브라우저에서 다시 시도해 주세요." },
  timeout: { label: "영상 서버의 응답 대기 시간이 지났습니다", help: "연결 상태를 확인하고 다시 올려 주세요." },
  aborted: { label: "영상 전송이 중단됐습니다", help: "다시 올리고 완료 안내가 나올 때까지 이 화면을 열어 두세요." },
  session_gone: { label: "영상 업로드 연결이 만료됐습니다", help: "다시 올리기를 눌러 새로 시작해 주세요." },
  server_rejected: { label: "영상 저장 서버가 전송을 거절했습니다", help: "잠시 뒤에도 같으면 선생님께 업로드 확인번호를 알려 주세요." },
  server_busy: { label: "영상 저장 서버의 요청이 몰려 있습니다", help: "잠시 기다렸다가 다시 올려 주세요." },
  server_error: { label: "영상 저장 서버에서 오류가 발생했습니다", help: "잠시 기다렸다가 다시 올려 주세요." },
  no_progress: { label: "영상 전송 진행이 멈춰 있습니다", help: "연결 상태를 확인하고 화면을 열어 두세요. 응답이 없으면 다시 시도해 주세요." },
  retry_limit: { label: "여러 번 재시도했지만 전송하지 못했습니다", help: "연결 상태를 확인한 뒤 다시 올려 주세요." },
  confirm_pending: { label: "전송 후 제출 완료를 아직 확인하지 못했습니다", help: "잠시 뒤 이 화면을 다시 열어 완료 여부를 확인해 주세요." },
  confirm_error: { label: "전송 후 제출 결과를 확인하는 중 오류가 발생했습니다", help: "잠시 뒤 이 화면을 다시 열어 확인해 주세요. 선생님께 업로드 확인번호를 알려 주셔도 됩니다." },
  confirm_unavailable: { label: "영상 저장 연결을 확인할 수 없습니다", help: "선생님께 업로드 확인번호를 알려 주세요." },
  confirm_invalid: { label: "이 제출 링크로 영상을 등록할 수 없습니다", help: "숙제 올리기 첫 화면에서 숙제를 다시 골라 주세요." },
  unknown: { label: "영상 업로드를 마치지 못했습니다", help: "다시 시도해 주세요. 반복되면 선생님께 업로드 확인번호를 알려 주세요." },
};
export const uploadFailureText = (reason: UploadFailureReason) => reasons[reason];
export function uploadEventLabel(event: UploadEvent): string {
  if (event.reason) return `${reasons[event.reason].label}${event.kind === "retry" || event.kind === "confirm_retry" ? " · 재시도" : ""}`;
  const labels: Record<UploadEvent["kind"], string> = { started: "전송 시작", progress: "전송 중", retry: "전송 재시도", failed: "전송 실패", transferred: "파일 전송 응답 수신", confirming: "제출 완료 확인 중", confirm_retry: "제출 확인 재시도", confirm_failed: "제출 확인 실패", confirmed: "제출 완료", hidden: "화면이 백그라운드로 전환됨", visible: "화면으로 돌아옴", page_left: "제출 화면을 떠남", offline: "기기에서 인터넷 끊김 감지", online: "기기에서 인터넷 연결 감지", stalled: "진행 응답 대기" };
  return labels[event.kind];
}
const integer = (value: unknown, max: number) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= max;
/** Only bounded numbers and enumerated codes. Never save URLs, tokens, file names, raw UA or exception text. */
export function parseUploadEvent(value: unknown): UploadEvent | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  if (!UPLOAD_EVENT_KINDS.includes(v.kind as UploadEvent["kind"]) || !integer(v.sequence, 1_000_000) || v.sequence === 0 || !integer(v.elapsedMs, 172_800_000)
    // 보낸 양의 상한 = 영상 한도 그 값(2026-10-16 2GB) — 숫자를 따로 적으면 한도를 올린 구간의 실패 기록·선생님 알림이 거절된다.
    || !integer(v.sentBytes, HOMEWORK_VIDEO_MAX_BYTES) || !integer(v.attempt, 100) || !(v.httpStatus === null || integer(v.httpStatus, 599))
    || !(v.reason === null || UPLOAD_FAILURE_REASONS.includes(v.reason as UploadFailureReason))
    || !["transfer", "confirm"].includes(String(v.phase)) || typeof v.online !== "boolean" || !["visible", "hidden"].includes(String(v.visibility))
    || !["kakaotalk", "edge", "chrome", "safari", "samsung", "other"].includes(String(v.browser))) return null;
  return { kind: v.kind, sequence: v.sequence, elapsedMs: v.elapsedMs, sentBytes: v.sentBytes, phase: v.phase, reason: v.reason,
    attempt: v.attempt, httpStatus: v.httpStatus, online: v.online, visibility: v.visibility, browser: v.browser } as UploadEvent;
}
export function readUploadDiagnostics(value: unknown): UploadDiagnostics {
  const v = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const read = (e: unknown): StoredUploadEvent | undefined => {
    const event = parseUploadEvent(e); const at = (e as { receivedAt?: unknown } | null)?.receivedAt;
    return event && typeof at === "string" && Number.isFinite(Date.parse(at)) ? { ...event, receivedAt: at } : undefined;
  };
  return { last: read(v.last), lastError: read(v.lastError), history: Array.isArray(v.history) ? v.history.slice(-16).flatMap(e => { const event = read(e); return event ? [event] : []; }) : [] };
}
export function confirmationReason(code: unknown): UploadFailureReason {
  return code === "pending" ? "confirm_pending" : code === "unavailable" ? "confirm_unavailable" : code === "invalid" || code === "mismatch" ? "confirm_invalid" : "confirm_error";
}
