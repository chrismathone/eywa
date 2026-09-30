import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { reportError } from "@/lib/observability/report-error";
import { parseCalendarSources } from "../google-import";
import { catchUpSince, isWeeklyFullDay, planCalendarCron, type CronPlanReason } from "../cron-plan";
import { ensureCalendarChannels, type ChannelSummary } from "./google-channels";
import { runGoogleCalendarImport } from "./google-import";
import { runGoogleCalendarIncremental } from "./google-incremental";
import type { ImportSummary } from "./google-sync-core";
import { listStates, type SyncStateRow } from "./sync-state";

/**
 * **새벽 크론 본체(가볍게)** — 원장 2026-09-30 *"하루 한번 새벽에 가볍게 돌려 필요하면."*
 *
 * 순서: ① 채널 열기·갱신(만료 전 갱신 · 없거나 실패한 채널 다시 열기) → ② 캘린더마다 [`planCalendarCron`](../cron-plan.ts)이
 * 증분/전체를 고른다 → ③ 증분은 **웹훅과 같은 함수·같은 잠금**으로 놓친 알림을 메운다 → ④ 전체가 필요한 캘린더(판정 +
 * 증분 실패)만 모아 **한 번** 전체 임포트(감사로그 `calendar_google_import` 한 줄).
 *
 * 🔴 `calendar_sync_state` 표가 없거나 읽지 못하면(#95) · 캘린더 목록이 비었으면 **종전과 똑같이** 전 캘린더 전체 임포트 +
 *    채널 열기(표가 없으면 채널은 조용히 꺼진다).
 * 🔴 채널을 **먼저** 연다 — 새로 연 채널은 이 순간부터 알림을 보내고, 그 앞 구간은 이번 증분·전체가 메운다.
 */

type Counts = Pick<ImportSummary, "inserted" | "updated" | "deleted" | "unchanged" | "skippedEdited" | "skippedDeleted" | "failed">;

export type CronCalendarResult = {
  calendarId: string;
  tag: string;
  mode: "full" | "incremental";
  reason: CronPlanReason | "incremental_failed";
  /** 증분 결과(돌았으면). 전체로 넘어간 캘린더도 실패한 증분 결과를 남긴다. */
  incremental?: Counts | "busy";
};

export type CronRunResult = {
  mode: "light" | "legacy_full";
  reason?: string;
  weekly: boolean;
  forced: boolean;
  calendars: CronCalendarResult[];
  full: ImportSummary | null;
  channels: ChannelSummary | { error: string };
};

function counts(s: ImportSummary): Counts {
  const { inserted, updated, deleted, unchanged, skippedEdited, skippedDeleted, failed } = s;
  return { inserted, updated, deleted, unchanged, skippedEdited, skippedDeleted, failed };
}

/** 채널 열기·갱신 — 실패해도 동기화는 계속한다(그 캘린더는 전체로 맞춘다). */
async function ensureChannelsSafe(tenantId: string): Promise<ChannelSummary | { error: string }> {
  try {
    const channels = await ensureCalendarChannels(tenantId);
    if (channels.failed.length > 0) {
      reportError(new Error(`구글 캘린더 알림 채널 ${channels.failed.length}개 열기 실패`), { where: "google-calendar-channels" });
    }
    return channels;
  } catch (e) {
    reportError(e, { where: "google-calendar-channels" });
    return { error: "알림 채널 갱신 실패" };
  }
}

export async function runCalendarCronLight(tenantId: string, opts: { forceFull: boolean; now?: number }): Promise<CronRunResult> {
  const now = opts.now ?? Date.now();
  const weekly = isWeeklyFullDay(now);
  const sources = parseCalendarSources(process.env.GOOGLE_CALENDAR_IDS);

  let states: SyncStateRow[] | null = null;
  let legacyReason: string | null = sources.length === 0 ? "no_calendar_ids" : null;
  if (!legacyReason) {
    try {
      states = await listStates(createAdminClient(), tenantId);
      if (states === null) legacyReason = "state_table_missing";
    } catch (e) {
      reportError(e, { where: "google-calendar-import:state" });
      legacyReason = "state_read_failed";
    }
  }
  if (legacyReason || !states) {
    // 종전 그대로 — 전 캘린더 전체 임포트 뒤 채널(표가 없으면 채널은 disabled로 돌아온다).
    const full = await runGoogleCalendarImport(tenantId);
    const channels = await ensureChannelsSafe(tenantId);
    return { mode: "legacy_full", reason: legacyReason ?? "state_table_missing", weekly, forced: opts.forceFull, calendars: [], full, channels };
  }

  const channels = await ensureChannelsSafe(tenantId);
  const channelsBroken = "error" in channels || !!channels.disabled;
  const failedChannel = new Set("failed" in channels ? channels.failed.map((f) => f.calendarId) : []);
  const byCal = new Map(states.map((s) => [s.calendar_id, s]));

  const calendars: CronCalendarResult[] = [];
  const fullIds = new Set<string>();
  for (const src of sources) {
    const state = byCal.get(src.calendarId) ?? null;
    const plan = planCalendarCron({
      state,
      channelFailed: channelsBroken || failedChannel.has(src.calendarId),
      forceFull: opts.forceFull,
      weekly,
      now,
    });
    const base = { calendarId: src.calendarId, tag: src.tagName };
    if (plan.mode === "full" || !state) {
      fullIds.add(src.calendarId);
      calendars.push({ ...base, mode: "full", reason: plan.reason });
      continue;
    }
    try {
      const catchUp = { ...state, last_synced_at: catchUpSince(state.last_synced_at, now) };
      let summary = await runGoogleCalendarIncremental(tenantId, catchUp, { advanceOnEmpty: true, trigger: "cron" });
      // 웹훅 증분이 돌고 있으면(잠금) 잠깐(최대 ~20초) 기다렸다 다시 — 안 그러면 그 캘린더는 오늘 25시간 따라잡기를
      // 통째로 건너뛴다(웹훅 재회차는 제 시작점만 본다). 전체 임포트의 잠금 대기와 같은 폭.
      for (let i = 0; !summary && i < 4; i += 1) {
        await new Promise((r) => setTimeout(r, 5000));
        summary = await runGoogleCalendarIncremental(tenantId, catchUp, { advanceOnEmpty: true, trigger: "cron" });
      }
      if (!summary) {
        // 그래도 웹훅 증분이 돌고 있다 — 그 회차가 `dirty`를 보고 한 번 더 돈다(못 한 따라잡기는 증분 실패가 아니라 남은 위험 — 주간 전체·48시간 판정이 맞춘다).
        calendars.push({ ...base, mode: "incremental", reason: "incremental", incremental: "busy" });
      } else if (summary.failed.length > 0) {
        fullIds.add(src.calendarId);
        calendars.push({ ...base, mode: "full", reason: "incremental_failed", incremental: counts(summary) });
      } else {
        calendars.push({ ...base, mode: "incremental", reason: "incremental", incremental: counts(summary) });
      }
    } catch (e) {
      reportError(e, { where: "google-calendar-import:incremental" });
      fullIds.add(src.calendarId);
      calendars.push({ ...base, mode: "full", reason: "incremental_failed" });
    }
  }

  const full =
    fullIds.size > 0
      ? await runGoogleCalendarImport(tenantId, {
          only: fullIds,
          auditExtra: {
            trigger: "cron",
            reasons: calendars.filter((c) => c.mode === "full").map((c) => ({ tag: c.tag, reason: c.reason })),
          },
        })
      : null;
  return { mode: "light", weekly, forced: opts.forceFull, calendars, full, channels };
}
