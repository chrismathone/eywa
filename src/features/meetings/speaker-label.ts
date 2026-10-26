// 회의록 화자 이름표(`ai_speaker_roles`) 저장 전 정리 — 순수 함수(⚠️ server-only 금지 [[#61]] — Vitest 대상).
// 이름표는 전사 화면에서 발화마다 `[이름표]`로 붙고 화자 지정 편집기의 초기값이 된다 — 짧은 이름·직함이어야 한다.
// 2026-10-26 시험: Claude Sonnet 5.5가 이름표 자리에 근거·설명문을 썼다(34개 중 32개 — "수학과 담당자로 보이나 이름은 전사에서
// 확인되지 않음 (…특정 불가)"). 옛 저장본에도 같은 꼴이 있다(운영 224개 중 55개가 16자 초과 — "대표 (성명 미상)" ·
// "설현 원장(추정) — 학원 재무·세무 관련 질문…").
// 🔴 짧고 설명이 없는 이름표는 그대로 둔다("대표" · "허은진(수학과, 추정)" · "이승엽 대리(추정)"). 설명이 붙은 것만 앞의
//    이름·직함을 남기고, 남는 게 없으면 버린다(화면은 '화자 A'로 보인다 — 설명문보다 낫다). 이름을 지어 넣지 않는다.

/** 이름표로 쓸 수 있는 길이 — 넘으면 설명이 붙었다고 본다(저장본 실측: 이름·직함은 대개 12자 안쪽). */
export const SPEAKER_LABEL_MAX = 16;
/** 값 전체가 '모름' 표시 — 이름표가 아니다. */
const EMPTY_MARK = /^(미상|없음|불명|알\s?수\s?없음|모름|해당\s?없음|[-—?…]|\.{2,}|화자(\s?[A-Z])?|이름\s?미상|역할\s?미상|성명\s?미상|역할\/이름)$/;
/** 근거·설명 낱말 — 이름표에는 안 나오는 말. */
const EXPLAIN = /(보이|확인|특정|불가|호칭|담당자로|으로\s?보|미상|불명|발언|언급|질문자|추정되|로\s?추정|구체적|표기|가능성|기록되|기록\s?외|없음|않음|않았|같음|듯)/;

const isEmptyMark = (s: string) => EMPTY_MARK.test(s.trim());
/** 괄호 하나 — '(추정)'·짧은 직함·소속은 두고, 설명·긴 괄호는 뗀다. */
const keepParen = (inner: string) => {
  const t = inner.trim();
  return t === "추정" || (t.length <= 8 && !EXPLAIN.test(t));
};

export function cleanSpeakerLabel(raw: string): string {
  // '허은진 (추정)' → '허은진(추정)' — 옛 저장본 꼴(모양만).
  const t0 = raw.replace(/\s+/g, " ").trim().replace(/\s+\(추정\)/g, "(추정)");
  if (!t0 || isEmptyMark(t0)) return "";
  if (t0.length <= SPEAKER_LABEL_MAX && !EXPLAIN.test(t0)) return t0;
  // 1) 괄호 설명을 뗀다 2) ' — '·':' 뒤 설명을 뗀다
  let t = t0.replace(/\s*\(([^()]*)\)/g, (m, inner: string) => (keepParen(inner) ? m : ""));
  t = t.split(/\s[—–-]\s|[:：]|\s—|—\s/)[0]!.trim();
  // 3) 그래도 길면 남은 괄호도 떼고, 그래도 길면 '역할/역할'의 첫 조각
  if (t.length > SPEAKER_LABEL_MAX) t = t.replace(/\s*\([^()]*\)/g, "").trim();
  if (t.length > SPEAKER_LABEL_MAX && t.includes("/")) t = t.split("/")[0]!.trim();
  // 4) '/'로 이은 조각 중 '이름 미상' 같은 빈 표시는 뗀다
  t = t.split("/").map((p) => p.trim()).filter((p) => p && !isEmptyMark(p)).join("/");
  if (!t || t.length > SPEAKER_LABEL_MAX || isEmptyMark(t) || EXPLAIN.test(t.replace(/\(추정\)/g, ""))) return "";
  return t;
}

/** 화자 → 이름표 맵 — 정리 뒤 빈 이름표는 뺀다(그 화자는 '화자 A'로 보인다). */
export function cleanSpeakerLabels(roles: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(roles)) {
    const label = cleanSpeakerLabel(v);
    if (label) out[k] = label;
  }
  return out;
}
