// 스토리지 파일을 **원본 파일명 그대로** 저장하는 클라 헬퍼(⚠️ `server-only` 금지 [[#61]] — window/document 사용).
//
// ⚠️ Supabase Storage의 `?download=<이름>`에 파일명을 맡기지 말 것(원장 제보 2026-08-17, 실측으로 확인):
// storage-api는 헤더를 `attachment; filename=%EA%B9%80…; filename*=UTF-8''%EA%B9%80…`로 만든다 —
//   ① 폴백 `filename`이 **percent-encoded 원문**이고(따옴표도 없음),
//   ② `filename*`도 그냥 `encodeURIComponent`라 RFC 5987이 금지하는 `*'()`가 날것으로 남는다
//      (실제 계약서 63건 중 18건이 괄호·공백 포함: `김동후26.06(시용)근로계약서.pdf`).
// 크로미움은 둘 다 되돌려 한글로 저장하지만, `filename*`을 못 읽는 브라우저는 ①을 리터럴로 받아
// `%EA%B9%80%EB%8F%99…pdf`로 저장한다(제보된 증상). 서버 헤더를 우리가 못 고치는 자리이므로
// **이름 결정을 헤더 파서에서 뺏어온다**: 같은 출처 blob + `a.download`은 어떤 브라우저에서도 이 문자열 그대로다.
// (우리 라우트가 직접 내보내는 Content-Disposition은 여전히 `attachmentFilename()` — CLAUDE.md B1.)

function clickAnchor(href: string, fileName: string): void {
  const a = document.createElement("a");
  a.href = href;
  a.download = fileName; // 같은 출처(blob:)에서만 유효 — 교차출처 폴백에선 브라우저가 헤더를 따른다.
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/**
 * 서명 URL의 파일을 받아 `fileName`으로 저장한다(탭 안 열림).
 * 실패(네트워크·CORS)하면 서명 URL로 직접 이동 — 이름은 서버 헤더를 따르지만 파일은 받게 한다.
 */
export async function saveFileAs(url: string, fileName: string): Promise<void> {
  let objectUrl: string | null = null;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`파일 응답 오류 ${res.status}`);
    objectUrl = URL.createObjectURL(await res.blob());
    clickAnchor(objectUrl, fileName);
  } catch {
    clickAnchor(url, fileName);
  } finally {
    // 클릭 직후 revoke하면 저장이 시작되기 전에 blob이 사라지는 브라우저가 있다 — 넉넉히 뒤에 정리.
    if (objectUrl) {
      const created = objectUrl;
      setTimeout(() => URL.revokeObjectURL(created), 60_000);
    }
  }
}
