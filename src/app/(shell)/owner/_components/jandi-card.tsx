import { getJandiCardState } from "@/features/jandi/server/queries";
import { JandiSettingsForm } from "./jandi-settings-form";

/**
 * 잔디 알림 카드(학원 설정 '연동' 면) — 슈퍼관리자가 '잔디 알림 연결'을 켠 지점에만 선다.
 * aywa 알림 중 원장이 고른 종류를 그 지점의 잔디 방 하나로 보낸다(1단계, 2026-09-28).
 */
export async function JandiCard() {
  const state = await getJandiCardState();
  if (state.kind === "off") return null;

  return (
    <section className="border-border bg-card space-y-3 rounded-2xl border p-5" aria-label="잔디 알림">
      <div>
        <h3 className="text-foreground text-sm font-bold">잔디 알림</h3>
        <p className="text-text-dim mt-1 text-xs">
          고른 aywa 알림을 잔디 방으로 함께 보냅니다. 알림에 학생 이름·내용이 들어가므로 직원만 있는 방에 연결하세요.
          한 번에 알림이 여러 건 생기면(일괄 배정 등) 한 통으로 묶어 보냅니다.
        </p>
      </div>
      {state.kind === "readonly" ? (
        <p className="text-text-dim text-sm">잔디 연결은 원장만 설정할 수 있습니다.</p>
      ) : state.kind === "missing_table" ? (
        <p className="text-danger text-sm">잔디 연결 표가 아직 DB에 없습니다 — 0294a SQL을 적용한 뒤 설정할 수 있습니다.</p>
      ) : state.kind === "error" ? (
        <p className="text-danger text-sm">잔디 설정을 읽지 못했습니다. 잠시 후 새로고침해 주세요.</p>
      ) : (
        <JandiSettingsForm connected={state.connected} maskedUrl={state.maskedUrl} eventTypes={state.eventTypes} />
      )}
    </section>
  );
}
