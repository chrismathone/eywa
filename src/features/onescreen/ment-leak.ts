/**
 * 학부모 글(수업보고서 멘트)에 **AI의 혼잣말·지시 되받기·형식 찌꺼기**가 실리지 않게 하는 마지막 관문(순수 · Vitest).
 * 원장 2026-11-12 *"ai가 환각일으켜서 나오면 안되는 멘트가 나온다면 조건을 걸던 여러방법으로 막아줘"* — 실례:
 * "…공배수와 최소공배수 부분에서 조금 더 시간이 필요해 보였다는 말은 쓰지 않겠습니다.\n"(지시를 되받은 혼잣말 + 줄바꿈 기호 글자).
 *
 * 🔑 고쳐 쓰지 않는다 — 걸린 **문장을 통째로 뺀다**(지어내지 않으려고). 다 빠지면 호출부가 정해진 글·오류로 처리한다.
 * 🔑 모든 AI 멘트 길이 이 한 벌을 지난다: 일반 멘트·추세(`readMentResponse`) · 수학 '오늘의 수업'(`cleanPilotUnderstanding`) ·
 *    사실 항목 말투 다시 쓰기(`acceptRestyle` — 걸리면 코드 글 그대로) · 영어 멘트(`parseEnglishMent`) · 사랑의 한마디 초안(`checkLoveNote`).
 * 🔴 **오탐이 누출보다 나쁠 수 있다**(조용히 빠진 보강 안내 = #118) — 수업 글에 쓰일 수 있는 낱말(규칙·조건·요청·입력·데이터·AI·※·참고)은
 *    넣지 않는다. 혼잣말에만 나오는 **모양**(무엇을 '쓰지 않겠다' · '다시 쓰겠다' · 지침·프롬프트 · 응답 머리말 · 입력 표지)만 잡는다.
 *    새 누출 실례를 보면 여기 한 줄 + 테스트(누출 1 · 같은 낱말의 정상 문장 1).
 */

/** 글자 그대로 남은 이스케이프(`\n` 두 글자 등) — 실제 줄바꿈·공백으로 되돌린다. */
export function unescapeLiteral(text: string): string {
  return text.replace(/\\r\\n|\\n/g, "\n").replace(/\\t/g, " ").replace(/\\r/g, "");
}

/** 학부모에게 보낼 글이 아닌 모양 — 지시 되받기 · 작성 과정 · 응답 머리말 · 입력 표지·형식 찌꺼기. */
const META: readonly RegExp[] = [
  // 지시를 되받는 말 — 무엇(말·표현·문장·단어)을 쓰지/넣지 않겠다
  // ⚠️ '한국말을 쓰지 않았습니다'(영어 수업 칭찬)는 사실이다 — 낱말 앞 글자 경계 + 앞으로의 다짐 꼴(겠·을게)만.
  /(?<![가-힣])(?:말|표현|문장|단어|어휘)[은는을이가]\s*(?:쓰지|사용하지|넣지|적지) 않(?:겠|을게)/,
  // 작성 과정 — 다시 쓰겠다 · 생략·언급하지 않겠다
  /다시 쓰겠|다시 써 드리|다시 작성하겠|고쳐 쓰겠|(?:언급|생략)하지 않겠|생략하겠습니다|언급하지 않았습니다/,
  // 지침·프롬프트를 입에 올린 말
  /지침(?:에|을|대로|상)|프롬프트|금지(?:된)? 표현/,
  // 응답 머리말(편지 본문이 아니다)
  /^(?:알겠습니다|물론입니다)/,
  // 입력 표지·형식 찌꺼기
  /\[(?:기록|입력|부르는 이름|선생님 수업 메모)\]|○○|```|\{\s*"|"\s*\}|\bJSON\b/,
];

/** 이 문장이 혼잣말·찌꺼기인가. `keep`(선생님이 직접 적은 말)에 걸린 글자가 그대로 있으면 혼잣말이 아니다. */
export function hasMentLeak(sentence: string, keep: readonly string[] = []): boolean {
  const s = sentence.trim();
  if (!s) return false;
  for (const re of META) {
    const m = s.match(re);
    if (m && !keep.some((k) => k.includes(m[0]))) return true;
  }
  return false;
}

/**
 * 글에서 걸린 문장만 뺀다 — 줄 구조(문단·항목·표)는 지키고, 뺄 문장이 없는 줄은 글자 하나 바꾸지 않는다.
 * `keep` = 선생님이 직접 적어 글에 들어갈 수 있는 말(특이사항·공지·수업 메모).
 */
export function stripMentLeaks(text: string, keep: readonly string[] = []): { text: string; dropped: string[] } {
  const dropped: string[] = [];
  const kept = keep.map((k) => k.trim()).filter(Boolean);
  const lines = unescapeLiteral(text).split("\n").map((line) => {
    const parts = line.split(/(?<=[.!?。])[ \t]+/);
    const ok = parts.filter((p) => {
      if (!hasMentLeak(p, kept)) return true;
      dropped.push(p.trim());
      return false;
    });
    return ok.length === parts.length ? line : ok.join(" ").trimEnd();
  });
  if (!dropped.length) return { text: lines.join("\n").trim(), dropped };
  // 문장을 뺀 자리에 생긴 빈 줄이 겹치지 않게(문단 구분은 한 줄 비움까지).
  return { text: lines.join("\n").replace(/\n{3,}/g, "\n\n").trim(), dropped };
}

/**
 * 프롬프트에 **코드로** 붙이는 같은 약속(원장이 화면에서 고치는 프롬프트 본문과 따로 — 편집 한 번에 사라지지 않게). 검사(`stripMentLeaks`)가
 * 마지막 관문이고, 이 줄은 처음부터 덜 나오게 하는 첫 관문이다. 줄바꿈 규칙은 출력 계약(`OUTPUT_NEWLINE_RULE`)이 따로 말한다.
 */
export const NO_META_RULE =
  "- 값에는 학부모에게 보낼 문장만 쓰세요. 지시를 따랐다는 말('~라는 말은 쓰지 않겠습니다'), 작성 과정 설명('다시 쓰겠습니다'), 대답('알겠습니다'), 지침 이야기는 절대 쓰지 마세요.";
