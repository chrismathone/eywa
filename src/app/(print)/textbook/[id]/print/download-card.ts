// 교재요청서 카드 DOM → PNG. 프린트 뷰어(이미지 저장)·목록의 '바로 다운로드'·학부모 발송(첨부 업로드) 공용.
// 클라이언트 전용(document/html2canvas). ⚠️ html2canvas 1.4.1은 oklch 미지원 → 카드 본문은 inline hex(card-body).

/** 캔버스 생성 단일 지점 — 다운로드와 Blob 변환이 **같은 렌더 설정**을 쓰도록(학부모가 받는 그림 = 저장한 그림). */
async function renderCardCanvas(el: HTMLElement): Promise<HTMLCanvasElement> {
  const { default: html2canvas } = await import("html2canvas");
  return html2canvas(el, { scale: 2, backgroundColor: "#ffffff", useCORS: true });
}

export async function downloadCardPng(
  el: HTMLElement,
  requestDate: string | null,
  studentName: string | null,
  bookName: string,
): Promise<void> {
  const canvas = await renderCardCanvas(el);
  const url = canvas.toDataURL("image/png");
  const a = document.createElement("a");
  a.download = `${cardFileBase(requestDate, studentName, bookName)}.png`;
  a.href = url;
  a.click();
}

/** 같은 카드를 파일(Blob)로 — 학부모 발송 시 스토리지 업로드용(다운로드 흐름은 위 함수 그대로 유지). */
export async function cardToPngBlob(el: HTMLElement): Promise<Blob> {
  const canvas = await renderCardCanvas(el);
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("요청서 이미지를 만들지 못했습니다"))),
      "image/png",
    );
  });
}

/** 파일명 기본형 — 윈도 금지문자 제거(다운로드·첨부 이름 공용). */
export function cardFileBase(
  requestDate: string | null,
  studentName: string | null,
  bookName: string,
): string {
  return (
    `${requestDate ?? "교재요청"}_${studentName ?? "학생"}_${bookName}`
      .replace(/[\\/:*?"<>|]/g, " ")
      .trim() || "교재요청서"
  );
}
