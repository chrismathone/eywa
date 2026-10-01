"use client";

/**
 * 역할별 운영실 시안 보드 — 위: 역할 · 안(A/B/C) · 담당 과목 · 원장이 정할 6가지, 가운데: 보이는 칸/뺀 칸, 아래: 실제 운영실 카드.
 *
 * 걸러내기는 이 브라우저에서 한다(`applyRoleView`) — 전체 스냅샷을 한 번만 읽고 바꿀 때마다 즉시 다시 그린다(서버 왕복 없음).
 * 보는 사람이 원장이라 전체 데이터가 이미 원장 것이다. 고른 값은 저장하지 않고 **주소 쿼리**에만 남긴다
 * (`history.replaceState` — 창(embed) 주소의 다른 쿼리는 그대로 둔다, #133).
 * 과목 선택지는 학원설정(`useSubjectMaps().options`) — 과목 키·라벨을 코드에 적지 않는다.
 */
import { useMemo, useState } from "react";
import { Overview } from "@/app/(shell)/dashboard/_overview/overview";
import { refreshOverview } from "@/features/dashboard/overview/actions";
import type { ChartKinds } from "@/features/dashboard/overview/chart-prefs";
import type { OverviewSnapshot } from "@/features/dashboard/overview/model";
import { useSubjectMaps } from "@/features/owner/operations-context";
import { applyRoleView } from "../_lib/apply";
import { describeRole } from "../_lib/describe";
import { toggleParam, type LayoutId, type RoleId, type Toggles } from "../_lib/roles";
import { RoleControls } from "./role-controls";
import { RoleNotesPanel } from "./role-notes";

export function RoleBoard({
  full,
  chartKinds,
  initialRole,
  initialLayout,
  initialSubject,
  initialToggles,
}: {
  full: OverviewSnapshot;
  chartKinds: ChartKinds;
  initialRole: RoleId;
  initialLayout: LayoutId;
  initialSubject: string;
  initialToggles: Toggles;
}) {
  const maps = useSubjectMaps();
  const options = maps.options;
  const [role, setRole] = useState(initialRole);
  const [layout, setLayout] = useState(initialLayout);
  const [toggles, setToggles] = useState(initialToggles);
  const [subjectPick, setSubject] = useState(initialSubject);
  const subject = options.some((o) => o.value === subjectPick) ? subjectPick : (options[0]?.value ?? "");

  const sync = (patch: Record<string, string>) => {
    try {
      const url = new URL(window.location.href);
      for (const [k, v] of Object.entries(patch)) {
        if (v) url.searchParams.set(k, v);
        else url.searchParams.delete(k);
      }
      window.history.replaceState(null, "", url);
    } catch {
      // 주소 갱신은 편의 — 실패해도 화면 상태는 그대로.
    }
  };

  const input = useMemo(() => ({ role, layout, subject, toggles }), [role, layout, subject, toggles]);
  const view = useMemo(() => applyRoleView(full, input), [full, input]);
  const notes = useMemo(() => describeRole(role, view.layout, toggles), [role, view.layout, toggles]);
  // 30초 갱신도 같은 걸러내기를 거친다 — 안 거치면 새로 받은 전체 스냅샷이 화면에 그대로 덮인다.
  const refresh = useMemo(() => async () => applyRoleView(await refreshOverview(), input).snapshot, [input]);

  return (
    <div className="flex flex-col gap-4">
      <RoleControls
        role={role}
        layout={layout}
        subject={subject}
        subjects={options}
        toggles={toggles}
        onRole={(r) => {
          setRole(r);
          sync({ role: r === "owner" ? "" : r });
        }}
        onLayout={(l) => {
          setLayout(l);
          sync({ layout: l === "a" ? "" : l });
        }}
        onSubject={(s) => {
          setSubject(s);
          sync({ subject: s });
        }}
        onToggles={(t) => {
          setToggles(t);
          sync({ t: toggleParam(t) });
        }}
      />
      <RoleNotesPanel role={role} layout={layout} notes={notes} />
      <div className="border-line-strong bg-background overflow-hidden rounded-2xl border border-dashed">
        <Overview
          key={view.snapshot.scope}
          initial={view.snapshot}
          layout={view.layout}
          billingAmounts={view.billingAmounts}
          chartKinds={chartKinds}
          refresh={refresh}
          titleSuffix={role === "subject" && subject ? `(${maps.labelOf(subject)})` : undefined}
          billingScopeNote={role === "subject" && view.billingAmounts ? "학원 전체" : undefined}
        />
      </div>
    </div>
  );
}
