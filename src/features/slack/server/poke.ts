import "server-only";
import { after } from "next/server";
import { reportError } from "@/lib/observability/report-error";

/**
 * 앱에서 알림·활동이 생긴 뒤 **응답 뒤에** 슬랙 발송기를 한 번 깨운다 — "바로 체크"(1분 cron을 기다리지 않게).
 * 트리거가 같은 트랜잭션에서 인박스에 넣었으니, 응답 뒤엔 이미 커밋돼 보인다.
 * 🔴 발송기는 동적 import — 감사로그(log.ts)가 이 모듈을 부르므로 정적으로 물면 순환이 생기고,
 *    슬랙을 안 쓰는 지점까지 발송기 코드를 매번 싣게 된다. 슬랙 연결이 없는 지점은 조회 한 번으로 끝난다.
 */
export function pokeSlack(tenantId: string | null | undefined): void {
  if (!tenantId) return;
  const run = () =>
    import("./dispatch")
      .then((m) => m.drainTenant(tenantId))
      .catch((e) => reportError(e, { scope: "slack.poke", tenantId }));
  try {
    after(run);
  } catch {
    // 요청 밖(스크립트 등) — cron이 1분 안에 처리한다.
  }
}
