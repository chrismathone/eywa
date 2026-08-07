import { headers } from "next/headers";
import QRCode from "qrcode";
import { ROLE_LABEL } from "@/lib/auth/role-hierarchy";
import type { SystemRole } from "@/lib/permissions";
import { isTokenOpen } from "@/features/staff/server/intake-token";
import { listStaffIntakeTokens } from "@/features/staff/server/intake-token-actions";
import { StaffQrPanel, type StaffQrView } from "./staff-qr-panel";

/**
 * 직원 등록 QR 섹션 — 토큰 목록 + QR SVG 생성을 서버에서(qrcode를 클라 번들에 안 싣는다, 등록상담 선례).
 * 원장 지시 2026-08-07: "직원 명부만 나오는 QR로 직원 등록".
 */
export async function StaffQrSection({ tenantId }: { tenantId: string }) {
  const tokens = await listStaffIntakeTokens(tenantId);
  const h = await headers();
  const host = h.get("host") ?? "localhost:3000";
  const proto = host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https";
  const origin = `${proto}://${host}`;

  const views: StaffQrView[] = await Promise.all(
    tokens.map(async (t) => {
      const url = `${origin}/staff-intake/${t.token}`;
      return {
        id: t.id,
        name: t.name,
        url,
        qrSvg: await QRCode.toString(url, { type: "svg", margin: 1 }),
        active: t.active,
        open: isTokenOpen(t),
        roleLabel: ROLE_LABEL[t.role as SystemRole] ?? t.role,
        submissionCount: t.submissionCount,
        expiresAt: t.expiresAt,
      };
    }),
  );
  return <StaffQrPanel tokens={views} />;
}
