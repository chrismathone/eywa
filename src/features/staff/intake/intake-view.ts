/**
 * 직원 등록 QR의 화면 표시용 뷰 — **서버가 만들어 클라에 넘긴다**(qrcode 라이브러리를 클라 번들에 안 싣는다,
 * 등록상담 공개 QR 선례). 타입만 있는 순수 모듈이라 서버/클라 양쪽에서 안전하게 import한다(#81).
 */
export type StaffQrView = {
  /** academy_documents.id — 열기/닫기·재발급 대상 */
  id: string;
  /** 화면에 적는 링크 이름(입력칸이 사라진 뒤엔 항상 "직원 등록") */
  name: string;
  url: string;
  /** 서버에서 만든 QR SVG 문자열 */
  qrSvg: string;
  /** 원장이 켜 둔 상태인지(만료는 별개) */
  active: boolean;
  /** 실제로 지금 등록을 받는지 = active && 미만료 */
  open: boolean;
  /** 이 QR로 만들어지는 계정의 역할 라벨(현재 항상 "강사") */
  roleLabel: string;
  submissionCount: number;
  expiresAt: string | null;
};
