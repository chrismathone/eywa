// 전사 통짜 텍스트를 문장 단위로 분리 — 화자 라벨이 없는(diarization 미적용) 녹음도 읽기 좋게.
// 종결부호(. ? ! 。 …) 뒤에 공백이 있을 때만 줄을 나눈다 → 소수점/퍼센트("1.9까지", "99%")는 안 쪼개짐.

/** 문장마다 줄바꿈한 텍스트(whitespace-pre-line으로 렌더). 부호가 없으면 원문 그대로. */
export function breakIntoSentences(text: string): string {
  return splitSentences(text).join("\n");
}

/** 종결부호+공백 경계로 문장 배열 분리. 기존 줄바꿈도 경계로 본다. 빈 조각은 제거. */
export function splitSentences(text: string): string[] {
  return text
    .replace(/([.?!。…])[ \t]+/g, "$1\n") // 종결부호 + (스페이스/탭) → 종결부호 + 개행
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
}
