/** 보강 수업의 반과 학부모에게 전달할 반은 별개다(2026-11-12). */
export function makeupDeliveryOnSave(input: {
  anchor: string | null;
  priorAnchor: string | null;
  priorDelivery: string | null;
}): string | null {
  return input.anchor === input.priorAnchor ? input.priorDelivery ?? input.anchor : input.anchor;
}

/** 발송 PC가 여러 대면 어느 PC가 작업을 집어도 새 경로를 처리해야 한다. */
export function makeupDeliveryWorkersReady(rows: readonly { last_seen: string | null; last_results: unknown }[], now: number): boolean {
  const posting = rows.flatMap(row => {
    const at = Date.parse(row.last_seen ?? "");
    const raw = row.last_results;
    if (!Number.isFinite(at) || !raw || typeof raw !== "object" || Array.isArray(raw)) return [];
    const data = raw as { postMode?: unknown; caps?: { makeupDelivery?: unknown } };
    return data.postMode === true ? [{ at, supported: data.caps?.makeupDelivery === true }] : [];
  });
  const live = posting.filter(row => now - row.at <= 10 * 60_000);
  const pool = live.length ? live : posting.sort((a, b) => b.at - a.at).slice(0, 1);
  return pool.length > 0 && pool.every(row => row.supported);
}

export const MAKEUP_DELIVERY_UPDATE_REQUIRED = "보강 보고서의 발송 경로를 처리하려면 연동 PC 업데이트가 필요합니다 — 보고서는 저장됐습니다";
