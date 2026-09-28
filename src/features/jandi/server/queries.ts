import "server-only";
import { getCurrentUser } from "@/lib/auth/current-user";
import { isCurrentUserSuperAdmin } from "@/lib/auth/super-admin";
import { isFeatureOptedIn } from "@/lib/license/server";
import { maskJandiWebhookUrl } from "../format";
import { loadJandiRow } from "./store";

/**
 * 학원 설정 '연동' 면의 잔디 카드 상태. 🔴 원문 주소는 절대 내려보내지 않는다(가린 값만).
 * - off = 슈퍼관리자 스위치가 꺼짐 → 카드를 세우지 않는다(이 지점엔 없는 기능)
 * - readonly = 스위치는 켜졌지만 원장·총괄이 아님 → 안내만
 */
export type JandiCardState =
  | { kind: "off" }
  | { kind: "readonly" }
  | { kind: "missing_table" }
  | { kind: "error" }
  | { kind: "ready"; connected: boolean; maskedUrl: string; eventTypes: string[]; updatedAt: string | null };

export async function getJandiCardState(): Promise<JandiCardState> {
  const user = await getCurrentUser();
  if (!user || !(await isFeatureOptedIn(user.tenantId, "jandi"))) return { kind: "off" };
  if (user.systemRole !== "master" && !(await isCurrentUserSuperAdmin())) return { kind: "readonly" };
  const loaded = await loadJandiRow(user.tenantId);
  if (loaded.status === "missing_table") return { kind: "missing_table" };
  if (loaded.status === "error") return { kind: "error" };
  const row = loaded.row;
  return {
    kind: "ready",
    connected: !!row?.webhookUrl,
    maskedUrl: row?.webhookUrl ? maskJandiWebhookUrl(row.webhookUrl) : "",
    eventTypes: row?.eventTypes ?? [],
    updatedAt: row?.updatedAt ?? null,
  };
}
