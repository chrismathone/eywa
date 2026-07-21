/**
 * 워커 로그 한 줄이 **원장에게 보여줄 문제**인지 판정 — 순수 함수(Vitest).
 *
 * ⚠️ 왜 필요한가(2026-07-21 실측): 하트비트의 '최근 경고' 슬롯은 5칸뿐인데, 필터가 단순히 `/실패|오류|error|⚠/`
 * 였다. 그래서 **"처리 완료 — 성공 2 / 실패 0 / 재큐 0"** 같은 **정상 로그가 '실패'라는 글자 때문에** 경고로
 * 잡혀 슬롯을 잡아먹었다(실제 5칸 중 2칸 점유). 진짜 문제가 밀려나면 진단용 생명줄이 무용지물이 된다.
 *
 * 규칙: ⚠·error/exception은 무조건 문제. `실패`·`오류`는 **뒤따르는 수가 0이면 문제가 아니다**(0건 = 정상 보고).
 */

/** 숫자 카운트가 0인 "실패 0"·"오류 0"류 — 정상 보고다. */
const ZERO_COUNT = /(?:실패|오류)\s*[:=]?\s*0(?!\d)/;

export function isWorkerIssueLine(msg) {
  const s = String(msg ?? "");
  if (/⚠/.test(s)) return true;
  // 단어경계(\b)를 걸면 **TypeError·RangeError 같은 실제 예외 이름을 놓친다** — 영문은 종전대로 부분일치.
  if (/error|exception|failed/i.test(s)) return true;
  // '실패'·'오류'가 나오되, 그 자리의 수가 0이 아닐 때만 문제로 본다.
  // 한 줄에 여러 번 나오면(예 "실패 0 / 오류 2") 0이 아닌 게 하나라도 있으면 문제.
  const hits = s.match(/(?:실패|오류)\s*[:=]?\s*\d*/g);
  if (!hits) return false;
  return hits.some((h) => !ZERO_COUNT.test(h));
}
