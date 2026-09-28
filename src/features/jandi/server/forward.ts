import "server-only";
import { after } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchInChunks } from "@/lib/supabase/batch";
import { isFeatureOptedIn } from "@/lib/license/server";
import { reportError } from "@/lib/observability/report-error";
import {
  buildDigestPayload,
  buildSinglePayload,
  JANDI_MAX_MESSAGES_PER_BATCH,
  planJandiMessages,
  type ForwardRow,
} from "../format";
import { loadJandiRow, postToJandi } from "./store";

/**
 * aywa 알림 → 잔디 방 전달(1단계, 2026-09-28). `notifyUsers()`가 알림을 넣은 뒤 부른다.
 *
 * - **응답 뒤에** 돈다(`after`) — 잔디가 느리거나 죽어도 배정·결재 같은 본 작업의 응답을 늦추지 않는다(반응속도 1순위).
 * - 게이트 둘: 슈퍼관리자 스위치(`isFeatureOptedIn(…, "jandi")`, 기본 꺼짐) ∧ 원장이 등록한 웹훅 주소 + 고른 종류.
 * - best-effort — 실패는 로그만(알림 자체는 이미 aywa에 들어가 있다). 재시도 없음.
 */
export type NotificationInsertRow = {
  tenant_id: string;
  recipient_id: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
};

export function scheduleJandiForward(rows: readonly NotificationInsertRow[]): void {
  if (rows.length === 0) return;
  const run = () => forwardToJandi(rows).catch((e) => reportError(e, { scope: "jandi.forward" }));
  try {
    after(run);
  } catch {
    // 요청 밖(스크립트 등)에서 불린 경우 — after를 못 쓰니 기다리지 않고 흘려보낸다.
    void run();
  }
}

function appUrlOrNull(): string | null {
  const explicit = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, "");
  const vercel = process.env.VERCEL_URL?.trim();
  return vercel ? `https://${vercel}` : null;
}

async function forwardToJandi(rows: readonly NotificationInsertRow[]): Promise<void> {
  const byTenant = new Map<string, NotificationInsertRow[]>();
  for (const r of rows) {
    const list = byTenant.get(r.tenant_id) ?? [];
    list.push(r);
    byTenant.set(r.tenant_id, list);
  }
  for (const [tenantId, list] of byTenant) await forwardTenant(tenantId, list);
}

async function forwardTenant(tenantId: string, rows: NotificationInsertRow[]): Promise<void> {
  if (!(await isFeatureOptedIn(tenantId, "jandi"))) return;
  const loaded = await loadJandiRow(tenantId);
  if (loaded.status !== "ok" || !loaded.row?.webhookUrl) return;
  const { webhookUrl, eventTypes } = loaded.row;

  const forwardRows: ForwardRow[] = rows.map((r) => ({
    type: r.type,
    title: r.title,
    body: r.body,
    link: r.link,
    recipientId: r.recipient_id,
  }));
  const messages = planJandiMessages(forwardRows, new Set(eventTypes));
  if (messages.length === 0) return;

  if (messages.length > JANDI_MAX_MESSAGES_PER_BATCH) {
    await send(webhookUrl, buildDigestPayload(messages), tenantId);
    return;
  }

  const names = await recipientNames(tenantId, [...new Set(messages.flatMap((m) => m.recipientIds))]);
  const appUrl = appUrlOrNull();
  for (const m of messages) {
    const who = m.recipientIds.map((id) => names.get(id)).filter((n): n is string => !!n);
    await send(webhookUrl, buildSinglePayload(m, who, appUrl), tenantId);
  }
}

async function recipientNames(tenantId: string, ids: string[]): Promise<Map<string, string>> {
  try {
    const admin = createAdminClient();
    const data = await fetchInChunks<{ id: string; display_name: string }>(ids, (chunk) =>
      admin.from("users").select("id, display_name").eq("tenant_id", tenantId).in("id", chunk),
    );
    return new Map(data.map((u) => [u.id, u.display_name]));
  } catch (e) {
    // 이름을 못 읽어도 알림은 보낸다(받는 사람 줄만 빠진다).
    reportError(e, { scope: "jandi.recipient_names" });
    return new Map();
  }
}

async function send(url: string, payload: Parameters<typeof postToJandi>[1], tenantId: string): Promise<void> {
  const res = await postToJandi(url, payload);
  if (!res.ok) reportError(new Error(`jandi webhook failed: ${res.status ?? "network"}`), { scope: "jandi.send", tenantId });
}
