/**
 * 비ASCII(한글 등) 파일명을 안전한 `Content-Disposition` 헤더 값으로 만든다.
 *
 * ⚠️ HTTP 헤더 값은 ByteString(Latin-1, 코드포인트 ≤255)이라, 한글(예: '수' = U+C218 = 49688)을
 * `filename="수학_…"`처럼 그대로 넣으면 응답 생성 단계에서
 * `TypeError: Cannot convert argument to a ByteString`이 나고 라우트가 500 → 다운로드가 "무반응".
 *
 * RFC 5987대로 ① ASCII 폴백 `filename`(비ASCII는 `_`로 치환) + ② UTF-8 percent-encoded `filename*`
 * 둘 다 준다. 현대 브라우저(Chrome/Firefox/Safari/Edge)는 `filename*`로 원래 한글 파일명을 쓴다.
 */
export function attachmentFilename(filename: string): string {
  // ASCII 폴백: 비ASCII 런(run)을 `_`로, 따옴표 제거(헤더 토큰 안전).
  const asciiFallback = filename.replace(/[^\x20-\x7E]+/g, "_").replace(/"/g, "");
  // RFC 5987 ext-value: encodeURIComponent가 안 빼는 *'() 까지 추가 인코딩.
  const encoded = encodeURIComponent(filename).replace(
    /['()*]/g,
    (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase(),
  );
  return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encoded}`;
}
