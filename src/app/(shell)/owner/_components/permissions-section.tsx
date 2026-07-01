"use client";

import { useMemo, useState } from "react";
import { DragScrollArea } from "@/components/ui/drag-scroll-area";
import { SectionForm } from "./section-form";
import {
  MENU_ACCESS,
  MENU_KEYS,
  SYSTEM_ROLES,
  isPermissionLocked,
  resolveMatrix,
  type Access,
  type AccessMatrix,
  type MenuKey,
  type PermissionOverride,
  type SystemRole,
} from "@/lib/permissions";
import type { PermissionsSettings } from "@/features/owner/settings-types";

const MENU_LABEL: Record<MenuKey, string> = {
  dashboard: "대시보드",
  timetable: "시간표",
  attendance: "출석부",
  classes: "수업목록",
  students: "학생목록",
  exams: "성적관리",
  enrollment: "등록상담",
  consultations: "학생상담",
  withdrawals: "퇴원관리",
  retention: "이탈 방어",
  staff: "직원관리",
  billing: "수납관리",
  textbook_requests: "교재 요청",
  meetings: "회의록",
  help: "도움말",
  admin: "관리자 도구",
  owner: "학원 설정",
  teacher_onescreen: "선생님 원스크린",
  my_learning: "내 학습",
  kiosk_settings: "키오스크 설정",
};

const ROLE_LABEL: Record<SystemRole, string> = {
  master: "원장",
  admin: "관리자",
  manager: "실장",
  teacher: "강사",
  counselor: "상담",
  accountant: "회계",
  viewer: "열람",
  student: "학생",
};

const CYCLE: Access[] = ["full", "scoped", "readonly", "none"];
const ACCESS_LABEL: Record<Access, string> = { full: "전체", scoped: "담당", readonly: "읽기", none: "없음" };
const ACCESS_CLS: Record<Access, string> = {
  full: "bg-primary/10 text-primary",
  scoped: "bg-blue/10 text-blue",
  readonly: "bg-bg-soft text-text-dim",
  none: "text-text-faint",
};

// 셀 편집 불가: 역할 전용 화면(원스크린/내 학습) 행 전체 + 학생 컬럼 전체(내 학습 전용 역할) +
// 원장의 owner/admin/대시보드(자기잠금 방지). permissions.ts의 isPermissionLocked와 동일 규약.
function isCellLocked(menu: MenuKey, role: SystemRole): boolean {
  if (menu === "teacher_onescreen" || menu === "my_learning") return true;
  if (role === "student") return true;
  if (role === "master" && (menu === "owner" || menu === "admin" || menu === "dashboard")) return true;
  return false;
}

// 유효 매트릭스 → 하드코딩 기본값과 다른 셀만 sparse override 배열로(저장 페이로드).
function diffOverrides(matrix: AccessMatrix): PermissionOverride[] {
  const out: PermissionOverride[] = [];
  for (const menu of MENU_KEYS) {
    for (const role of SYSTEM_ROLES) {
      if (matrix[menu][role] !== MENU_ACCESS[menu][role]) {
        out.push({ menu, role, access: matrix[menu][role] });
      }
    }
  }
  return out;
}

export function PermissionsSection({ initial }: { initial: PermissionsSettings }) {
  const [matrix, setMatrix] = useState<AccessMatrix>(() => resolveMatrix(initial.overrides));
  const overrides = useMemo(() => diffOverrides(matrix), [matrix]);

  function cycle(menu: MenuKey, role: SystemRole) {
    const next = CYCLE[(CYCLE.indexOf(matrix[menu][role]) + 1) % CYCLE.length];
    if (isPermissionLocked(menu, role, next)) return; // 가드레일 셀은 변경 거부
    setMatrix((m) => ({ ...m, [menu]: { ...m[menu], [role]: next } }));
  }

  return (
    <SectionForm section="permissions" payload={{ overrides }}>
      <section className="border-border bg-card rounded-lg border p-5">
        <h3 className="text-foreground text-sm font-bold">역할별 메뉴 권한</h3>
        <p className="text-text-dim mt-1 text-[12px] leading-relaxed">
          셀을 클릭하면 <b>전체 → 담당 → 읽기 → 없음</b> 순으로 바뀝니다. 기본값과 다른 셀만 저장됩니다
          (현재 {overrides.length}개 변경). 선생님 원스크린·내 학습은 역할 전용이라 고정이고, 학생 역할과
          원장의 설정·관리자 도구·대시보드 접근은 잠글 수 없습니다.
        </p>
        <DragScrollArea className="border-border mt-4 rounded-md border">
          <table className="w-full border-collapse text-[12px]">
            <thead>
              <tr className="bg-bg-soft">
                <th className="bg-bg-soft sticky left-0 z-10 px-3 py-2 text-left font-semibold whitespace-nowrap">
                  메뉴
                </th>
                {SYSTEM_ROLES.map((r) => (
                  <th key={r} className="px-2 py-2 text-center font-semibold whitespace-nowrap">
                    {ROLE_LABEL[r]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {MENU_KEYS.map((menu) => (
                <tr key={menu} className="border-border border-t">
                  <td className="bg-card sticky left-0 z-10 px-3 py-1.5 font-medium whitespace-nowrap">
                    {MENU_LABEL[menu]}
                  </td>
                  {SYSTEM_ROLES.map((role) => {
                    const a = matrix[menu][role];
                    const locked = isCellLocked(menu, role);
                    return (
                      <td key={role} className="px-1.5 py-1.5 text-center">
                        <button
                          type="button"
                          disabled={locked}
                          onClick={() => cycle(menu, role)}
                          title={locked ? "고정" : "클릭하여 변경"}
                          className={`w-full min-w-[3rem] rounded px-1.5 py-1 text-[11px] font-medium transition ${ACCESS_CLS[a]} ${
                            locked ? "cursor-default opacity-40" : "hover:ring-primary/40 hover:ring-1"
                          }`}
                        >
                          {ACCESS_LABEL[a]}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </DragScrollArea>
      </section>
    </SectionForm>
  );
}
