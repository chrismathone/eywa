// 교재요청서 카드 DOM → PNG 다운로드(html2canvas). 프린트 뷰어(이미지 저장)와 목록의 '바로 다운로드' 공용.
// 클라이언트 전용(document/html2canvas). ⚠️ html2canvas 1.4.1은 oklch 미지원 → 카드 본문은 inline hex(card-body).
export async function downloadCardPng(
  el: HTMLElement,
  requestDate: string | null,
  studentName: string | null,
  bookName: string,
): Promise<void> {
  const { default: html2canvas } = await import("html2canvas");
  const canvas = await html2canvas(el, { scale: 2, backgroundColor: "#ffffff", useCORS: true });
  const url = canvas.toDataURL("image/png");
  const a = document.createElement("a");
  const fname = `${requestDate ?? "교재요청"}_${studentName ?? "학생"}_${bookName}`
    .replace(/[\\/:*?"<>|]/g, " ")
    .trim();
  a.download = `${fname}.png`;
  a.href = url;
  a.click();
}
