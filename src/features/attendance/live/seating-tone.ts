/**
 * 좌석표 카드의 **색 규약** — 순수(Vitest). 색은 시간이 아니라 **"내가 할 일이 남았나"**를 말한다.
 *
 * 원장 2026-08-18: *"지나간 수업을 무슨 색으로 하면 좋을지 검토."* → 지나간 칸을 한 색으로 칠하면
 * 다 찍은 수업과 아무도 안 찍은 수업이 같아 보인다. 그래서 '지남'만 둘로 가른다.
 * 색은 전부 `globals.css` 토큰이다(라이트 전용 · 브랜드 네이비 `#363c41` · 앰버 `#a35d0a`는 대비 5.09).
 * 🔴 새 색을 즉석에서 만들지 말 것.
 */
import type { SeatMark } from "./mark-state";
import type { NowBand } from "./now-band";

/** 그 카드에 아직 비어 있는 칸 수 — 지나간 수업의 색을 가르는 근거. */
export function pendingCountOf(klass: { students: readonly { mark: SeatMark }[] }): number {
  return klass.students.filter((s) => s.mark === "unmarked").length;
}

/**
 * 카드 색이 말해야 하는 것 — **시간이 아니라 "내가 할 일이 남았나"**(원장 2026-08-18).
 *
 * 지나간 수업을 한 색으로 칠하면 **다 찍은 수업**과 **아무도 안 찍은 수업**이 같아 보인다.
 * 그래서 '지남'만 둘로 가른다. 진행 전(회색)·진행 중(네이비)은 그대로.
 */
export type SeatingTone = "now" | "upcoming" | "past_pending" | "past_done";

export function seatingToneOf(band: NowBand, pending: number): SeatingTone {
  if (band === "now") return "now";
  if (band === "upcoming" || band === "later") return "upcoming";
  return pending > 0 ? "past_pending" : "past_done";
}

/** 헤더에 덧붙는 한 마디(없으면 빈 문자열) — raw 코드 대신 사람 말. */
export function seatingToneNote(tone: SeatingTone, pending: number): string {
  if (tone === "past_pending") return `미입력 ${pending}`;
  if (tone === "past_done") return "입력 완료";
  return "";
}

/**
 * 카드 바깥 — 다 찍은 지난 수업만 그림자를 빼고 **테두리만** 남겨 조용히 물러난다.
 * 🔴 **왼쪽 색 띠를 두르지 않는다**(원장 2026-09-16 *"왼쪽에 이렇게 테두리 같은거 표시하는거 싹다 제거해"*) —
 *    지나간 미입력은 머리 줄이 이미 앰버 바탕 + `미입력 N`으로 말한다(같은 말을 띠로 한 번 더 했었다).
 * 🔴 흐리게(opacity) 만들지 않는다: 지나간 수업이야말로 조치 대상이다([[#105]]).
 */
export function seatingCardClass(tone: SeatingTone): string {
  if (tone === "past_done") return "border-line border";
  return "shadow-card";
}

/**
 * 수업명 줄 배경 — **지금 / 예정 / 지남(완료) / 지남(미입력) 넷**.
 *
 * 종전엔 국면(phase) 둘로만 갈라(대기=회색, 진행·종료=네이비) **이미 끝난 반과 지금 하는 반이 같은
 * 네이비**였다. 하루치가 한 화면에 깔리는 좌석표에서 그건 곧 "전부 수업 중"으로 읽힌다(원장 지적).
 * ⚠️ 색은 전부 `globals.css` 토큰이다(라이트 전용·브랜드 네이비·앰버 `#a35d0a`는 텍스트 대비 5.09).
 *    새 색을 즉석에서 만들지 말 것.
 */
export function seatingHeaderClass(tone: SeatingTone): string {
  if (tone === "now") return "bg-primary text-white";
  if (tone === "upcoming") return "bg-att-weekend text-text";
  if (tone === "past_pending") return "bg-amber-soft text-amber";
  return "bg-card text-text-dim border-line border-b";
}
