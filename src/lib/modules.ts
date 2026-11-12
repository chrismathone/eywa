/**
 * 기능 묶음(모듈) — 학원마다 **통째로 켜고 끄는** 단위. 원장 2026-09-22 방향 B(*"'침산'은 그대로 두고 …
 * 앞으로 시작하는 지점만 일반화"*)의 뼈대다.
 *
 * 세 층을 섞지 않는다:
 *  - **모듈**(여기) = 이 학원에 그 기능이 *있나 없나*. 꺼지면 메뉴·페이지·대시보드 카드·서버 액션이 함께 닫힌다.
 *  - **권한**(permissions.ts) = 있는 기능을 *누가* 쓰나.
 *  - **왼쪽 탭**(menu-layout.ts) = 보이는 입구를 *어디에·어떤 순서로* 두나.
 *
 * 🔴 꺼진 모듈의 메뉴는 권한 매트릭스 **맨 끝**에서 전원 `none`이 된다(perm-matrix.ts `capDisabledModules`) —
 *    원장 override·개인 예외·super_admin 병합으로도 열리지 않는다(기능이 없는 학원이다).
 * 🔴 저장은 `tenant_settings.data.modules.disabled`(끈 것만) + 저장 당시 목록 `known`. 침산은 `known`을 무시해
 *    빈 목록 = 전부 켜짐(오늘과 같다), 일반판은 저장 뒤 추가된 모듈도 끈 것으로 푼다.
 * ⚠️ 순수 상수 모듈 — 서버·클라가 같이 import한다(`server-only` 금지, #61·#81).
 */
import type { Access, AccessMatrix, MenuKey, SystemRole } from "@/lib/permissions";
import {
  MODULE_BASELINE_V1,
  MODULE_IDS,
  effectiveDisabledModulesFromStored,
  knownModulesFromStored,
  normalizeKnownModuleIds,
  normalizeModuleIds,
} from "@/lib/module-state.mjs";

export {
  MODULE_BASELINE_V1,
  MODULE_IDS,
  effectiveDisabledModulesFromStored,
  knownModulesFromStored,
  normalizeKnownModuleIds,
};
export type ModuleId = (typeof MODULE_IDS)[number];

export type ModuleDef = {
  id: ModuleId;
  /** 설정 화면 이름(한국어). */
  label: string;
  /** 한 줄 설명 — 켜면 무엇이 생기는지. */
  description: string;
  /** 이 모듈이 꺼지면 권한이 `none`이 되는 메뉴키. 메뉴 없이 화면 일부만 가진 모듈은 빈 배열. */
  menuKeys: readonly MenuKey[];
};

export const MODULES: Readonly<Record<ModuleId, ModuleDef>> = {
  makeups: {
    id: "makeups",
    label: "보강관리",
    description: "보강 접수·예정 회차·실시 검토와 미처리 업무 관리",
    menuKeys: ["makeups"],
  },
  ecs: {
    id: "ecs",
    label: "영어 강사 시트",
    description: "영어 반의 주간 수업계획·출결 시트와 월간 계획서",
    menuKeys: ["ecs", "student_english_name"],
  },
  mcs: {
    id: "mcs",
    label: "수학 강사 시트",
    description: "학생별 수학 진도표·월간 목표·진도맵",
    menuKeys: ["mcs"],
  },
  seat_attendance: {
    id: "seat_attendance",
    label: "자습실(자리) 출석부",
    description: "랩실·JJ실처럼 여러 반이 함께 앉는 자리의 출석부와 공개 PIN 화면",
    menuKeys: ["seat_attendance"],
  },
  textbooks: {
    id: "textbooks",
    label: "교재목록(차수 기입)",
    description: "교재·차수별 진도를 강사 시트에 자동으로 채우는 교재 마스터",
    menuKeys: ["textbooks"],
  },
  shuttle: {
    id: "shuttle",
    label: "셔틀",
    description: "차량·노선 편성과 오늘 등하원 기록",
    // 셔틀 관리자 화면(2026-11-10 권한 키)도 함께 꺼진다 — 셔틀 권한 위 조건이라 셔틀 없이는 뜻이 없다.
    menuKeys: ["shuttle", "shuttle_admin"],
  },
  inventory: {
    id: "inventory",
    label: "재고관리",
    description: "자산·대여·실사·소모품 대장과 자산 QR",
    menuKeys: ["inventory"],
  },
  kiosk: {
    id: "kiosk",
    label: "출석 키오스크",
    description: "현관 태블릿으로 학생이 스스로 등하원 체크",
    menuKeys: ["kiosk_settings"],
  },
  newcomers: {
    id: "newcomers",
    label: "신규생 관리",
    description: "등록 후 90일 체크리스트(사전 콜·첫 수업 안내·만족도 콜)",
    menuKeys: ["newcomers"],
  },
  retention: {
    id: "retention",
    label: "이탈 방어",
    description: "재원생 위험 신호와 재등록 캠페인",
    menuKeys: ["retention"],
  },
  approvals: {
    id: "approvals",
    label: "전자결재",
    description: "휴가·품의·지출·수입 결의서 결재선",
    menuKeys: ["approvals"],
  },
  class_review: {
    id: "class_review",
    label: "직원 평가",
    description: "수업 참관 체크리스트와 강사 자기 평가",
    menuKeys: ["class_review"],
  },
  calendar: {
    id: "calendar",
    label: "학원 캘린더",
    description: "학원 공용 일정과 레벨테스트 일정",
    menuKeys: ["calendar"],
  },
  classnote: {
    id: "classnote",
    label: "클래스노트",
    description: "수업보고서의 클래스노트 탭: 발송 큐·반 구성·공지·직접 발송·회수·학부모 글·답글 연동",
    menuKeys: [],
  },
  makeedu: {
    id: "makeedu",
    label: "makeedu 연동",
    description: "makeedu에서 학생·반·청구·상담을 가져오는 동기화 PC 연동",
    menuKeys: ["integrations"],
  },
  sheet_sync: {
    id: "sheet_sync",
    label: "구글 시트 시간표 연동",
    description: "구글 시트로 시간표를 내보내고 가져오기",
    menuKeys: ["sheet_sync"],
  },
  eie: {
    id: "eie",
    label: "EiE 프로그램 구분",
    description: "영어 반을 EiE / 인재원 영어로 나누는 필터·월 정액·월간 계획서",
    menuKeys: [],
  },
  session_billing: {
    id: "session_billing",
    label: "회차 정산",
    description: "회차 확정·시수 검증·강사 정산(청구 N회 × 단가 기반 급여 분배)",
    menuKeys: [],
  },
  payroll: {
    id: "payroll",
    label: "월별 급여",
    description: "직원별 급여 정산과 지급 현황",
    menuKeys: ["attendance_salary_settings", "payroll_settings"],
  },
  staff_leaves: {
    id: "staff_leaves",
    label: "기존 직원 휴가",
    description: "직원별 기존 휴가 기록과 승인 관리",
    menuKeys: [],
  },
};

/**
 * 새로 여는 학원(일반판)이 **끈 채 태어나는** 모듈 = 첫 학원(침산)의 운영 방식에 묶인 기능들.
 * 원장이 설정 '기능' 면에서 하나씩 켤 수 있다. 침산은 이 목록과 무관하게 전부 켜져 있다.
 */
// 보강은 별도의 안전한 운영 모드로 켠다. 두 활성 스위치가 서로 어긋나지 않게 한다.
export const GENERIC_DISABLED_MODULES: readonly ModuleId[] = MODULE_IDS.filter(id => id !== "makeups");

/** 저장값(jsonb)에서 알 수 있는 모듈 id만 — 모르는 값은 버린다(스키마가 바뀌어도 유령 id가 게이트를 흔들지 않게). */
export function normalizeDisabledModules(raw: unknown): ModuleId[] {
  return normalizeModuleIds(raw) as ModuleId[];
}

/** 이 모듈이 켜져 있나. */
export function isModuleEnabled(disabled: readonly ModuleId[] | undefined, id: ModuleId): boolean {
  return !(disabled ?? []).includes(id);
}

/** 저장 전후를 비교해 이번 요청이 실제로 모듈을 켜짐→꺼짐으로 바꾸는지 판정한다. */
export function isModuleTurningOff(
  before: readonly ModuleId[] | undefined,
  after: readonly ModuleId[] | undefined,
  id: ModuleId,
): boolean {
  return isModuleEnabled(before, id) && !isModuleEnabled(after, id);
}

/** 꺼진 모듈들이 닫는 메뉴키 집합. */
export function disabledMenuKeysOf(disabled: readonly ModuleId[] | undefined): ReadonlySet<MenuKey> {
  const out = new Set<MenuKey>();
  for (const id of disabled ?? []) for (const k of MODULES[id]?.menuKeys ?? []) out.add(k);
  return out;
}

/**
 * 꺼진 모듈의 메뉴를 **전 역할 `none`**으로 누른 새 매트릭스. 권한 매트릭스를 만드는 **맨 마지막**에 부른다 —
 * 원장 override·개인 예외·super_admin 병합(mergeMostPermissive) 뒤라야 그 어느 것도 다시 열지 못한다.
 * 꺼진 게 없으면 받은 매트릭스를 그대로 돌려준다(침산 = 복사도 안 한다, 오늘과 같다).
 */
export function capDisabledModules(matrix: AccessMatrix, disabled: readonly ModuleId[] | undefined): AccessMatrix {
  const keys = disabledMenuKeysOf(disabled);
  if (keys.size === 0) return matrix;
  const out = { ...matrix } as AccessMatrix;
  for (const k of keys) {
    const row = matrix[k];
    if (!row) continue;
    out[k] = Object.fromEntries(Object.keys(row).map((r) => [r, "none" as Access])) as Record<SystemRole, Access>;
  }
  return out;
}

/**
 * 메뉴키가 아니라 **한 메뉴 안의 면**으로만 존재하는 모듈의 입구 주소 — 권한 매트릭스로는 못 끄는 자리다
 * (수납관리 메뉴는 살아 있고 그 안의 회차 정산 면만 꺼야 한다). 사이드바·메뉴 판·휴대폰 메뉴에서 감춘다.
 */
const MODULE_FACE_HREFS: Partial<Record<ModuleId, readonly string[]>> = {
  session_billing: ["/billing?tab=sessions", "/billing?tab=verify", "/billing?tab=payroll"],
};

/**
 * '왼쪽 탭' 보기 설정 + 꺼진 모듈의 면 입구(숨김) — 사이드바·메뉴 판·휴대폰 메뉴가 이 목록 하나를 따른다.
 * 꺼진 면이 없으면 **받은 배열을 그대로** 돌려준다(침산 = 오늘과 같은 값, 같은 참조).
 * ⚠️ 이건 입구만 감춘다 — 면 자체는 각 화면이 같은 모듈 판정으로 막는다(수납 페이지의 SESSION_FACE_KEYS, [[#77]]).
 */
export function menuLayoutWithModules<T extends { href: string; hidden?: boolean; order?: number }>(
  menus: readonly T[],
  disabled: readonly ModuleId[] | undefined,
): readonly (T | { href: string; hidden: true })[] {
  const extra: { href: string; hidden: true }[] = [];
  for (const id of disabled ?? []) for (const href of MODULE_FACE_HREFS[id] ?? []) extra.push({ href, hidden: true });
  if (extra.length === 0) return menus;
  const kept = menus.filter((m) => !extra.some((e) => e.href === m.href));
  return [...kept, ...extra];
}

/** 이 메뉴키를 가진 모듈(없으면 null) — 꺼진 기능 안내 화면이 "무슨 기능인지"를 말할 때. */
export function moduleOfMenuKey(menu: MenuKey): ModuleId | null {
  for (const id of MODULE_IDS) if (MODULES[id].menuKeys.includes(menu)) return id;
  return null;
}
