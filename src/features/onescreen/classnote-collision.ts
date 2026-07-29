/**
 * ClassNote 동명이인 감지에 **어떤 학생을 세는가** — 순수 규칙(Vitest).
 *
 * 가드의 목적은 "같은 이름의 보드가 둘이라 엉뚱한 집에 게시되는 것"을 막는 것이다. 따라서 세어야 할 대상은
 * **ClassNote 보드가 실제로 존재할 수 있는 학생**뿐이다.
 *
 * 🔴 2026-07-29 원장 승인 — 기존 규칙(`withdrawn`만 제외)은 **예비원생까지 세어 정상 발송을 막았다**:
 * 김수아(중1·재원)가 김수아(초6·prospect) 때문에 `name_conflict`로 차단됐다. 실제로는 재원생도 ClassNote
 * 보드도 하나뿐이라 오배송 위험이 0이었다. 같은 거짓 양성이 3명(김수아·이지호A·전주원), 예비원생은 23명이라
 * 상담이 늘수록 늘어난다. 거짓 양성은 조용한 미발송을 만들고, 강사는 왜 안 갔는지 모른 채 넘어간다.
 *
 * ⚠️ 그래도 **`on_hold`(휴원)는 계속 센다** — 휴원생은 재원 시절 보드가 그대로 남아 있어 진짜 충돌원이다.
 * `prospect`·`consulted`는 등록 전 단계라 원아·보드가 만들어지지 않는다(보드 생성은 등록 후 사무실 작업).
 * 이 목록을 넓히면 거짓 양성이, 좁히면 **오배송**이 늘어난다 — 좁힐 때는 "그 상태에 보드가 존재할 수 있는가"를
 * 근거로만 판단할 것.
 */
export const COLLISION_STATUSES = ["enrolled", "on_hold"] as const;

export type CollisionStatus = (typeof COLLISION_STATUSES)[number];

/** 이 상태의 학생이 동명이인 계산에 포함되는가. */
export function countsForNameCollision(status: string | null | undefined): boolean {
  return !!status && (COLLISION_STATUSES as readonly string[]).includes(status);
}

/** 같은 유효이름 학생 수 → 충돌 여부(본인 포함 2명 이상). */
export function isNameCollision(sameNameCount: number): boolean {
  return sameNameCount > 1;
}
