"use client";

import { useMemo, useRef, useState } from "react";
import { DragScrollArea } from "@/components/ui/drag-scroll-area";
import { SectionForm } from "./section-form";
import {
  MENU_ACCESS,
  MENU_KEYS,
  SYSTEM_ROLES,
  TEACHER_MENU_KEYS,
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
  dashboard: "운영실",
  timetable: "시간표",
  attendance: "출석부",
  seat_attendance: "랩실·JJ실 출석부",
  classes: "수업목록",
  students: "학생목록",
  exams: "성적관리",
  enrollment: "등록상담",
  consultations: "학생상담",
  withdrawals: "퇴원관리",
  retention: "이탈 방어",
  ecs: "영어 강사 시트",
  lesson_reports: "수업보고서",
  staff: "직원관리",
  billing: "수납관리",
  textbook_requests: "교재 요청",
  expense_requests: "지출결의서",
  meetings: "회의록",
  documents: "데이터베이스",
  class_review: "수업 평가",
  integrations: "makeedu 연동",
  sheet_sync: "구글 시트 연동",
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
// 원장의 owner/admin/대시보드(자기잠금 방지) + 강사 대시보드(전역 집계 누수 방지).
// permissions.ts의 isPermissionLocked와 동일 규약.
function isCellLocked(menu: MenuKey, role: SystemRole): boolean {
  if (menu === "teacher_onescreen" || menu === "my_learning") return true;
  if (role === "student") return true;
  if (menu === "dashboard" && role === "teacher") return true;
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

export function PermissionsSection({
  initial,
  userOverrideNames = {},
}: {
  initial: PermissionsSettings;
  /** 개인 예외 표시용 userId→이름(서버에서 해석). 이름 없는 id는 축약 id로 표시. */
  userOverrideNames?: Record<string, string>;
}) {
  const [matrix, setMatrix] = useState<AccessMatrix>(() => resolveMatrix(initial.overrides));
  const overrides = useMemo(() => diffOverrides(matrix), [matrix]);
  // 개인 예외는 이 폼에서 편집하지 않는다(조회 전용) — 단 저장 payload에 **그대로 관통**시킨다.
  // 빠뜨리면 permissionsSchema의 default([])가 채워져 매트릭스 저장 한 번에 개인 예외가 전멸한다.
  const userOverrides = initial.userOverrides;

  function cycle(menu: MenuKey, role: SystemRole) {
    const next = CYCLE[(CYCLE.indexOf(matrix[menu][role]) + 1) % CYCLE.length];
    if (isPermissionLocked(menu, role, next)) return; // 가드레일 셀은 변경 거부
    setMatrix((m) => ({ ...m, [menu]: { ...m[menu], [role]: next } }));
  }

  // '강사 내 메뉴 표시' 빠른 토글 — 같은 matrix 상태를 편집(별도 저장/필드 없음, 아래 표와 한 폼).
  // 켜기 복원값 = '끄기 직전의 실제 강사 접근값'(세션 중 매트릭스로 바꾼 readonly 등도 보존). 마운트 값으로 초기화.
  // ⚠️ 마운트 값 고정으로 복원하면 세션 중 매트릭스 편집이 off/on 사이클에 유실됨 → 끄기 시점에 live 값을 캡처.
  // 처음부터 '없음'이던 탭을 켜면 코드 기본값(scoped/full). 끄기=none → 탭 숨김 + 페이지 접근 차단.
  const prevTeacherAccessRef = useRef<Record<string, Access> | null>(null);
  if (prevTeacherAccessRef.current === null) {
    prevTeacherAccessRef.current = Object.fromEntries(
      TEACHER_MENU_KEYS.map((k) => [k, matrix[k].teacher]),
    ) as Record<string, Access>;
  }
  function setTeacherShown(menu: MenuKey, shown: boolean) {
    if (menu === "teacher_onescreen") return; // 강사 홈 — 항상 표시(ROLE_LOCKED)
    setMatrix((m) => {
      const prev = prevTeacherAccessRef.current!;
      if (!shown) {
        // 끄기 직전의 비-none 값을 기억 → 다시 켤 때 복원(매트릭스로 방금 바꾼 값 유실 방지)
        if (m[menu].teacher !== "none") prev[menu] = m[menu].teacher;
        return { ...m, [menu]: { ...m[menu], teacher: "none" } };
      }
      const restore = prev[menu];
      const next: Access = restore && restore !== "none" ? restore : MENU_ACCESS[menu].teacher;
      return { ...m, [menu]: { ...m[menu], teacher: next } };
    });
  }

  return (
    <SectionForm section="permissions" payload={{ overrides, userOverrides }}>
      <>
      <section className="border-border bg-card rounded-2xl border p-5">
        <h3 className="text-foreground text-sm font-bold">강사 &lsquo;내 메뉴&rsquo; 표시</h3>
        <p className="text-text-dim mt-1 text-[12px] leading-relaxed">
          강사 화면 우상단 <b>내 메뉴</b> 드롭다운에 보여줄 탭을 고릅니다. 끄면 그 탭이 숨겨지고 강사가 해당
          페이지에 접근할 수 없습니다(모든 강사 공통). <b>수업 마감(원스크린)</b>은 강사 홈이라 항상 표시됩니다.
          세부 권한(담당/읽기 등)은 아래 표에서 조정합니다.
        </p>
        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
          {TEACHER_MENU_KEYS.map((menu) => {
            const shown = matrix[menu].teacher !== "none";
            const locked = menu === "teacher_onescreen";
            return (
              <label
                key={menu}
                className={`border-border flex items-center gap-2 rounded-md border px-3 py-2 text-[13px] ${
                  locked ? "opacity-60" : "hover:bg-bg-soft cursor-pointer"
                }`}
              >
                <input
                  type="checkbox"
                  checked={shown}
                  disabled={locked}
                  onChange={(e) => setTeacherShown(menu, e.target.checked)}
                  className="accent-primary size-4"
                />
                <span className="truncate">
                  {MENU_LABEL[menu]}
                  {locked ? " · 고정" : ""}
                </span>
              </label>
            );
          })}
        </div>
      </section>
      <section className="border-border bg-card rounded-2xl border p-5">
        <h3 className="text-foreground text-sm font-bold">역할별 메뉴 권한</h3>
        <p className="text-text-dim mt-1 text-[12px] leading-relaxed">
          셀을 클릭하면 <b>전체 → 담당 → 읽기 → 없음</b> 순으로 바뀝니다. 기본값과 다른 셀만 저장됩니다
          (현재 {overrides.length}개 변경). 선생님 원스크린·내 학습은 역할 전용이라 고정이고, 학생 역할과
          원장의 설정·관리자 도구·운영실 접근은 잠글 수 없습니다. 강사 운영실은 담당 범위 집계가 없어 비활성화됩니다.
        </p>
        <DragScrollArea className="border-border mt-4 rounded-md border">
          <table className="w-full border-collapse text-[12px]">
            <thead>
              <tr className="bg-bg-soft">
                <th className="bg-bg-soft sticky left-0 z-10 px-3 py-2 text-left font-bold whitespace-nowrap">
                  메뉴
                </th>
                {SYSTEM_ROLES.map((r) => (
                  <th key={r} className="px-2 py-2 text-center font-bold whitespace-nowrap">
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
        {userOverrides.length > 0 ? (
          // 개인 예외 — 역할 표 위에 특정 사용자에게만 얹힌 셀(예: 직원관리를 원장+개발팀 4인으로 좁히며
          // 설현·이승엽 admin에게만 개별 허용, 2026-08-01). 표의 역할 값과 다르게 동작하는 이유를 원장이
          // 여기서 확인한다. 편집은 시스템 반영(스크립트) 경로만 — 이 폼은 저장 시 그대로 보존한다.
          <div className="border-border bg-bg-soft mt-4 rounded-md border px-4 py-3">
            <p className="text-foreground text-[12px] font-bold">개인 예외 {userOverrides.length}건</p>
            <p className="text-text-dim mt-0.5 text-[11px] leading-relaxed">
              아래 사용자는 역할과 무관하게 해당 메뉴가 개별 적용됩니다(위 표보다 우선).
            </p>
            <ul className="mt-1.5 space-y-0.5">
              {userOverrides.map((o) => (
                <li key={`${o.userId}-${o.menu}`} className="text-[12px]">
                  <span className="text-foreground font-medium">
                    {userOverrideNames[o.userId] || `${o.userId.slice(0, 8)}…`}
                  </span>
                  <span className="text-text-dim"> — {MENU_LABEL[o.menu]}: </span>
                  <span className={`rounded px-1 py-0.5 text-[11px] font-medium ${ACCESS_CLS[o.access]}`}>
                    {ACCESS_LABEL[o.access]}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>
      </>
    </SectionForm>
  );
}
