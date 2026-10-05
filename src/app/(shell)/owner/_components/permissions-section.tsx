"use client";
import { nextPermissionAccess, PERMISSION_ACCESS_CYCLE as CYCLE } from "@/features/owner/permission-edit";
import { DASHBOARD_ROLE_LABELS } from "@/features/dashboard/layout/roles";

import { useMemo, useState } from "react";
import { DragScrollArea } from "@/components/ui/drag-scroll-area";
import { SectionForm } from "./section-form";
import { useSectionDraft } from "./use-section-draft";
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
import { ambiguousRoleCells } from "@/features/owner/permissions-canonical";
import { isTeacherMenuEntranceOpen } from "@/lib/navigation";

// '강사 내 메뉴 표시' 빠른 토글에 세울 탭 — 강사 '내 메뉴'와 **같은 입구 정책**(isTeacherMenuEntranceOpen)으로 거른다.
// 메뉴에서 뺀 탭(원장 2026-09-10 캘린더)은 켜도 꺼도 메뉴가 안 바뀌어 거짓 약속이 되므로 여기 세우지 않는다
// (2026-09-11 리뷰). 그 탭의 페이지 접근은 아래 '역할별 메뉴 권한' 표에서 그대로 조정된다.
const TEACHER_TOGGLE_KEYS = TEACHER_MENU_KEYS.filter(isTeacherMenuEntranceOpen);

const ROLE_LABEL: Record<SystemRole, string> = DASHBOARD_ROLE_LABELS;


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

/** 이 면이 고치는 세 칸 — 저장도 셋을 함께 보낸다(한 칸만 따로 저장하는 길은 없다). */
type PermissionsDraft = {
  /** 역할별 권한 — 저장되는 목록(sparse)이 아니라 실제로 적용되는 표로 들고 편집한다. */
  matrix: AccessMatrix;
  userOverrides: UserPermissionOverride[];
  specialAccess: PermissionsSettings["specialAccess"];
};
const toDraft = (p: PermissionsSettings): PermissionsDraft => ({
  matrix: resolveMatrix(p.overrides),
  userOverrides: p.userOverrides,
  specialAccess: p.specialAccess,
});
const teacherAccessOf = (matrix: AccessMatrix) =>
  Object.fromEntries(TEACHER_MENU_KEYS.map((k) => [k, matrix[k].teacher])) as Record<string, Access>;

export function PermissionsSection({
  initial,
  userOverrideNames = {},
  staffOptions = [],
  hiddenUserIds = [],
  generic = false,
  baselineToken,
  baselineVersion,
}: {
  /** 서버가 **방금 읽은** 역할·권한(page.tsx) — 설정 캐시의 값이 아니다. */
  initial: PermissionsSettings;
  /** 개인 예외 표시용 userId→이름(서버에서 해석). 이름 없는 id는 축약 id로 표시. */
  userOverrideNames?: Record<string, string>;
  staffOptions?: { id: string; name: string; role: string }[];
  hiddenUserIds?: string[];
  generic?: boolean;
  /**
   * 이 화면이 연 시점의 역할·권한을 가리키는 기준 token — 저장 요청에 실려, 그사이 다른 곳(다른 창 · '역할 설정' 대화상자 ·
   * 운영자 스크립트)이 바꿨으면 저장이 거절된다. 없으면 저장할 수 없다(서버가 받지 않는다).
   */
  baselineToken?: string;
  /** 이 값을 읽은 문서의 저장 순번 — 내 저장보다 먼저 읽힌 값이 뒤늦게 내려와도 받지 않는다(useSectionDraft). */
  baselineVersion?: number;
}) {
  // 🔴 세 칸은 **한 묶음**으로 다룬다 — 서버가 새 값을 내려보내면 깨끗할 때만 셋을 함께 받고, 수정 중이면 셋 다 그대로 둔다.
  //    (전에는 표가 화면을 연 때의 값에 머물러, 대화상자로 바꾼 직급을 다음 저장이 되돌렸다.)
  const initialDraft = useMemo(() => toDraft(initial), [initial]);
  const { draft, setDraft, baseline, confirmed, noteSubmitted, confirmSaved, noteSaveFailed, adoptions } =
    useSectionDraft(initialDraft, baselineToken, baselineVersion);
  const { matrix, userOverrides, specialAccess } = draft;
  const setMatrix = (next: (m: AccessMatrix) => AccessMatrix) => setDraft((d) => ({ ...d, matrix: next(d.matrix) }));
  const setUserOverrides = (next: (rows: UserPermissionOverride[]) => UserPermissionOverride[]) =>
    setDraft((d) => ({ ...d, userOverrides: next(d.userOverrides) }));
  const setSpecialAccess = (next: (v: PermissionsDraft["specialAccess"]) => PermissionsDraft["specialAccess"]) =>
    setDraft((d) => ({ ...d, specialAccess: next(d.specialAccess) }));
  const overrides = useMemo(() => diffOverrides(matrix), [matrix]);
  // 같은 칸이 서로 다른 값으로 두 번 저장돼 있으면(손으로 넣은 값·스크립트) 알린다 — 표는 마지막 줄을 보여 주고,
  // 저장하면 표의 값 하나로 정리된다. 말없이 정리하지 않는다(그 전까지 읽는 곳에 따라 다른 값이 적용될 수 있었다).
  // 🔴 안내의 기준도 **이 화면이 받아들인 서버 상태**(기준 token)다 — 서버 prop을 그대로 읽으면, 저장으로 정리한 뒤에도
  //    prop이 아직 옛것이거나 내 저장보다 먼저 읽힌 값이 뒤늦게 내려올 때 이미 정리된 안내가 되살아난다(적대 리뷰 2b N1).
  //    기준 token이 바뀐 렌더에서만 다시 본다: 내 저장이 바꾼 것이면 정리된 것이고, 받아들인 서버 값이면 그 값에서 다시 센다.
  // ⚠️ 표(draft)가 갈아끼워진 횟수로 가리지 않는다 — 다른 곳이 넣은 중복 줄은 표를 바꾸지 않을 수 있다(마지막 줄이 같은 값).
  const [savedToken, setSavedToken] = useState<string>();
  const [notice, setNotice] = useState(() => ({ baseline, cells: ambiguousRoleCells(initial.overrides) }));
  if (notice.baseline !== baseline) {
    setNotice({ baseline, cells: baseline !== undefined && baseline === savedToken ? [] : ambiguousRoleCells(initial.overrides) });
  }
  const ambiguous = notice.cells;
  // '저장 전 변경'의 기준은 **확정 상태**다(서버 prop이 아니다 — 저장 직후엔 prop이 잠깐 옛 값이라 방금 저장한 칸이 변경으로 남는다).
  const savedMatrix = useMemo(() => (JSON.parse(confirmed) as PermissionsDraft).matrix, [confirmed]);
  const changes = MENU_KEYS.flatMap((menu) => SYSTEM_ROLES.flatMap((role) =>
    matrix[menu][role] === savedMatrix[menu][role] ? [] : [{ menu, role, before: savedMatrix[menu][role], after: matrix[menu][role] }],
  ));
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
    const next = nextPermissionAccess(menu, role, matrix[menu][role]);
    if (isPermissionLocked(menu, role, next)) return; // 가드레일 셀은 변경 거부
    setMatrix((m) => ({ ...m, [menu]: { ...m[menu], [role]: next } }));
  }

  // '강사 내 메뉴 표시' 빠른 토글 — 같은 matrix 상태를 편집(별도 저장/필드 없음, 아래 표와 한 폼).
  // 켜기 복원값 = '끄기 직전의 실제 강사 접근값'(세션 중 매트릭스로 바꾼 readonly 등도 보존). 화면을 연 때의 값으로 시작한다.
  // ⚠️ 연 때의 값 고정으로 복원하면 세션 중 매트릭스 편집이 off/on 사이클에 유실됨 → 끄기 시점에 live 값을 캡처.
  // 처음부터 '없음'이던 탭을 켜면 코드 기본값(scoped/full). 끄기=none → 탭 숨김 + 페이지 접근 차단.
  // 서버 값으로 표를 갈아끼우면(`adoptions`) 기억도 그 표로 다시 잡는다 — 옛 표에서 기억한 값을 새 표에 되살리지 않는다.
  // ⚠️ ref가 아니라 state다(렌더 중 ref 갱신 금지) — 갈아끼운 렌더에서 파생한다(effect 안 setState 금지 #25).
  const [restore, setRestore] = useState(() => ({ adoptions, values: teacherAccessOf(matrix) }));
  if (restore.adoptions !== adoptions) setRestore({ adoptions, values: teacherAccessOf(matrix) });
  function setTeacherShown(menu: MenuKey, shown: boolean) {
    if (menu === "teacher_onescreen") return; // 강사 홈 — 항상 표시(ROLE_LOCKED)
    if (!shown) {
      // 끄기 직전의 비-none 값을 기억 → 다시 켤 때 복원(매트릭스로 방금 바꾼 값 유실 방지)
      const current = matrix[menu].teacher;
      if (current !== "none") setRestore((r) => ({ ...r, values: { ...r.values, [menu]: current } }));
      setMatrix((m) => ({ ...m, [menu]: { ...m[menu], teacher: "none" } }));
      return;
    }
    const remembered = restore.values[menu];
    const next: Access = remembered && remembered !== "none" ? remembered : MENU_ACCESS[menu].teacher;
    setMatrix((m) => ({ ...m, [menu]: { ...m[menu], teacher: next } }));
  }

  return (
    <SectionForm
      section="permissions"
      payload={{ overrides, userOverrides, specialAccess }}
      extraFields={{ permissionsBaseline: baseline }}
      onSubmit={noteSubmitted}
      onSaved={(state) => {
        setSavedToken(state.permissions?.token);
        confirmSaved(state.permissions?.token, state.version);
      }}
      onSaveFailed={noteSaveFailed}
      rebaselineNonce={adoptions}
    >
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
          (기본값과 다른 셀 {overrides.length}개). 선생님 원스크린·내 학습은 역할 전용이라 고정이고, 학생 역할과
          원장의 설정·관리자 도구·대시보드 접근은 잠글 수 없습니다. 강사 대시보드는 담당 범위 집계가 없어 비활성화됩니다.
        </p>
        {ambiguous.length ? (
          <p role="status" className="border-amber/30 bg-amber-soft mt-3 rounded-md border px-3 py-2 text-xs leading-relaxed">
            <b>같은 칸이 서로 다른 값으로 여러 번 저장되어 있습니다</b> —{" "}
            {ambiguous.map(({ menu, role }) => `${MENU_LABEL[menu]} · ${ROLE_LABEL[role]}`).join(", ")}. 화면에 따라 다른 값이
            적용될 수 있습니다. 아래 표의 값을 확인한 뒤 저장하면 표의 값 하나로 정리됩니다.
          </p>
        ) : null}
        {changes.length ? (
          <details className="border-amber/30 bg-amber-soft mt-3 rounded-md border px-3 py-2 text-xs">
            <summary className="cursor-pointer font-bold">저장 전 변경 {changes.length}개</summary>
            <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto">
              {changes.map(({ menu, role, before, after }) => <li key={`${menu}:${role}`}>
                {MENU_LABEL[menu]} · {ROLE_LABEL[role]}: {ACCESS_LABEL[before]} → {ACCESS_LABEL[after]}
              </li>)}
            </ul>
          </details>
        ) : null}
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
                    const changed = a !== savedMatrix[menu][role];
                    return (
                      <td key={role} className="px-1.5 py-1.5 text-center">
                        <button
                          type="button"
                          disabled={locked}
                          onClick={() => cycle(menu, role)}
                          title={locked ? "고정" : changed ? `${ACCESS_LABEL[savedMatrix[menu][role]]} → ${ACCESS_LABEL[a]} · 저장 전 변경` : "클릭하여 변경"}
                          className={`w-full min-w-[3rem] rounded px-1.5 py-1 text-xs font-medium transition ${ACCESS_CLS[a]} ${changed ? "ring-2 ring-amber" : ""} ${
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
