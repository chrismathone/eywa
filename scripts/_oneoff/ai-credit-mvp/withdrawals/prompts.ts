// ① 퇴원 사유 — 프롬프트 버전. 고칠 때는 조정용 표본만 보고 새 버전을 더한다(옛 버전은 남겨 둔다 · version-log.md).
import { GUIDELINES, GUIDELINE_RULES, taxonomyText } from "./guideline";

const OUTPUT_V1 = `답은 JSON 하나:
{"recorded_category":"기록된 분류 글 그대로(없으면 null)","reason":"대분류 key 또는 unknown","detail":"세부 key 또는 null","memo":"reason이 other일 때 실제 사유(원문 표현 20자 안팎) 또는 null","evidence":[{"src":"근거 id","quote":"그 근거 글에서 그대로 복사한 구절"}],"conflict":true|false,"conflict_note":"충돌이면 무엇과 무엇이 어긋나는지 또는 null"}
- evidence는 1~3개. 근거 id = 카드의 [대괄호] id(mk · a:<원본id>:<칸 이름> · e1 · c1 · p1). quote는 **한 글자도 바꾸지 말고** 복사한다(요약·띄어쓰기 수정 금지).
- 사유를 정할 수 없으면 reason은 unknown, 자료가 서로 다른 사유를 말하면 conflict를 true로.`;

export const PROMPTS: Record<string, { system: string; user: (card: string) => string; recordedLine?: true }> = {
  v1: {
    system: `너는 학원 사무실에서 옛 퇴원 기록을 정리하는 직원이다. 학생 한 명의 근거 카드를 읽고 이번 퇴원의 사유를 아래 표로 분류한다.

## 대분류 14 · 세부(key)
${taxonomyText()}

## ${GUIDELINE_RULES}

${OUTPUT_V1}`,
    user: (card) => `아래 카드의 이번 퇴원 사유를 분류하라.\n\n${card}`,
  },
  // v2 — 기준 v2(충돌 세 경우로 한정 · 기록된 분류 우선) + 충돌이어도 후보 사유를 적게(사람이 고를 재료).
  v2: {
    system: `너는 학원 사무실에서 옛 퇴원 기록을 정리하는 직원이다. 학생 한 명의 근거 카드를 읽고 이번 퇴원의 사유를 아래 표로 분류한다.

## 대분류 14 · 세부(key)
${taxonomyText()}

## ${GUIDELINES.v2}

${OUTPUT_V1.replace("- 사유를 정할 수 없으면 reason은 unknown, 자료가 서로 다른 사유를 말하면 conflict를 true로.",
  "- 판단 순서: ① 기록된 분류를 찾는다 ② 규칙 4의 세 경우인지 본다 — 맞으면 conflict=true, reason에는 가장 그럴듯한 후보 ③ 아니면 규칙 3·7로 reason을 정한다. 사유를 정할 수 없으면 reason=unknown.\n- 덧붙은 이유가 있다는 것만으로 conflict를 true로 하지 말 것(규칙 3).")}`,
    user: (card) => `아래 카드의 이번 퇴원 사유를 분류하라.\n\n${card}`,
  },
  // v3 — 카드에 [기록된 분류] 줄 · 기준 v3(읽기 규칙 셋 · 짐작은 근거 아님) · 충돌 경우 번호(코드가 검증한다).
  v3: {
    recordedLine: true,
    system: `너는 학원 사무실에서 옛 퇴원 기록을 정리하는 직원이다. 학생 한 명의 근거 카드를 읽고 이번 퇴원의 사유를 아래 표로 분류한다.

## 대분류 14 · 세부(key)
${taxonomyText()}

## ${GUIDELINES.v3}

${OUTPUT_V1.replace('"conflict":true|false,', '"conflict":true|false,"conflict_case":"1|2|3 또는 null",').replace("- 사유를 정할 수 없으면 reason은 unknown, 자료가 서로 다른 사유를 말하면 conflict를 true로.",
  "- 판단 순서: ① 카드의 [기록된 분류] 줄을 본다 ② 규칙 4의 세 경우인지 본다 — 맞으면 conflict=true · conflict_case에 번호 · reason에는 가장 그럴듯한 후보 ③ 아니면 규칙 3·7로 reason을 정한다. 사유를 정할 수 없으면 reason=unknown.\n- 덧붙은 이유가 있다는 것만으로 conflict를 true로 하지 말 것(규칙 3). [기록된 분류]가 있으면 conflict_case 3은 쓰지 않는다.")}`,
    user: (card) => `아래 카드의 이번 퇴원 사유를 분류하라.\n\n${card}`,
  },
};
// v4 = v3과 같은 틀 · 기준만 v4(결정 계기 · ② 예시 · 읽기 규칙 둘).
PROMPTS.v4 = { ...PROMPTS.v3, system: PROMPTS.v3.system.replace(GUIDELINES.v3, GUIDELINES.v4) };
// v5 = 같은 틀 · 기준 v5(②의 예 둘 · 직전 상담·학부모 글의 결정).
PROMPTS.v5 = { ...PROMPTS.v3, system: PROMPTS.v3.system.replace(GUIDELINES.v3, GUIDELINES.v5) };
