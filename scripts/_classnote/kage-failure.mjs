/**
 * scripts/_classnote/kage-failure.mjs — kage(ClassNote 내부 스토리지) 업로드 **실패 사유 문장**(순수, 의존성 0).
 *
 * 왜 생겼나(2026-09-04, 원장 제보 "곽하윤 건 ClassNote 발송 실패했는데 원인 확인"):
 * 스샷 업로드가 실패하면 워커가 `스샷 kage 업로드 실패` **한 줄**만 남겼다. 그래서 DB만 봐서는
 * ① 올릴 이미지가 애초에 비어 있었는지 ② 작성폼의 첨부 칸이 안 열렸는지 ③ kage가 거부했는지(HTTP 몇)
 * ④ 응답이 아예 안 왔는지를 **구분할 수 없었다**. 바로 아래 파일첨부 경로는 2026-07-21에 이미 단계별로
 * 사유를 나눠 담게 고쳤는데 **스샷 경로만 그 개선이 빠져 있었다**.
 *
 * 왜 별도 순수 모듈인가: 사유를 만드는 자리는 [classnote-admin-core.mjs](./classnote-admin-core.mjs)인데
 * 그 파일은 **@playwright/test를 import**한다. 문장 규칙을 거기 두면 테스트가 playwright를 끌어온다
 * (board-safety.mjs·identity-keys.mjs와 같은 규칙).
 *
 * 🔴 **문장은 반드시 한국어가 충분히 섞인 '사람 문장'이어야 한다.** 이 사유는 `lesson_reports.classnote_error`에
 *    저장돼 발송 콘솔에서 [humanizeClassnoteError](../../src/features/report-admin/classnote-error.ts)를 지나는데,
 *    그 함수는 **한글 비율이 낮거나 기술 원문 신호**(스택 프레임 `at x:1` · `Error:` · `net::` · URL)가 있으면
 *    사람 문장으로 안 보고 **패턴표로 덮어쓴다**. 실제로 위험하다 — "…이미지…"는 `/스크린샷|이미지/` 패턴에
 *    걸려 "보고서 이미지 생성 실패"로, "찾지 못"은 보드 관련 안내로 **오진**된다. 그래서
 *    ① 기술 원문은 {@link sanitizeKageDetail}로 신호를 걷어내고 짧게 자르며 ② "찾지 못" 같은 어구를 피한다.
 *    가드 = kage-failure.test.mjs.
 */

/** 사유 끝에 덧붙이는 기술 원문의 최대 길이 — 길면 한글 비율이 떨어져 위 오진이 난다. */
export const KAGE_MAX_DETAIL = 40;

/**
 * 기술 원문에서 **`humanizeClassnoteError`가 '기술 원문'으로 판정하는 신호**를 걷어내고 한 줄로 줄인다.
 * 지우는 게 목적이 아니라 **사람 문장의 꼬리로 안전하게 붙이는 것**이 목적이다(원문 전체는 워커 로그에 남는다).
 *
 * @param {unknown} raw 기술 원문(예외 메시지·응답 본문 요약).
 * @param {number} [max] 최대 길이.
 * @returns {string}
 */
export function sanitizeKageDetail(raw, max = KAGE_MAX_DETAIL) {
  const one = String(raw ?? "")
    .replace(/https?:\/\/\S+/g, " ") // URL
    .replace(/net::\S*/g, " ") // 크롬 네트워크 코드
    .replace(/\bat\s+\S+:\d+(?::\d+)?/g, " ") // 스택 프레임
    .replace(/\b[A-Za-z]*Error:\s*/g, " ") // `Error:` / `TypeError:` 접두
    .replace(/\s+/g, " ")
    .trim();
  if (!one) return "";
  return one.length > max ? `${one.slice(0, max - 1)}…` : one;
}

/**
 * 실패 사유 한 줄. `kind`:
 *  · `empty`    올릴 바이트가 0 — **캡처가 실패한 것**이지 업로드가 실패한 게 아니다(다음 조치가 다르다).
 *  · `no_input` 작성폼의 첨부 칸에 파일을 못 넣음(폼 미로딩·ClassNote 화면 구조 변경).
 *  · `rejected` kage가 응답은 했는데 access_key를 안 줌 — HTTP 상태로 용량·형식 문제를 가른다.
 *  · `timeout`  응답이 제한 시간 안에 아예 안 옴.
 *
 * ⚠️ 대기 시간은 **실제 값**을 문장에 적는다(상수 이름이 아니라) — 상수가 바뀌면 문장도 따라 바뀐다([[#121]]).
 *
 * @param {{ subject?: string, kind?: string, status?: number|string|null, waitedMs?: number|null, detail?: unknown }} [opts]
 * @returns {string}
 */
export function kageFailureReason({ subject = "첨부 파일", kind, status = null, waitedMs = null, detail = "" } = {}) {
  const head = `${subject} 업로드 실패`;
  const clean = sanitizeKageDetail(detail);
  const tail = clean ? ` [${clean}]` : "";
  switch (kind) {
    case "empty":
      return `${head} — 올릴 데이터가 비어 있습니다(0바이트). 업로드가 아니라 캡처가 실패한 것이니 재발송으로 다시 시도하세요${tail}`;
    case "no_input":
      return `${head} — ClassNote 작성폼의 첨부 칸이 열리지 않았습니다. 폼이 덜 뜬 것이거나 ClassNote 화면 구조가 바뀐 것입니다${tail}`;
    case "rejected":
      return `${head} — ClassNote 저장소가 파일을 거부했습니다(HTTP ${status ?? "알 수 없음"}). 다시 시도해도 같으면 용량·형식을 확인하세요${tail}`;
    case "timeout":
      return `${head} — ClassNote 저장소가 ${Math.round((waitedMs ?? 0) / 1000)}초 동안 응답하지 않았습니다. 재발송으로 다시 시도하세요${tail}`;
    default:
      return `${head} — 원인을 알 수 없습니다. 워커 로그를 확인하세요${tail}`;
  }
}
