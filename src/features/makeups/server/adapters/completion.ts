import "server-only";
import { createClient } from "@/lib/supabase/server";
import { getTenantSettingsByTenantId } from "@/features/owner/server/queries";
import { isMissingMakeupRpc, isModeOffError, isParticipantPermissionDenied, parseParticipantBody } from "../../command-parse";
import { splitLegacyBatch } from "../../legacy-plan";

export type ProjectedReservation = {
  participantId: string;
  effectKey: string;
  teacherId: string | null;
  reportId: string | null;
  anchorClassId: string | null;
};

export type LegacyDisposition =
  | { kind: "legacy" }
  | { kind: "blocked"; error: string }
  | { kind: "split"; project: Map<string, ProjectedReservation>; hold: Set<string>; mode: "on" | "draining"; pilotSubjects: readonly string[] };

/** 권한 없는 출결 writer도 기존 미연결 예약은 이행한다. 연결 예약은 DB 보호가 시수 변경 전에 막는다. */
export async function classifyLegacyReservations(
  tenantId: string,
  rows: readonly { id: string; studentId: string; classId: string; makeupDate: string }[],
): Promise<LegacyDisposition> {
  if (rows.length === 0) return { kind: "legacy" };
  const settings = await getTenantSettingsByTenantId(tenantId);
  const mode = settings.makeups.mode;
  if (mode !== "on" && mode !== "draining") return { kind: "legacy" };
  const db = await createClient();
  const { data, error } = await db.rpc("makeup_list_participants", {
    p_filter: {
      class_id: rows[0]?.classId, session_date: rows[0]?.makeupDate,
      legacy_reservation_ids: rows.map((row) => row.id),
      student_ids: [...new Set(rows.map((row) => row.studentId))], limit: 500,
    },
  });
  if (error) {
    if (isParticipantPermissionDenied(error)) return { kind: "legacy" };
    if (isModeOffError(error) || isMissingMakeupRpc(error)) return { kind: "legacy" };
    return { kind: "blocked", error: "보강 참여를 확인하지 못했습니다" };
  }
  const parsed = parseParticipantBody(data);
  if (!parsed.ok || parsed.value.truncated) return { kind: "blocked", error: parsed.ok ? "보강 참여 목록이 잘렸습니다" : parsed.error };
  const maps = new Map(parsed.value.legacyMaps.map((row) => [row.legacyReservationId, row]));
  const people = new Map(parsed.value.participants.map((row) => [row.id, row]));
  const split = splitLegacyBatch(rows.map((row) => ({ id: row.id, studentId: row.studentId, mapped: maps.has(row.id) })));
  const project = new Map<string, ProjectedReservation>();
  const hold = new Set(split.hold.map((row) => row.id));
  for (const row of split.project) {
    const map = maps.get(row.id);
    if (!map?.participantId) {
      hold.add(row.id);
      continue;
    }
    const person = people.get(map.participantId);
    project.set(row.id, {
      participantId: map.participantId, effectKey: `att:${map.participantId}`,
      teacherId: person?.teacherId ?? null, reportId: person?.reportId ?? null,
      anchorClassId: person?.anchorClassId ?? person?.classId ?? null,
    });
  }
  return { kind: "split", project, hold, mode, pilotSubjects: settings.makeups.pilotSubjects };
}

export { sendParticipation } from "./effects";
