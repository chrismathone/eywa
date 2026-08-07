import "server-only";
import webpush from "web-push";
import { createAdminClient } from "@/lib/supabase/admin";
import { reportError } from "@/lib/observability/report-error";

/**
 * 휴대폰 웹 푸시 발송 (0188a, 2026-08-07).
 *
 * 범위(원장 2026-08-07): *"셔틀 선생님으로 체크된 사용자만 알림을 모바일에서 받을 수 있으면 될것 같네.
 * pc 알림은 잘 작동하는것 같더라고"* → **`attendance_alert_optin` 계정 + 출결 알림**만 이 경로를 탄다.
 * PC 알림(desktop-notify.ts, 창이 열려 있을 때의 OS 알림)은 손대지 않았다.
 *
 * 🔴 **best-effort다.** 푸시 실패가 알림 insert(=벨)나 본 작업을 절대 막지 않는다. 벨이 진실이고
 *    푸시는 "빨리 알려주는 수단"일 뿐이다 — 여기서 throw하면 분류 스윕 전체가 멈춘다.
 *
 * ⚠️ 키가 없으면 **조용히 아무것도 안 한다**(no-op). Vercel에 `VAPID_PUBLIC_KEY`·`VAPID_PRIVATE_KEY`를
 *    넣기 전까지 이 코드가 배포돼 있어도 무해하다(gotcha #95의 expand/contract — 앱이 먼저 나가도 안전).
 * ⚠️ 표(0188a)가 아직 없어도 조용히 0을 돌려준다 — SQL을 원장이 손으로 실행하므로 배포와 적용 사이에
 *    항상 간격이 있다. 이 경로가 죽으면 셔틀 알림 자체가 안 만들어지므로 반드시 삼킨다.
 */

export type PushPayload = {
  title: string;
  body?: string | null;
  /** 눌렀을 때 열 화면(앱 경로). */
  link?: string | null;
  /** 같은 tag는 폰이 하나로 덮어쓴다 — 알림 id를 넣어 중복 표시를 막는다. */
  tag?: string | null;
};

type SubRow = { id: string; endpoint: string; p256dh: string; auth: string };

/** 공개키 — 브라우저 구독에 필요해 클라이언트로 내려간다(공개해도 되는 값이다). */
export function pushPublicKey(): string | null {
  return process.env.VAPID_PUBLIC_KEY?.trim() || null;
}

/** 발송 준비가 됐나(키 3종). subject는 연락처 URL/mailto — 푸시 서비스가 문제 시 연락할 곳이다. */
export function pushConfigured(): boolean {
  return Boolean(pushPublicKey() && process.env.VAPID_PRIVATE_KEY?.trim());
}

function applyVapid(): boolean {
  const publicKey = pushPublicKey();
  const privateKey = process.env.VAPID_PRIVATE_KEY?.trim();
  if (!publicKey || !privateKey) return false;
  const subject = process.env.VAPID_SUBJECT?.trim() || "mailto:admin@eywa.app";
  try {
    webpush.setVapidDetails(subject, publicKey, privateKey);
    return true;
  } catch (e) {
    reportError(e, { scope: "push.vapid" }); // 키 형식이 깨졌다 — 발송은 포기하되 앱은 계속 돈다
    return false;
  }
}

/**
 * 지정 사용자들의 **모든 기기**로 푸시. 반환값은 실제로 보낸 기기 수(0이어도 정상 — 구독 전일 수 있다).
 *
 * ⚠️ admin client는 RLS를 우회한다 → `tenant_id` 필터 필수(다른 학원 기기로 새면 대형 사고).
 */
export async function sendPushToUsers(
  tenantId: string,
  userIds: string[],
  payload: PushPayload,
): Promise<number> {
  if (!userIds.length || !pushConfigured() || !applyVapid()) return 0;
  try {
    const db = createAdminClient();
    const { data, error } = await db
      .from("push_subscriptions")
      .select("id, endpoint, p256dh, auth")
      .eq("tenant_id", tenantId)
      .in("user_id", userIds)
      .is("failed_at", null);
    // 표가 아직 없거나(마이그 전) 조회가 깨졌으면 조용히 포기 — 벨은 이미 만들어졌다.
    if (error || !data?.length) return 0;

    const body = JSON.stringify({
      title: payload.title,
      body: payload.body ?? "",
      link: payload.link ?? "/",
      tag: payload.tag ?? undefined,
    });

    let sent = 0;
    // 기기 수가 한 자리라 순차로 충분하다(병렬로 묶어 푸시 서비스에 몰아칠 이유가 없다).
    for (const sub of (data as SubRow[]) ?? []) {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          body,
          { TTL: 60 * 60 * 6 }, // 6시간 — 셔틀 출발 뒤에 도착하는 알림은 의미가 없다
        );
        sent++;
        await db.from("push_subscriptions").update({ last_sent_at: new Date().toISOString() }).eq("id", sub.id);
      } catch (e) {
        // 404·410 = 구독이 죽었다(앱 삭제·권한 회수). 소인해 다음 발송에서 빼면 표가 무한히 자라지 않는다.
        const status = (e as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) {
          await db
            .from("push_subscriptions")
            .update({ failed_at: new Date().toISOString(), fail_reason: `gone(${status})` })
            .eq("id", sub.id);
        } else {
          reportError(e, { scope: "push.send", status });
        }
      }
    }
    return sent;
  } catch (e) {
    reportError(e, { scope: "push.send.throw" });
    return 0;
  }
}
