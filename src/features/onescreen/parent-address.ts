/**
 * 특이사항 속 **학부모께 직접 드리는 사과·양해 문장** — AI를 거치지 않고 멘트 맨 앞에 그대로 싣는다(순수 함수).
 *
 * 🔴 왜(2026-09-22 강사 제보, 이수진 선생님 9/18 금 2교시 네 명): 발송이 늦어 특이사항에
 *    *"9월 18일(금) 수업일지 발송을 누락시켜서 늦게 보내드려서 죄송합니다."*를 똑같이 적었는데, 김지호 멘트에만
 *    반영되고 김근호·한지민·정지우는 빠져 선생님이 손으로 넣어 보냈다. 멘트 프롬프트의 *"인사말·끝인사·날짜 금지"*가
 *    날짜가 든 사과 문장을 걸러 내라는 뜻으로 읽혀 모델이 **때때로** 뺀다 — 확률 문제라 프롬프트 문구로는 못 막는다
 *    (게다가 프롬프트 본문은 원장이 편집하는 자리다). 선생님이 학부모께 쓴 말은 **사실 재료가 아니라 전할 말**이므로
 *    모델에 주지 않고 코드가 그대로 붙인다 — 매번 같은 결과가 나온다.
 *
 * 판정은 좁게 — 문장이 **사과·양해의 존댓말로 끝날 때만**(`…죄송합니다.` · `…양해 부탁드립니다.` · `…사과드립니다.`),
 *   그리고 한 문장답게 짧고(90자) 나열이 아니며(쉼표 ≤1) 인용·화자 표기가 아닐 때만.
 *   · "지각해서 죄송하다고 했습니다"(아이의 말을 전하는 관찰)는 끝이 달라 걸리지 않는다 — 종전대로 AI가 녹여 쓴다.
 *   · 못 잡으면 종전과 같다(무해). 잘못 잡으면 관찰 한 문장이 다듬어지지 않고 그대로 나갈 뿐 사실은 안 바뀐다.
 */

/** 사과·양해로 **끝나는** 문장 — 끝의 마침표·느낌표·물결·이모티콘(^^ ㅠㅠ)·공백은 허용. */
const PARENT_ADDRESS_END =
  /(죄송합니다|죄송했습니다|죄송스럽습니다|죄송해요|양해\s*부탁\s*드립니다|양해\s*부탁\s*드려요|양해\s*바랍니다|사과\s*드립니다|사과의\s*말씀을?\s*드립니다)\s*[.!。~^ㅠㅜ]*\s*$/;

/**
 * 한 문장으로 보기엔 너무 긴 후보는 AI에 맡긴다 — 부호 없이 관찰 여러 개를 이어 쓴 메모가 통째로 학부모 글 첫 줄에
 * 원문 그대로 서는 것을 막는다(적대 리뷰 2026-09-22). 제보 사례는 44자다.
 */
const MAX_ADDRESS_LEN = 90;
/** 쉼표가 둘 이상이면 개조식 나열("개념 부족, 오답노트 필요, … 죄송합니다")로 보고 AI에 맡긴다. */
const MAX_ADDRESS_COMMAS = 1;
/** "민수: 선생님 죄송합니다." — 화자 표기는 아이·학부모의 말을 옮긴 것이다(선생님의 사과가 아니다). */
const SPEAKER_PREFIX = /^[^\s:：]{1,12}\s*[:：]\s/;

/** 따옴표 짝이 맞나 — 인용문 한가운데서 잘린 조각(`학생이 "늦어서 죄송합니다.`)은 선생님의 사과가 아니다. */
function quotesBalanced(s: string): boolean {
  const count = (ch: string) => s.split(ch).length - 1;
  return count('"') % 2 === 0 && count("'") % 2 === 0 && count("“") === count("”") && count("‘") === count("’") && count("「") === count("」");
}

function isParentAddress(s: string): boolean {
  return (
    PARENT_ADDRESS_END.test(s) &&
    s.length <= MAX_ADDRESS_LEN &&
    (s.match(/[,，]/g)?.length ?? 0) <= MAX_ADDRESS_COMMAS &&
    !SPEAKER_PREFIX.test(s) &&
    quotesBalanced(s)
  );
}

/**
 * 한 줄을 문장으로 나눈다. 경계 둘:
 *  · 종결부호 + 공백(split-sentences.ts와 같은 경계 — 소수점 `1.9`는 안 쪼갠다)
 *  · 공백 없이 붙은 마침표, **양쪽이 한글일 때만**(`어려워함.늦게` — 폰 입력에서 흔하다). `p.12`·`3.5`·`Mr.Kim`·
 *    `drive.google.com`·`63p.설공`은 안 쪼갠다(쪼개면 AI 재료에 공백이 끼어 주소·이름이 깨진다 — 재리뷰 2026-09-22).
 */
function sentencesOf(line: string): string[] {
  return line
    .replace(/([.?!。…])[ \t]+/g, "$1\n")
    .replace(/(?<=[가-힣)])([.?!。])(?=[가-힣])/g, "$1\n")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * 부호 없이 이어 쓴 존댓말(`갔습니다 늦게 보내드려 죄송합니다`)을 토막 낸다. 🔴 사과 후보는 **문장의 마지막 토막**뿐이다 —
 * 중간 토막을 인정하면 `지각해서 선생님 죄송합니다 하고 들어왔습니다.`(아이의 말을 옮긴 관찰)에서 앞 토막이 선생님 사과로
 * 떼어져 학부모 글 첫 줄에 서고 AI 재료는 뜻을 잃는다(재리뷰 2026-09-22 차단 결함).
 */
function politePieces(sentence: string): string[] {
  return sentence
    .replace(/(니다|세요|어요|해요)[ \t]+(?=\S)/g, "$1\n")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * 특이사항(또는 반 전체 안내)을 **전할 말**(`address`)과 **AI 재료**(`rest`)로 가른다.
 * `rest`는 원래 줄 구조를 지킨다(한 줄 안의 남은 문장은 공백으로, 줄은 줄바꿈으로 다시 잇는다).
 */
export function splitParentAddress(note: string | null | undefined): { address: string[]; rest: string } {
  const address: string[] = [];
  const restLines: string[] = [];
  for (const line of (note ?? "").replace(/\r\n?/g, "\n").split("\n")) {
    // 토막마다 "사과 후보가 될 수 있는가"(= 그 문장의 마지막 토막)를 함께 든다.
    const pieces = sentencesOf(line).flatMap((s) => {
      const parts = politePieces(s);
      return parts.map((text, i) => ({ text, take: i === parts.length - 1 && isParentAddress(text) }));
    });
    // 떼어 낼 문장이 없는 줄은 **원문 그대로** 둔다(띄어쓰기 하나 안 바꾼다 — 종전 입력과 같게).
    if (!pieces.some((p) => p.take)) {
      if (line.trim()) restLines.push(line);
      continue;
    }
    const kept: string[] = [];
    for (const p of pieces) {
      if (p.take) address.push(p.text);
      else kept.push(p.text);
    }
    if (kept.length) restLines.push(kept.join(" "));
  }
  return { address, rest: restLines.join("\n") };
}

/** 전할 말을 멘트 맨 앞 줄로. 같은 문장이 둘(특이사항·반 안내 양쪽)이면 한 번만. 빈 멘트면 전할 말만. */
export function prependParentAddress(comment: string, address: readonly string[]): string {
  const seen = new Set<string>();
  const lines = address.filter((a) => {
    const k = a.replace(/\s+/g, " ");
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  if (!lines.length) return comment;
  const body = comment.trim();
  return body ? `${lines.join("\n")}\n${body}` : lines.join("\n");
}
