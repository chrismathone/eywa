/** Device discovery never asks for microphone access or opens an audio stream. */
export type MicrophoneStatus = "checking" | "available" | "missing" | "blocked" | "unsupported" | "unavailable";
let status: MicrophoneStatus = "checking";
let generation = 0;
const listeners = new Set<() => void>();
let disconnect: (() => void) | undefined;

export const getMicrophoneStatus = () => status;
export const getServerMicrophoneStatus = (): MicrophoneStatus => "checking";
function publish(value: MicrophoneStatus) {
  if (status === value) return;
  status = value;
  for (const listener of listeners) listener();
}

export async function refreshMicrophone(): Promise<MicrophoneStatus> {
  const probe = ++generation;
  let next: MicrophoneStatus;
  if (!navigator.mediaDevices?.enumerateDevices || !navigator.mediaDevices.getUserMedia || typeof MediaRecorder === "undefined") {
    next = "unsupported";
  } else {
    try {
      const permission = await navigator.permissions?.query({ name: "microphone" as PermissionName }).catch(() => null);
      if (permission?.state === "denied") next = "blocked";
      else {
        const devices = await navigator.mediaDevices.enumerateDevices();
        next = devices.some((device) => device.kind === "audioinput") ? "available" : "missing";
      }
    } catch { next = "unavailable"; }
  }
  if (probe === generation) publish(next);
  return next;
}

export function subscribeMicrophone(listener: () => void): () => void {
  listeners.add(listener);
  if (!disconnect) {
    const media = navigator.mediaDevices;
    const refresh = () => { void refreshMicrophone(); };
    const onVisible = () => { if (document.visibilityState === "visible") refresh(); };
    let permission: PermissionStatus | null = null;
    let disposed = false;
    media?.addEventListener?.("devicechange", refresh);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", onVisible);
    void navigator.permissions?.query({ name: "microphone" as PermissionName }).then((value) => {
      if (disposed) return;
      permission = value;
      permission.addEventListener("change", refresh);
    }).catch(() => {});
    refresh();
    disconnect = () => {
      disposed = true;
      media?.removeEventListener?.("devicechange", refresh);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", onVisible);
      permission?.removeEventListener("change", refresh);
    };
  }
  return () => {
    listeners.delete(listener);
    if (!listeners.size) {
      disconnect?.(); disconnect = undefined;
      generation++;
      status = "checking";
    }
  };
}

export function microphoneMessage(value: MicrophoneStatus): string {
  switch (value) {
    case "available": return "";
    case "checking": return "마이크 확인 중…";
    case "missing": return "마이크를 연결해 주세요";
    case "blocked": return "브라우저에서 마이크 사용을 허용해 주세요";
    case "unsupported": return "녹음을 지원하는 최신 브라우저로 열어 주세요";
    case "unavailable": return "마이크를 확인할 수 없습니다. 연결 상태를 확인해 주세요";
  }
}

/** Browser diagnostics belong in the console; the form always gives Korean guidance. */
export function microphoneErrorMessage(error: unknown): string {
  const code = error instanceof Error ? error.name : "UnknownError";
  switch (code) {
    case "NotSupportedError":
      return "이 브라우저에서는 녹음을 시작할 수 없습니다. 최신 브라우저로 다시 열어 주세요.";
    case "NotFoundError": case "DevicesNotFoundError":
      return "마이크가 인식되지 않습니다. 마이크를 연결해 주세요.";
    case "NotAllowedError": case "PermissionDeniedError": case "SecurityError":
      return "마이크 사용이 허용되지 않았습니다. 브라우저와 기기의 마이크 권한을 확인해 주세요.";
    case "NotReadableError": case "TrackStartError":
      return "마이크를 사용할 수 없습니다. 다른 프로그램의 마이크 사용과 연결 상태를 확인해 주세요.";
    case "OverconstrainedError": case "ConstraintNotSatisfiedError":
      return "이 마이크로 녹음을 시작할 수 없습니다. 마이크 연결 상태를 확인해 주세요.";
    default:
      return "녹음을 시작하지 못했습니다. 마이크 연결 상태를 확인한 뒤 다시 시도해 주세요.";
  }
}
