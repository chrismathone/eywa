/**
 * 수업보고서 **템플릿 채우기** — 순수 함수(Vitest로 잠금).
 *
 * 영어 보고서를 "템플릿 여러 개 + 발송 전 수정"으로 보내기 위한 조립부다(사용자 2026-09-10).
 * 템플릿 = 고정 문구 + `{토큰}`. 값은 호출부가 `{ 토큰: 값 }`으로 넘긴다 — 어떤 칸에서 온 값인지는
 * 여기서 모른다(원스크린·관리자 작성이 같은 함수를 쓰게 하려고 입력을 좁혔다).
 *
 * 학부모에게 나가는 글이라 **빈 칸이 드러나지 않는 것**이 핵심이다:
 *  1. 토큰 뒤 조사는 값의 받침에 맞춘다 — `{학생}이` → `김지우가`. 교재 멘트(`fillMentTemplate`)와 같은 규칙.
 *     `{학생}이는`처럼 호칭 '이'가 붙으면 받침 없는 이름에선 '이'를 뺀다(`김지우는` / `김민준이는`).
 *  2. 한 줄의 토큰이 **전부 비면 그 줄을 지운다** — `테스트 : ` 같은 빈 줄이 나가지 않게.
 *  3. **내용 토큰** 줄이 있던 문단에서 내용 토큰 줄이 하나도 안 남으면 **문단째 지운다** — `💡 다음 시간 테스트 안내`
 *     머리말만 덩그러니 남지 않게. 🔑 `꾸밈 토큰`(보내는 사람·학생 이름)만 남은 머리말(`💌 {작성자} 코멘트`)은
 *     내용이 아니다 — 안 그러면 AI 코멘트가 비었을 때 빈 '코멘트' 머리말이 학부모에게 나간다(적대 리뷰 2026-09-10).
 *     토큰이 원래 없던 문단(인사·맺음말)은 그대로 둔다.
 *  4. **모르는 토큰은 빈 값으로 본다** — `{진도2}` 같은 오타가 중괄호째 학부모에게 나가면 안 된다.
 *     편집 화면이 경고할 수 있게 `unknownTokens`로 돌려준다.
 *  5. 토큰 이름의 공백은 무시한다 — `{다음 테스트}` = `{다음테스트}`.
 */
import { JOSA_ALTERNATION, hasBatchim, pickJosa } from "@/lib/text/josa";

/** 토큰 → 값. 키가 있으면 "아는 토큰"이다(값이 비어도). 키가 없으면 모르는 토큰. */
export type TemplateValues = Readonly<Record<string, string | null | undefined>>;

export type FillOptions = {
  /** 꾸밈 토큰(보내는 사람·학생 이름) — 값이 있어도 문단을 '내용 있음'으로 만들지 않는다(규칙 3). */
  decorationTokens?: readonly string[];
};

export type FilledTemplate = {
  /** 학부모가 받을 글 그대로. */
  text: string;
  /** 템플릿에 적혀 있는데 값 목록에 없는 토큰(공백 제거한 이름, 등장 순). */
  unknownTokens: string[];
  /** 템플릿에 적힌 토큰 전부(공백 제거한 이름, 등장 순, 중복 제거). */
  usedTokens: string[];
};

/** 토큰 한 개 — 이름은 줄바꿈·중괄호 없이 1~20자. */
const TOKEN = "\\{([^{}\\n]{1,20})\\}";

/**
 * 토큰 + **바로 뒤 조사**. 조사는 뒤에 한글이 안 올 때만 조사로 본다 — `{진도}과제`의 `과`를
 * 조사로 오인하지 않게(교재 멘트와 같은 안전장치).
 */
const TOKEN_JOSA_RE = new RegExp(`${TOKEN}(?:(${JOSA_ALTERNATION})(?![가-힣]))?`, "g");
/**
 * `{학생}` + 호칭 '이' + 조사(`{학생}이는`·`{학생}이가`) — 받침 없는 이름이면 '이'를 뺀다(규칙 1).
 * 🔴 **학생 칸에만** 건다 — 다른 칸(`{숙제}이만큼`)의 '이'는 호칭이 아니다. 이름이 비면 조사까지 함께 지운다
 *    (안 지우면 "는 Unit 3을 했어요"가 남는다, 적대 재리뷰 2026-09-10).
 */
const TOKEN_VOCATIVE_RE = /\{\s*학생\s*\}이(는|가|를|의|도|랑|와|에게|한테|만|께)/g;
const TOKEN_ONLY_RE = new RegExp(TOKEN, "g");

/**
 * 빈 값 자리 표시(NUL 문자) — 치환이 끝난 뒤 **그 자리의** 옆 공백 하나와 함께 지운다.
 * 🔴 줄 전체의 연속 공백을 접으면(교재 멘트 방식) 템플릿에 일부러 넣은 간격까지 사라진다 — 빈 자리만 손본다.
 * ⚠️ 소스에 NUL을 직접 적지 않는다(파일이 바이너리로 잡힌다) — 실행 중에 만든다.
 */
const EMPTY_MARK = String.fromCharCode(0);
const EMPTY_LEAD_RE = new RegExp(`^${EMPTY_MARK}[ \\t]*`);
const EMPTY_RE = new RegExp(`[ \\t]?${EMPTY_MARK}`, "g");

export function normalizeTokenName(name: string): string {
  return name.replace(/\s+/g, "");
}

/** 템플릿에 적힌 토큰 이름들(공백 제거, 등장 순, 중복 제거). */
export function templateTokens(template: string): string[] {
  const seen = new Set<string>();
  for (const m of (template ?? "").matchAll(TOKEN_ONLY_RE)) seen.add(normalizeTokenName(m[1]!));
  return [...seen];
}

function valueTable(values: TemplateValues): Map<string, string> {
  const table = new Map<string, string>();
  for (const [k, v] of Object.entries(values)) {
    // 값 안의 NUL은 빈 자리 표시와 부딪히므로 미리 지운다(학부모 글에 들어갈 이유가 없는 글자).
    table.set(normalizeTokenName(k), (v ?? "").split(EMPTY_MARK).join("").trim());
  }
  return table;
}

export function fillReportTemplate(
  template: string,
  values: TemplateValues,
  opts: FillOptions = {},
): FilledTemplate {
  const table = valueTable(values);
  const decoration = new Set((opts.decorationTokens ?? []).map(normalizeTokenName));
  const usedTokens = templateTokens(template);
  const unknownTokens = usedTokens.filter((t) => !table.has(t));
  const valueOf = (raw: string) => table.get(normalizeTokenName(raw)) ?? "";
  const isContent = (raw: string) => !decoration.has(normalizeTokenName(raw));

  const source = (template ?? "").split(EMPTY_MARK).join("").replace(/\r\n?/g, "\n");
  const out: string[] = [];
  for (const block of source.split(/\n[ \t]*\n/)) {
    const kept: string[] = [];
    let hadContentLine = false;
    let keptContentLine = false;
    for (const line of block.split("\n")) {
      const tokens = [...line.matchAll(TOKEN_ONLY_RE)].map((t) => t[1]!);
      if (tokens.length === 0) {
        kept.push(line);
        continue;
      }
      const content = tokens.filter(isContent);
      if (content.length) hadContentLine = true;
      if (tokens.every((t) => valueOf(t) === "")) continue; // 규칙 2
      // 규칙 2의 연장 — 내용 칸이 있는 줄에서 **내용 칸이 전부 비면** 꾸밈 칸만 남아도 줄째 뺀다
      // ("오늘 {학생}이는 {인사말}" → "오늘 김민준이는"만 남는 것 방지).
      if (content.length && content.every((t) => valueOf(t) === "")) continue;
      if (content.some((t) => valueOf(t) !== "")) keptContentLine = true;
      const filled = line
        .replace(TOKEN_VOCATIVE_RE, (_m, particle: string) => {
          const value = valueOf("학생");
          if (!value) return EMPTY_MARK;
          return `${value}${hasBatchim(value) === false ? "" : "이"}${particle}`;
        })
        .replace(TOKEN_JOSA_RE, (_m, name: string, josa?: string) => {
          const value = valueOf(name);
          if (!value) return EMPTY_MARK; // 빈 값이면 조사도 함께 없앤다
          return josa ? `${value}${pickJosa(value, josa)}` : value;
        });
      kept.push(filled.replace(EMPTY_LEAD_RE, "").replace(EMPTY_RE, "").trimEnd());
    }
    if (hadContentLine && !keptContentLine) continue; // 규칙 3
    const text = kept.join("\n").trim();
    if (text) out.push(text);
  }
  return { text: out.join("\n\n").replace(/\n{3,}/g, "\n\n").trim(), unknownTokens, usedTokens };
}
