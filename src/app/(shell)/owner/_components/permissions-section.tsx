"use client";

import { useMemo, useState } from "react";
import { cycleSkipsScoped, nextPermissionAccess, sparseRoleOverrides } from "@/features/owner/permission-edit";
import { editablePermissionRowGroups, type PermissionNavigation } from "@/features/owner/permission-rows";
import { TEACHER_TOGGLE_KEYS, teacherToggleOnAccess } from "@/features/owner/teacher-toggle-rows";
import { SETTINGS_ROLE_KEYS, type SettingsRoleKey } from "@/lib/settings-role-catalog";
import { ambiguousRoleCells } from "@/features/owner/permissions-canonical";
import { effectivePayslipManagerIds } from "@/features/owner/payslip-permissions";
import type { PermissionsSettings } from "@/features/owner/settings-types";
import {
  MENU_KEYS,
  MENU_LABEL,
  SCOPED_FORBIDDEN_MESSAGE,
  SYSTEM_ROLES,
  isConnectedAppMenu,
  isPermissionLocked,
  resolveMatrix,
  type Access,
  type AccessMatrix,
  type MenuKey,
  type SystemRole,
  type UserPermissionOverride,
} from "@/lib/permissions";
import { ACCESS_LABEL, ROLE_LABEL } from "./permission-ui";
import { ConnectedAppPermissionsCard, type ConnectedAppPermissionRow } from "./connected-app-permissions-card";
import { RoleMatrixTable } from "./role-matrix-table";
import { SectionForm } from "./section-form";
import { SettingsCard } from "./settings-card";
import { SpecialAccessEditor } from "./special-access-editor";
import { TeacherMenuToggles } from "./teacher-menu-toggles";
import { UserOverrideEditor } from "./user-override-editor";
import { useSectionDraft } from "./use-section-draft";

/** 숨길 메뉴 줄이 없을 때의 기본값 — 렌더마다 새 배열을 만들면 줄 목록 계산이 매번 다시 돈다. */
const NO_MENU_KEYS: readonly MenuKey[] = [];

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
  specialAccess: { ...p.specialAccess, payslipManagerIds: effectivePayslipManagerIds(p.specialAccess) },
});
const teacherAccessOf = (matrix: AccessMatrix) =>
  Object.fromEntries(TEACHER_TOGGLE_KEYS.map((k) => [k, matrix[k].teacher])) as Record<string, Access>;

/**
 * 역할·권한 면 — 강사 메뉴 표시, 역할별 메뉴 권한, 설정별 역할 권한, 개인별 메뉴·기능 권한.
 * 모든 구획이 한 폼이다. 설정 권한도 같은 draft와 저장 기준을 사용한다.
 */
export function PermissionsSection({
  initial,
  navigation,
  userOverrideNames = {},
  staffOptions = [],
  hiddenUserIds = [],
  generic = false,
  hiddenSettingKeys = [],
  hiddenMenuKeys = NO_MENU_KEYS,
  connectedApps = [],
  baselineToken,
  baselineVersion,
}: {
  /** 서버가 **방금 읽은** 역할·권한(page.tsx) — 설정 캐시의 값이 아니다. */
  initial: PermissionsSettings;
  /** 학원의 '탭 및 메뉴 구성' — 표의 줄 · '내 메뉴' 칸이 이 차례와 이름으로 선다. 없으면 기본 구성. */
  navigation?: PermissionNavigation;
  /** 개인 예외 표시용 userId→이름(서버에서 해석). 이름 없는 id는 축약 id로 표시. */
  userOverrideNames?: Record<string, string>;
  staffOptions?: { id: string; name: string; role: string }[];
  hiddenUserIds?: string[];
  generic?: boolean;
  hiddenSettingKeys?: readonly SettingsRoleKey[];
  /** 이 지점에서 꺼진 기능의 메뉴 줄(지점 AI가 꺼지면 학원 비서) — 표 · 개인별 메뉴 권한 고르기에 세우지 않는다(저장값은 그대로 실린다). */
  hiddenMenuKeys?: readonly MenuKey[];
  /** 이 지점에서 켠 연결 앱 — 역할별 표 아래 '연결 앱 권한' 표의 줄(없으면 카드도 없다). */
  connectedApps?: readonly ConnectedAppPermissionRow[];
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
  const overrides = useMemo(() => sparseRoleOverrides(matrix), [matrix]);
  const groups = useMemo(
    () =>
      editablePermissionRowGroups(navigation, { generic })
        .map((group) => ({ ...group, rows: group.rows.filter((row) => !hiddenMenuKeys.includes(row.menu)) }))
        .filter((group) => group.rows.length > 0),
    [navigation, generic, hiddenMenuKeys],
  );
  const isSetting = (menu: MenuKey) => (SETTINGS_ROLE_KEYS as readonly string[]).includes(menu);
  const menuGroups = groups.map((group) => ({ ...group, rows: group.rows.filter((row) => !isSetting(row.menu)) })).filter((group) => group.rows.length > 0);
  const settingGroups = [{
    id: "settings-roles", label: "설정별 역할 권한", hiddenInMenu: false,
    rows: SETTINGS_ROLE_KEYS.filter((menu) => !hiddenSettingKeys.includes(menu)).map((menu) => ({
      menu, label: MENU_LABEL[menu], covers: [], hiddenInMenu: false, inner: false,
    })),
  }];
  const individualGroups = [...menuGroups, ...settingGroups];
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
  // 표에 선 차례대로 적고(왼쪽 탭 → 내부 메뉴), **표에 없는 줄의 변경도 뒤에 붙인다** — 감춘 메뉴의 강사 칸은 위 '내 메뉴' 표시로 바뀐다.
  const shownMenus = groups.flatMap((g) => g.rows.map((r) => r.menu));
  // 연결 앱 칸은 아래 '연결 앱 권한' 카드가 제 제목 줄에 센다 — 역할별 카드의 수에 섞지 않는다(리뷰 2026-11-05). 저장은 그대로 한 번에 실린다.
  const changes = [...shownMenus, ...MENU_KEYS.filter((menu) => !shownMenus.includes(menu) && !isConnectedAppMenu(menu))].flatMap((menu) => SYSTEM_ROLES.flatMap((role) =>
    matrix[menu][role] === savedMatrix[menu][role] ? [] : [{ menu, role, before: savedMatrix[menu][role], after: matrix[menu][role] }],
  ));
  const staffName = (id: string) => staffOptions.find((s) => s.id === id)?.name || userOverrideNames[id] || `${id.slice(0, 8)}…`;

  // 강사보다 낮은 직급(열람·아르바이트) 칸에서 '담당'을 건너뛰었으면 그 칸과 까닭을 알린다 — 말없이 건너뛰지 않는다
  // (원장 2026-11-05 *"무조건적으로 안되게하지말고 알림메시지도 배선"*). 다른 칸을 누르거나 닫기·저장하면 사라진다.
  // 서버 값으로 표를 갈아끼우면(`adoptions`) 그 안내는 이미 지난 표의 것이라 함께 지운다(렌더에서 파생 — effect 안 setState 금지).
  const [skipState, setScopedSkip] = useState<{ menu: MenuKey; role: SystemRole; to: Access; adoptions: number } | null>(null);
  const scopedSkip = skipState && skipState.adoptions === adoptions ? skipState : null;
  function cycle(menu: MenuKey, role: SystemRole) {
    const current = matrix[menu][role];
    const next = nextPermissionAccess(menu, role, current);
    if (isPermissionLocked(menu, role, next)) return; // 가드레일 셀은 변경 거부
    setScopedSkip(cycleSkipsScoped(menu, role, current) ? { menu, role, to: next, adoptions } : null);
    setMatrix((m) => ({ ...m, [menu]: { ...m[menu], [role]: next } }));
  }
  /**
   * 이 표(카드)의 칸에서 건너뛴 것만 그 표 **아래**에 — 메뉴 표와 설정 표가 같은 `cycle`을 쓴다.
   * 🔴 표 위에 두면 표가 길어(메뉴 표 30여 줄) 아래쪽 줄을 누를 때 안내가 화면 밖에 떠 결국 '말없이 건너뜀'이 됐다(리뷰 2026-11-05).
   *    표 아래에 두고 창 아래(저장 줄 바로 위 — `bottom-16`)에 붙인다: 표 어디를 누르든 보이고, 표 위 칸을 밀어내지 않는다.
   *    바탕은 불투명(표를 덮는다) · 닫기 단추로 치울 수 있다(덮인 줄을 누르려면). 닫으면 단추가 사라지므로 초점을 안내를 띄운 칸으로
   *    돌려준다(문서 맨 처음이나 표 밖으로 빠지지 않게 — 재리뷰 2026-11-05). 그 칸을 못 찾으면 안내 자리로.
   * ⚠️ 알림 자리(`aria-live`)는 **늘 붙여 두고 글만 바꾼다** — 내용과 함께 새로 끼우면 화면낭독기가 읽지 않는 경우가 있다.
   *    `role="status"` 대신 `aria-live`인 까닭: 늘 붙어 있는 빈 status 요소가 이 면의 다른 안내(같은 칸 중복 — role=status)와 섞인다.
   */
  const scopedSkipNotice = (cardGroups: readonly { rows: readonly { menu: MenuKey }[] }[]) => {
    const shown = scopedSkip && cardGroups.some((g) => g.rows.some((r) => r.menu === scopedSkip.menu)) ? scopedSkip : null;
    return (
      <div data-scoped-skip-notice="" tabIndex={-1} className="sticky bottom-16 z-20 outline-none">
        <div className={shown ? "bg-card mt-3 rounded-md shadow-[0_4px_14px_-4px_rgba(29,29,31,0.25)]" : undefined}>
          <div className={shown ? "border-amber/30 bg-amber-soft flex items-start gap-2 rounded-md border px-3 py-2" : undefined}>
            <p aria-live="polite" aria-atomic="true" className="min-w-0 flex-1 text-xs leading-relaxed">
              {shown ? <>
                <b>{MENU_LABEL[shown.menu]} · {ROLE_LABEL[shown.role]}: ‘담당’을 건너뛰고 ‘{ACCESS_LABEL[shown.to]}’{shown.to === "none" ? "으로" : "로"} 바꿨습니다.</b>{" "}
                {SCOPED_FORBIDDEN_MESSAGE}
              </> : null}
            </p>
            {shown ? (
              <button type="button" onClick={(e) => {
                const cell = e.currentTarget.closest("section")?.querySelector<HTMLElement>(`[data-perm-cell="${shown.menu}:${shown.role}"]`);
                (cell ?? e.currentTarget.closest<HTMLElement>("[data-scoped-skip-notice]"))?.focus();
                setScopedSkip(null);
              }} aria-label="안내 닫기" title="닫기"
                className="text-text-dim hover:text-foreground -my-0.5 flex size-6 shrink-0 items-center justify-center rounded text-sm leading-none">×</button>
            ) : null}
          </div>
        </div>
      </div>
    );
  };

  // '강사 내 메뉴 표시' 빠른 토글 — 같은 matrix 상태를 편집(별도 저장/필드 없음, 아래 표와 한 폼).
  // 켜기 복원값 = '끄기 직전의 실제 강사 접근값'(세션 중 매트릭스로 바꾼 readonly 등도 보존). 화면을 연 때의 값으로 시작한다.
  // ⚠️ 연 때의 값 고정으로 복원하면 세션 중 매트릭스 편집이 off/on 사이클에 유실됨 → 끄기 시점에 live 값을 캡처.
  // 처음부터 '없음'이던 탭을 켜면 코드 기본값(기본값도 '없음'인 전자결재·직원 평가는 담당 — teacherToggleOnAccess). 끄기=none → 탭 숨김 + 페이지 접근 차단.
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
    const next: Access = remembered && remembered !== "none" ? remembered : teacherToggleOnAccess(menu);
    setMatrix((m) => ({ ...m, [menu]: { ...m[menu], teacher: next } }));
  }

  return (
    <SectionForm
      section="permissions"
      payload={{ overrides, userOverrides, specialAccess }}
      extraFields={{ permissionsBaseline: baseline }}
      onSubmit={noteSubmitted}
      onSaved={(state) => {
        setScopedSkip(null);
        setSavedToken(state.permissions?.token);
        confirmSaved(state.permissions?.token, state.version);
      }}
      onSaveFailed={noteSaveFailed}
      rebaselineNonce={adoptions}
    >
      <>
        <TeacherMenuToggles matrix={matrix} navigation={navigation} onToggle={setTeacherShown} />
        <SettingsCard
          title="역할별 메뉴 권한"
          // 접고 펼친다(원장 2026-11-05 *"역할별하고 연동앱 권한도 접기 펼치기"*) — 처음엔 지금처럼 펼친 채, 접어도 안의 값은 그대로 저장에 실린다.
          collapsible
          defaultOpen
          // 접어 둬도 저장하지 않은 칸이 있는지 보이게(안쪽 '저장 전 변경' 목록과 같은 수 · 문구는 겹치지 않게).
          summary={changes.length ? `저장하지 않은 칸 ${changes.length}개` : undefined}
        >
          <div className="space-y-3">
          {/* 설명은 접는 제목 줄이 아니라 본문에 둔다 — 제목 줄 안의 글자를 누르면 카드가 접히고, 화면 낭독기가 설명 전체를 단추 이름으로 읽는다. */}
          <p className="text-text-dim text-xs">
            셀을 클릭하면 <b>전체 → 담당 → 읽기 → 없음</b> 순으로 바뀝니다. 기본값과 다른 셀만 저장됩니다
            (기본값과 다른 셀 {overrides.filter((o) => !isConnectedAppMenu(o.menu)).length}개). 강사뷰 접근은 <b>전체 → 읽기 → 없음</b>만 사용합니다. 강사보다 낮은 직급(열람·아르바이트)도{" "}
            <b>전체 → 읽기 → 없음</b>만 씁니다(맡은 반이 없어 ‘담당’이 ‘전체’처럼 열리므로 ‘담당’을 건너뜁니다). 줄은 <b>탭 및 메뉴 구성에서 쓰는 메뉴</b>가 <b>왼쪽 탭과 그 안의 메뉴 차례</b>대로 서 있습니다(구성에서 감춘 메뉴는 표에 없고 — 강사 ‘내 메뉴’에 보이면 ‘관리자뷰에서 감춤’으로 남습니다 — 구성을 바꾸면
            함께 바뀝니다). 선생님 원스크린·내 학습은 강사·학생 전용 화면이라 표에 없고, 학생 역할과 원장의 설정·대시보드 접근은
            잠글 수 없습니다. 강사 대시보드는 담당 범위 집계가 없어 비활성화됩니다.
          </p>
          {ambiguous.length ? (
            <p role="status" className="border-amber/30 bg-amber-soft rounded-md border px-3 py-2 text-xs leading-relaxed">
              <b>같은 칸이 서로 다른 값으로 여러 번 저장되어 있습니다</b> —{" "}
              {ambiguous.map(({ menu, role }) => `${MENU_LABEL[menu]} · ${ROLE_LABEL[role]}`).join(", ")}. 화면에 따라 다른 값이
              적용될 수 있습니다. 아래 표의 값을 확인한 뒤 저장하면 표의 값 하나로 정리됩니다.
            </p>
          ) : null}
          {changes.length ? (
            <details className="border-amber/30 bg-amber-soft rounded-md border px-3 py-2 text-xs">
              <summary className="cursor-pointer font-bold">저장 전 변경 {changes.length}개</summary>
              <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto">
                {changes.map(({ menu, role, before, after }) => <li key={`${menu}:${role}`}>
                  {MENU_LABEL[menu]} · {ROLE_LABEL[role]}: {ACCESS_LABEL[before]} → {ACCESS_LABEL[after]}
                </li>)}
              </ul>
            </details>
          ) : null}
          <RoleMatrixTable groups={menuGroups} matrix={matrix} savedMatrix={savedMatrix} onCycle={cycle} />
          </div>
          {scopedSkipNotice(menuGroups)}
        </SettingsCard>
        <ConnectedAppPermissionsCard apps={connectedApps} matrix={matrix} savedMatrix={savedMatrix} onCycle={cycle} />
        <SettingsCard
          title="설정별 역할 권한"
          description="각 메뉴에 있던 ‘역할 설정’을 여기에서 관리합니다. 기존 권한은 그대로 유지되며, 메뉴·개인 권한과 함께 저장됩니다."
        >
          <RoleMatrixTable groups={settingGroups} matrix={matrix} savedMatrix={savedMatrix} onCycle={cycle} />
          {scopedSkipNotice(settingGroups)}
        </SettingsCard>
        <UserOverrideEditor
          overrides={userOverrides}
          roleMatrix={matrix}
          hiddenUserIds={hiddenUserIds}
          staffOptions={staffOptions}
          nameOf={staffName}
          groups={individualGroups}
          onChange={(next) => setDraft((d) => ({ ...d, userOverrides: next(d.userOverrides) }))}
        />
        <SpecialAccessEditor
          value={specialAccess}
          hiddenUserIds={hiddenUserIds}
          staffOptions={staffOptions}
          nameOf={staffName}
          onChange={(next) => setDraft((d) => ({ ...d, specialAccess: next(d.specialAccess) }))}
        />
      </>
    </SectionForm>
  );
}
