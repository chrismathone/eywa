/**
 * 등록상담 AI 분석 리스트 섹션 후보정 — 약한 모델(Solar) 출력의 형식 붕괴를 렌더 전에 부드럽게 완성.
 * 순수 함수(Vitest). 실 DB 분석 검수로 확인된 3대 붕괴를 교정:
 *   1) 런온: 항목을 줄바꿈 없이 한 줄에 ' - '로 이어붙임 → 항목 경계로 분리.
 *   2) 조각 끊김: 연결어미(~며/~고/~하여/~지만/~는데…)·매달린 조사(등을/및/,)로 끝나 문장이 잘림
 *      → 다음 항목과 병합해 완결(~다)까지 잇는다.
 *   3) 잡음 정리: 빈 항목·중복 공백·마커 잔재 제거.
 * ⚠️ 리스트형 섹션(parentConcerns/parentQuestions/parentRequests/studentTraits/teacherResponse/
 *   salesPoints/agreements/followUps/warnings)에만 적용. 산문(summary 등)은 그대로.
 */

// 줄 머리 불릿/번호 마커.
const LEADING_MARKER = /^\s*(?:[-•·*]|\d+[.)])\s+/;

// 항목이 이 어미/조사로 끝나면 '미완결'(다음 항목과 이어진 조각) — 병합 대상.
// 다중자 위주로 오탐(명사 오인) 최소화. 단, ','·'및'로 끝나도 미완결.
const INCOMPLETE_END =
  /(이며|하며|으며|되며|라며|다며|며|하고|이고|되고|라고|다고|지고|고서|하여|되어|하며는|위해|통해|대해|의해|관해|비해|향해|해서|아서|어서|라서|여서|면서|하면서|으면서|하지만|이지만|되지만|지만|하는데|되는데|인데|는데|은데|하려고|려고|으려고|하도록|도록|하거나|거나|함으로써|으로써|로써|등을|등의|등과|등에|등도|및|,)$/;

/** 한 줄을 런온(' - ' 경계)으로 분해. 숫자 천단위 콤마·단어 내 하이픈은 앞뒤 공백이 없어 안 걸림. */
function splitRunOn(line: string): string[] {
  return line.split(/\s+[-–]\s+/);
}

/** 항목이 미완결(연결어미/매달린 조사로 끝남)인가. */
export function isIncompleteItem(item: string): boolean {
  const t = item.replace(/\s+$/, "");
  if (!t) return false;
  // 문장부호·닫는 괄호·따옴표로 끝나면 완결로 본다(괄호 안 조사 오인 방지).
  if (/[.!?…)\]"'’”]$/.test(t)) return false;
  return INCOMPLETE_END.test(t);
}

/** 두 조각을 한국어 문장으로 잇는다(끝 쉼표는 유지, 그 외 공백 조인). */
function joinFragment(a: string, b: string): string {
  const left = a.replace(/\s+$/, "");
  const right = b.replace(/^\s+/, "");
  return /[,，]$/.test(left) ? `${left} ${right}` : `${left} ${right}`;
}

/** 리스트 섹션 텍스트 → 후보정된 항목들을 줄바꿈으로 결합. */
export function normalizeAiListText(raw: string): string {
  if (!raw || !raw.trim()) return "";

  // 1) 항목 후보 분해: 줄바꿈 + 런온(' - ').
  const rawItems = raw
    .split(/\n+/)
    .flatMap(splitRunOn)
    .map((s) => s.replace(LEADING_MARKER, "").replace(/\s{2,}/g, " ").trim())
    .filter(Boolean);

  // 2) 조각 병합: 앞 항목이 미완결이고 다음이 답변줄(→)이 아니면 이어붙인다.
  const merged: string[] = [];
  for (const item of rawItems) {
    const prev = merged[merged.length - 1];
    if (prev !== undefined && isIncompleteItem(prev) && !/^→/.test(item)) {
      merged[merged.length - 1] = joinFragment(prev, item);
    } else {
      merged.push(item);
    }
  }

  // 3) 학부모 질문 Q&A 태그 교정: Solar가 답을 써놓고도 '(미답변)'을 붙이는 오라벨을 정리.
  return merged.map(cleanQaTags).join("\n");
}

/**
 * '질문 → (답변)/(미답변) 답변' 형태의 태그 잡음 교정.
 * - '→ (미답변) <내용>' : 뒤에 답변 내용이 있으면 실제로 답한 것 → '(미답변)' 태그 제거(오라벨 교정).
 * - '→ (답변) <내용>' : 중복 태그 제거.
 * - '→ (미답변)'(뒤에 내용 없음)은 진짜 미답변이므로 유지.
 */
export function cleanQaTags(item: string): string {
  return item
    .replace(/→\s*\(미답변\)\s*(?=\S)/g, "→ ")
    .replace(/→\s*\(답변\)\s*/g, "→ ")
    .replace(/\s{2,}/g, " ")
    .trim();
}
