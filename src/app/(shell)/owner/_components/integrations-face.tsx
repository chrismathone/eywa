import { FaceTabs, type Face } from "@/components/face-tabs";
import { slackGate } from "@/features/slack/server/gate";
import { classnoteModuleOn } from "@/features/owner/classnote-gate";
import type { TenantSettings } from "@/features/owner/settings-types";
import { SheetsFace } from "./sheets-face";
import { SlackCard } from "./slack-card";
import { VideoDriveCard } from "./video-drive-card";
import { AgentCard } from "./agent-card";
import { agentTabAvailable } from "@/features/sync-agent/server/availability";
import { getMakeeduSyncWorkers } from "@/features/integrations/server/makeedu-sync";
import { MakeeduWorkerStatus } from "./makeedu-worker-status";
import { TodaysMathCard } from "./todays-math-card";
import { TodaysMathMenusCard } from "./todays-math-menus-card";
import { getCurrentUser } from "@/lib/auth/current-user";
import { isCurrentUserSuperAdmin } from "@/lib/auth/super-admin";
import { canWriteTenant } from "@/lib/auth/perm-matrix";
import { isFeatureOptedIn } from "@/lib/license/server";

/**
 * 학원 설정 '연동' 면 = **켜진 연동만 내부 탭으로**(원장 2026-09-28 *"연동 탭이 좀 깔끔해지도록 (현재 너무 세로스크롤이
 * 길어짐) admin이 on/off 한 항목에 따라 적절한 내부탭 디자인화"*). 예전엔 슬랙·makeedu·구글 시트가 한 면에 세로로 쌓였다.
 * 탭 = 슬랙 설정 게이트(`slackGate` — 지점 스위치 ∧ 원장·총괄) · 학원 기능(makeedu·sheet_sync 모듈) · 숙제영상 드라이브(ClassNote 모듈,
 * 2026-10-04 — 숙제 영상을 받는 기능이 그 모듈에 있다). 꺼진 연동은 탭도 조회도 없다.
 * 오늘 수학(지점 라이선스 todays_math — 개발 중 기능 스위치, 2026-10-17).
 * 주소 `?tab=sheets&sub=slack|makeedu|sheets|video|agent|todaysMath` — 고른 탭만 서버에서 읽는다(무거운 면 지연, FaceTabs 규약).
 */
export type IntegrationSub = "slack" | "makeedu" | "sheets" | "video" | "agent" | "todaysMath";

const LABEL: Record<IntegrationSub, string> = { slack: "슬랙", makeedu: "makeedu 동기화", sheets: "구글 시트", video: "숙제영상 드라이브", agent: "연동 PC", todaysMath: "오늘 수학" };

export async function IntegrationsFace({
  sub,
  settings,
  modulesOn,
  page,
  isEmbed,
  canEdit,
}: {
  sub: string | undefined;
  settings: TenantSettings;
  modulesOn: { makeedu: boolean; sheets: boolean };
  page: number;
  isEmbed: boolean;
  /**
   * 연동 설정 쓰기(`canWriteTenant(integration_settings)` — page.tsx의 fieldset 잠금과 같은 값). 없으면 이 면 전체가 잠기므로
   * 하위 카드는 쓰기 단추를 **그리지 않는다**(원장 2026-11-05 — 비활성 단추를 남기지 않는다).
   */
  canEdit: boolean;
}) {
  // 슬랙 탭 = 설정 게이트와 같은 판정(지점 스위치 ∧ 원장·총괄) — 위임 관리자에게 빈 슬랙 탭이 첫 탭으로 뜨지 않게.
  // 오늘 수학 탭 = 지점 라이선스(todays_math)가 켜진 학원만(2026-10-17 — 개발 중 기능의 켜기 스위치가 여기 산다).
  const me = getCurrentUser();
  const todaysMathOn = me.then((u) => (u ? isFeatureOptedIn(u.tenantId, "todays_math") : false));
  const [gate,agentOn,mathOn,user] = await Promise.all([slackGate(false),agentTabAvailable(modulesOn.makeedu||classnoteModuleOn(settings)),todaysMathOn,me]);
  // 오늘 수학 사용 메뉴 = 원장 역할만(원장 2026-10-19 "원장만" · 총괄은 새 게이트를 통과) — 저장 액션도 같은 판정.
  const isMaster = user?.systemRole === "master" || (mathOn && (await isCurrentUserSuperAdmin()));
  const slackOn = !("error" in gate);
  const available: IntegrationSub[] = [
    ...(slackOn ? (["slack"] as const) : []),
    ...(modulesOn.makeedu ? (["makeedu"] as const) : []),
    ...(modulesOn.sheets ? (["sheets"] as const) : []),
    // 숙제영상 드라이브 = ClassNote 기능이 있는 지점만(조회·저장 서버 게이트와 같은 판정 — drive-settings-actions).
    ...(classnoteModuleOn(settings) ? (["video"] as const) : []),
    ...(agentOn ? (["agent"] as const) : []),
    ...(mathOn ? (["todaysMath"] as const) : []),
  ];
  if (available.length === 0) {
    return (
      <div className="border-border bg-card rounded-2xl border p-5">
        {/* 꺼진 연동의 이름을 늘어놓지 않는다(원장 2026-09-30 "꺼지면 있었는지조차 모르게"). */}
        <p className="text-foreground text-sm font-bold">이 학원은 켜진 외부 연동이 없습니다</p>
      </div>
    );
  }
  // sub 없는 옛 링크 중 실행 이력 페이저(`&page=N`)는 makeedu 면의 것이다.
  const wanted = sub ?? (page > 1 ? "makeedu" : "");
  const active: IntegrationSub = (available as string[]).includes(wanted) ? (wanted as IntegrationSub) : available[0]!;
  const faces: Face[] = available.map((key) => ({ key, label: LABEL[key], href: `/owner?tab=sheets&sub=${key}` }));
  // 오늘 수학 토글 3개는 **보고서 섹션**에 저장된다(saveOwnerSection(report) → report_settings) — 화면도 그 키로 판정한다.
  // 이 면이 연동 설정으로 잠겼으면(canEdit=false) 어차피 못 고치니 함께 잠근다. 안내 문구의 키는 막은 쪽.
  const canWriteReport = active === "todaysMath" && user ? await canWriteTenant(user.systemRole, "report_settings") : false;

  return (
    <div className="space-y-4">
      {available.length > 1 ? <FaceTabs faces={faces} active={active} level="secondary" ariaLabel="연동 종류 전환" /> : null}
      {active === "slack" ? <SlackCard canEdit={canEdit} /> : null}
      {active === "makeedu" || active === "sheets" ? (
        <SheetsFace
          subjects={settings.operations.subjects}
          page={page}
          isEmbed={isEmbed}
          makeeduOn={active === "makeedu"}
          sheetsOn={active === "sheets"}
          canEdit={canEdit}
        />
      ) : null}
      {active === "video" ? <VideoDriveCard /> : null}
      {active === "todaysMath" ? (
        <TodaysMathCard
          report={settings.report}
          readOnly={!canEdit || !canWriteReport}
          lockMenu={canWriteReport ? "integration_settings" : "report_settings"}
          // 면 전체가 잠겼으면(canEdit=false) 면 위 한 줄이 안내한다 — 일부(보고서 설정)만 막힌 때만 카드가 적는다.
          lockNote={canEdit}
        />
      ) : null}
      {/* 사용 메뉴 저장도 연동 설정 쓰기를 함께 본다(branch-menus-actions.ts의 저장 문과 같은 판정). */}
      {active === "todaysMath" && isMaster ? <TodaysMathMenusCard canEdit={canEdit} /> : null}
      {active === "agent" ? <AgentCard classnoteOn={classnoteModuleOn(settings)} makeeduOn={modulesOn.makeedu} canEdit={canEdit}
        legacyPC={modulesOn.makeedu?<LegacyMakeeduPC />:null} /> : null}
    </div>
  );
}

async function LegacyMakeeduPC() {
  // Server request timestamp for the legacy heartbeat display.
  // eslint-disable-next-line react-hooks/purity
  const nowMs=Date.now();
  const workers=await getMakeeduSyncWorkers(nowMs);
  if(!workers.length)return null;
  return <section className="space-y-2"><h2 className="text-sm font-bold">기존 동기화 PC</h2><MakeeduWorkerStatus workers={workers} nowMs={nowMs} /></section>;
}
