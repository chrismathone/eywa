import { createHash } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { isValidCodeInput } from "@/features/attendance/kiosk/codes";
import { KIOSK_COOKIE } from "@/features/attendance/kiosk/constants";
import { parseForwardedFor } from "@/features/attendance/kiosk/device-info";
import { processKioskCheckin } from "@/features/attendance/kiosk/server/checkin";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

// ⚠️ /api/* 는 미들웨어를 전면 통과한다(proxy.ts). 이 핸들러가 인증 전부를 책임진다:
//   디바이스 토큰(httpOnly 쿠키) 해시 조회 → tenant 스코프 → 출석번호 형식 검증 → 시도 제한.
//   service_role(admin)이 RLS를 우회하므로 한 줄이라도 빠지면 전 테넌트 노출 — 신중히.

// 경량 시도 제한(데모). ⚠️ Vercel serverless는 인스턴스 간 메모리 비공유 →
// 프로덕션급 무차별대입 방어는 Upstash/Vercel KV 같은 외부 상태저장소 필요(향후).
const attempts = new Map<string, number[]>();
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 20;

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function POST(req: Request) {
  const jar = await cookies();
  const token = jar.get(KIOSK_COOKIE)?.value;
  if (!token) {
    return NextResponse.json({ ok: false, reason: "no_device" }, { status: 401 });
  }

  const admin = createAdminClient();
  const { data: device } = await admin
    .from("kiosk_devices")
    .select("id, tenant_id, is_active")
    .eq("token_hash", hashToken(token))
    .maybeSingle();
  if (!device || !device.is_active) {
    return NextResponse.json({ ok: false, reason: "device_revoked" }, { status: 401 });
  }

  // 시도 제한(기기별 슬라이딩 윈도우)
  const now = new Date();
  const recent = (attempts.get(device.id) ?? []).filter((t) => now.getTime() - t < WINDOW_MS);
  if (recent.length >= MAX_PER_WINDOW) {
    return NextResponse.json({ ok: false, reason: "rate_limited" }, { status: 429 });
  }
  recent.push(now.getTime());
  attempts.set(device.id, recent);

  let body: { code?: string };
  try {
    body = (await req.json()) as { code?: string };
  } catch {
    return NextResponse.json({ ok: false, reason: "bad_request" }, { status: 400 });
  }
  const code = String(body.code ?? "").trim();
  if (!isValidCodeInput(code)) {
    return NextResponse.json({ ok: false, reason: "invalid_code" }, { status: 400 });
  }

  // 기기 last_seen(시각/IP) 갱신(best-effort)
  const ip = parseForwardedFor(req.headers.get("x-forwarded-for"), req.headers.get("x-real-ip"));
  await admin
    .from("kiosk_devices")
    .update({ last_seen_at: now.toISOString(), ...(ip ? { last_seen_ip: ip } : {}) })
    .eq("id", device.id);

  const result = await processKioskCheckin({
    tenantId: device.tenant_id,
    deviceId: device.id,
    code,
    now,
  });

  const status = result.ok ? 200 : result.reason === "not_found" ? 404 : 400;
  return NextResponse.json(result, { status });
}
