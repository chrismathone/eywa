"use client";
import { DASHBOARD_ROLE_LABELS } from "@/features/dashboard/layout/roles";

import { useMemo, useRef, useState } from "react";
import { DragScrollArea } from "@/components/ui/drag-scroll-area";
import { SectionForm } from "./section-form";
import {
  MENU_ACCESS,
  MENU_KEYS,
  MENU_LABEL,
  SYSTEM_ROLES,
  TEACHER_MENU_KEYS,
  isPermissionLocked,
  resolveMatrix,
  type Access,
  type AccessMatrix,
  type MenuKey,
  type PermissionOverride,
  type SystemRole,
  type UserPermissionOverride,
} from "@/lib/permissions";
import type { PermissionsSettings } from "@/features/owner/settings-types";
import { isTeacherMenuEntranceOpen } from "@/lib/navigation";

// '강사 내 메뉴 표시' 빠른 토글에 세울 탭 — 강사 '내 메뉴'와 **같은 입구 정책**(isTeacherMenuEntranceOpen)으로 거른다.
// 메뉴에서 뺀 탭(원장 2026-09-10 캘린더)은 켜도 꺼도 메뉴가 안 바뀌어 거짓 약속이 되므로 여기 세우지 않는다
// (2026-09-11 리뷰). 그 탭의 페이지 접근은 아래 '역할별 메뉴 권한' 표에서 그대로 조정된다.
const TEACHER_TOGGLE_KEYS = TEACHER_MENU_KEYS.filter(isTeacherMenuEntranceOpen);

const ROLE_LABEL: Record<SystemRole, string> = DASHBOARD_ROLE_LABELS;

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
  staffOptions = [],
  hiddenUserIds = [],
  generic = false,
}: {
  initial: PermissionsSettings;
  /** 개인 예외 표시용 userId→이름(서버에서 해석). 이름 없는 id는 축약 id로 표시. */
  userOverrideNames?: Record<string, string>;
  staffOptions?: { id: string; name: string; role: string }[];
  hiddenUserIds?: string[];
  generic?: boolean;
}) {
  const [matrix, setMatrix] = useState<AccessMatrix>(() => resolveMatrix(initial.overrides));
  const overrides = useMemo(() => diffOverrides(matrix), [matrix]);
  const [userOverrides, setUserOverrides] = useState<UserPermissionOverride[]>(initial.userOverrides);
  const [specialAccess, setSpecialAccess] = useState(initial.specialAccess);
  const [pickedUser, setPickedUser] = useState("");
  const [pickedMenu, setPickedMenu] = useState<MenuKey>("staff");
  const [pickedAccess, setPickedAccess] = useState<Access>("full");
  const [pickedPayslip, setPickedPayslip] = useState("");
  const [pickedLeave, setPickedLeave] = useState("");
  const hiddenIds = new Set(hiddenUserIds);
  const visibleOverrides = userOverrides.filter((row) => !hiddenIds.has(row.userId));
  const visibleSpecial = {
    payslipViewerIds: specialAccess.payslipViewerIds.filter((id) => !hiddenIds.has(id)),
    leaveAdjusterIds: specialAccess.leaveAdjusterIds.filter((id) => !hiddenIds.has(id)),
  };
  const staffName = (id: string) => staffOptions.find((s) => s.id === id)?.name || userOverrideNames[id] || `${id.slice(0, 8)}…`;

  function addUserOverride() {
    if (!pickedUser) return;
    const role = staffOptions.find((s) => s.id === pickedUser)?.role as SystemRole | undefined;
    if (!role || isPermissionLocked(pickedMenu, role, pickedAccess)) return;
    setUserOverrides((rows) => {
      const next = rows.filter((r) => r.userId !== pickedUser || r.menu !== pickedMenu);
      return next.length >= 80 ? rows : [...next, { userId: pickedUser, menu: pickedMenu, access: pickedAccess }];
    });
  }

  function addSpecial(key: "payslipViewerIds" | "leaveAdjusterIds", id: string) {
    if (!id) return;
    setSpecialAccess((prev) => prev[key].includes(id) || prev[key].length >= 80
      ? prev
      : { ...prev, [key]: [...prev[key], id] });
  }

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
    <SectionForm section="permissions" payload={{ overrides, userOverrides, specialAccess }}>
      <>
      <section className="border-border bg-card rounded-2xl border p-5">
        <h3 className="text-foreground text-sm font-bold">강사 &lsquo;내 메뉴&rsquo; 표시</h3>
        <p className="text-text-dim mt-1 text-xs leading-relaxed">
          강사 화면 우상단 <b>내 메뉴</b> 드롭다운에 보여줄 탭을 고릅니다. 끄면 그 탭이 숨겨지고 강사가 해당
          페이지에 접근할 수 없습니다(모든 강사 공통). <b>수업 마감(원스크린)</b>은 강사 홈이라 항상 표시됩니다.
          세부 권한(담당/읽기 등)은 아래 표에서 조정합니다. 권한은 그대로 두고 <b>순서만 바꾸거나 메뉴에서만 감추려면</b>{" "}
          <b>탭 및 메뉴 구성 → 강사뷰</b>에서 합니다.
          {TEACHER_TOGGLE_KEYS.length < TEACHER_MENU_KEYS.length
            ? " 메뉴에서 뺀 탭은 여기 나오지 않습니다 — 그 탭의 접근은 아래 표에서 조정합니다."
            : null}
        </p>
        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
          {TEACHER_TOGGLE_KEYS.map((menu) => {
            const shown = matrix[menu].teacher !== "none";
            const locked = menu === "teacher_onescreen";
            return (
              <label
                key={menu}
                className={`border-border flex items-center gap-2 rounded-md border px-3 py-2 text-sm ${
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
        <p className="text-text-dim mt-1 text-xs leading-relaxed">
          셀을 클릭하면 <b>전체 → 담당 → 읽기 → 없음</b> 순으로 바뀝니다. 기본값과 다른 셀만 저장됩니다
          (현재 {overrides.length}개 변경). 선생님 원스크린·내 학습은 역할 전용이라 고정이고, 학생 역할과
          원장의 설정·관리자 도구·대시보드 접근은 잠글 수 없습니다. 강사 대시보드는 담당 범위 집계가 없어 비활성화됩니다.
        </p>
        <DragScrollArea className="border-border mt-4 rounded-md border">
          <table className="w-full border-collapse text-xs">
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
                          className={`w-full min-w-[3rem] rounded px-1.5 py-1 text-xs font-medium transition ${ACCESS_CLS[a]} ${
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
        {generic || visibleOverrides.length > 0 ? (
          <div className="border-border bg-bg-soft mt-4 space-y-3 rounded-md border px-4 py-3">
            <div>
              <p className="text-foreground text-xs font-bold">개인별 메뉴 권한 {visibleOverrides.length}건</p>
              <p className="text-text-dim mt-0.5 text-xs">역할별 권한보다 우선합니다. 같은 사람의 같은 메뉴는 새 값으로 바뀝니다.</p>
            </div>
            {generic ? (
              <div className="flex flex-wrap items-center gap-2">
                <select aria-label="직원 선택" value={pickedUser} onChange={(e) => setPickedUser(e.target.value)} className="border-border bg-card rounded border px-2 py-1.5 text-xs">
                  <option value="">직원 선택</option>
                  {staffOptions.filter((s) => !hiddenIds.has(s.id)).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
                <select aria-label="메뉴 선택" value={pickedMenu} onChange={(e) => setPickedMenu(e.target.value as MenuKey)} className="border-border bg-card rounded border px-2 py-1.5 text-xs">
                  {MENU_KEYS.filter((menu) => menu !== "teacher_onescreen" && menu !== "my_learning" && !(menu === "dashboard" && staffOptions.find((s) => s.id === pickedUser)?.role === "teacher")).map((menu) => <option key={menu} value={menu}>{MENU_LABEL[menu]}</option>)}
                </select>
                <select aria-label="접근 수준" value={pickedAccess} onChange={(e) => setPickedAccess(e.target.value as Access)} className="border-border bg-card rounded border px-2 py-1.5 text-xs">
                  {CYCLE.map((access) => <option key={access} value={access}>{ACCESS_LABEL[access]}</option>)}
                </select>
                <button type="button" onClick={addUserOverride} disabled={!pickedUser || (userOverrides.length >= 80 && !userOverrides.some((r) => r.userId === pickedUser && r.menu === pickedMenu)) || isPermissionLocked(pickedMenu, (staffOptions.find((s) => s.id === pickedUser)?.role ?? "student") as SystemRole, pickedAccess)} className="border-border bg-card rounded border px-3 py-1.5 text-xs disabled:opacity-40">추가·변경</button>
              </div>
            ) : null}
            {visibleOverrides.length > 0 ? <ul className="space-y-1">
              {visibleOverrides.map((o) => (
                <li key={`${o.userId}-${o.menu}`} className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="text-foreground min-w-20 font-medium">{staffName(o.userId)}</span>
                  <span className="text-text-dim">{MENU_LABEL[o.menu]}</span>
                  {generic ? (
                    <>
                      <select aria-label={`${staffName(o.userId)} ${MENU_LABEL[o.menu]} 권한`} value={o.access} onChange={(e) => setUserOverrides((rows) => rows.map((r) => r === o ? { ...r, access: e.target.value as Access } : r))} className="border-border bg-card rounded border px-2 py-1 text-xs">
                        {CYCLE.map((access) => <option key={access} value={access}>{ACCESS_LABEL[access]}</option>)}
                      </select>
                      <button type="button" onClick={() => setUserOverrides((rows) => rows.filter((r) => r !== o))} className="text-text-dim hover:text-foreground">제거</button>
                    </>
                  ) : <span className={`rounded px-1 py-0.5 ${ACCESS_CLS[o.access]}`}>{ACCESS_LABEL[o.access]}</span>}
                </li>
              ))}
            </ul> : <p className="text-text-dim text-xs">지정된 개인 예외가 없습니다.</p>}
          </div>
        ) : null}
        {generic ? <div className="border-border bg-bg-soft mt-4 space-y-4 rounded-md border px-4 py-3">
          <div>
            <p className="text-foreground text-xs font-bold">민감 기능 담당자</p>
            <p className="text-text-dim mt-0.5 text-xs">두 기능의 담당자를 따로 지정합니다. 연차 조정은 직원관리 메뉴 권한도 있어야 합니다.</p>
          </div>
          {([
            { key: "payslipViewerIds" as const, label: "급여명세서 열람", picked: pickedPayslip, setPicked: setPickedPayslip },
            { key: "leaveAdjusterIds" as const, label: "연차 조정", picked: pickedLeave, setPicked: setPickedLeave },
          ]).map(({ key, label, picked, setPicked }) => <div key={key} className="space-y-2">
            <p className="text-xs font-medium">{label}</p>
            <div className="flex flex-wrap gap-2">
              <select aria-label={`${label} 담당자 선택`} value={picked} onChange={(e) => setPicked(e.target.value)} className="border-border bg-card rounded border px-2 py-1.5 text-xs">
                <option value="">직원 선택</option>
                {staffOptions.filter((s) => !hiddenIds.has(s.id) && !specialAccess[key].includes(s.id)).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
              <button type="button" onClick={() => { addSpecial(key, picked); setPicked(""); }} disabled={!picked || specialAccess[key].length >= 80} className="border-border bg-card rounded border px-3 py-1.5 text-xs disabled:opacity-40">담당자 추가</button>
            </div>
            <div className="flex flex-wrap gap-2">
              {visibleSpecial[key].length === 0 ? <span className="text-text-dim text-xs">지정된 직원 없음</span> : visibleSpecial[key].map((id) => <span key={id} className="border-border bg-card inline-flex items-center gap-1 rounded border px-2 py-1 text-xs">{staffName(id)} <button type="button" aria-label={`${staffName(id)} ${label} 해제`} onClick={() => setSpecialAccess((prev) => ({ ...prev, [key]: prev[key].filter((v) => v !== id) }))}>×</button></span>)}
            </div>
          </div>)}
        </div> : null}
      </section>
      </>
    </SectionForm>
  );
}
