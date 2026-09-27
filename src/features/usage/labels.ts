import { MENU_LABEL, SYSTEM_ROLES } from "@/lib/permissions";
import { ROLE_LABEL } from "@/lib/auth/role-hierarchy";
import { SUBTABS_BY_MENU } from "@/lib/navigation";
import { menuKeyOfRoute, routeKeyOf } from "./route-key";
import { splitSegmentKey, subjectGroupLabel } from "./segment";

/**
 * 이용 분석 **표시 말** — 권한·메뉴·화면·시간을 한글로(raw 키 노출 금지 규칙). 순수 함수(Vitest).
 * 🔴 라벨 표를 여기 새로 적지 않는다 — 메뉴 = `MENU_LABEL`, 권한 = `ROLE_LABEL`, 하부 면 = `SUBTABS_BY_MENU`(사이드바와 같은 말).
 */

/**
 * 분석에 나오는 권한 = 학원 시스템 역할. 🔴 슈퍼관리자는 **세지 않는다**(0293a, 원장 2026-09-28 *"슈퍼 관리자는 제외"*) —
 * 필터에도 두지 않는다.
 */
export const USAGE_ROLES = SYSTEM_ROLES;
export type UsageRole = (typeof USAGE_ROLES)[number];

export function isUsageRole(v: string): v is UsageRole {
  return (USAGE_ROLES as readonly string[]).includes(v);
}

export function usageRoleLabel(role: string): string {
  // 0293a 적용 전에 쌓인 슈퍼관리자 행(0293a가 지운다)이 잠깐 보여도 영문 키가 새지 않게.
  if (role === "super_admin") return "슈퍼관리자";
  return (ROLE_LABEL as Record<string, string>)[role] ?? "알 수 없는 권한";
}

/** 사용자 분류(권한 · 강사는 과목) → "원장" · "강사 · 수학" · "강사 · 과목 미지정". */
export function usageSegmentLabel(key: string, labelOf: (subjectKey: string) => string): string {
  const { role, subject } = splitSegmentKey(key);
  const roleLabel = usageRoleLabel(role);
  return subject === null ? roleLabel : `${roleLabel} · ${subjectGroupLabel(subject, labelOf)}`;
}

export function usageMenuLabel(menuKey: string): string {
  return (MENU_LABEL as Record<string, string>)[menuKey] ?? "기타 화면";
}

/** 사이드바 하부 면(주소 → 이름) — 메뉴 첫 화면(하위 칸도 탭도 없는 주소)은 메뉴 이름이 대신한다. */
const SUB_FACE_LABEL: ReadonlyMap<string, string> = new Map(
  Object.values(SUBTABS_BY_MENU)
    .flat()
    .flatMap((t) => {
      if (!t) return [];
      const [path, query = ""] = t.href.split("?");
      const key = routeKeyOf(path, query);
      return key.split("/").length > 2 || key.includes("?") ? [[key, t.label] as const] : [];
    }),
);

/**
 * 화면 식별자 → 사람이 읽는 이름. 하부 면으로 등록된 주소는 그 이름("수납관리 › 회차 확정"),
 * 아니면 메뉴 이름 + 모양("원생목록 › 상세"). 정확한 주소는 화면이 둘째 줄로 따로 보여 준다.
 */
export function routeLabel(routeKey: string): string {
  const menu = usageMenuLabel(menuKeyOfRoute(routeKey));
  const face = SUB_FACE_LABEL.get(routeKey);
  if (face) return `${menu} › ${face}`;
  const q = routeKey.indexOf("?");
  const path = q < 0 ? routeKey : routeKey.slice(0, q);
  const rest = path.split("/").filter(Boolean).slice(1);
  const parts: string[] = [];
  if (rest.includes("[id]")) parts.push("상세");
  else if (rest.includes("[date]")) parts.push("날짜별");
  else if (rest.length > 0) parts.push("하위 화면");
  if (q >= 0) parts.push(routeKey.includes("tab=") ? "탭" : "보기");
  return parts.length > 0 ? `${menu} › ${parts.join(" · ")}` : menu;
}

/** 초 → "45초" · "12분" · "3시간 5분" · "1,204시간". */
export function fmtDuration(sec: number): string {
  if (!Number.isFinite(sec) || sec <= 0) return "0초";
  if (sec < 60) return `${Math.round(sec)}초`;
  const mins = Math.round(sec / 60);
  if (mins < 60) return `${mins}분`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h >= 100 || m === 0) return `${h.toLocaleString("ko-KR")}시간`;
  return `${h}시간 ${m}분`;
}

/** 활동률 = 활동 ÷ 화면 — 화면 시간이 없으면 표시하지 않는다. */
export function fmtRatio(part: number, whole: number): string {
  if (whole <= 0) return "—";
  return `${Math.round((part / whole) * 100)}%`;
}

