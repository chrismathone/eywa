import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { createClient } from "@/lib/supabase/server";
import { pushConfigured, pushPublicKey } from "@/lib/push/web-push";

/**
 * 휴대폰 알림 구독 관리 (0188a, 2026-08-07).
 *
 *  GET    — 이 계정이 휴대폰 알림을 켤 수 있나 + 구독에 필요한 공개키.
 *  POST   — 이 기기 구독 저장(같은 기기는 endpoint가 같아 갱신된다).
 *  DELETE — 이 기기 구독 해제.
 *
 * 게이트(원장 2026-08-07): **`users.attendance_alert_optin`이 켜진 계정만.** 셔틀·사무실이 출결 연락을
 * 폰으로 받게 하려는 기능이라, 토글이 꺼진 계정은 구독해봐야 받을 알림이 없다(자격증명만 쌓인다).
 *
 * ⚠️ 쓰기는 **사용자 세션 클라이언트**로 한다(admin 아님) — RLS `push_subscriptions_self`가 본인 행만
 *    허용하므로, 남의 기기를 등록·삭제하는 경로가 구조적으로 막힌다.
 * ⚠️ 표(0188a)가 아직 없어도 500으로 죽지 않고 `{ ok:false }`로 답한다(SQL은 원장이 손으로 실행 — 배포와
 *    적용 사이 간격이 항상 있다, gotcha #95).
 */

export const dynamic = "force-dynamic";

type OptinRow = { attendance_alert_optin: boolean | null };

async function meWithOptin() {
  const user = await getCurrentUser();
  if (!user) return null;
  const supabase = await createClient();
  const { data } = await supabase
    .from("users")
    .select("attendance_alert_optin")
    .eq("id", user.id)
    .maybeSingle<OptinRow>();
  return { user, optin: Boolean(data?.attendance_alert_optin) };
}

export async function GET() {
  const me = await meWithOptin();
  if (!me) return NextResponse.json({ ok: false }, { status: 401 });
  // 서버가 준비 안 됐거나(키 없음) 토글이 꺼진 계정이면 버튼 자체를 띄우지 않는다(할 수 없는 일을 권하지 않기).
  const enabled = me.optin && pushConfigured();
  return NextResponse.json({ ok: true, enabled, publicKey: enabled ? pushPublicKey() : null });
}

export async function POST(req: Request) {
  const me = await meWithOptin();
  if (!me) return NextResponse.json({ ok: false }, { status: 401 });
  if (!me.optin) return NextResponse.json({ ok: false, reason: "not_optin" }, { status: 403 });

  let payload: { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } };
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ ok: false, reason: "bad_json" }, { status: 400 });
  }
  const endpoint = typeof payload.endpoint === "string" ? payload.endpoint : "";
  const p256dh = typeof payload.keys?.p256dh === "string" ? payload.keys.p256dh : "";
  const auth = typeof payload.keys?.auth === "string" ? payload.keys.auth : "";
  if (!endpoint.startsWith("https://") || !p256dh || !auth) {
    return NextResponse.json({ ok: false, reason: "bad_subscription" }, { status: 400 });
  }

  const supabase = await createClient();
  const { error } = await supabase.from("push_subscriptions").upsert(
    {
      tenant_id: me.user.tenantId,
      user_id: me.user.id,
      endpoint,
      p256dh,
      auth,
      user_agent: req.headers.get("user-agent")?.slice(0, 300) ?? null,
      // 다시 켰다는 뜻이므로 지난 실패 소인을 지운다(기기를 되살린다).
      failed_at: null,
      fail_reason: null,
    },
    { onConflict: "endpoint" },
  );
  if (error) return NextResponse.json({ ok: false, reason: "save_failed" }, { status: 200 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
  const me = await meWithOptin();
  if (!me) return NextResponse.json({ ok: false }, { status: 401 });
  let endpoint = "";
  try {
    const payload = (await req.json()) as { endpoint?: unknown };
    endpoint = typeof payload.endpoint === "string" ? payload.endpoint : "";
  } catch {
    /* 본문이 없으면 아래에서 400 */
  }
  if (!endpoint) return NextResponse.json({ ok: false, reason: "no_endpoint" }, { status: 400 });

  const supabase = await createClient();
  // RLS가 본인 행으로 이미 좁히지만, 실수로 남의 endpoint를 보내도 안 지워지도록 조건을 한 번 더 적는다.
  await supabase.from("push_subscriptions").delete().eq("endpoint", endpoint).eq("user_id", me.user.id);
  return NextResponse.json({ ok: true });
}
