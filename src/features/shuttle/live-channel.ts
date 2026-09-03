/**
 * 셔틀 **실시간 반영** 규약 — 순수 모듈(IO 없음, Vitest). 보내는 쪽(오늘 등하원)과 받는 쪽(관제 화면)이
 * 같은 문자열을 써야 하므로 채널 이름·이벤트 이름을 여기 한 곳에서만 만든다.
 *
 * 원장(2026-09-02): 관리자가 *"그걸"* 본다 — 동승 선생님이 폰에서 찍은 것이 데스크·원장 화면에
 * 바로 나타나야 한다. 지금은 각자 누른 것만 갱신되고(`router.refresh()`), 남이 찍은 건 새로고침해야 보인다.
 *
 * 🔑 **broadcast를 쓴다(`postgres_changes` 아님).** 회의록 StatusWatcher는 postgres_changes를 쓰는데
 *    그건 그 표가 realtime publication에 들어 있어야 동작한다 = **DB 설정이 필요**하다. eywa는 SQL을
 *    원장이 손으로 실행하므로 배포와 설정 사이에 간격이 생기고, 그 사이엔 조용히 아무 일도 안 난다.
 *    broadcast는 설정이 0이고 이미 도는 인프라다(수정중 presence가 같은 WebSocket을 쓴다).
 *
 * 🔴 **payload에 사람·학생 정보를 싣지 않는다.** presence 채널이 v1에서 public이라(edit-presence.tsx
 *    머리 주석) 이 채널도 같은 전제로 본다 — "무언가 바뀌었다"는 신호만 보내고, **무엇이 바뀌었는지는
 *    받는 쪽이 자기 권한으로 다시 조회**한다(router.refresh). 학생 이름이 WebSocket에 흐르지 않는다.
 *
 * 🔑 채널을 **날짜까지 갈라 둔 이유**: 어제 명단을 열어 둔 화면이 오늘 찍는 것마다 새로고침되면
 *    보고 있던 자리가 계속 튄다. 같은 날짜를 보는 사람끼리만 묶인다.
 */

/** 보내는 쪽·받는 쪽이 같은 이름을 써야 한다 — 갈리면 아무 일도 안 일어나고 아무 에러도 안 난다. */
export const SHUTTLE_LIVE_EVENT = "shuttle-changed";

/**
 * 테넌트 × 날짜 단위 채널. 시즌은 넣지 않는다 — 학기중/방학중은 **보기**일 뿐이고, 그날 실제로
 * 도는 건 한 벌이라 갈라 두면 방학 편성을 보는 사람만 갱신이 안 된다.
 */
export function shuttleLiveChannel(tenantId: string, ymd: string): string {
  return `shuttle-day:${tenantId}:${ymd}`;
}

/**
 * 신호 한 건. `sender`는 **내가 보낸 것을 내가 받고 다시 새로고침하는 것을 막기 위한 탭 식별자**이고
 * (사람 id가 아니다), `kind`는 관제 화면이 "무엇 때문에 갱신됐는지" 한 줄 보여줄 때만 쓴다.
 */
export type ShuttleLiveKind = "boarding" | "trip" | "exception";

export type ShuttleLivePayload = {
  sender: string;
  kind: ShuttleLiveKind;
  /** 보낸 시각(ms) — 받는 쪽이 "방금 갱신됨"을 표시하는 데만 쓴다. */
  at: number;
};

/** 낯선 모양이 와도 화면이 죽지 않게 — 채널은 누구나 아무거나 보낼 수 있는 자리다. */
export function isLivePayload(v: unknown): v is ShuttleLivePayload {
  if (!v || typeof v !== "object") return false;
  const p = v as Record<string, unknown>;
  return (
    typeof p.sender === "string" &&
    typeof p.at === "number" &&
    (p.kind === "boarding" || p.kind === "trip" || p.kind === "exception")
  );
}

/**
 * 이 신호에 반응해야 하나 — **내가 보낸 것은 무시한다.**
 *
 * 🔑 내 화면은 서버 액션이 끝나는 즉시 이미 `router.refresh()`를 한다. 내 broadcast까지 받아서 또
 *    새로고침하면 한 번 누를 때마다 왕복이 두 번이고, 빠르게 연달아 찍는 현장에서 화면이 계속 깜빡인다.
 */
export function shouldReactTo(payload: ShuttleLivePayload, myId: string): boolean {
  return payload.sender !== myId;
}

/** 탭마다 하나씩 만드는 식별자 — 사람이 아니라 **화면**을 가른다(한 사람이 폰·PC를 같이 열 수 있다). */
export function newSenderId(random: () => number = Math.random): string {
  return `s${Math.floor(random() * 1e9).toString(36)}${Date.now().toString(36)}`;
}
