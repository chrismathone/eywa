/**
 * 누적 암기 단어수 칸 — **무엇을 갱신해도 되는가**의 판정. 순수 모듈(Vitest가 잠근다).
 *
 * 원장 2026-09-28: *"영어수업계획서에 우리 SRS 누적단어 가져와있자나 이거 자동으로 기입되어있고
 * 최신버전으로 srs 업데이트 뭐 해서 가져와서 자동기입되게 하는 기능 추가"*.
 *
 * 🔑 **왜 '빈 칸만'으로는 최신이 안 되나**: '내용 복사 (지난 수업)'가 이 칸을 **지난 값으로 미리 채운다**
 *    ([`carry-marks.ts`](@/features/class-sheets/lib/carry-marks) — 누적값이라 지난 값이 오늘의 시작점).
 *    그러면 칸이 "이미 적힌 칸"이 되어 자동 채우기가 영영 건너뛴다 = 시트에 **지난 주 숫자가 굳는다**
 *    (실측 2026-09-28: 앞날 9/29·9/30 칸에 이미 48·54개 값이 적혀 있었다).
 * 🔴 그래서 **숫자만 든 칸은 갱신하고, 글자가 섞인 칸은 손대지 않는다.** 원장 2026-09-21의
 *    *"사람이 적어 둔 값은 덮지 않는다"*가 지키려던 것은 **그 칸에 섞여 사는 다른 기록**이다
 *    (그 지시의 근거로 적힌 예가 `150/200점 - STARTING 2`·`눈 아파서 조퇴`였다). 숫자는 SRS 값을
 *    적으려던 같은 시도라 최신값으로 바꿔도 잃는 사실이 없다.
 *    실측(2026-09-28 전건 1,507칸): **숫자만 1,373 · 글자 섞임 134** — 134는 전부 시험 점수·조퇴·봉사 메모
 *    9종이고 이 판정에 하나도 안 걸린다.
 * 🔴 **지난 날 칸은 갱신하지 않는다** — SRS 값은 기간과 무관한 '지금' 값이라, 지난 날 칸에 덮으면
 *    그 날의 기록이 거짓이 된다(9/20 칸에 9/28 숫자). 지난 날은 종전처럼 **빈 칸만** 채운다.
 */

/**
 * 단어수로 보는 모양 — 숫자(자릿수 구분 쉼표 허용)뿐. 🔴 **느슨하게 만들지 말 것**:
 * `150/200점 - STARTING 2`·`눈 아파서 조퇴` 같은 실데이터가 통과하면 사람이 쓴 기록이 사라진다.
 * ⚠️ `개`·`단어` 같은 꼬리는 일부러 안 받는다(실데이터에 0건 — 지어낸 관용을 넣어 판정을 넓히지 않는다).
 */
const WORD_COUNT = /^[0-9][0-9,]*$/;

/** 공백만 있는 칸은 빈 칸이다(화면에서 지운 흔적이 "이미 쓴 칸"으로 오인되지 않게 — carry-marks와 같은 규약). */
export function cellText(value: string | null | undefined): string {
  return (value ?? "").trim();
}

/** 이 칸에 든 값이 **숫자(단어수)** 인가 — 빈 칸은 아니다(빈 칸은 `fill` 쪽이 맡는다). */
export function looksLikeWordCount(value: string | null | undefined): boolean {
  const t = cellText(value);
  return t !== "" && WORD_COUNT.test(t);
}

/** 이번 실행이 **덮어도 되는 실행인가**. 판정은 core 한 곳에서 날짜로 정한다(호출부가 고르지 않는다). */
export type MemorizedFillMode = "fill" | "refresh";

/**
 * 오늘·앞날 = `refresh`(숫자 갱신) · 지난 날 = `fill`(빈 칸만).
 * ⚠️ 앞날을 `refresh`로 두는 이유: 미리 복사해 둔 지난 값이 거기 있고, 그 날이 오면 크론이 다시 갱신한다.
 */
export function memorizedFillMode(date: string, today: string): MemorizedFillMode {
  return date < today ? "fill" : "refresh";
}

/**
 * 그 칸을 이번에 어떻게 할지.
 *  · `fill`    — 빈 칸을 새로 채운다
 *  · `refresh` — 숫자가 든 칸을 최신값으로 바꾼다(refresh 모드에서만)
 *  · `keep`    — 손대지 않는다(메모가 든 칸 · fill 모드의 이미 적힌 칸)
 */
export function memorizedCellPlan(
  current: string | null | undefined,
  mode: MemorizedFillMode,
): "fill" | "refresh" | "keep" {
  if (cellText(current) === "") return "fill";
  if (mode === "refresh" && looksLikeWordCount(current)) return "refresh";
  return "keep";
}
