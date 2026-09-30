import "server-only";
import { google } from "googleapis";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllPaged } from "@/lib/supabase/batch";
import { canOverwrite, googleEventKey, type ImportedEventRow } from "../google-import";

/**
 * 구글 캘린더 → aywa 반영의 **공용 부품** — 전체 임포트(google-import.ts)와 웹훅 증분 동기화
 * (google-incremental.ts)가 **같은 규칙**으로 쓰게 한 곳에 모았다(두 벌이면 한쪽만 고쳐진다).
 * 🔴 읽기만 한다 · 손으로 만든 일정 불가침(`google_event_id` 있는 행만) · 사람이 고친 행 안 덮음 · 지운 행 묘비.
 * ⚠️ admin 클라이언트 = RLS 우회 → 모든 쿼리에 **tenant_id 명시 필터**.
 */

export type Admin = ReturnType<typeof createAdminClient>;

/** 과거·미래 창 — 지난 일정은 기록으로 조금만, 앞은 넉넉히(연간 행사가 1년 뒤에 잡힌다). */
export const PAST_DAYS = 30;
export const FUTURE_DAYS = 400;

export function syncWindow(now: number) {
  const windowStart = new Date(now - PAST_DAYS * 86_400_000);
  const windowEnd = new Date(now + FUTURE_DAYS * 86_400_000);
  const ymd = (d: Date) => new Date(d.getTime() + 9 * 3600_000).toISOString().slice(0, 10);
  return { windowStart, windowEnd, startYmd: ymd(windowStart), endYmd: ymd(windowEnd) };
}

/**
 * 서비스 계정 키 로드. 실패 사유를 **갈라서** 돌려준다.
 * 🔴 "키 없음"과 "형식 이상"을 한 문장으로 뭉치면 진단이 왕복한다 — 2026-09-10에 실제로
 *    "Vercel에 넣었는데?"와 "그건 로컬 파일입니다"를 두 번 주고받았다. 어느 이름이 있고 없는지를 적는다.
 */
function loadServiceAccount(): { ok: true; email: string; key: string } | { ok: false; reason: string } {
  // 🔴 있는 키를 순서대로 쓴다 — 환경마다 무엇이 들어 있는지가 다르다(프로덕션엔 캘린더 전용 키).
  //    ⚠️ 어느 키든 **그 키가 속한 GCP 프로젝트에서 Calendar API가 켜져 있어야** 한다. 안 켜져 있으면
  //       인증은 되고 조회에서 "has not been used in project …"로 막힌다(권한 문제로 오인하기 쉽다).
  const candidates: [string, string | undefined][] = [
    ["GOOGLE_CALENDAR_SERVICE_ACCOUNT_KEY", process.env.GOOGLE_CALENDAR_SERVICE_ACCOUNT_KEY],
    ["GOOGLE_SERVICE_ACCOUNT_KEY", process.env.GOOGLE_SERVICE_ACCOUNT_KEY],
  ];
  const found = candidates.find(([, v]) => v && v.trim().length > 0);
  const which = found?.[0] ?? "";
  const raw = found?.[1];
  if (!raw) {
    return {
      ok: false,
      reason:
        "서비스 계정 키가 이 환경에 없습니다 — GOOGLE_CALENDAR_SERVICE_ACCOUNT_KEY · GOOGLE_SERVICE_ACCOUNT_KEY 중 하나를 Vercel(Production)에 넣고 재배포하세요.",
    };
  }
  let parsed: { client_email?: string; private_key?: string };
  try {
    parsed = JSON.parse(raw) as typeof parsed;
  } catch {
    try {
      parsed = JSON.parse(Buffer.from(raw, "base64").toString("utf8")) as typeof parsed;
    } catch {
      return { ok: false, reason: `${which} 값을 JSON으로 읽지 못했습니다(원문·base64 둘 다 실패).` };
    }
  }
  if (!parsed.client_email || !parsed.private_key) {
    return { ok: false, reason: `${which}에 client_email 또는 private_key가 없습니다.` };
  }
  return { ok: true, email: parsed.client_email, key: parsed.private_key };
}

export type CalendarApi = ReturnType<typeof google.calendar>;

/** 읽기 전용 캘린더 클라이언트. 푸시 채널(`events.watch`)도 읽기 권한으로 연다. */
export function calendarApi(): { ok: true; cal: CalendarApi } | { ok: false; reason: string } {
  const sa = loadServiceAccount();
  if (!sa.ok) return sa;
  const auth = new google.auth.JWT({
    email: sa.email,
    key: sa.key,
    scopes: ["https://www.googleapis.com/auth/calendar.readonly"],
  });
  return { ok: true, cal: google.calendar({ version: "v3", auth }) };
}

export type ImportSummary = {
  tenantId: string;
  calendars: number;
  inserted: number;
  updated: number;
  skippedEdited: number;
  /** 사람이 aywa에서 지운 구글 일정 — 다시 넣지 않고 건너뛴 수(F15). */
  skippedDeleted: number;
  unchanged: number;
  deleted: number;
  failed: { calendarId: string; reason: string }[];
};

export function emptySummary(tenantId: string, calendars: number): ImportSummary {
  return { tenantId, calendars, inserted: 0, updated: 0, skippedEdited: 0, skippedDeleted: 0, unchanged: 0, deleted: 0, failed: [] };
}

export type ExistingRow = {
  id: string;
  google_event_id: string | null;
  updated_at: string | null;
  google_synced_at: string | null;
  title: string | null;
  memo: string | null;
  start_date: string | null;
  end_date: string | null;
  start_time: string | null;
  end_time: string | null;
  tag_id: string | null;
};
export const EXISTING_COLUMNS =
  "id, google_event_id, updated_at, google_synced_at, title, memo, start_date, end_date, start_time, end_time, tag_id";

/**
 * 내용이 그대로면 UPDATE를 보내지 않는다.
 * 🔴 안 그러면 **12시간마다 1,077행을 전부 다시 쓴다** — 바뀐 게 없어도 `updated_at`이 올라가
 *    "사람이 고쳤나" 판정(`canOverwrite`)의 근거까지 흐려진다.
 * ⚠️ `start_time`은 DB가 `16:00:00`으로 돌려주고 우리는 `16:00`을 만든다 — 앞 5글자로 비교한다.
 */
function unchanged(prev: ExistingRow, next: ImportedEventRow, tagId: string | null): boolean {
  const t = (v: string | null) => (v ? v.slice(0, 5) : null);
  return (
    prev.title === next.title &&
    prev.memo === next.memo &&
    prev.start_date === next.startDate &&
    prev.end_date === next.endDate &&
    t(prev.start_time) === next.startTime &&
    t(prev.end_time) === next.endTime &&
    prev.tag_id === tagId
  );
}

/** 태그 이름 → id. 없으면 만든다(이름은 원장이 정한 것이라 임의로 바꾸지 않는다). */
export async function resolveTagId(admin: Admin, tenantId: string, name: string): Promise<string | null> {
  const { data } = await admin.from("calendar_tags").select("id").eq("tenant_id", tenantId).eq("name", name).maybeSingle();
  if (data?.id) return String(data.id);
  const { data: made } = await admin.from("calendar_tags").insert({ tenant_id: tenantId, name }).select("id").maybeSingle();
  return made?.id ? String(made.id) : null;
}

/**
 * 🔴 사람이 aywa에서 지운 구글 일정(2026-09-23 전수 점검 F15) — 지워도 다음 회차가 "새 일정"으로 다시
 *    넣어서, 취소된 레벨테스트가 12시간 뒤 '금일입테'에 또 떴다. **삭제 감사로그(append-only)**가 묘비:
 *    deleteCalendarEvent가 지운 행의 구글 키를 metadata에 남기고, 반영은 그 키를 건너뛴다.
 *    ⚠️ 조회가 실패하면 멈추지 않는다 — 대신 실패로 적는다(묘비를 못 읽었다고 전 캘린더를 버리면 더 큰 손실).
 */
export async function loadTombstones(admin: Admin, tenantId: string, now: number, summary: ImportSummary): Promise<Set<string>> {
  const tombstones = new Set<string>();
  try {
    const since = new Date(now - (PAST_DAYS + FUTURE_DAYS) * 86_400_000).toISOString();
    const logs = await fetchAllPaged<{ metadata: { googleEventKeys?: unknown } | null }>((from, to) =>
      admin
        .from("audit_logs")
        .select("metadata")
        .eq("tenant_id", tenantId)
        .eq("action", "calendar_event_delete")
        .gte("created_at", since)
        .not("metadata->googleEventKeys", "is", null)
        .order("id", { ascending: true })
        .range(from, to),
    );
    for (const l of logs) {
      const keys = l.metadata?.googleEventKeys;
      if (Array.isArray(keys)) for (const k of keys) if (typeof k === "string") tombstones.add(k);
    }
  } catch (e) {
    summary.failed.push({
      calendarId: "-",
      reason: `삭제한 일정 목록을 읽지 못했습니다 — ${e instanceof Error ? e.message.slice(0, 160) : "조회 실패"}`,
    });
  }
  return tombstones;
}

/** 캘린더 하나의 쓰기 실패를 한 줄로 모은다(감사로그 metadata가 수천 줄이 되지 않게). */
export function writeFailureCollector() {
  let count = 0;
  let first: string | null = null;
  return {
    get count() {
      return count;
    },
    note(message: string) {
      count += 1;
      first ??= message.slice(0, 160);
    },
    flush(summary: ImportSummary, calendarId: string) {
      if (count > 0) summary.failed.push({ calendarId, reason: `일정 ${count}건 쓰기 실패 — ${first ?? "알 수 없음"}` });
    },
  };
}

/**
 * 구글 행들을 넣거나 고친다 — 없으면 넣고(묘비면 건너뜀), 있으면 사람이 안 고쳤고 내용이 바뀐 것만 고친다.
 * 전체 임포트와 증분 동기화가 **이 함수 하나**를 지난다.
 */
export async function applyRows(
  admin: Admin,
  ctx: { tenantId: string; calendarId: string; tagId: string | null; syncedAt: string },
  rows: readonly ImportedEventRow[],
  byGoogleId: ReadonlyMap<string, ExistingRow>,
  tombstones: ReadonlySet<string>,
  summary: ImportSummary,
  note: (message: string) => void,
): Promise<void> {
  for (const row of rows) {
    const prev = byGoogleId.get(row.googleEventId);
    if (!prev && tombstones.has(googleEventKey(ctx.calendarId, row.googleEventId))) {
      summary.skippedDeleted += 1;
      continue;
    }
    const payload = {
      tenant_id: ctx.tenantId,
      google_calendar_id: ctx.calendarId,
      google_event_id: row.googleEventId,
      google_synced_at: ctx.syncedAt,
      title: row.title,
      memo: row.memo,
      start_date: row.startDate,
      end_date: row.endDate,
      start_time: row.startTime,
      end_time: row.endTime,
      tag_id: ctx.tagId,
    };
    if (!prev) {
      const { error } = await admin.from("calendar_events").insert(payload);
      if (error) note(error.message);
      else summary.inserted += 1;
      continue;
    }
    if (!canOverwrite({ updatedAt: prev.updated_at, googleSyncedAt: prev.google_synced_at })) {
      summary.skippedEdited += 1;
      continue;
    }
    if (unchanged(prev, row, ctx.tagId)) {
      summary.unchanged += 1;
      continue;
    }
    const { error } = await admin.from("calendar_events").update(payload).eq("id", prev.id).eq("tenant_id", ctx.tenantId);
    if (error) note(error.message);
    else summary.updated += 1;
  }
}

/** 구글에서 사라진 일정 지우기 — **이 캘린더에서 온 행만**. 청크로 **전부** 지운다(상한으로 자르지 않는다). */
export async function deleteByGoogleIds(
  admin: Admin,
  tenantId: string,
  calendarId: string,
  ids: readonly string[],
  summary: ImportSummary,
  note: (message: string) => void,
): Promise<void> {
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200);
    const { data, error } = await admin
      .from("calendar_events")
      .delete()
      .eq("tenant_id", tenantId)
      .eq("google_calendar_id", calendarId)
      .in("google_event_id", chunk)
      .select("id");
    if (error) note(error.message);
    else summary.deleted += data?.length ?? 0;
  }
}

/** 시스템 이벤트 감사로그(원장 규약: 기능 변동은 전부 감사로그). actor 없음. */
/** 🔴 두 액션 리터럴을 **이 파일에 적어 둔다** — 감사로그 레지스트리 가드가 직접 insert 파일의 `action: "…"`를 스캔한다. */
export async function logSyncAudit(admin: Admin, summary: ImportSummary, kind: "full" | "push", extra: Record<string, unknown> = {}) {
  const head =
    kind === "full"
      ? { action: "calendar_google_import", actor_name: "시스템(구글 캘린더 임포트)" }
      : { action: "calendar_google_push_sync", actor_name: "시스템(구글 캘린더 알림)" };
  await admin.from("audit_logs").insert({
    tenant_id: summary.tenantId,
    actor_id: null,
    ...head,
    target_type: "calendar",
    target_label: `캘린더 ${summary.calendars}개`,
    metadata: {
      inserted: summary.inserted,
      updated: summary.updated,
      skippedEdited: summary.skippedEdited,
      skippedDeleted: summary.skippedDeleted,
      unchanged: summary.unchanged,
      deleted: summary.deleted,
      failed: summary.failed,
      ...extra,
    },
  });
}
