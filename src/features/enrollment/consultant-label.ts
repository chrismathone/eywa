/**
 * 목록·칸반 카드의 '상담사' 표시 — 상담사 계정 이름, 없으면 상담자 글(옛 시트·QR 접수에 적힌 '대표' 등).
 * 상세 화면 '상담자'도 같은 두 값을 보인다(원장 2026-10-19 *"목록도 상세처럼"*). 상담사 필터·인라인 선택은 계정 기준 그대로.
 */
export function consultantLabel(row: { consultantName: string | null; counselorText: string | null }): string | null {
  return row.consultantName?.trim() || row.counselorText?.trim() || null;
}
