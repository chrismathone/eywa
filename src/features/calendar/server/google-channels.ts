import "server-only";
import { randomBytes, randomUUID } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { parseCalendarSources } from "../google-import";
import { needsChannelRenewal } from "../google-push";
import { calendarApi } from "./google-sync-core";
import { listStates, upsertState } from "./sync-state";

/**
 * 구글 **푸시 채널** 열기·갱신 — 캘린더마다 "바뀌면 우리 웹훅을 불러 달라"는 구독(`events.watch`).
 * 채널은 만료가 있어(구글이 정하는 최대치) 하루 2회 임포트 크론이 이 함수를 불러 **만료 36시간 전에 새로 열고
 * 옛 채널을 닫는다**. 비용 0 — 구글 푸시·조회는 무료 할당 안이고, 알림이 올 때만 함수가 돈다.
 *
 * 🔴 주소가 없거나(`NEXT_PUBLIC_APP_URL`) https가 아니면 열지 않는다 — 구글은 유효한 HTTPS 주소만 받는다.
 * 🔴 `calendar_sync_state` 표가 없으면(SQL 미적용) 아무것도 안 한다 — 채널을 열어도 토큰을 저장할 곳이 없어
 *    웹훅이 전부 거절하게 된다.
 */
export const PUSH_PATH = "/api/calendar/google-push";

export type ChannelSummary = { opened: number; kept: number; stopped: number; failed: { calendarId: string; reason: string }[]; disabled?: string };

export function pushAddress(): string | null {
  const base = process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/+$/, "");
  if (!base || !base.startsWith("https://")) return null;
  return `${base}${PUSH_PATH}`;
}

export async function ensureCalendarChannels(tenantId: string): Promise<ChannelSummary> {
  const out: ChannelSummary = { opened: 0, kept: 0, stopped: 0, failed: [] };
  const address = pushAddress();
  if (!address) return { ...out, disabled: "NEXT_PUBLIC_APP_URL(https)가 없어 알림을 받을 주소가 없습니다" };
  const api = calendarApi();
  if (!api.ok) return { ...out, disabled: api.reason };
  const admin = createAdminClient();
  const states = await listStates(admin, tenantId);
  if (states === null) return { ...out, disabled: "calendar_sync_state 표 없음(SQL 미적용)" };

  const sources = parseCalendarSources(process.env.GOOGLE_CALENDAR_IDS);
  const byCal = new Map(states.map((s) => [s.calendar_id, s]));
  const now = Date.now();

  for (const src of sources) {
    const prev = byCal.get(src.calendarId);
    if (prev?.channel_id && !needsChannelRenewal(prev.channel_expires_at, now)) {
      out.kept += 1;
      continue;
    }
    const channelId = randomUUID();
    const token = randomBytes(24).toString("base64url");
    try {
      const res = await api.cal.events.watch({
        calendarId: src.calendarId,
        requestBody: { id: channelId, type: "web_hook", address, token },
      });
      const expMs = Number(res.data.expiration);
      // 🔴 새 채널을 **먼저 저장**하고 옛 채널을 닫는다 — 순서를 바꾸면 그 사이 알림이 전부 거절된다.
      await upsertState(admin, tenantId, src.calendarId, {
        channel_id: channelId,
        channel_token: token,
        resource_id: res.data.resourceId ?? null,
        channel_expires_at: Number.isFinite(expMs) ? new Date(expMs).toISOString() : null,
      });
      out.opened += 1;
      if (prev?.channel_id && prev.resource_id) {
        await api.cal.channels
          .stop({ requestBody: { id: prev.channel_id, resourceId: prev.resource_id } })
          .then(() => (out.stopped += 1))
          .catch(() => undefined); // 이미 만료된 채널이면 실패해도 무해하다.
      }
    } catch (e) {
      out.failed.push({ calendarId: src.calendarId, reason: e instanceof Error ? e.message.slice(0, 200) : "채널 열기 실패" });
    }
  }
  // env에서 빠진 캘린더의 채널은 닫고 지운다 — 남겨 두면 그 캘린더 알림이 계속 와서(증분은 무시) 헛돈다.
  const wanted = new Set(sources.map((s) => s.calendarId));
  for (const st of states) {
    if (wanted.has(st.calendar_id) || !st.channel_id) continue;
    if (st.resource_id) {
      await api.cal.channels
        .stop({ requestBody: { id: st.channel_id, resourceId: st.resource_id } })
        .then(() => (out.stopped += 1))
        .catch(() => undefined);
    }
    await upsertState(admin, tenantId, st.calendar_id, {
      channel_id: null,
      channel_token: null,
      resource_id: null,
      channel_expires_at: null,
    }).catch(() => undefined);
  }
  return out;
}
