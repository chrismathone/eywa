/**
 * 업로드 검증 순수 규칙 — ⚠️ **server-only 없음**(media-storage는 server-only라 Vitest에서 못 읽는다 [[#61]]).
 * 판정 자체를 여기 두고 media-storage.verifyUploadedObject가 Supabase 메타값을 넣어 쓴다.
 *
 * 배경(2026-07-29): GCS 분기를 걷어내며 `verifyUploadedObject`를 다시 썼는데, 그 전까지 Supabase 경로는
 * `{size:0}`만 돌려주는 **무검증**이었다. 적대 검증이 남긴 두 결론을 이 모듈이 고정한다:
 *  ① 크기는 강제한다 — 0/음수/미확인(0)도 거부. 빈 파일·메타 미기록은 신뢰할 수 없다.
 *  ② **MIME은 강제하지 않는다** — Supabase에 남는 mimetype은 서버가 승인한 값이 아니라 클라 `File.type`이고
 *    (MediaRecorder는 오디오 전용 녹음도 `video/webm`으로 뱉는다), 여기서 막으면 호출부가 정상 파일을
 *    지운다(녹음 소실). 형식 관문은 버킷 `allowed_mime_types`(setup-storage.ts)가 담당한다.
 */

/** 업로드된 객체 크기가 허용 범위인가. `false`면 호출부가 throw → cleanup. */
export function assertUploadedSize(size: number, maxBytes: number): boolean {
  return Number.isFinite(size) && size > 0 && size <= maxBytes;
}
