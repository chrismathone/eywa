import { getSlackCardState } from "@/features/slack/server/queries";
import { SlackSettingsForm } from "./slack-settings-form";

/**
 * 슬랙 알림 카드(학원 설정 '연동' 면) — 슈퍼관리자가 '슬랙 알림 연결'을 켠 지점에만 선다.
 * aywa 알림 중 고른 종류를 슬랙 채널과 받는 사람 본인(1:1)에게 보낸다(2026-09-28).
 */
export async function SlackCard() {
  const state = await getSlackCardState();
  if (state.kind === "off") return null;

  return (
    <section className="border-border bg-card space-y-3 rounded-2xl border p-5" aria-label="슬랙 알림">
      <div>
        <h3 className="text-foreground text-sm font-bold">슬랙 알림</h3>
        <p className="text-text-dim mt-1 text-xs">
          고른 aywa 알림을 슬랙 채널이나 받는 사람 본인에게 함께 보냅니다. 알림에 학생 이름·내용이 들어가므로 직원만 있는
          워크스페이스에 연결하세요. 한 번에 알림이 여러 건 생기면(일괄 배정 등) 한 통으로 묶어 보냅니다.
        </p>
      </div>
      {state.kind === "readonly" ? (
        <p className="text-text-dim text-sm">슬랙 연결은 원장만 설정할 수 있습니다.</p>
      ) : state.kind === "missing_table" ? (
        <p className="text-danger text-sm">슬랙 연결 표가 아직 DB에 없습니다 — 0297a SQL을 적용한 뒤 설정할 수 있습니다.</p>
      ) : state.kind === "error" ? (
        <p className="text-danger text-sm">슬랙 설정을 읽지 못했습니다. 잠시 후 새로고침해 주세요.</p>
      ) : (
        <SlackSettingsForm
          connected={state.connected}
          maskedToken={state.maskedToken}
          teamName={state.teamName}
          routes={state.routes}
        />
      )}
    </section>
  );
}
