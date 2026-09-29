// 학원 프리셋(출발점) 판정 — **단일 소스**. 원장 2026-09-22 방향 B(침산은 그대로, 새 지점만 일반화).
//
// 규칙(저장된 설정 행 기준): **`preset: "generic"`이 적힌 행만 일반판**, 그 밖(행 없음·빈 행·preset 없음·다른 값)은 전부 침산.
// 그래서 침산은 DB를 한 줄도 안 건드려도 오늘과 같다.
//
// 🔴 **실패는 침산 쪽으로 기운다**(적대 리뷰 2026-09-22) — 처음엔 "행 없음 = 일반판"이었는데, 그러면 설정 행이
//    에러 없이 0개로 읽히는 순간(서비스 키 오설정으로 RLS가 걸림 [[#104]]·행 삭제) 침산이 통째로 일반판이 되어
//    모듈 17개가 꺼지고 자동 시수(돈)가 멈춘다. 일반판은 **명시적 표식**이 있어야만 켜진다.
// 🔴 새 학원은 태어날 때 표식을 받는다(super-admin 학원 추가가 `{version:1, preset:"generic"}` 행을 만든다) —
//    표식이 이미 있는 행은 저장(saveOwnerSection)이 섹션만 바꾸므로 그대로 남는다.
// 🔴 이 값을 읽는 곳은 여기와 수업 규칙 프로필뿐이다 — 다른 코드는 풀린 설정·모듈만 본다(가드 preset-guard.test.ts).
//    "if 침산" 분기가 화면마다 번지면 두 경로를 영영 못 합친다.
import { DEFAULT_SETTINGS } from "./defaults";
import { GENERIC_SETTINGS } from "./generic-defaults";
import type { TenantPreset, TenantSettings } from "./settings-types";

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** 저장된 설정(jsonb, 없으면 null) → 이 학원의 프리셋. */
export function presetOfStored(stored: unknown): TenantPreset {
  return isPlainObject(stored) && stored.preset === "generic" ? "generic" : "chinsan";
}

/** 프리셋의 기본값 문서 — resolveSettings가 저장값을 이 위에 얹는다. */
export function baseSettingsFor(preset: TenantPreset): TenantSettings {
  return preset === "generic" ? GENERIC_SETTINGS : DEFAULT_SETTINGS;
}

/**
 * 일반판 학원에만 서는 화면들 — 설정 '기능' 면, 대시보드 '시작하기' 카드.
 * 🔴 침산 화면은 이 작업 전과 글자 그대로 같아야 한다(원장 2026-09-22 *"침산은 아무일도 없던 것처럼"*) —
 *    그래서 새 화면은 프리셋으로 가른다. 화면 코드는 `settings.preset`을 직접 비교하지 말고 이 함수를 부른다.
 */
export function isGenericTenant(settings: Pick<TenantSettings, "preset">): boolean {
  return settings.preset === "generic";
}

/** Legacy first-academy exceptions are isolated here so generic tenants never inherit them. */
export function isChinsanTenant(settings: Pick<TenantSettings, "preset">): boolean {
  return !isGenericTenant(settings);
}

/** 이번 작업(2026-09-22 방향 B)이 운영 섹션에 새로 만든 칸 — 침산 행엔 절대 남지 않고, 새 학원 행엔 사람이 준 값만 남는다. */
const NEW_OPERATIONS_KEYS = ["periodStyle", "schoolSaveAliases"] as const;

/**
 * 저장 직전 섹션 값을 프리셋에 맞게 다듬는다(saveOwnerSection 전용).
 *  · **침산**: 새 칸 둘을 **값과 무관하게** 뺀다 — origin(이 작업 전)에선 모르는 키라 스키마가 지웠다. 기본값과 같을 때만 빼면
 *    owner 쓰기를 위임받은 사람이 요청을 만들어 `periodStyle:"plain"`을 침산 행에 남길 수 있고, 침산엔 되돌릴 화면이 없다
 *    (modules 섹션을 거절하는 것과 같은 이유 [[#77]]). 빠진 칸은 읽을 때 침산 기본값으로 채워진다 — 동작도 행도 오늘과 같다.
 *  · **새 학원**: 요청에 **없던** 칸은 스키마 기본값(침산 값)이 끼어든 것이다 — 저장돼 있던 값이 있으면 그것을, 없으면 비워서
 *    읽을 때 일반판 기본값으로 채워지게 한다(배포 순간 열린 옛 화면이 칸 없이 저장해도 침산 규칙이 박히지 않게).
 *  · **탭 및 메뉴 구성**(프리셋 무관): 요청에 없던 강사뷰 칸(`teacherMenus`)은 저장돼 있던 값으로 둔다(옛 화면이 지우지 않게).
 */
export function prepareSectionForSave(
  preset: TenantPreset,
  section: string,
  rawInput: unknown,
  parsed: unknown,
  storedSection: unknown,
): unknown {
  if (section === "permissions" && isPlainObject(parsed)) {
    const out: Record<string, unknown> = { ...parsed };
    if (!isPlainObject(rawInput) || !("userOverrides" in rawInput)) {
      if (isPlainObject(storedSection) && "userOverrides" in storedSection) out.userOverrides = storedSection.userOverrides;
      else delete out.userOverrides;
    }
    // 침산의 기존 민감 기능 명단은 이 새 설정 화면이 절대 덮지 않는다.
    if (preset !== "generic") delete out.specialAccess;
    // 배포 전 열린 폼이 새 칸을 보내지 않아도 저장된 담당자 명단을 지키고,
    // 이전 화면이 개인 예외를 누락했다면 그것도 보존한다.
    else if (!isPlainObject(rawInput) || !("specialAccess" in rawInput)) {
      if (isPlainObject(storedSection) && "specialAccess" in storedSection) out.specialAccess = storedSection.specialAccess;
      else delete out.specialAccess;
    }
    return out;
  }
  // 탭 및 메뉴 구성 — 배포 순간 열린 옛 화면이 강사뷰 칸(teacherMenus) 없이 보내면 스키마 기본값([])이 채워진다.
  // 그대로 저장하면 원장이 정해 둔 강사뷰 구성이 조용히 지워지므로, 요청에 **없던** 칸은 저장돼 있던 값으로 둔다(프리셋 무관).
  if (section === "navigation" && isPlainObject(parsed)) {
    const out: Record<string, unknown> = { ...parsed };
    if (!isPlainObject(rawInput) || !("teacherMenus" in rawInput)) {
      if (isPlainObject(storedSection) && "teacherMenus" in storedSection) out.teacherMenus = storedSection.teacherMenus;
      else delete out.teacherMenus;
    }
    // groups를 모르는 구버전 화면은 이름·아이콘·배치를 지우지 못한다. 새 화면의 groups:[]는 명시적 초기화다.
    if (!isPlainObject(rawInput) || !("groups" in rawInput)) {
      if (isPlainObject(storedSection)) {
        out.groups = storedSection.groups;
        const previous = Array.isArray(storedSection.menus) ? storedSection.menus.filter(isPlainObject) : [];
        const incoming = Array.isArray(parsed.menus) ? parsed.menus.filter(isPlainObject) : [];
        const hrefs = new Set([...incoming, ...previous].map((r) => r.href));
        out.menus = [...hrefs].map((href) => {
          const old = previous.find((r) => r.href === href);
          const next = incoming.find((r) => r.href === href);
          return { href, ...(old?.label ? { label: old.label } : {}), ...(old?.icon ? { icon: old.icon } : {}),
            ...(old?.groupId ? { groupId: old.groupId } : {}), ...next };
        }).filter((row) => Object.keys(row).length > 1);
      }
    }
    // 이전 강사 편집기의 숨김·순서 저장도 새 이름·아이콘·폴더 구성을 지우지 않는다.
    if ((!isPlainObject(rawInput) || !("teacherGroups" in rawInput)) && isPlainObject(storedSection)) {
      out.teacherGroups = storedSection.teacherGroups;
      if (isPlainObject(rawInput) && "teacherMenus" in rawInput) {
        const previous = Array.isArray(storedSection.teacherMenus) ? storedSection.teacherMenus.filter(isPlainObject) : [];
        const incoming = Array.isArray(parsed.teacherMenus) ? parsed.teacherMenus.filter(isPlainObject) : [];
        const hrefs = new Set([...incoming, ...previous].map((r) => r.href));
        out.teacherMenus = [...hrefs].map((href) => {
          const old = previous.find((r) => r.href === href);
          const next = incoming.find((r) => r.href === href);
          return { href, ...(old?.label ? { label: old.label } : {}), ...(old?.icon ? { icon: old.icon } : {}),
            ...(old?.groupId ? { groupId: old.groupId } : {}), ...next };
        }).filter((row) => Object.keys(row).length > 1);
      }
    }
    return out;
  }
  // 배포 전에 열어 둔 보고서 설정 폼은 영상 제출 칸을 보내지 않는다. 스키마 기본값(전체 사용)으로
  // 저장된 제외 목록을 덮지 않도록, 요청에 없던 칸은 기존 저장값을 유지한다.
  if (section === "report" && isPlainObject(parsed)) {
    if (isPlainObject(rawInput) && "videoHomeworkPolicy" in rawInput) return parsed;
    const out: Record<string, unknown> = { ...parsed };
    if (isPlainObject(storedSection) && "videoHomeworkPolicy" in storedSection)
      out.videoHomeworkPolicy = storedSection.videoHomeworkPolicy;
    else delete out.videoHomeworkPolicy;
    return out;
  }
  if (section !== "operations" || !isPlainObject(parsed)) return parsed;
  const out: Record<string, unknown> = { ...parsed };
  for (const key of NEW_OPERATIONS_KEYS) {
    if (preset !== "generic") {
      delete out[key];
    } else if (!(isPlainObject(rawInput) && key in rawInput)) {
      if (isPlainObject(storedSection) && key in storedSection) out[key] = storedSection[key];
      else delete out[key];
    }
  }
  return out;
}
