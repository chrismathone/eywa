"use client";

import { CLASS_SPLIT_ENABLED } from "@/features/class-splits/access";
import { useModuleOn } from "@/features/owner/operations-context";
import type { PermissionsSettings } from "@/features/owner/settings-types";
import { SettingsCard } from "./settings-card";
import { StaffScopeEditor } from "./staff-scope-editor";
import { SpecialAccessList } from "./special-access-list";
import { StudentStatusAccessEditor } from "./student-status-access-editor";

type SpecialAccess = PermissionsSettings["specialAccess"];
type StaffOption = { id: string; name: string; role: string };
type ListKey = "payslipViewerIds" | "payslipManagerIds" | "leaveAdjusterIds" | "classSplitterIds";
const LISTS: readonly { key: ListKey; label: string; hint: string }[] = [
  { key: "payslipViewerIds", label: "급여명세서 열람", hint: "급여명세서를 조회·인쇄할 수 있는 사람입니다. 조정 저장·발행·발행취소는 관리 권한이 필요합니다. 지정한 사람은 출석부 메뉴 권한도 있어야 합니다." },
  { key: "payslipManagerIds", label: "급여명세서 관리", hint: "열람을 포함해 조정 저장·발행·발행취소를 할 수 있는 사람입니다. 열람 명단에 중복 지정할 필요가 없으며, 관리 명단에 남아 있으면 열람을 해제해도 볼 수 있습니다. 출석부 메뉴 권한도 있어야 합니다." },
  { key: "leaveAdjusterIds", label: "연차 조정", hint: "직원의 연차 부여 일수를 고칠 수 있는 사람입니다. 직원관리 메뉴 권한도 있어야 합니다." },
  { key: "classSplitterIds", label: "수업 나누기", hint: "시간표에서 수업을 나눌 수 있는 사람입니다. 수업 관리 권한도 있어야 합니다." },
];

/**
 * 개인별 기능 권한 — 메뉴 권한과 별개로 **사람을 지정해서** 여는 기능을 한자리에서 주고 거둔다
 * (원장 2026-10-06 *"개인 역할은 전부다 편집기"*). 급여명세서 열람 · 연차 조정 · 수업 나누기 · 업무 처리 현황 · 직원관리 과목 범위.
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
  const payrollOn = useModuleOn("payroll");
  const hidden = new Set(hiddenUserIds);
  const pickable = staffOptions.filter((s) => !hidden.has(s.id) && s.role !== "master");
  const lists = LISTS.filter(({ key }) => (!key.startsWith("payslip") || payrollOn) && (key !== "classSplitterIds" || CLASS_SPLIT_ENABLED));
  return (
    <SettingsCard
      title="개인별 기능 권한"
      collapsible
      defaultOpen
      description="메뉴 권한과 별개로, 사람을 지정해서 여는 기능입니다. 원장은 지정하지 않아도 전부 할 수 있습니다. 지정한 사람은 × 로 거둘 수 있습니다."
    >
      <div className="space-y-5">
        <StudentStatusAccessEditor value={value} hiddenUserIds={hiddenUserIds} staffOptions={pickable} nameOf={nameOf} onChange={onChange} />
        {lists.map(({ key, label, hint }) => <SpecialAccessList key={key} label={label} hint={hint}
          ids={value[key] ?? []} hiddenUserIds={hiddenUserIds} staffOptions={pickable} nameOf={nameOf}
          onChange={(update) => onChange((prev) => ({ ...prev, [key]: update(prev[key] ?? []) }))} />)}
        <StaffScopeEditor
          scopes={value.staffSubjectScopes}
          hiddenUserIds={hiddenUserIds}
          staffOptions={pickable}
          nameOf={nameOf}
          onChange={(next) => onChange((prev) => ({ ...prev, staffSubjectScopes: next(prev.staffSubjectScopes) }))}
        />
        <SpecialAccessList
          label="수강 날짜 수정"
          hint="수강 시작일·종료일을 수정할 수 있는 별도 권한입니다. 종료일 지정·비우기도 포함합니다. 학생목록·수업목록·퇴원관리 중 접근할 메뉴 권한이 필요하며, 기존 담당 범위를 따릅니다. 수강 이력 삭제 권한은 포함하지 않습니다."
          ids={value.enrollmentDateEditorIds ?? []}
          hiddenUserIds={hiddenUserIds}
          staffOptions={pickable}
          nameOf={nameOf}
          onChange={(update) => onChange((prev) => ({ ...prev, enrollmentDateEditorIds: update(prev.enrollmentDateEditorIds ?? []) }))}
        />
        <SpecialAccessList
          label="업무 처리 현황"
          hint="모든 직원의 할 일(보고서 발송 실패 · 상담 후속조치)과 처리 여부를 볼 수 있는 사람입니다. 운영실 강사별 업무 현황과 알림 벨에서 엽니다. 매일 아침 '늦은 할 일' 요약 알림도 여기 지정한 사람이 받습니다(아무도 지정하지 않으면 원장). 할 일의 원래 내용은 그 메뉴 권한대로 열립니다."
          ids={value.staffTaskMonitorIds ?? []}
          hiddenUserIds={hiddenUserIds}
          staffOptions={pickable}
          nameOf={nameOf}
          onChange={(update) => onChange((prev) => ({ ...prev, staffTaskMonitorIds: update(prev.staffTaskMonitorIds ?? []) }))}
        />
        <SpecialAccessList
          label="JJ 보고서 담당"
          hint="그날 JJ 교시가 있는 반의 수업보고서를 원스크린에서 쓸 수 있는 사람입니다. JJ는 담당 강사를 두지 않는 자리 교시라, 이 칸으로 보고서 작성자를 정합니다. 그 반 담임도 그대로 함께 씁니다."
          ids={value.jjReportManagerIds ?? []}
          hiddenUserIds={hiddenUserIds}
          staffOptions={pickable}
          nameOf={nameOf}
          onChange={(update) => onChange((prev) => ({ ...prev, jjReportManagerIds: update(prev.jjReportManagerIds ?? []) }))}
        />
        <SpecialAccessList
          label="비포클래스 보고서 표"
          hint="이 사람이 쓰는 수학 수업보고서의 '수업 평가' 표에 비포클래스체크리스트 줄이 붙습니다. 체크리스트 반이고 그날 체크가 있을 때만 붙습니다."
          ids={value.beforeClassReportIds ?? []}
          hiddenUserIds={hiddenUserIds}
          staffOptions={pickable}
          nameOf={nameOf}
          onChange={(update) => onChange((prev) => ({ ...prev, beforeClassReportIds: update(prev.beforeClassReportIds ?? []) }))}
        />
        <SpecialAccessList
          label="퇴원보고서 승인자"
          hint="퇴원보고서의 관리자 승인을 맡는 사람입니다. 여기 지정한 사람이 담당하는 과목은 이 사람들만 승인 후보로 나옵니다. 지정한 사람이 없는 과목은 그 과목 관리자 전원이 후보입니다. 담당 과목은 직원의 과목(직원관리 과목 범위가 있으면 그 범위)을 따릅니다."
          ids={value.withdrawalApproverIds ?? []}
          hiddenUserIds={hiddenUserIds}
          staffOptions={pickable}
          nameOf={nameOf}
          onChange={(update) => onChange((prev) => ({ ...prev, withdrawalApproverIds: update(prev.withdrawalApproverIds ?? []) }))}
        />
      </div>
    </SettingsCard>
  );
}
