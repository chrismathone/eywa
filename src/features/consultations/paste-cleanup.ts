/**
 * 붙여 넣기로 딸려 온 **화면 코드 조각**을 걷어낸다(순수·Vitest).
 *
 * 원장 2026-09-09: 정하운 상담 본문에 이런 줄이 끼어 있었다 — *"원본이 그런건가?"* → 옛 시스템에서 그대로
 * 넘어온 것이었고 *"그 조각만 걷어내. 앞으로 가져올때도 조심."*
 *
 * ```
 * *]:pointer-events-auto scroll-mt-[calc(var(--header-height)+…)]" tabindex="-1" dir="auto"
 * data-turn-id="request-WEB:3f1776a5-…" data-testid="conversation-turn-10" data-turn="assistant">
 * ```
 * 사람이 웹 AI 대화창에서 글을 복사할 때 **DOM 속성까지** 함께 붙은 흔적이다(실측 8건, 전부 한 줄짜리).
 *
 * 🔴 **줄 단위로만** 지운다 — 문장 중간을 정규식으로 도려내면 `<`가 든 정상 문장(`x < 3`)이 깨진다.
 * 🔴 조각 **뒤에 사람이 쓴 글이 붙어 있으면 그것만 남긴다**(마지막 `>` 뒤). 통째로 지우면 실제 상담 내용이
 *    함께 사라진다 — 실측 8건은 전부 `>`로 끝나 남는 글이 없지만, 다음 붙여넣기가 그러리라는 보장은 없다.
 * ⚠️ 한글이 섞인 줄은 **표식이 확실할 때만** 건드린다(잡음 제거가 본문을 먹는 쪽이 더 나쁘다).
 */

/** 화면 코드 조각임을 가리는 확실한 표식 — 사람이 쓴 상담 글엔 나올 수 없는 것들. */
const MARKUP_MARKERS = [
  /data-(?:turn-id|turn|testid|scroll-anchor)\s*=/i,
  /\btabindex\s*=\s*"/i,
  /\bdir\s*=\s*"(?:auto|ltr|rtl)"/i,
  /pointer-events-(?:auto|none)/i,
  /scroll-mt-\[/i,
  /\bclass\s*=\s*"[^"]*\b(?:flex|grid|text-|bg-)/i,
];

/** 속성 쌍(`key="value"`)이 여러 개인데 한글이 하나도 없는 줄 — 표식이 없어도 사람 글이 아니다. */
function looksLikeAttributeSoup(line: string): boolean {
  if (/[가-힣]/.test(line)) return false;
  const pairs = line.match(/[a-zA-Z-]+\s*=\s*"[^"]*"/g);
  return (pairs?.length ?? 0) >= 2;
}

function isMarkupLine(line: string): boolean {
  return MARKUP_MARKERS.some((re) => re.test(line)) || looksLikeAttributeSoup(line);
}

/**
 * 한 줄을 정리한다.
 * @returns 남길 문자열, 또는 줄을 통째로 버릴 때 null.
 */
function cleanLine(line: string): string | null {
  if (!isMarkupLine(line)) return line;
  const close = line.lastIndexOf(">");
  if (close >= 0) {
    // 조각 뒤에 붙은 사람 글은 살린다(`…data-turn="assistant">안다고 하면서 …`).
    const tail = line.slice(close + 1).trim();
    return tail === "" ? null : tail;
  }
  // 닫는 `>`가 없다 — 한글이 없으면 통째로 잡음이고, 한글이 있으면 **그대로 둔다**(본문을 먹지 않는다).
  return /[가-힣]/.test(line) ? line : null;
}

/**
 * 붙여넣기 잡음을 걷어낸 본문. 잡음이 없으면 **원문 그대로**(공백·줄바꿈도 안 건드린다).
 * ⚠️ 저장 경로와 가져오기 경로가 같은 함수를 쓴다 — 한쪽만 고치면 다음 임포트에서 되살아난다.
 */
export function stripPastedMarkup(value: string | null | undefined): string | null {
  if (typeof value !== "string" || value === "") return value ?? null;
  if (!value.split(/\r?\n/).some(isMarkupLine)) return value;
  const eol = value.includes("\r\n") ? "\r\n" : "\n";
  const kept = value
    .split(/\r?\n/)
    .map(cleanLine)
    .filter((line): line is string => line !== null);
  return kept.join(eol);
}

/** 이 글에 화면 코드 조각이 섞여 있나 — 정리 대상 세기·가드용. */
export function hasPastedMarkup(value: string | null | undefined): boolean {
  return typeof value === "string" && value.split(/\r?\n/).some(isMarkupLine);
}
