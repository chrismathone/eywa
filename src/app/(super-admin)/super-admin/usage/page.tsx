import { PageHeader } from "@/components/page-header";
import { BigStat } from "@/components/atoms/big-stat";
import { EyIcon } from "@/components/icons/aywa-icons";
import { Panel, fmtDate, fmtNum } from "@/components/super-admin/parts";
import { fmtRatio } from "@/features/usage/labels";
import { IDLE_MS } from "@/features/usage/meter";
import { parseUsageQuery } from "@/features/usage/query";
import { loadUsage } from "@/features/usage/server/summary-query";
import { UsageFilters } from "./_filters";
import { MenuUsagePanel } from "./_menu-panel";
import { RoleUsagePanel, TenantUsagePanel } from "./_group-panels";
import { RouteUsagePanel, UnusedMenusPanel } from "./_route-panels";

export const metadata = { title: "슈퍼관리자 · 이용 분석 — 에이와" };

const hours = (sec: number) => (sec / 3600).toLocaleString("ko-KR", { maximumFractionDigits: 1 });

/**
 * 이용 분석 — 권한·지점별로 **어떤 기능을 많이 쓰고 어느 화면에 오래 머무는지**(원장 2026-09-28, 유지보수 우선순위의 근거).
 *
 * 🔑 두 시간을 함께 본다: **활동 시간**(입력 후 60초 안쪽 = 실제로 일한 시간, 정렬 기본값)과 **화면 시간**(띄워 두고
 *    잡고 있던 시간). 활동률(활동 ÷ 화면)이 낮은 화면은 "켜 두기만 하는" 화면이다. 계측 = src/features/usage.
 * 🔴 사람 한 명 단위는 보여 주지 않는다 — 권한·지점 묶음만(0292a 머리주석).
 * 권한·지점 묶음 패널은 이미 그 축으로 좁혔으면 숨긴다(한 줄짜리 표가 된다). 강사는 담당 과목별로 갈린다(0293a).
 * 🔴 슈퍼관리자 전용 — 지점에 알리지 않는다 · 슈퍼관리자 계정 자신은 세지 않는다(원장 2026-09-28).
 */
export default async function UsagePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const q = parseUsageQuery(await searchParams);
  const data = await loadUsage(q);
  const idleSec = Math.round(IDLE_MS / 1000);

  return (
    <>
      <PageHeader
        eyebrow="슈퍼관리자"
        title="이용 분석"
        description={`권한·지점별로 많이 쓰는 기능과 오래 머무는 화면을 봅니다. 활동 시간은 클릭·키·스크롤 후 ${idleSec}초 안쪽만 셉니다(띄워 두기만 한 시간은 화면 시간에만).`}
        embedLabel="기능별 이용 시간"
        stats={
          data.ok ? (
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <BigStat label="활동 시간" value={hours(data.summary.total.activeSec)} unit="시간" icon={<EyIcon name="clock" size={16} />} tone="primary" sub={`${fmtDate(data.from)} ~ ${fmtDate(data.to)}`} />
              <BigStat label="화면 시간" value={hours(data.summary.total.openSec)} unit="시간" icon={<EyIcon name="eye" size={16} />} tone="blue" sub={`활동률 ${fmtRatio(data.summary.total.activeSec, data.summary.total.openSec)}`} />
              <BigStat label="방문" value={fmtNum(data.summary.total.visits)} unit="회" icon={<EyIcon name="barChart" size={16} />} tone="green" />
              <BigStat label="이용자" value={fmtNum(data.summary.total.users)} unit="명" icon={<EyIcon name="users" size={16} />} tone="gold" />
            </div>
          ) : undefined
        }
      />

      <UsageFilters q={q} tenants={data.tenants} subjects={data.subjects} />

      {data.ok ? (
        <>
          <MenuUsagePanel menus={data.summary.menus} sort={q.sort} />
          {/* 권한을 안 골랐거나 '강사' 전체를 골랐으면 분류 카드(강사 = 과목별)를 보인다. */}
          {q.role === null || (q.role === "teacher" && q.subject === null) ? (
            <RoleUsagePanel roles={data.summary.roles} q={q} subjectLabels={data.subjects.labels} />
          ) : null}
          {q.tenantId === null ? <TenantUsagePanel tenants={data.summary.tenants} names={data.tenants} q={q} /> : null}
          <RouteUsagePanel routes={data.summary.routes} sort={q.sort} />
          <UnusedMenusPanel menus={data.summary.unusedMenus} />
        </>
      ) : (
        <Panel title={data.reason === "not_ready" ? "이용 기록 표가 아직 준비되지 않았습니다" : "이용 기록을 읽지 못했습니다"}>
          <p className="text-foreground text-sm" title={data.detail}>
            {data.reason === "not_ready"
              ? "이용 분석 DB 변경(0292a·0293a)을 적용하면 이 화면이 열립니다. 강사 과목 필터는 0293a가 있어야 합니다."
              : "잠시 뒤 다시 열어 주세요. 계속되면 원문(마우스를 올리면 보입니다)을 개발 담당에게 전해 주세요."}
          </p>
        </Panel>
      )}
    </>
  );
}
