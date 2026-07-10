/**
 * 기술 에러 원문을 화면·툴팁에 보여줄 때 **사람이 못 읽는 제어문자를 제거**한다(순수, 클라·서버 공용).
 *
 * Playwright/Node가 남기는 에러엔 ANSI 색코드(ESC + `[2m` 같은 터미널 제어 시퀀스)와 개행·탭이 섞여 있어,
 * 그대로 `title` 툴팁·화면에 넣으면 "알 수 없는 문자"로 노출된다(raw 코드 UI 노출 금지 규칙 위반).
 * 이 함수로 ANSI 시퀀스를 지우고 나머지 제어문자를 공백으로 눌러 한 줄 가독 텍스트로 만든다.
 *
 * ⚠️ 이건 "원문 클린업"(툴팁용)이다 — 화면 본문엔 도메인별 한글 요약(예: humanizeClassnoteError)을
 * 함께 써서 "한글 요약 + 마우스오버 시 정리된 원문" 패턴을 유지한다.
 */

// ANSI CSI 시퀀스: ESC(27) '['(91) + 파라미터(0-9;?) + 중간(0x20-0x2f) + 종결(0x40-0x7e).
// ESC·'['는 소스에 제어문자를 박지 않으려 charCode로 구성(no-control-regex 회피).
const ANSI_CSI = new RegExp(String.fromCharCode(27, 91) + "[0-9;?]*[ -/]*[@-~]", "g");

export function sanitizeErrorText(raw: string | null | undefined): string {
  const r = (raw ?? "").trim();
  if (!r) return "";
  // 1) ANSI 색코드 통째 제거. 2) 남은 제어문자(개행·탭·기타, 0x00-0x1f·0x7f)는 공백으로. 3) 공백 정규화.
  let out = "";
  for (const ch of r.replace(ANSI_CSI, "")) {
    const code = ch.charCodeAt(0);
    out += code < 0x20 || code === 0x7f ? " " : ch;
  }
  return out.replace(/\s+/g, " ").trim();
}
