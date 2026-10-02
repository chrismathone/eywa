// scripts/_classnote/class-route-halt.mjs — 반 보드 경로의 **비상 정지 표식**(이 프로세스 안, 수업보고서·공지 공용).
//
// 반 보드에는 여러 집이 함께 있다 — 글은 원아를 지정해 올리므로 그 원아에게만 보여야 한다. 게시 뒤 같은 반 **다른** 원아의 알림장에서
// 그 글이 보이면(교차 확인 이상) ClassNote 동작이 우리가 아는 것과 달라졌다는 뜻이라, 원인을 사람이 볼 때까지 반 보드 게시를 전부 멈춘다.
// 수업보고서 쪽(classnote-core.mjs)과 공지 쪽(classnote-notice-core.mjs)이 **같은 표식**을 본다 — 한쪽에서 새는 것이 확인됐는데
// 다른 쪽이 계속 올리면 안 된다(공지에는 개인 본문·교재요청서 이미지가 실린다). 워커를 다시 켜면 풀린다(원인 확인 뒤).
let halted = null;

/** 정지 사유(한글) — 정지 중이 아니면 null. */
export const classRouteHaltReason = () => halted;

/** 반 보드 게시를 멈춘다. 이미 멈춰 있으면 첫 사유를 유지한다. */
export function haltClassRoute(reason) {
  if (!halted) halted = String(reason ?? "").slice(0, 200) || "교차 확인 이상";
}

/** 테스트용 — 표식을 지운다. */
export function resetClassRouteHaltForTest() {
  halted = null;
}
