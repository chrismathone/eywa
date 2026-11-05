import { z } from "zod";
import { MENU_ACCESS } from "@/lib/permissions";

const idsSchema = z.array(z.string().uuid()).max(80);
const record = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** Only raw absence means legacy. Invalid explicit values revoke access. */
export function studentStatusManagerIds(special: unknown): string[] | undefined {
  if (special === undefined) return undefined;
  if (!record(special)) return [];
  if (!Object.hasOwn(special, "studentStatusManagerIds") || special.studentStatusManagerIds === undefined) return undefined;
  const parsed = idsSchema.safeParse(special.studentStatusManagerIds);
  return parsed.success && new Set(parsed.data).size === parsed.data.length ? [...parsed.data] : [];
}

/**
 * 옛 방식(담당자 미지정)에서 원생 상태 변경을 하는 역할 — 사무실 역할 ∧ (원생 메뉴 '전체' 또는 관리자 도구 '전체')
 * (DB `student_status_private.allowed` · 앱 [`canManageStudentStatus`](@/features/students/status-access)). 원장은 언제나 하므로 뺀다.
 * 🔴 DB 트리거(s2_0025 `student_status_private.guard_settings`)가 같은 목록·같은 기본값을 들고 있다(가드: 시험).
 */
export const LEGACY_STATUS_ROLES = ["admin", "manager", "counselor", "accountant"] as const;
/** 옛 방식에서 상태 변경 자격을 주는 메뉴 — DB `allowed()`가 `menu('students')='full' or menu('admin')='full'`을 본다. */
export const LEGACY_STATUS_MENUS = ["students", "admin"] as const;

type Row = Record<string, unknown>;
/**
 * 조건에 맞는 **마지막 줄**의 권한 값(없거나 값이 비면 null) — DB `student_status_private.menu`(`order by n desc limit 1`) ·
 * 앱 권한 해석과 같은 '마지막 줄이 이긴다'. 값은 글자로 본다(DB의 `->>`처럼).
 */
function lastAccess(rows: unknown, pick: (r: Row) => boolean): string | null {
  const list = (Array.isArray(rows) ? rows : []).filter((r): r is Row => record(r) && pick(r));
  const value = list.at(-1)?.access;
  return value === undefined || value === null ? null : typeof value === "string" ? value : JSON.stringify(value);
}

/**
 * 옛 방식에서 이 저장이 **원생 상태 변경 권한을 넓히는가** — 넓히면 먼저 담당자를 지정하게 한다(조용히 남에게 퇴원·휴원 권한이 생기지 않게).
 *
 * 원장 2026-11-05 *"원생목록 '읽기'에 굳이 그럴 필요가있어?"* — 전에는 원생 메뉴 줄이 **조금만 바뀌어도** 막았다(아르바이트에게 '읽기'를 줘도).
 * 상태 변경 자격은 사무실 역할 ∧ (원생 '전체' ∨ 관리자 도구 '전체')에서만 생기므로, 앞뒤 **실효값**(개인 예외 마지막 줄 → 역할 칸 마지막 줄
 * → 코드 기본값 — DB `student_status_private.menu`와 같은 순서)을 비교해 넓어질 때만 막는다. 같은 줄을 그대로 두면 절대 막지 않는다.
 *  · 역할 칸 — 사무실 역할(`LEGACY_STATUS_ROLES`)이 원생·관리자 도구 어느 쪽으로도 '전체'가 아니었는데 '전체'가 된다(줄을 지워 기본값 '전체'로 돌아가는 것 포함).
 *  · 개인 예외 — 누군가의 실효값이 '전체'가 되거나, '전체'가 아닌 제한이 사라진다(역할 칸으로 돌아가 '전체'일 수 있다).
 *    개인 줄은 그 사람의 역할을 여기서 모르므로 넓게 본다(강사에게 '전체'를 줘도 막는다 — 드문 일이고 막는 쪽이 안전하다).
 */
export function studentStatusRefreshRequired(input: unknown, previous: unknown): boolean {
  const sent = record(input) ? input : {};
  const stored = record(previous) ? previous : {};
  if (record(sent.specialAccess) && Object.hasOwn(sent.specialAccess, "studentStatusManagerIds")) return false;
  if (studentStatusManagerIds(stored.specialAccess) !== undefined) return false;
  // 요청에 없는 칸은 저장값 그대로 간다(`prepareSectionForSave`) — 앞뒤가 같다.
  const next = (key: string) => (Object.hasOwn(sent, key) ? sent[key] : stored[key]);

  const roleFull = (rows: unknown, role: (typeof LEGACY_STATUS_ROLES)[number]) =>
    LEGACY_STATUS_MENUS.some((menu) => (lastAccess(rows, (r) => r.menu === menu && r.role === role) ?? MENU_ACCESS[menu][role]) === "full");
  for (const role of LEGACY_STATUS_ROLES) {
    if (roleFull(next("overrides"), role) && !roleFull(stored.overrides, role)) return true;
  }

  const before = stored.userOverrides;
  const after = next("userOverrides");
  const ids = new Set(
    [before, after].flatMap((rows) => (Array.isArray(rows) ? rows : []))
      .filter((r): r is Row => record(r) && (LEGACY_STATUS_MENUS as readonly unknown[]).includes(r.menu) && typeof r.userId === "string")
      .map((r) => r.userId as string),
  );
  for (const id of ids) {
    for (const menu of LEGACY_STATUS_MENUS) {
      const b = lastAccess(before, (r) => r.menu === menu && r.userId === id);
      const a = lastAccess(after, (r) => r.menu === menu && r.userId === id);
      if (a === "full" && b !== "full") return true;
      if (a === null && b !== null && b !== "full") return true;
    }
  }
  return false;
}
