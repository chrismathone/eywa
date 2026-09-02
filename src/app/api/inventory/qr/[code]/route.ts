import { NextResponse } from "next/server";
import { requireAccess } from "@/lib/auth/require-access";
import { ASSET_CODE_RE, normalizeAssetCode } from "@/features/inventory/asset-code";
import { assetQrTarget } from "@/features/inventory/qr";

/**
 * 자산 QR(SVG) — 자산ID에서 그 자리에서 그린다(저장 없음 → 새 자산도 자동). 내용 = 상세 화면 절대 주소.
 * 🔑 `qrcode`는 무거운 라이브러리라 여기(서버 라우트)에서만 `await import()`한다(B5). 하루 캐시(private).
 * 열람 권한(inventory)이 있어야 한다 — 표·라벨·상세가 같은 게이트를 지난다.
 */
export async function GET(request: Request, { params }: { params: Promise<{ code: string }> }) {
  await requireAccess("inventory");
  const code = normalizeAssetCode(decodeURIComponent((await params).code));
  if (!ASSET_CODE_RE.test(code)) return new NextResponse("bad code", { status: 400 });
  const base = process.env.NEXT_PUBLIC_APP_URL?.trim() || new URL(request.url).origin;
  const QRCode = (await import("qrcode")).default;
  const svg = await QRCode.toString(assetQrTarget(base, code), { type: "svg", margin: 1, errorCorrectionLevel: "M" });
  return new NextResponse(svg, {
    headers: {
      "Content-Type": "image/svg+xml; charset=utf-8",
      "Cache-Control": "private, max-age=86400",
    },
  });
}
