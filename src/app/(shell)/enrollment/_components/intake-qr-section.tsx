import { headers } from "next/headers";
import QRCode from "qrcode";
import { getIntakeTokens } from "@/features/enrollment/server/queries";
import { IntakeQrButton, type IntakeTokenView } from "./intake-qr-panel";

/**
 * 공개 접수 QR — 토큰 조회 + QR SVG 생성을 첫 페인트에서 분리(Suspense 스트리밍).
 * QR은 버튼 클릭 시에만 보이므로 첫 페인트를 막을 이유가 없다. 서버 생성 유지(qrcode를 클라 번들에 안 싣음).
 * `canWrite` = 페이지가 토큰 액션 게이트와 같은 판정(`canWriteTenant(…,"enrollment")`)으로 내려 준다 — false면 링크 관리 단추를 안 그린다.
 */
export async function IntakeQrSection({ canWrite = true }: { canWrite?: boolean }) {
  const tokens = await getIntakeTokens();
  const h = await headers();
  const host = h.get("host") ?? "localhost:3000";
  const proto = host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https";
  const origin = `${proto}://${host}`;
  const tokenViews: IntakeTokenView[] = await Promise.all(
    tokens.map(async (t) => {
      const url = `${origin}/intake/${t.token}`;
      return {
        id: t.id,
        name: t.name,
        url,
        qrSvg: await QRCode.toString(url, { type: "svg", margin: 1 }),
        isActive: t.isActive,
        usageCount: t.usageCount,
        submissionCount: t.submissionCount,
        expiresAt: t.expiresAt,
      };
    }),
  );
  return <IntakeQrButton tokens={tokenViews} canWrite={canWrite} />;
}
