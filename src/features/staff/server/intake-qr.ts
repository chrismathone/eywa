import "server-only";
import { headers } from "next/headers";
import QRCode from "qrcode";
import { ROLE_LABEL } from "@/lib/auth/role-hierarchy";
import type { SystemRole } from "@/lib/permissions";
import type { StaffQrView } from "../intake-view";
import { isTokenOpen, type StaffIntakeToken } from "./intake-token";

// 토큰 → 화면 뷰(QR SVG 포함). 목록 렌더(StaffQrSection)와 서버 액션(만들기·재발급)이 **같은 함수**를 쓴다 —
// 액션이 뷰를 그대로 돌려주면 클라가 router.refresh를 기다리지 않고 즉시 QR을 띄운다.

export async function buildStaffQrView(t: StaffIntakeToken): Promise<StaffQrView> {
  const h = await headers();
  const host = h.get("host") ?? "localhost:3000";
  const proto = host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https";
  const url = `${proto}://${host}/staff-intake/${t.token}`;
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
}

export async function buildStaffQrViews(tokens: StaffIntakeToken[]): Promise<StaffQrView[]> {
  return Promise.all(tokens.map((t) => buildStaffQrView(t)));
}
