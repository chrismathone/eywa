/**
 * 영어 템플릿의 **그림 자리** — 인재원 시험 결과지·학습 분석지를 글의 어느 줄에 둘지. 순수 함수(Vitest로 잠금).
 *
 * 사용자 2026-09-11: *"템플릿에도 시험 친 결과지, 학습분석지 이렇게 넣을 수 있게 … 이미지 위치도 정할 수 있으면 좋고 …
 * 사용자가 직접 넣는 게 아니라 우리가 위치에 넣을 거라고 지정해 놓으면 백에서 돌아서 들어가는 게 맞음"*.
 *
 * 🔑 자리는 글(`lesson_reports.notes`) 안의 **한 줄**이다 — `[시험결과지]`·`[학습분석지]`. 템플릿이 기본 위치를 정하고,
 *    강사는 그 줄을 옮겨(또는 지워) 이번 보고서만 바꿀 수 있다. 새 칸이 없어 글 저장 경로가 그대로다.
 * 🔑 그림은 사람이 올리지 않는다 — 저장할 때 서버가 인재원에서 받아 둔 자료(`report_jj_snapshots`, 0261a)로 카드가
 *    그린다. 그래서 `/r`·PDF·ClassNote 캡처(카드 스크린샷)가 같은 그림을 같은 자리에 싣는다.
 * 🔑 **첨부 자리**(같은 날 후속, 사용자 *"이미지 pdf 같은 것도 넣어서 바로 보낼 때 같이 쓸 수 있게 … 사진 잘라서"*) — 강사가
 *    올린 사진·PDF도 같은 방식의 한 줄이다: `[첨부: 파일 이름]`. 이름이 그 보고서 첨부(`attachments[].name`)와 **글자까지
 *    같아야** 그 자리에 선다(올릴 때 겹치지 않게 이름을 정한다 — attachment-utils.ts `uniqueAttachmentName`).
 *    그 줄을 넣고 빼고 다시 짠 글로 옮기는 규칙은 attachment-lines.ts — 첨부 줄은 **템플릿 글의 일부가 아니다**.
 * 🔴 글을 **글자로** 내보내는 곳(글 복사)은 자리 줄을 지운다 — 대괄호가 학부모 글에 그대로 나가면 안 된다.
 * ⚠️ 줄 **전체**가 자리 표식일 때만 자리다 — 문장 속 `[시험결과지]`는 그냥 글자(사람이 쓴 문장을 그림으로 오인하지 않게).
 */

import { monthlyEvalOfLine, type MonthlyEval } from "./monthly-eval";

export type ImageSlotKey = "시험결과지" | "학습분석지" | "단어백분위" | "학습배지";

/** 그림 자리 키 — 템플릿 칸 이름과 **같은 글자**다(defaults.ts의 토큰 목록이 이 키를 쓴다). */
// 단어백분위·학습배지 = 2026-10-26(인재원 순위·배지) — 뒤에 붙인다(앞 둘의 뜻·순서를 바꾸지 않는다).
export const IMAGE_SLOT_KEYS: readonly ImageSlotKey[] = ["시험결과지", "학습분석지", "단어백분위", "학습배지"];

/** 글 안에 남는 자리 표식 한 줄. */
export function imageSlotMarker(key: ImageSlotKey): string {
  return `[${key}]`;
}

/** 이 줄이 그림 자리면 그 키 — 공백은 무시한다(`[ 학습분석지 ]`도 자리). */
export function imageSlotOfLine(line: string): ImageSlotKey | null {
  const t = line.replace(/\s+/g, "");
  for (const key of IMAGE_SLOT_KEYS) if (t === imageSlotMarker(key)) return key;
  return null;
}

/** 첨부 자리 줄 — `[첨부: 이름]`(콜론 앞뒤 공백·전각 콜론 허용). 이름은 가운데 공백까지 그대로 비교한다. */
const ATTACHMENT_LINE = /^\[\s*첨부\s*[:：]\s*(.+?)\s*\]$/;

/** 글 안에 남는 첨부 자리 한 줄. */
export function attachmentMarker(name: string): string {
  return `[첨부: ${name}]`;
}

/** 이 줄이 첨부 자리면 그 파일 이름. */
export function attachmentNameOfLine(line: string): string | null {
  const m = ATTACHMENT_LINE.exec(line.trim());
  return m ? m[1]! : null;
}

export type BodySegment =
  | { kind: "text"; text: string }
  | { kind: "slot"; key: ImageSlotKey }
  | { kind: "attachment"; name: string }
  // EiE 월간 보고서 점수 자리(2026-11-05, monthly-eval.ts) — 점수를 줄 안에 동결해 둔다.
  | { kind: "monthly"; eval: MonthlyEval };

type MarkerSegment = Exclude<BodySegment, { kind: "text" }>;

function markerOfLine(line: string): MarkerSegment | null {
  const key = imageSlotOfLine(line);
  if (key) return { kind: "slot", key };
  const monthly = monthlyEvalOfLine(line);
  if (monthly) return { kind: "monthly", eval: monthly };
  const name = attachmentNameOfLine(line);
  return name ? { kind: "attachment", name } : null;
}

const linesOf = (text: string | null | undefined): string[] => (text ?? "").replace(/\r\n?/g, "\n").split("\n");

/** 조각 앞뒤의 빈 줄만 다듬는다(카드가 조각마다 여백을 준다) — 조각 안의 빈 줄(문단 간격)은 그대로. */
function trimBlankLines(text: string): string {
  return text.replace(/^(?:[ \t]*\n)+/, "").replace(/(?:\n[ \t]*)+$/, "");
}

/** 글 → 글 조각·그림 자리·첨부 자리를 **나온 순서대로**. 비어 있는 글 조각은 버린다. */
export function splitImageSlots(text: string | null | undefined): BodySegment[] {
  const out: BodySegment[] = [];
  let buf: string[] = [];
  const flush = () => {
    const joined = trimBlankLines(buf.join("\n"));
    if (joined.trim()) out.push({ kind: "text", text: joined });
    buf = [];
  };
  for (const line of linesOf(text)) {
    const marker = markerOfLine(line);
    if (marker) {
      flush();
      out.push(marker);
    } else {
      buf.push(line);
    }
  }
  flush();
  return out;
}

/**
 * 글자로 내보낼 글 — 그림 자리·첨부 자리 줄을 지우고, **지운 자리 옆에서만** 빈 줄 겹침을 한 번의 문단 간격으로 접는다.
 * 🔴 글 전체의 빈 줄을 접지 말 것 — 강사가 일부러 띄운 간격까지 사라진다(적대 리뷰 2026-09-11).
 */
export function stripImageSlots(text: string | null | undefined): string {
  const out: string[] = [];
  let afterSlot = false;
  for (const line of linesOf(text)) {
    if (markerOfLine(line) !== null) {
      afterSlot = true;
      continue;
    }
    const blank = line.trim() === "";
    // 지운 자리 바로 뒤의 빈 줄은, 앞에 이미 빈 줄이 있거나 글 맨 앞이면 버린다(자리 앞뒤 간격이 두 겹이 되지 않게).
    if (afterSlot && blank && (out.length === 0 || out[out.length - 1]!.trim() === "")) continue;
    if (!blank) afterSlot = false;
    out.push(line);
  }
  return out.join("\n").replace(/^(?:[ \t]*\n)+/, "").replace(/\s+$/, "");
}

/**
 * 자리 줄(그림·첨부) 말고 **학부모에게 나갈 글**이 있는가 — '미작성' 판정·발송 게이트(강사 화면·관리자 콘솔·서버)가 같은 답을 내게.
 * 자리 줄뿐인 영어 글은 서버가 발송을 막는다(isSlotOnlyEnglishNotes) — 화면이 '작성됨'이라 하면 눌러 보고서야 거절을 만난다.
 * 수학 글엔 자리 줄이 없어 `trim()`과 같다. (템플릿 흐름의 '고친 글인가'는 첨부 줄만 빼는 attachment-lines.ts 쪽을 쓴다.)
 */
export function hasTextBesidesMarkers(text: string | null | undefined): boolean {
  return !!stripImageSlots(text).trim();
}

/** 글에 자리 줄(그림·첨부)이 하나라도 있는가. */
export function hasBodyMarkers(text: string | null | undefined): boolean {
  return linesOf(text).some((line) => markerOfLine(line) !== null);
}

/** 글에 들어 있는 그림 자리(나온 순서, 중복 제거) — 저장 때 인재원 자료를 받을지 가른다. */
export function usedImageSlots(text: string | null | undefined): ImageSlotKey[] {
  const seen: ImageSlotKey[] = [];
  for (const line of linesOf(text)) {
    const key = imageSlotOfLine(line);
    if (key && !seen.includes(key)) seen.push(key);
  }
  return seen;
}

/** 글에 들어 있는 첨부 자리의 파일 이름(나온 순서, 중복 제거) — 카드가 그 자리에 그릴 첨부를 고른다. */
export function usedAttachmentNames(text: string | null | undefined): string[] {
  const seen: string[] = [];
  for (const line of linesOf(text)) {
    const name = attachmentNameOfLine(line);
    if (name !== null && !seen.includes(name)) seen.push(name);
  }
  return seen;
}
