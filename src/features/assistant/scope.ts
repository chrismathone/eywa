/**
 * 학원 비서 권한 범위(원장 2026-11-12 *"각 역할에 맞는 답변만 출력되게(허용된 권한 이내에서)"* · Codex 합의 A+A′).
 * - 묻는 사람의 메뉴 권한 → **허용 묶음 키**(`scopeKeysFor`). 원장 역할·운영 계정 = `master` 하나(전부 본다 — 11-06 결정 그대로).
 * - 표 → 묶음 대응표는 **DB가 원본**(`assistant_private.scope_tables`·`scope_columns` — s2_0096). 앱은 질문마다 그 표를 읽어
 *   보기 목록·표 구조를 거르고(executor), DB는 같은 표로 보기 조건을 건다 — 둘이 어긋나도 DB가 막는다.
 * - 🔴 대응표에 없는 표 = 원장만. 🔴 '담당'(scoped)은 닫는다 · 전체·읽기여도 앱이 그 역할에게 행을 좁혀 보이는 메뉴는 그 역할을 뺀다(`roles`).
 * 묶음 규칙(키 → 메뉴·역할)은 여기 한 곳이다 — 새 묶음 키를 SQL에 쓰면 여기에도(가드 scope-map.test.ts).
 */
import type { Access, MenuKey, SystemRole } from "@/lib/permissions";
import { SCOPE_GROUPS } from "./scope-groups";

export { SCOPE_GROUPS };
export const MASTER_SCOPE = "master";
/** 급여명세서 지정 열람(학원 설정 → 역할·권한의 사람 지정 · 원장 역할은 지정 없이 통과) — 급여 정책 권한과는 다른 묶음(Codex 합의 5). */
export const PAYSLIP_SCOPE = "payslip";

export type ScopeGroup = {
  key: string;
  /** 거절 안내('○○ 권한이 필요합니다')에 쓰는 이름 — 권한 표의 메뉴 이름. */
  label: string;
  /** 이 중 하나라도 '전체' 또는 '읽기'면 연다('담당'·'없음'은 닫는다). */
  menus: readonly MenuKey[];
  /** 그 메뉴에서 학원 전체 행을 보는 역할만 — 앱이 본인·담당·과목으로 좁혀 보이는 역할은 넣지 않는다. */
  roles: readonly SystemRole[];
};

export type ScopeContext = {
  role: SystemRole;
  /** 원장 역할 또는 운영 계정. */
  master: boolean;
  access: (menu: MenuKey) => Access;
  /** 급여명세서 지정 열람자. */
  payslipViewer: boolean;
};

const OPEN: ReadonlySet<Access> = new Set<Access>(["full", "readonly"]);

/** 메뉴 판정에 쓰는 메뉴 전부(서버가 권한을 한 번에 읽는다). */
export const SCOPE_MENUS: readonly MenuKey[] = [...new Set(SCOPE_GROUPS.flatMap((g) => g.menus))];

export function scopeKeysFor(ctx: ScopeContext): string[] {
  if (ctx.master) return [MASTER_SCOPE];
  const keys = new Set<string>();
  for (const g of SCOPE_GROUPS) {
    if (!g.roles.includes(ctx.role)) continue;
    if (g.menus.some((m) => OPEN.has(ctx.access(m)))) keys.add(g.key);
  }
  if (ctx.payslipViewer) keys.add(PAYSLIP_SCOPE);
  return [...keys].sort();
}

export const hasScope = (keys: readonly string[], key: string): boolean => keys.includes(MASTER_SCOPE) || keys.includes(key);

/** DB 대응표(public.assistant_scope_map). */
export type ScopeMap = {
  tables: ReadonlyMap<string, string>;
  columns: ReadonlyArray<{ table: string; column: string; key: string }>;
};

/**
 * onto_* 보기 → 원본 표(SQL create_ontology_views가 읽는 assistant 보기). DB는 원본 보기를 거쳐 상속하고, 앱은 원본이 모두 열릴 때만 보인다.
 * 🔴 onto 보기가 읽는 원본을 바꾸면(s2_0039~0041 계열) 여기도 — 빠지면 원본 하나가 막혀도 보기가 목록에 떠 0행이 '없음'으로 읽힌다.
 */
export const ONTO_SOURCES: Readonly<Record<string, readonly string[]>> = {
  onto_students: ["students", "enrollments"],
  onto_enrollments: ["classes", "enrollments"],
  onto_attendance: ["attendance_records"],
  onto_class_teachers: ["class_delegations", "class_schedules", "classes"],
  onto_classes: ["classes", "tenant_settings"],
  onto_homeroom_history: ["audit_logs", "classes"],
  onto_siblings: ["student_siblings", "students"],
  onto_households: ["onto_siblings"],
  onto_tuition_months: ["classes", "enrollments", "invoices", "onto_students"],
  onto_teacher_churn: ["teacher_portfolio_months", "users"],
};

/** onto 보기의 원본을 끝까지 펼친 표 이름(onto가 onto를 읽는 경우 포함 · 순환 방지). */
function baseTables(view: string, seen: Set<string> = new Set()): string[] {
  const sources = ONTO_SOURCES[view];
  if (!sources) return [view];
  if (seen.has(view)) return [];
  seen.add(view);
  return sources.flatMap((s) => baseTables(s, seen));
}

/** 이 보기를 읽는 데 필요한 묶음 키(onto는 원본들의 키 · 대응표에 없으면 원장). */
export function viewKeys(view: string, map: ScopeMap): string[] {
  return [...new Set(baseTables(view).map((t) => map.tables.get(t) ?? MASTER_SCOPE))].sort();
}

export function viewAllowed(view: string, keys: readonly string[], map: ScopeMap): boolean {
  return viewKeys(view, map).every((k) => hasScope(keys, k));
}

/** 묶음 키 → 거절 안내 이름. */
export function scopeLabel(key: string): string {
  if (key === MASTER_SCOPE) return "원장";
  if (key === PAYSLIP_SCOPE) return "급여명세서 열람";
  return SCOPE_GROUPS.find((g) => g.key === key)?.label ?? "원장";
}

/** 거절 안내 — 막힌 키 중 첫 것의 이름으로(숨긴 표 이름·건수는 말하지 않는다 · Codex 합의 7). */
export function deniedMessage(missing: readonly string[]): string {
  const key = missing[0] ?? MASTER_SCOPE;
  return key === MASTER_SCOPE ? "원장만 볼 수 있는 자료입니다" : `'${scopeLabel(key)}' 권한이 있어야 볼 수 있는 자료입니다`;
}

/**
 * 이 표들을 쓴 답에 필요한 묶음 키(저장 표지) — 표의 키 + 조회문이 이름으로 쓴 칸(`columns` · `*`은 그 표의 가린 칸 전부)의 칸 키
 * (`viewerKeys`를 주면 묻는 사람이 실제로 받은 칸 키만).
 * 칸 이름은 표 구분 없이 견준다(넉넉하게 — 다른 표의 같은 이름 칸이어도 넣는다 · 적대 리뷰 2026-11-12: 표 키만 남기면 급여 칸을 읽은 답이
 * 급여 권한을 거둔 뒤에도 보이고, 밤 재측정 증표가 그 칸을 null로 가렸다).
 */
export function requiredKeys(views: Iterable<string>, map: ScopeMap, columns: Iterable<string> = [], viewerKeys?: readonly string[]): string[] {
  const out = new Set<string>();
  const tables = new Set<string>();
  for (const v of views) {
    for (const k of viewKeys(v, map)) out.add(k);
    for (const t of baseTables(v)) tables.add(t);
  }
  const used = new Set(columns);
  // 묻는 사람이 볼 수 없던 칸은 DB가 null로 줬다 — 답에 그 자료가 없으니 표지에 넣지 않는다(넣으면 자기 답이 다시 열 때 사라진다 · 재리뷰 2026-11-12).
  for (const c of map.columns) {
    if (!tables.has(c.table) || !(used.has(c.column) || used.has("*"))) continue;
    if (viewerKeys && !hasScope(viewerKeys, c.key)) continue;
    out.add(c.key);
  }
  return [...out].sort();
}

/** 이 표들에서 지금 범위가 가린 칸 중 조회문이 이름으로 쓴 것(`*` 포함) — 확인 지표는 가린 칸으로 재지 않는다(null을 0으로 세지 않게). */
export function hiddenColumnsUsed(tables: Iterable<string>, columns: Iterable<string>, hidden: (table: string) => ReadonlySet<string>): string[] {
  const used = new Set(columns);
  const hits = new Set<string>();
  for (const t of tables) for (const c of hidden(t)) if (used.has(c) || used.has("*")) hits.add(c);
  return [...hits].sort();
}

/**
 * 저장한 답·의견을 지금 이 사람이 볼 수 있나 — 표지가 없는 옛 기록(null)은 원장만(Codex 합의 9).
 * 빈 배열 = 자료를 읽지 않은 답(누구나).
 */
export function covers(viewerKeys: readonly string[], required: readonly string[] | null | undefined): boolean {
  if (viewerKeys.includes(MASTER_SCOPE)) return true;
  if (!required) return false;
  return required.every((k) => hasScope(viewerKeys, k));
}
