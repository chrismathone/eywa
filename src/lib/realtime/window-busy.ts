/**
 * 창 "사용 중(busy)" 신호 — same-origin **BroadcastChannel**로 iframe(플로팅 창 본문)과 부모(워크스페이스
 * 캔버스)를 한 채널로 묶는다. 녹음처럼 끊기면 데이터를 잃는 작업이 진행 중일 때, iframe 안 폼이 자기
 * 창 id로 `{active:true}`를 쏘면 부모의 FloatingWindow가 그 창의 닫기(X)·배경보내기를 잠그고
 * (use-recording-lock 참조), WorkspaceCanvas는 탭 전체 새로고침을 beforeunload로 막는다.
 *
 * winId = 창 store id(`route:meetings/new` 등). 폼은 use-recording-lock이 pathname에서 도출해 넘긴다.
 *
 * ⚠️ client 전용(클라 컴포넌트/훅이 import) — `server-only` 금지([[#61]] 런타임 상수 누출 빌드깨짐).
 */
const CHANNEL_NAME = "eywa-window-busy";

export type WindowBusyMessage = { type: "busy"; winId: string; active: boolean };

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

/** 이 창이 끊기면 안 되는 작업을 시작/종료했음을 같은 origin의 부모·형제 문서에 알린다. */
export function publishWindowBusy(winId: string, active: boolean): void {
  const msg: WindowBusyMessage = { type: "busy", winId, active };
  getChannel()?.postMessage(msg);
}

/** busy 신호 구독. 반환 함수로 해제. */
export function subscribeWindowBusy(cb: (msg: WindowBusyMessage) => void): () => void {
  const ch = getChannel();
  if (!ch) return () => {};
  const handler = (e: MessageEvent) => {
    const m = e.data as WindowBusyMessage | undefined;
    if (m && m.type === "busy") cb(m);
  };
  ch.addEventListener("message", handler);
  return () => ch.removeEventListener("message", handler);
}
