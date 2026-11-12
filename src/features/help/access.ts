import { canAccessTenant } from "@/lib/auth/perm-matrix";
import type { SystemRole, MenuKey } from "@/lib/permissions";
import type { ShellView } from "@/lib/auth/view-mode";
import { getCurrentUser } from "@/lib/auth/current-user";
import { isFeatureLicensed } from "@/lib/license/server";
import { getTenantSettings } from "@/features/owner/server/queries";
import { isModuleEnabled } from "@/lib/modules";
import { isFeatureOptedIn } from "@/lib/license/server";
import type { HelpManual } from "./types";

/**
 * 이 사람이 이 링크로 **실제로 그 화면을 열 수 있나** — 도움말은 열 수 없는 화면을 링크하지 않는다.
 * 페이지 게이트와 같은 답(원스크린=뷰, 강사뷰=강사 행으로 한 번 더).
 */
export async function helpLinkOpens(
  menu: MenuKey | null,
  role: SystemRole,
  view: ShellView,
): Promise<boolean> {
  if (!menu) return true;
  if (menu === "teacher_onescreen") return view === "teacher";
  if (!(await canAccessTenant(role, menu))) return false;
  return view !== "teacher" || (await canAccessTenant("teacher", menu));
}

/**
 * 설명서 한 권을 이 사람에게 보여 주나 — 메뉴 게이트(`helpLinkOpens`, 꺼진 모듈은 캡으로 막힘) + **메뉴가 없는 스위치**.
 * '창 사용법'은 창 모드 라이선스가 꺼진 지점엔 없다(원장 2026-09-30 "꺼지면 있었는지조차 모르게").
 */
export async function helpManualOpens(
  manual: { slug: string; menuKey: MenuKey | null },
  role: SystemRole,
  view: ShellView,
): Promise<boolean> {
  if (!(await helpLinkOpens(manual.menuKey, role, view))) return false;
  if (manual.slug === "workspace") {
    const user = await getCurrentUser();
    return user ? isFeatureLicensed(user.tenantId, "window_mode") : true;
  }
  if (manual.slug === "lesson-reports") {
    const settings = await getTenantSettings();
    return isModuleEnabled(settings.modules.disabled, "classnote");
  }
  return true;
}

/** 켜진 기능의 설명만 남긴 화면용 사본. 원본 상수는 건드리지 않아 전부 켜진 지점의 문구가 그대로다. */
export async function helpManualForTenant(manual: HelpManual, tenantId: string): Promise<HelpManual> {
  const [consultRatingOn, slackOn, classnoteOn] = await Promise.all([
    manual.slug === "consultations" ? isFeatureOptedIn(tenantId, "consult_rating") : true,
    manual.slug === "owner" ? isFeatureOptedIn(tenantId, "slack") : true,
    manual.slug === "onescreen" ? getTenantSettings().then((settings) => isModuleEnabled(settings.modules.disabled, "classnote")) : true,
  ]);
  if (consultRatingOn && slackOn && classnoteOn) return manual;
  return {
    ...manual,
    callouts: manual.callouts.map((callout) => {
      let body = callout.body;
      if (!consultRatingOn && manual.slug === "consultations" && callout.n === 6) {
        body = body.replace(" | 상담 평점.", ".");
        const detail = body.indexOf(" '상담 평점'은");
        if (detail >= 0) body = body.slice(0, detail);
      }
      if (!slackOn && manual.slug === "owner" && callout.n === 5) body = body.replace("슬랙·", "");
      if (!classnoteOn && manual.slug === "onescreen" && callout.n === 7) {
        body = body.replace("학부모 발송은 ClassNote이고, 사무실 총괄은 [[lesson-reports|수업보고서]]입니다.", "저장한 보고서는 이 화면에서 확인합니다.");
      }
      return body === callout.body ? callout : { ...callout, body };
    }),
  };
}
