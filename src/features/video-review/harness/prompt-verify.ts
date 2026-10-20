/**
 * 실수 확인(반박) 지침 — 판정이 낸 실수 주장 하나마다 따로 묻는다(2026-10-20 하네스 4차~).
 * Haiku 판정의 오탐(맞는 비례식을 틀렸다고 함)을 Sonnet 확인이 '애매'로 걸렀고, 진짜 오류는 '확정'으로 남겼다.
 * 확인자는 Sonnet으로 고정한다 — Haiku 확인자는 진짜 오류를 '애매'로 떨어뜨리고 도형 오탐을 '확정'했다(같은 날 실측).
 */

export type MistakeClaim = { where: string; seen: string; why_wrong: string; check?: number; certainty?: string };
export type VerifyVerdict = "확정" | "고침" | "반증" | "애매";

const STEPS = `너는 수학 숙제 영상 판정의 **반박 담당**이다. 다른 조교가 학생의 실수라고 적은 주장 하나를 받는다. 너의 일은 이 주장이 **틀렸을 가능성**을 찾는 것이다.

확인 순서:
1. 주장이 가리키는 화면(where)을 보고, 그 줄을 보이는 그대로 다시 옮겨 적는다. 다른 화면과 last_…_hi에서도 같은 줄을 찾아 비교한다.
2. 글자를 다르게 읽을 여지가 있는지 본다(+/-, 6/16, =/≠, 1/7, 지운 자국, 고쳐 쓴 흔적).
3. 학생이 쓴 식이 맞는 식과 같은 꼴(양변 바꿈·비 뒤집기·순서 바꿈)인지, 그림의 점 위치·조건에 비추어 사실은 맞는지 본다.
4. 학생이 바로 뒤에 스스로 고쳤는지 본다.
판정: '확정'(글자가 또렷하고 분명히 틀렸으며 고치지 않음) / '고침'(틀렸다가 스스로 고침) / '반증'(사실은 맞음) / '애매'(읽기·해석이 확실하지 않음).
JSON 하나만 출력: {"verdict":"확정|고침|반증|애매","reread":"다시 옮겨 적은 줄","why":"한두 문장"}`;

/** 확인 system 지침(고정 글). 짧아서 혼자서는 캐시 최소 길이에 못 미친다 — 캐시 지점은 자료 끝(verifyMaterial)에 둔다. */
export const VERIFY_SYSTEM = STEPS;

/**
 * 확인 자료 — 같은 영상의 주장 N개(최대 4)가 그대로 공유하는 부분(전사 자료 + 화면 목록). 요청은 이 글을 cachePrefix로 보내
 * system·화면·자료까지를 캐시한다(2026-10-21, 원장 "최소요금"). 주장은 그 뒤에 따로 온다 — 전엔 주장이 자료 앞에 있었다.
 */
export function verifyMaterial(material: string, frameLabels: readonly string[]): string {
  return [material, `[화면] ${frameLabels.length}장(이미지로 첨부, 각 이미지 앞에 이름): ${frameLabels.join(", ")}`].join("\n\n");
}

/** 확인 본문 — 주장 하나(자료 뒤에 온다). */
export function verifyPrompt(claim: MistakeClaim): string {
  return `[받은 주장] ${JSON.stringify({ where: claim.where, seen: claim.seen, why_wrong: claim.why_wrong })}`;
}

export function parseVerdict(raw: unknown): VerifyVerdict {
  const v = (raw as { verdict?: unknown } | null)?.verdict;
  return v === "확정" || v === "고침" || v === "반증" || v === "애매" ? v : "애매";
}
