"use server";

import { revalidatePath } from "next/cache";
import { logAction } from "@/features/audit/server/log";
import { getTenantSettings } from "@/features/owner/server/queries";
import { getCurrentUser } from "@/lib/auth/current-user";
import { isCurrentUserSuperAdmin } from "@/lib/auth/super-admin";
import { isFeatureOptedIn } from "@/lib/license/server";
import { sanitizeJandiEventTypes } from "../events";
import { checkJandiWebhookUrl, describeJandiFailure } from "../format";
import { loadJandiRow, postToJandi, saveJandiRow } from "./store";

/**
 * 잔디 연결 설정(학원 설정 '연동' 면) — 원장·총괄만, 슈퍼관리자가 '잔디 알림 연결'을 켠 지점만.
 * 🔴 웹훅 주소는 비밀번호와 같다 → 화면엔 가린 값만 내려가고, 바꿀 때만 새 주소를 받는다(빈 칸 = 그대로 둔다).
 */
export type JandiActionResult = { error?: string; ok?: boolean; message?: string };

async function gate(): Promise<{ tenantId: string; userId: string } | { error: string }> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };
  if (user.systemRole !== "master" && !(await isCurrentUserSuperAdmin())) {
    return { error: "잔디 연결은 원장만 설정할 수 있습니다" };
  }
  if (!(await isFeatureOptedIn(user.tenantId, "jandi"))) {
    return { error: "이 지점은 잔디 알림 연결이 꺼져 있습니다 — 사용하려면 운영사에 문의하세요" };
  }
  return { tenantId: user.tenantId, userId: user.id };
}

export async function saveJandiSettings(input: { webhookUrl: string; eventTypes: string[] }): Promise<JandiActionResult> {
  const g = await gate();
  if ("error" in g) return g;

  const rawUrl = (input.webhookUrl ?? "").trim();
  let webhookUrl: string | undefined;
  if (rawUrl) {
    const checked = checkJandiWebhookUrl(rawUrl);
    if (!checked.ok) return { error: checked.error };
    webhookUrl = checked.url;
  } else {
    const current = await loadJandiRow(g.tenantId);
    if (current.status === "missing_table") return { error: "잔디 연결 표가 아직 DB에 없습니다(0294a 적용 필요)" };
    if (current.status !== "ok" || !current.row?.webhookUrl) return { error: "잔디 웹훅 주소를 붙여 넣어 주세요" };
  }
  const eventTypes = sanitizeJandiEventTypes(Array.isArray(input.eventTypes) ? input.eventTypes : []);

  const saved = await saveJandiRow(g.tenantId, g.userId, { webhookUrl, eventTypes });
  if (saved.error) return { error: saved.error };

  await logAction({
    action: "jandi_webhook_update",
    targetType: "integration",
    targetLabel: "잔디 알림 연결",
    // 주소(비밀)는 감사로그에도 남기지 않는다 — 바뀌었는지와 고른 종류만.
    metadata: { urlChanged: webhookUrl !== undefined, eventTypes },
  });
  revalidatePath("/owner");
  return { ok: true, message: "저장했습니다" };
}

export async function disconnectJandi(): Promise<JandiActionResult> {
  const g = await gate();
  if ("error" in g) return g;
  const saved = await saveJandiRow(g.tenantId, g.userId, { webhookUrl: "" });
  if (saved.error) return { error: saved.error };
  await logAction({ action: "jandi_webhook_disconnect", targetType: "integration", targetLabel: "잔디 알림 연결" });
  revalidatePath("/owner");
  return { ok: true, message: "연결을 해제했습니다" };
}

export async function sendJandiTest(): Promise<JandiActionResult> {
  const g = await gate();
  if ("error" in g) return g;
  const loaded = await loadJandiRow(g.tenantId);
  if (loaded.status === "missing_table") return { error: "잔디 연결 표가 아직 DB에 없습니다(0294a 적용 필요)" };
  if (loaded.status !== "ok" || !loaded.row?.webhookUrl) return { error: "먼저 웹훅 주소를 저장해 주세요" };

  const academy = (await getTenantSettings()).profile.name || "학원";
  const res = await postToJandi(loaded.row.webhookUrl, {
    body: `[aywa] 잔디 연결 확인 — ${academy}`,
    connectColor: "#1F3A68",
    connectInfo: [{ title: "연결됨", description: "학원 설정에서 고른 aywa 알림이 이 방으로 옵니다." }],
  });
  await logAction({
    action: "jandi_webhook_test",
    targetType: "integration",
    targetLabel: "잔디 알림 연결",
    metadata: { ok: res.ok, status: res.status },
  });
  return res.ok ? { ok: true, message: "잔디 방에 확인 메시지를 보냈습니다" } : { error: describeJandiFailure(res.status) };
}
