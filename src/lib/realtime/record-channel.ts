/**
 * 레코드 단위 동시-편집 신호 — same-origin **BroadcastChannel**로 모든 iframe(플로팅 창)·브라우저 탭을
 * 한 채널로 묶는다. 한 곳에서 어떤 레코드를 저장하면 `{scope}` 메시지를 쏘고, 같은 레코드를 편집 중인
 * 다른 창/탭이 받아 경고한다(useConcurrentEditGuard). scope = `student:123`·`tenant-settings:profile` 등.
 *
 * ⚠️ client 전용(클라 컴포넌트/훅이 import) — `server-only` 금지(런타임 상수 누출 빌드깨짐 규칙).
 */
const CHANNEL_NAME = "eywa-record-edits";

export type RecordSavedMessage = { type: "saved"; scope: string; senderId: string };

let channel: BroadcastChannel | null | undefined;
/** 문서별 BroadcastChannel 싱글턴. 미지원(SSR·구형)이면 null → 호출부는 조용히 no-op. */
function getChannel(): BroadcastChannel | null {
  if (channel !== undefined) return channel;
  try {
    channel = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel(CHANNEL_NAME) : null;
  } catch {
    channel = null;
  }
  return channel;
}

/** 이 문서(창/탭)의 발신자 id — 자기 메시지 무시용. 클라 런타임이라 Math.random 사용 가능. */
export const SENDER_ID = Math.random().toString(36).slice(2);

/** 레코드 저장 성공을 같은 origin의 모든 창/탭에 알린다(성공 확정 후 호출 — 제출 시점 아님). */
export function publishRecordSaved(scope: string): void {
  const msg: RecordSavedMessage = { type: "saved", scope, senderId: SENDER_ID };
  getChannel()?.postMessage(msg);
}

/** 다른 발신자의 저장 메시지 구독. 반환 함수로 해제. self(SENDER_ID)는 자동 무시. */
export function subscribeRecordSaved(cb: (msg: RecordSavedMessage) => void): () => void {
  const ch = getChannel();
  if (!ch) return () => {};
  const handler = (e: MessageEvent) => {
    const m = e.data as RecordSavedMessage | undefined;
    if (m && m.type === "saved" && m.senderId !== SENDER_ID) cb(m);
  };
  ch.addEventListener("message", handler);
  return () => ch.removeEventListener("message", handler);
}
