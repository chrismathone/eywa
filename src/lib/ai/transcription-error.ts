// AssemblyAI 전사·제출·다운로드 에러(영어 원문)를 사용자용 한글 메시지로 매핑 — 순수 함수(Vitest).
// 이미 한글인 메시지(eywa 자체 생성)는 그대로 둔다. 알 수 없는 영어는 일반 한글 메시지로(원문은 화면 미노출).
// 소비처: assemblyai 웹훅(processing_error)·녹음 start 액션. 분석(generateJSON) 키 오류는 generate.ts rethrowAi가 별도 한글화.

export function localizeTranscriptionError(raw: string | null | undefined): string {
  const msg = (raw ?? "").trim();
  if (!msg) return "음성 처리 중 오류가 발생했습니다.";
  const s = msg.toLowerCase();

  // 형식/디코딩 — 지원 안 함·손상·EBML 등 (스크린샷의 "Transcoding failed. File type text/plain (EBML)…").
  if (/transcod|unsupported|file type|ebml|not a valid|invalid (audio|media|file|format)|corrupt|decode/.test(s)) {
    return "음성 파일을 처리할 수 없습니다 — 지원하지 않는 형식이거나 손상된 파일입니다. (mp3·m4a·wav·webm 권장)";
  }
  // 다운로드/접근 — URL 만료·파일 없음.
  if (/download|unable to (download|access|retrieve)|could not (download|fetch)|expired|403|404|not found|no such/.test(s)) {
    return "음성 파일을 내려받지 못했습니다 — 파일이 없거나 접근 권한(서명 URL)이 만료되었습니다.";
  }
  // 너무 짧음/무음.
  if (/too short|no (speech|audio)|silent|empty|0 ?(seconds?|sec)\b/.test(s)) {
    return "녹음이 너무 짧거나 말소리가 감지되지 않았습니다.";
  }
  // 인증/키.
  if (/unauthorized|forbidden|invalid (api )?key|authentication|401/.test(s)) {
    return "AI 전사 키 오류입니다 — 관리자에게 문의하세요 (AssemblyAI 키 확인·갱신 필요).";
  }
  // 한도/요금.
  if (/rate ?limit|429|too many requests|quota|exceeded|insufficient|balance|payment/.test(s)) {
    return "전사 요청이 한도를 초과했거나 잔액이 부족합니다 — 잠시 후 다시 시도하거나 관리자에게 문의하세요.";
  }
  // 서버 일시 오류/타임아웃/네트워크.
  if (/timeout|timed out|50[234]|server error|internal error|unavailable|econn|network|connection/.test(s)) {
    return "전사 서버가 일시적으로 응답하지 않습니다 — 잠시 후 다시 시도해주세요.";
  }
  // 이미 한글(eywa 자체 메시지)이면 그대로.
  if (/[가-힣]/.test(msg)) return msg;
  // 알 수 없는 영어 원문 — 일반 한글 메시지(원문은 화면 노출 X).
  return "음성 전사 중 오류가 발생했습니다. 문제가 계속되면 관리자에게 문의하세요.";
}
