"use client";

import { useState } from "react";
import { CLASS_SPLIT_ENABLED } from "@/features/class-splits/access";
import { useModuleOn } from "@/features/owner/operations-context";
import type { PermissionsSettings } from "@/features/owner/settings-types";
import { SettingsCard } from "./settings-card";
import { StaffScopeEditor } from "./staff-scope-editor";

type SpecialAccess = PermissionsSettings["specialAccess"];
type StaffOption = { id: string; name: string; role: string };
type ListKey = "payslipViewerIds" | "leaveAdjusterIds" | "classSplitterIds";
const MAX_PEOPLE = 80;
const LISTS: readonly { key: ListKey; label: string; hint: string }[] = [
  { key: "payslipViewerIds", label: "급여명세서 열람", hint: "급여명세서를 열람 · 작성 · 발행할 수 있는 사람입니다. 원장과 여기서 지정한 사람만 봅니다. 지정한 사람은 출석부 메뉴 권한도 있어야 합니다." },
  { key: "leaveAdjusterIds", label: "연차 조정", hint: "직원의 연차 부여 일수를 고칠 수 있는 사람입니다. 직원관리 메뉴 권한도 있어야 합니다." },
  { key: "classSplitterIds", label: "수업 나누기", hint: "시간표에서 수업을 나눌 수 있는 사람입니다. 수업 관리 권한도 있어야 합니다." },
];

/**
 * 개인별 기능 권한 — 메뉴 권한과 별개로 **사람을 지정해서** 여는 기능을 한자리에서 주고 거둔다
 * (원장 2026-10-06 *"개인 역할은 전부다 편집기"*). 급여명세서 열람 · 연차 조정 · 수업 나누기 · 직원관리 과목 범위.
 * 코드에 계정 명단을 두지 않는다 — 여기 보이는 것이 전부다.
 *
 * 🔴 **원장 역할은 지정 대상이 아니다** — 지정 없이 전부 통과하고 과목 범위도 안 걸린다(원장 2026-10-06 *"원장이니 최상위 권한"*).
 *    그래서 직원 고르기에 원장 역할을 세우지 않는다(이미 지정돼 있던 줄은 보이고 × 로 거둘 수 있다).
 * 🔴 화면에 안 보이는 사람(`hiddenUserIds`)은 손대지 않고 그대로 둔다 — 지우거나 바꾸는 요청은 저장이 거절한다.
 * ⚠️ 꺼진 기능의 칸은 세우지 않는다(급여 기능이 꺼진 학원엔 급여명세서 칸이 없고, 수업 나누기를 꺼 둔 동안엔 그 칸이 없다)
 *    — 저장값은 그대로 실려 간다(다시 켜면 지정해 둔 사람이 그대로 보인다).
 */
export function SpecialAccessEditor({ value, hiddenUserIds, staffOptions, nameOf, onChange }: {
  value: SpecialAccess;
  hiddenUserIds: readonly string[];
  staffOptions: readonly StaffOption[];
  nameOf: (userId: string) => string;
  onChange: (next: (value: SpecialAccess) => SpecialAccess) => void;
}) {
  const [picked, setPicked] = useState<Record<string, string>>({});
  const payrollOn = useModuleOn("payroll");
  const hidden = new Set(hiddenUserIds);
  const pickable = staffOptions.filter((s) => !hidden.has(s.id) && s.role !== "master");
  const lists = LISTS.filter(({ key }) => (key !== "payslipViewerIds" || payrollOn) && (key !== "classSplitterIds" || CLASS_SPLIT_ENABLED));
  const add = (key: ListKey, id: string) => {
    if (!id) return;
    onChange((prev) => (prev[key].includes(id) || prev[key].length >= MAX_PEOPLE ? prev : { ...prev, [key]: [...prev[key], id] }));
  };
  const select = "border-border bg-card rounded border px-2 py-1.5 text-xs";
  return (
    <SettingsCard
      title="개인별 기능 권한"
      collapsible
      defaultOpen
      description="메뉴 권한과 별개로, 사람을 지정해서 여는 기능입니다. 원장은 지정하지 않아도 전부 할 수 있습니다. 지정한 사람은 × 로 거둘 수 있습니다."
    >
      <div className="space-y-5">
        {lists.map(({ key, label, hint }) => {
          const shown = value[key].filter((id) => !hidden.has(id));
          return (
            <div key={key} className="space-y-2">
              <div>
                <p className="text-xs font-bold">{label}</p>
                <p className="text-text-dim text-xs">{hint}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <select aria-label={`${label} 담당자 선택`} value={picked[key] ?? ""} onChange={(e) => setPicked((p) => ({ ...p, [key]: e.target.value }))} className={select}>
                  <option value="">직원 선택</option>
                  {pickable.filter((s) => !value[key].includes(s.id)).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
                <button
                  type="button"
                  aria-label={`${label} 담당자 추가`}
                  onClick={() => {
                    add(key, picked[key] ?? "");
                    setPicked((p) => ({ ...p, [key]: "" }));
                  }}
                  disabled={!picked[key] || value[key].length >= MAX_PEOPLE}
                  className="border-border bg-card rounded border px-3 py-1.5 text-xs font-bold disabled:opacity-40"
                >
                  담당자 추가
                </button>
              </div>
              <div className="flex flex-wrap gap-2">
                {shown.length === 0 ? (
                  <span className="text-text-dim text-xs">지정된 직원 없음</span>
                ) : (
                  shown.map((id) => (
                    <span key={id} className="border-border bg-card inline-flex items-center gap-1 rounded border px-2 py-1 text-xs">
                      {nameOf(id)}{" "}
                      <button
                        type="button"
                        aria-label={`${nameOf(id)} ${label} 해제`}
                        title="해제"
                        onClick={() => onChange((prev) => ({ ...prev, [key]: prev[key].filter((v) => v !== id) }))}
                        className="text-text-dim hover:text-danger leading-none"
                      >
                        ×
                      </button>
                    </span>
                  ))
                )}
              </div>
            </div>
          );
        })}
        <StaffScopeEditor
          scopes={value.staffSubjectScopes}
          hiddenUserIds={hiddenUserIds}
          staffOptions={pickable}
          nameOf={nameOf}
          onChange={(next) => onChange((prev) => ({ ...prev, staffSubjectScopes: next(prev.staffSubjectScopes) }))}
        />
      </div>
    </SettingsCard>
  );
}
