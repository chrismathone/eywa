"use server";

import { getCurrentUser } from "@/lib/auth/current-user";
import { isCurrentUserSuperAdmin } from "@/lib/auth/super-admin";
import { canWriteTenant } from "@/lib/auth/perm-matrix";
import { isFeatureOptedIn } from "@/lib/license/server";
import { tenantViewOutboundError } from "@/lib/auth/tenant-view-outbound";
import { viewAsTeacher } from "@/lib/auth/view-as";
import { logAction } from "@/features/audit/server/log";
import { sourceBindingForTenant, targetRequest } from "../sync-server";
import { menuDiff, todaysMathMenusSchema, todaysMathMenusWriteReplySchema, type TodaysMathMenus } from "../branch-menus";

/**
 * 학원 설정 → 연동 → 오늘 수학 '오늘 수학 사용 메뉴'(원장 2026-10-19 *"원장만"* · *"연동되게"* · *"감사로그 서로 배선"*).
 * 원장 역할(master)만 · 지점 라이선스 todays_math · 연결(binding)이 있을 때. 읽을 때마다 오늘 수학에서 지금 값을 받는다(사본 없음).
 * 저장 = 오늘 수학이 판 번호를 대조해 저장하고 제 감사 기록에 «에이와 · 이름»으로 남긴다 → 성공하면 여기 감사 기록에도 남긴다.
 */
export type MenusLoad = { ok: true; data: TodaysMathMenus } | { ok: false; message: string };
export type MenusSave =
  | { ok: true; data: TodaysMathMenus; changed: boolean }
  | { ok: false; message: string; conflict?: boolean };

const UNAVAILABLE = "오늘 수학에 연결하지 못했습니다. 잠시 뒤 다시 시도해 주세요.";

async function gate() {
  const user = await getCurrentUser();
  if (!user) return { error: "원장만 바꿀 수 있습니다." } as const;
  // 학원 설정 화면 것이라 강사뷰에는 입구가 없다 — 강사뷰 중 직접 부르면 실제 계정(원장)으로 바깥 앱에 저장됐다(2026-11-05 강사뷰 적대 리뷰).
  if (await viewAsTeacher()) return { error: "강사뷰에서는 바꿀 수 없습니다. 강사뷰를 끝내고 다시 시도해 주세요." } as const;
  // 원장 역할 + 총괄(새 제한 게이트 자동 통과 — 결정 로그 2026-08-13).
  if (user.systemRole !== "master" && !(await isCurrentUserSuperAdmin())) return { error: "원장만 바꿀 수 있습니다." } as const;
  if (!(await isFeatureOptedIn(user.tenantId, "todays_math"))) return { error: "오늘 수학 연결이 꺼져 있습니다." } as const;
  const config = sourceBindingForTenant(user.tenantId);
  if (!config) return { error: "오늘 수학 연결 설정이 없습니다." } as const;
  return { user, config } as const;
}

export async function loadTodaysMathMenus(): Promise<MenusLoad> {
  const g = await gate();
  if ("error" in g) return { ok: false, message: g.error ?? UNAVAILABLE };
  try {
    const raw = await targetRequest(g.config, `/api/integrations/eywa/v2/branch-menus?bindingId=${g.config.bindingId}`, "GET");
    return { ok: true, data: todaysMathMenusSchema.parse(raw) };
  } catch (e) {
    console.error("[todays-math-menus] 읽기 실패", g.user.tenantId, e instanceof Error ? e.message : "unknown");
    return { ok: false, message: UNAVAILABLE };
  }
}

export async function saveTodaysMathMenus(input: { menus: string[]; expectedRevision: number; before: TodaysMathMenus }): Promise<MenusSave> {
  const g = await gate();
  if ("error" in g) return { ok: false, message: g.error ?? UNAVAILABLE };
  // 🔴 저장은 원장 역할에 더해 **연동 설정 쓰기**까지 — 원장이 자기 연동 설정 칸을 '읽기'로 둔 경우에도 역할만으로 통과했다
  //    (2026-11-05 권한 감사). 화면도 같은 판정으로 저장 단추를 감춘다(integrations-face.tsx). 읽기(load)는 종전대로 역할만 본다.
  if (!(await canWriteTenant(g.user.systemRole, "integration_settings"))) return { ok: false, message: "연동 설정 작성 권한이 필요합니다." };
  const blocked = await tenantViewOutboundError();
  if (blocked) return { ok: false, message: blocked };
  const before = todaysMathMenusSchema.safeParse(input.before);
  if (!before.success || !Array.isArray(input.menus) || input.menus.length > 60 || !input.menus.every((m) => typeof m === "string") || !Number.isInteger(input.expectedRevision))
    return { ok: false, message: "사용 메뉴를 확인해 주세요." };
  let reply;
  try {
    reply = todaysMathMenusWriteReplySchema.parse(await targetRequest(g.config, "/api/integrations/eywa/v2/branch-menus", "POST", {
      bindingId: g.config.bindingId,
      actor: { eywaUserId: g.user.id, name: (g.user.displayName || "원장").slice(0, 50) },
      update: { menus: input.menus, expectedMenuRevision: input.expectedRevision },
    }));
  } catch (e) {
    console.error("[todays-math-menus] 저장 실패", g.user.tenantId, e instanceof Error ? e.message : "unknown");
    return { ok: false, message: UNAVAILABLE };
  }
  if (!reply.ok) {
    if (reply.code === "CONFLICT")
      return { ok: false, conflict: true, message: "오늘 수학에서 먼저 바뀌었습니다. 최신 설정을 불러와 다시 확인해 주세요." };
    if (reply.code === "MENU_NOT_OPEN") return { ok: false, message: "오늘 수학에서 열리지 않은 메뉴는 켤 수 없습니다." };
    return { ok: false, message: UNAVAILABLE };
  }
  const data: TodaysMathMenus = { revision: reply.revision, items: reply.items };
  if (reply.changed) {
    const { turnedOn, turnedOff } = menuDiff(before.data.items, data.items);
    await logAction({
      action: "todays_math_menus_update",
      targetType: "todays_math",
      targetLabel: "오늘 수학 사용 메뉴",
      metadata: { source: "eywa", turnedOn, turnedOff, menus: data.items.filter((i) => i.on).map((i) => i.label), menuRevision: data.revision },
    });
  }
  return { ok: true, data, changed: reply.changed };
}
