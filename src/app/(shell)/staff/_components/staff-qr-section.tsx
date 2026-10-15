import { buildStaffQrViews } from "@/features/staff/intake/server/intake-qr";
import { listStaffIntakeTokens } from "@/features/staff/intake/server/intake-token";
import { StaffQrPanel } from "./staff-qr-panel";

/**
 * 직원 등록 QR 섹션 — 토큰 목록 + QR SVG 생성을 서버에서(qrcode를 클라 번들에 안 싣는다, 등록상담 선례).
 * 원장 지시 2026-08-07: "직원 명부만 나오는 QR로 직원 등록" — 만들 때 물어보는 칸은 없다(패널 주석 참조).
 */
export async function StaffQrSection({ tenantId }: { tenantId: string }) {
  const tokens = await listStaffIntakeTokens(tenantId);
  return <StaffQrPanel tokens={await buildStaffQrViews(tokens)} />;
}
