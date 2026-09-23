import "server-only";
import { google } from "googleapis";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllPaged } from "@/lib/supabase/batch";
import {
  canOverwrite,
  googleEventKey,
  planDeletions,
  LEGACY_SNAPSHOT_MEMO_PREFIX,
  parseCalendarSources,
  toImportedRow,
  type GoogleEventLike,
  type ImportedEventRow,
} from "../google-import";

/**
 * **구글 캘린더 → aywa 한 방향 임포트**(IO). 순수 변환·판정은 [`google-import.ts`](../google-import.ts).
 *
 * 원장 2026-09-10: *"동기화하지만 외부로 보여주지않고 내부 끌어오기 참고용으로만 할것"* + 하루 2회(06:00·18:00 KST).
 *
 * 🔴 **읽기만 한다** — 구글에 쓰지 않는다(서비스 계정 권한도 `일정 세부정보 보기`까지만 받았다).
 * 🔴 **손으로 만든 일정은 절대 안 건드린다** — 모든 쓰기·삭제가 `google_event_id is not null`로 좁혀진다.
 * 🔴 **조회 실패한 캘린더는 삭제 정리를 건너뛴다** — 빈 목록을 "구글에서 다 지워졌다"로 읽으면 그 캘린더가
 *    통째로 사라진다(조회 실패와 '일정 0건'은 다른 사실이다).
 * ⚠️ admin 클라이언트 = RLS 우회 → 모든 쿼리에 **tenant_id 명시 필터**.
 */

/** 과거·미래 창 — 지난 일정은 기록으로 조금만, 앞은 넉넉히(연간 행사가 1년 뒤에 잡힌다). */
const PAST_DAYS = 30;
const FUTURE_DAYS = 400;

/**
 * 서비스 계정 키 로드. 실패 사유를 **갈라서** 돌려준다.
 * 🔴 "키 없음"과 "형식 이상"을 한 문장으로 뭉치면 진단이 왕복한다 — 2026-09-10에 실제로
 *    "Vercel에 넣었는데?"와 "그건 로컬 파일입니다"를 두 번 주고받았다. 어느 이름이 있고 없는지를 적는다.
 */
function loadServiceAccount(): { ok: true; email: string; key: string } | { ok: false; reason: string } {
  // 🔴 있는 키를 순서대로 쓴다 — 환경마다 무엇이 들어 있는지가 다르다(프로덕션엔 캘린더 전용 키).
  //    ⚠️ 어느 키든 **그 키가 속한 GCP 프로젝트에서 Calendar API가 켜져 있어야** 한다. 안 켜져 있으면
  //       인증은 되고 조회에서 "has not been used in project …"로 막힌다(권한 문제로 오인하기 쉽다).
  //    옛 `FIREBASE_SERVICE_ACCOUNT_KEY` 후보는 걷어냈다(2026-09-15) — 그 GCP 프로젝트(ijw-calander)를 삭제해
  //    죽은 키였고, 환경변수 정리 때 로컬에서도 지웠다.
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

type ExistingRow = {
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

/**
 * 내용이 그대로면 UPDATE를 보내지 않는다.
 * 🔴 안 그러면 **12시간마다 1,077행을 전부 다시 쓴다** — 바뀐 게 없어도 `updated_at`이 올라가
 *    "사람이 고쳤나" 판정(`canOverwrite`)의 근거까지 흐려진다.
 * ⚠️ `start_time`은 DB가 `16:00:00`으로 돌려주고 우리는 `16:00`을 만든다 — 앞 5글자로 비교한다.
 */
function unchanged(prev: ExistingRow, next: { title: string; memo: string | null; startDate: string; endDate: string; startTime: string | null; endTime: string | null }, tagId: string | null): boolean {
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
async function resolveTagId(
  admin: ReturnType<typeof createAdminClient>,
  tenantId: string,
  name: string,
): Promise<string | null> {
  const { data } = await admin
    .from("calendar_tags")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("name", name)
    .maybeSingle();
  if (data?.id) return String(data.id);
  const { data: made } = await admin
    .from("calendar_tags")
    .insert({ tenant_id: tenantId, name })
    .select("id")
    .maybeSingle();
  return made?.id ? String(made.id) : null;
}

export async function runGoogleCalendarImport(tenantId: string): Promise<ImportSummary> {
  const sources = parseCalendarSources(process.env.GOOGLE_CALENDAR_IDS);
  const sa = loadServiceAccount();
  const summary: ImportSummary = {
    tenantId,
    calendars: sources.length,
    inserted: 0,
    updated: 0,
    skippedEdited: 0,
    skippedDeleted: 0,
    unchanged: 0,
    deleted: 0,
    failed: [],
  };
  if (sources.length === 0 || !sa.ok) {
    summary.failed.push({
      calendarId: "-",
      reason:
        sources.length === 0
          ? "GOOGLE_CALENDAR_IDS 미설정 — `태그이름|캘린더ID` 줄바꿈 구분으로 넣으세요."
          : sa.ok
            ? "알 수 없음"
            : sa.reason,
    });
    return summary;
  }

  const auth = new google.auth.JWT({
    email: sa.email,
    key: sa.key,
    scopes: ["https://www.googleapis.com/auth/calendar.readonly"],
  });
  const cal = google.calendar({ version: "v3", auth });
  const admin = createAdminClient();

  const now = Date.now();
  const windowStart = new Date(now - PAST_DAYS * 86_400_000);
  const windowEnd = new Date(now + FUTURE_DAYS * 86_400_000);
  const startYmd = new Date(windowStart.getTime() + 9 * 3600_000).toISOString().slice(0, 10);
  const endYmd = new Date(windowEnd.getTime() + 9 * 3600_000).toISOString().slice(0, 10);

  // 🔴 사람이 aywa에서 지운 구글 일정(2026-09-23 전수 점검 F15) — 지워도 다음 회차가 "새 일정"으로 다시
  //    넣어서, 취소된 레벨테스트가 12시간 뒤 '금일입테'에 또 떴다. 표에 숨김 컬럼이 없어(마이그레이션 없이)
  //    **삭제 감사로그(append-only)**가 묘비가 된다: deleteCalendarEvent가 지운 행의 구글 키를 metadata에
  //    남기고, 여기선 그 키를 건너뛴다. 창(과거 30일 + 미래 400일)보다 오래된 삭제는 볼 필요가 없다.
  //    ⚠️ 조회가 실패하면 임포트를 멈추지 않는다 — 대신 실패로 적는다(묘비를 못 읽었다고 전 캘린더를 버리면
  //       더 큰 손실이다. 이 회차에 되살아난 행은 사람이 다시 지우면 된다).
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

  for (const src of sources) {
    let events: GoogleEventLike[];
    try {
      const collected: GoogleEventLike[] = [];
      let pageToken: string | undefined;
      do {
        const res = await cal.events.list({
          calendarId: src.calendarId,
          timeMin: windowStart.toISOString(),
          timeMax: windowEnd.toISOString(),
          // 반복 일정을 **회차별로 펼친다** — 그래야 각 회차가 제 날짜에 서고 id도 회차마다 다르다.
          singleEvents: true,
          orderBy: "startTime",
          maxResults: 2500,
          pageToken,
        });
        collected.push(...((res.data.items ?? []) as GoogleEventLike[]));
        pageToken = res.data.nextPageToken ?? undefined;
      } while (pageToken);
      events = collected;
    } catch (e) {
      // 🔴 이 캘린더는 **손도 대지 않고** 넘어간다(삭제 정리 포함).
      summary.failed.push({
        calendarId: src.calendarId,
        reason: e instanceof Error ? e.message.slice(0, 200) : "조회 실패",
      });
      continue;
    }

    const tagId = await resolveTagId(admin, tenantId, src.tagName);
    const rows = events
      .map((ev) => toImportedRow(ev, src.tagName))
      .filter((r): r is ImportedEventRow => r !== null);
    const seen = new Set(rows.map((r) => r.googleEventId));

    // 🔴 페이징(2026-09-23 전수 점검 T2) — 창 안 행이 1,000을 넘으면(실측 1,077) 잘린 꼬리가 "없는 행"으로
    //    읽혀 새 일정으로 **중복 삽입**됐다(B2). 못 읽으면 이 캘린더는 손대지 않는다(삽입·삭제 둘 다).
    let existing: ExistingRow[];
    try {
      existing = await fetchAllPaged<ExistingRow>((from, to) =>
        admin
          .from("calendar_events")
          .select("id, google_event_id, updated_at, google_synced_at, title, memo, start_date, end_date, start_time, end_time, tag_id")
          .eq("tenant_id", tenantId)
          .eq("google_calendar_id", src.calendarId)
          .gte("start_date", startYmd)
          .lte("start_date", endYmd)
          .order("id", { ascending: true })
          .range(from, to),
      );
    } catch (e) {
      summary.failed.push({
        calendarId: src.calendarId,
        reason: `기존 일정 조회 실패 — ${e instanceof Error ? e.message.slice(0, 160) : "조회 실패"}`,
      });
      continue;
    }
    const byGoogleId = new Map(
      existing.filter((r) => r.google_event_id).map((r) => [r.google_event_id as string, r]),
    );

    // 🔴 첫 회차 정리 — 9/3 스냅샷이 남긴 **구글 id 없는** 같은 태그·같은 기간 행을 치운다.
    //    안 치우면 겹치는 기간이 두 벌이 된다(실측 창 안 160행). 창 밖 과거 6,108행은 2016년까지
    //    거슬러 가는 유일한 기록이라 손대지 않는다(쿼리가 창으로 좁혀져 있다).
    //    새 임포트 메모 접두는 글자가 달라 이번에 넣은 행이 걸릴 일은 없다. 2회차부터는 대상 0건.
    if (tagId) {
      await admin
        .from("calendar_events")
        .delete()
        .eq("tenant_id", tenantId)
        .eq("tag_id", tagId)
        .is("google_event_id", null)
        .like("memo", `${LEGACY_SNAPSHOT_MEMO_PREFIX}%`)
        .gte("start_date", startYmd)
        .lte("start_date", endYmd);
    }

    const syncedAt = new Date().toISOString();
    // 쓰기 실패는 행마다가 아니라 캘린더마다 한 줄로 모은다(감사로그 metadata가 수천 줄이 되지 않게).
    let writeFailures = 0;
    let firstWriteError: string | null = null;
    const noteWriteError = (message: string) => {
      writeFailures += 1;
      firstWriteError ??= message.slice(0, 160);
    };
    for (const row of rows) {
      const prev = byGoogleId.get(row.googleEventId);
      if (!prev && tombstones.has(googleEventKey(src.calendarId, row.googleEventId))) {
        summary.skippedDeleted += 1;
        continue;
      }
      const payload = {
        tenant_id: tenantId,
        google_calendar_id: src.calendarId,
        google_event_id: row.googleEventId,
        google_synced_at: syncedAt,
        title: row.title,
        memo: row.memo,
        start_date: row.startDate,
        end_date: row.endDate,
        start_time: row.startTime,
        end_time: row.endTime,
        tag_id: tagId,
      };
      if (!prev) {
        const { error } = await admin.from("calendar_events").insert(payload);
        if (error) noteWriteError(error.message);
        else summary.inserted += 1;
        continue;
      }
      if (!canOverwrite({ updatedAt: prev.updated_at, googleSyncedAt: prev.google_synced_at })) {
        summary.skippedEdited += 1;
        continue;
      }
      // 바뀐 게 없으면 쓰지 않는다(회차마다 전건 UPDATE 방지).
      if (unchanged(prev, row, tagId)) {
        summary.unchanged += 1;
        continue;
      }
      const { error } = await admin
        .from("calendar_events")
        .update(payload)
        .eq("id", prev.id)
        .eq("tenant_id", tenantId);
      if (error) noteWriteError(error.message);
      else summary.updated += 1;
    }

    // 구글에서 사라진 회차 정리 — **이 캘린더에서 온 행만**, 창 안에서만.
    const gone = planDeletions([...byGoogleId.keys()], seen);
    // 🔴 청크로 **전부** 지운다 — 상한으로 자르고 전체 수를 세면 화면이 안 지운 것까지 지웠다고 말한다.
    for (let i = 0; i < gone.length; i += 200) {
      const chunk = gone.slice(i, i + 200);
      const { error } = await admin
        .from("calendar_events")
        .delete()
        .eq("tenant_id", tenantId)
        .eq("google_calendar_id", src.calendarId)
        .in("google_event_id", chunk);
      if (error) noteWriteError(error.message);
      else summary.deleted += chunk.length;
    }
    if (writeFailures > 0) {
      summary.failed.push({
        calendarId: src.calendarId,
        reason: `일정 ${writeFailures}건 쓰기 실패 — ${firstWriteError ?? "알 수 없음"}`,
      });
    }
  }

  // 감사로그 — 시스템 이벤트라 actor는 없다(원장 규약: 기능 변동은 전부 감사로그).
  await admin.from("audit_logs").insert({
    tenant_id: tenantId,
    actor_id: null,
    actor_name: "시스템(구글 캘린더 임포트)",
    action: "calendar_google_import",
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
    },
  });

  return summary;
}
