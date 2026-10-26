import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchInChunks } from "@/lib/supabase/batch";
import { OWNER_ANCHORS } from "../harness/owner-anchors";
import { buildOwnerSystem, notesHash, ownerCard, type LoadedAnchor, type OwnerCardFields } from "../harness/owner";
import { piiHits } from "../harness/pii";

/**
 * 평점 기준 v6의 시스템 지침(기준 + 원장이 매긴 예시) — 예시 글은 저장소가 아니라 DB에서 읽는다(owner-anchors.ts 머리 주석).
 * 🔴 admin(RLS 우회)이라 **tenant_id 필터 필수** — 그래서 예시가 없는 지점(다른 지점)은 0건이고 매기지 않는다(원장 기준이 없는 지점에 침산 원장 눈높이를 쓰지 않는다).
 * 🔴 멘트 지문이 달라진 예시(선생님이 고침) · 외부 AI 전송 금지 정보가 든 예시는 뺀다. 남은 예시가 OWNER_ANCHOR_MIN보다 적으면 매기지 않는다(눈높이가 흔들린다).
 */
export const OWNER_ANCHOR_MIN = 40;

export type OwnerSystem = { system: string; used: number; dropped: string[] };

type Row = OwnerCardFields & { id: string };

export async function loadOwnerSystem(tenantId: string): Promise<OwnerSystem> {
  const db = createAdminClient();
  const rows = await fetchInChunks<Row>(OWNER_ANCHORS.map((a) => a.reportId), (chunk) =>
    db.from("lesson_reports").select("id, progress, homework_score, attitude, homework_today, notes").eq("tenant_id", tenantId).in("id", chunk));
  const byId = new Map(rows.map((r) => [r.id, r]));
  const loaded: LoadedAnchor[] = [];
  const dropped: string[] = [];
  for (const anchor of OWNER_ANCHORS) {
    const r = byId.get(anchor.reportId);
    if (!r) dropped.push(`${anchor.reportId}: 없음`);
    else if (notesHash(r.notes) !== anchor.notesHash) dropped.push(`${anchor.reportId}: 멘트가 바뀜`);
    else if (piiHits(ownerCard(r)).length) dropped.push(`${anchor.reportId}: 전송 금지 정보`);
    else loaded.push({ anchor, card: r });
  }
  return { system: buildOwnerSystem(loaded), used: loaded.length, dropped };
}

/** 매길 수 있는가 — 예시가 충분할 때만. 아니면 한글 사유. */
export function ownerSystemProblem(s: OwnerSystem): string | null {
  return s.used >= OWNER_ANCHOR_MIN ? null : `원장 기준 예시가 ${s.used}건뿐이라(${OWNER_ANCHOR_MIN}건 이상 필요) 매기지 않습니다`;
}
