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
 * 🔴 글을 **글자로** 내보내는 곳(글 복사)은 자리 줄을 지운다 — 대괄호가 학부모 글에 그대로 나가면 안 된다.
 * ⚠️ 줄 **전체**가 자리 표식일 때만 자리다 — 문장 속 `[시험결과지]`는 그냥 글자(사람이 쓴 문장을 그림으로 오인하지 않게).
 */

export type ImageSlotKey = "시험결과지" | "학습분석지";

/** 그림 자리 키 — 템플릿 칸 이름과 **같은 글자**다(defaults.ts의 토큰 목록이 이 키를 쓴다). */
export const IMAGE_SLOT_KEYS: readonly ImageSlotKey[] = ["시험결과지", "학습분석지"];

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

export type BodySegment = { kind: "text"; text: string } | { kind: "slot"; key: ImageSlotKey };

/** 조각 앞뒤의 빈 줄만 다듬는다(카드가 조각마다 여백을 준다) — 조각 안의 빈 줄(문단 간격)은 그대로. */
function trimBlankLines(text: string): string {
  return text.replace(/^(?:[ \t]*\n)+/, "").replace(/(?:\n[ \t]*)+$/, "");
}

/** 글 → 글 조각·그림 자리를 **나온 순서대로**. 비어 있는 글 조각은 버린다. */
export function splitImageSlots(text: string | null | undefined): BodySegment[] {
  const out: BodySegment[] = [];
  let buf: string[] = [];
  const flush = () => {
    const joined = trimBlankLines(buf.join("\n"));
    if (joined.trim()) out.push({ kind: "text", text: joined });
    buf = [];
  };
  for (const line of (text ?? "").replace(/\r\n?/g, "\n").split("\n")) {
    const key = imageSlotOfLine(line);
    if (key) {
      flush();
      out.push({ kind: "slot", key });
    } else {
      buf.push(line);
    }
  }
  flush();
  return out;
}

/**
 * 글자로 내보낼 글 — 자리 줄을 지우고, **지운 자리 옆에서만** 빈 줄 겹침을 한 번의 문단 간격으로 접는다.
 * 🔴 글 전체의 빈 줄을 접지 말 것 — 강사가 일부러 띄운 간격까지 사라진다(적대 리뷰 2026-09-11).
 */
export function stripImageSlots(text: string | null | undefined): string {
  const out: string[] = [];
  let afterSlot = false;
  for (const line of (text ?? "").replace(/\r\n?/g, "\n").split("\n")) {
    if (imageSlotOfLine(line) !== null) {
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

/** 글에 들어 있는 그림 자리(나온 순서, 중복 제거) — 저장 때 인재원 자료를 받을지 가른다. */
export function usedImageSlots(text: string | null | undefined): ImageSlotKey[] {
  const seen: ImageSlotKey[] = [];
  for (const line of (text ?? "").replace(/\r\n?/g, "\n").split("\n")) {
    const key = imageSlotOfLine(line);
    if (key && !seen.includes(key)) seen.push(key);
  }
  return seen;
}
