// 등록상담 과목 탭의 점수칸(form-config `type: "score"`) 입력 정규화 — 순수 함수.
//
// 원래는 호출부에서 `value.replace(/[^0-9]/g, "").slice(0, 3)`로 정수만 남겨서 소수점이 통째로
// 사라졌다("67.5" → "675"). 저장소는 `enrollment_consultations.subject_details`(jsonb)이고 값은
// 전부 문자열이라(실측 622개 전건 `string`) DB·서버는 소수를 이미 받아들인다 — 막고 있던 건 이 한 줄뿐.
//
// ⚠️ 타이핑 도중 상태이므로 "완성된 숫자"로 강제하지 않는다. 소수점을 찍은 직후("67.")를 지워버리면
// 소수 자릿수를 영영 못 친다.

/** 정수부 최대 자릿수(기존 3자리 상한 유지 — 100점 만점). */
const MAX_INT_DIGITS = 3;
/** 소수부 최대 자릿수(상위 % 표기가 55.93 형태라 2자리). */
const MAX_FRACTION_DIGITS = 2;

/**
 * 점수칸 입력값 정규화. 숫자와 소수점 하나만 남기고 자릿수를 제한한다.
 * - 소수점 이후를 타이핑 중인 상태("67.")는 그대로 보존한다.
 * - 소수점으로 시작하면 앞에 0을 채운다(".5" → "0.5").
 * - 두 번째 이후의 소수점, 그 밖의 모든 문자(한글·부호·공백)는 버린다.
 * - 기존에 저장된 정수 문자열("69")은 그대로 통과한다(하위 호환).
 */
export function sanitizeScoreInput(raw: string): string {
  const cleaned = String(raw ?? "").replace(/[^0-9.]/g, "");
  if (cleaned === "") return "";

  const dot = cleaned.indexOf(".");
  if (dot === -1) return cleaned.slice(0, MAX_INT_DIGITS);

  // 첫 소수점 기준으로 가르고, 뒤쪽에 남은 소수점은 버린다("6.7.5" → "6.75").
  const intPart = cleaned.slice(0, dot).slice(0, MAX_INT_DIGITS);
  const fracPart = cleaned
    .slice(dot + 1)
    .replace(/\./g, "")
    .slice(0, MAX_FRACTION_DIGITS);
  return `${intPart === "" ? "0" : intPart}.${fracPart}`;
}
