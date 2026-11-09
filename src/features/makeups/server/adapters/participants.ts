import "server-only";
import { createClient } from "@/lib/supabase/server";
import { getTenantSettings } from "@/features/owner/server/queries";
import { isMissingMakeupRpc, isModeOffError, isParticipantPermissionDenied, parseParticipantBody, participantCursor, sameParticipantCursor, type ParticipantCursor } from "../../command-parse";
import { featureLive, type NativeParticipant, type ParticipantRead, type ReadOutcome } from "../../types";

/** 운영이 꺼져 있으면 RPC를 부르지 않는다. 실패는 빈 목록으로 바꾸지 않는다. */
export async function loadNativeParticipants(filter: Record<string, unknown>, options?: { sharedRead: true }): Promise<ReadOutcome<ParticipantRead>> {
  const settings = await getTenantSettings();
  if (!featureLive(settings.makeups.mode)) return { status: "off" };
  return readParticipantPages(filter, options);
}

export async function readParticipantRpc(filter: Record<string, unknown>, options?: { sharedRead: true }): Promise<ReadOutcome<ParticipantRead>> {
  const db = await createClient();
  const { data, error } = await db.rpc("makeup_list_participants", { p_filter: filter });
  if (error) {
    // 기존 화면에서는 메뉴 권한이 없는 보강 부가 정보만 생략한다. 쓰기를 **막는** 판정은 이 옵션을 쓰지 않는다(거절을 "없음"으로
    // 읽으면 문이 열린다). 쓰기를 **여는** 근거를 찾는 판정(gates.ts nativeWriteKeys·nativeWriteAllowance)은 써도 좁아지는 쪽이다.
    if (options?.sharedRead && isParticipantPermissionDenied(error)) return { status: "off" };
    if (isModeOffError(error)) return { status: "off" };
    if (isMissingMakeupRpc(error)) return { status: "schema_missing" };
    return { status: "failed", error: "보강 참여를 확인하지 못했습니다" };
  }
  const parsed = parseParticipantBody(data);
  return parsed.ok ? { status: "ok", value: parsed.value } : { status: "failed", error: parsed.error };
}

export function rowsOrThrow(outcome: ReadOutcome<ParticipantRead>): NativeParticipant[] {
  if (outcome.status === "failed" || outcome.status === "schema_missing") {
    throw new Error(outcome.status === "failed" ? outcome.error : "보강 참여를 확인하지 못했습니다");
  }
  if (outcome.status === "ok" && outcome.value.truncated) throw new Error("보강 참여 목록이 잘렸습니다");
  return outcome.status === "ok" ? outcome.value.participants : [];
}

/** 표가 없으면 옛 명단만 남긴다. 잘림과 조회 실패는 빈 목록으로 숨기지 않는다. */
export function participantsOrLegacy(outcome: ReadOutcome<ParticipantRead>): NativeParticipant[] {
  if (outcome.status === "off" || outcome.status === "schema_missing") return [];
  return rowsOrThrow(outcome);
}

const PAGE_LIMIT = 500;
const MAX_PAGES = 8;
const TRUNCATED = "보강 참여 목록이 잘렸습니다";
const MORE = "보강 참여가 더 있습니다. 기간을 나눠 다시 조회해 주세요";

function pagePayload(filter: Record<string, unknown>, after: ParticipantCursor | null): Record<string, unknown> {
  const payload: Record<string, unknown> = { ...filter, limit: PAGE_LIMIT };
  delete payload.page;
  delete payload.page_size;
  delete payload.after;
  if (after) payload.after = after;
  else {
    payload.page = 1;
    payload.page_size = PAGE_LIMIT;
  }
  return payload;
}

function emptyRead(participants: NativeParticipant[], legacyMaps: ParticipantRead["legacyMaps"]): ReadOutcome<ParticipantRead> {
  return { status: "ok", value: { participants, legacyMaps, truncated: false, total: null, nextAfter: null } };
}

/** 첫 쪽은 page 만, 다음 쪽은 after 만 보낸다. 4,000명을 넘으면 더 있다는 오류로 끝낸다. */
export async function readParticipantPages(filter: Record<string, unknown>, options?: { sharedRead: true }): Promise<ReadOutcome<ParticipantRead>> {
  const participants: NativeParticipant[] = [];
  const legacyMaps: ParticipantRead["legacyMaps"] = [];
  const seen = new Set<string>();
  let after: ParticipantCursor | null = null;
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const outcome = await readParticipantRpc(pagePayload(filter, after), options);
    if (outcome.status !== "ok") return outcome;
    const rows = outcome.value.participants;
    if (rows.length === 0) return page > 1 ? { status: "failed", error: TRUNCATED } : emptyRead(participants, legacyMaps);
    if (rows.some((row) => seen.has(row.id))) return { status: "failed", error: TRUNCATED };
    for (const row of rows) {
      seen.add(row.id);
      participants.push(row);
    }
    for (const map of outcome.value.legacyMaps) {
      if (seen.has(map.participantId) && !legacyMaps.some((kept) => kept.id === map.id)) legacyMaps.push(map);
    }
    const total = outcome.value.total;
    if (!outcome.value.truncated || (total !== null && participants.length >= total)) {
      return { status: "ok", value: { participants, legacyMaps, truncated: false, total, nextAfter: null } };
    }
    const next = outcome.value.nextAfter ?? participantCursor(rows[rows.length - 1]!);
    if (after && sameParticipantCursor(after, next)) return { status: "failed", error: TRUNCATED };
    after = next;
  }
  return { status: "failed", error: MORE };
}

export async function nativeAttendanceLinks(fromDate: string): Promise<{ classId: string; studentId: string; date: string; kind: string }[]> {
  const rows = participantsOrLegacy(await loadNativeParticipants({ date_from: fromDate }, { sharedRead: true }));
  return rows.flatMap((row) => (
    row.classId && row.status !== "cancelled"
      ? [{ classId: row.classId, studentId: row.studentId, date: row.sessionDate, kind: "native" }]
      : []
  ));
}
