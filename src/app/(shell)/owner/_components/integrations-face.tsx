import { FaceTabs, type Face } from "@/components/face-tabs";
import { slackGate } from "@/features/slack/server/gate";
import type { TenantSettings } from "@/features/owner/settings-types";
import { SheetsFace } from "./sheets-face";
import { SlackCard } from "./slack-card";

/**
 * 학원 설정 '연동' 면 = **켜진 연동만 내부 탭으로**(원장 2026-09-28 *"연동 탭이 좀 깔끔해지도록 (현재 너무 세로스크롤이
 * 길어짐) admin이 on/off 한 항목에 따라 적절한 내부탭 디자인화"*). 예전엔 슬랙·makeedu·구글 시트가 한 면에 세로로 쌓였다.
 * 탭 = 슬랙 설정 게이트(`slackGate` — 지점 스위치 ∧ 원장·총괄) · 학원 기능(makeedu·sheet_sync 모듈). 꺼진 연동은 탭도 조회도 없다.
 * 주소 `?tab=sheets&sub=slack|makeedu|sheets` — 고른 탭만 서버에서 읽는다(무거운 면 지연, FaceTabs 규약).
 */
export type IntegrationSub = "slack" | "makeedu" | "sheets";

const LABEL: Record<IntegrationSub, string> = { slack: "슬랙", makeedu: "makeedu 동기화", sheets: "구글 시트" };

export async function IntegrationsFace({
  sub,
  settings,
  modulesOn,
  page,
  isEmbed,
}: {
  sub: string | undefined;
  settings: TenantSettings;
  modulesOn: { makeedu: boolean; sheets: boolean };
  page: number;
  isEmbed: boolean;
}) {
  // 슬랙 탭 = 설정 게이트와 같은 판정(지점 스위치 ∧ 원장·총괄) — 위임 관리자에게 빈 슬랙 탭이 첫 탭으로 뜨지 않게.
  const gate = await slackGate();
  const slackOn = !("error" in gate);
  const available: IntegrationSub[] = [
    ...(slackOn ? (["slack"] as const) : []),
    ...(modulesOn.makeedu ? (["makeedu"] as const) : []),
    ...(modulesOn.sheets ? (["sheets"] as const) : []),
  ];
  if (available.length === 0) {
    return (
      <div className="border-border bg-card rounded-2xl border p-5">
        <p className="text-foreground text-sm font-bold">이 학원은 켜진 외부 연동이 없습니다</p>
        <p className="text-text-dim mt-1 text-sm">
          makeedu 동기화·구글 시트 시간표 연동은 학원 설정의 &lsquo;기능&rsquo; 면에서 켤 수 있습니다.{" "}
          {"error" in gate ? `슬랙: ${gate.error}` : null}
        </p>
      </div>
    );
  }
  // sub 없는 옛 링크 중 실행 이력 페이저(`&page=N`)는 makeedu 면의 것이다.
  const wanted = sub ?? (page > 1 ? "makeedu" : "");
  const active: IntegrationSub = (available as string[]).includes(wanted) ? (wanted as IntegrationSub) : available[0]!;
  const faces: Face[] = available.map((key) => ({ key, label: LABEL[key], href: `/owner?tab=sheets&sub=${key}` }));

  return (
    <div className="space-y-4">
      {available.length > 1 ? <FaceTabs faces={faces} active={active} level="secondary" ariaLabel="연동 종류 전환" /> : null}
      {active === "slack" ? <SlackCard /> : null}
      {active === "makeedu" || active === "sheets" ? (
        <SheetsFace
          subjects={settings.operations.subjects}
          page={page}
          isEmbed={isEmbed}
          makeeduOn={active === "makeedu"}
          sheetsOn={active === "sheets"}
        />
      ) : null}
    </div>
  );
}
