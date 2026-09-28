import "server-only";
import { getCurrentUser } from "@/lib/auth/current-user";
import { isFeatureOptedIn } from "@/lib/license/server";
import { maskSlackToken, type SlackRoute } from "../format";
import { slackGate } from "./gate";
import { loadSlackRow } from "./store";

/**
 * 학원 설정 '연동' 면의 슬랙 카드 상태. 🔴 토큰 원문은 절대 내려보내지 않는다(가린 값만).
 * - off = 슈퍼관리자 스위치가 꺼짐 → 카드를 세우지 않는다(이 지점엔 없는 기능)
 * - readonly = 스위치는 켜졌지만 원장·총괄이 아님 → 안내만
 */
export type SlackCardState =
  | { kind: "off" }
  | { kind: "readonly" }
  | { kind: "missing_table" }
  | { kind: "error" }
  | { kind: "ready"; connected: boolean; maskedToken: string; teamName: string; routes: SlackRoute[] };

export async function getSlackCardState(): Promise<SlackCardState> {
  const user = await getCurrentUser();
  if (!user || !(await isFeatureOptedIn(user.tenantId, "slack"))) return { kind: "off" };
  const g = await slackGate();
  if ("error" in g) return { kind: "readonly" };
  const loaded = await loadSlackRow(g.tenantId);
  if (loaded.status === "missing_table") return { kind: "missing_table" };
  if (loaded.status === "error") return { kind: "error" };
  const row = loaded.row;
  return {
    kind: "ready",
    connected: !!row?.botToken,
    maskedToken: row?.botToken ? maskSlackToken(row.botToken) : "",
    teamName: row?.teamName ?? "",
    routes: row?.routes ?? [],
  };
}
