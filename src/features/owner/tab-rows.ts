import { OWNER_FACES, type OwnerCategory, type OwnerFaceDef, type OwnerFaceKey } from "./tabs";

/**
 * 학원 설정 상단 탭의 **줄 구성** — 순수 함수(Vitest). 설정 정리 3단계(2026-10-06).
 *
 * 면이 열넷이라 한 줄에 다 세우면 창에서는 늘 넘쳐 좌우로 밀어야 했다. 범주(다섯)로 접어
 * **첫 줄 = 범주 · 둘째 줄 = 그 범주의 면**으로 세운다. 범주와 그 안의 순서는 면 목록(`tabs.ts`) 그대로라
 * 설정 메뉴 판(왼쪽 '설정'을 눌렀을 때의 버튼 묶음)과 같은 묶음으로 읽힌다.
 *
 * 정한 것:
 *  · **주소는 그대로다** — 면마다 `?tab=`. 범주는 주소에 없고 지금 면에서 읽는다(옛 북마크 · 창 · 사이드바 하부탭 불변).
 *  · 범주를 누르면 그 범주에서 **이 사람이 열 수 있는 첫 면**으로 간다. 지금 범주를 다시 누르면 지금 면에 머문다.
 *  · 열 수 있는 면이 없는 범주는 세우지 않는다.
 *  · 보이는 면이 범주 수 이하면 **접지 않는다**(한 줄 — 종전 모양). 면 한두 개만 맡은 사람에게 범주 줄은 줄만 늘린다.
 * ⚠️ 여기는 무엇을 세울지만 정한다 — 접근을 허락하는 곳이 아니다. `visible`은 화면이 권한으로 이미 거른 목록이다.
 */

/** 범주 — 면 목록에 나오는 순서 그대로. */
export const OWNER_CATEGORIES: readonly OwnerCategory[] = [...new Set(OWNER_FACES.map((f) => f.category))];

/** 탭 한 칸 — `FaceTabs`의 `Face`와 같은 모양(클라이언트 모듈을 끌어오지 않으려고 따로 적는다). */
export type OwnerTabChip = { key: string; label: string; href: string; group?: string };

export type OwnerTabRows =
  /** 한 줄 — 면을 그대로 세운다(종전 모양). */
  | { mode: "flat"; faces: OwnerTabChip[] }
  /** 두 줄 — 범주 줄 + 지금 범주의 면 줄. `faces`가 비면(지금 범주에 열 수 있는 면이 없다) 면 줄을 세우지 않는다. */
  | { mode: "category"; categories: OwnerTabChip[]; activeCategory: string; faces: OwnerTabChip[] };

const chip = (face: OwnerFaceDef): OwnerTabChip => ({ key: face.key, label: face.label, href: face.href, group: face.group });

/**
 * @param visible 이 사람에게 입구가 서는 면(면 목록 순서)
 * @param active 지금 면 — 입구가 안 서는 면일 수도 있다(주소로 직접 온 경우. 본문이 안내한다)
 */
export function ownerTabRows(visible: readonly OwnerFaceDef[], active: OwnerFaceKey): OwnerTabRows {
  if (visible.length <= OWNER_CATEGORIES.length) return { mode: "flat", faces: visible.map(chip) };

  const activeCategory = OWNER_FACES.find((f) => f.key === active)?.category ?? "";
  const activeVisible = visible.find((f) => f.key === active);
  const categories = OWNER_CATEGORIES.flatMap((category): OwnerTabChip[] => {
    const faces = visible.filter((f) => f.category === category);
    if (faces.length === 0) return [];
    // 지금 범주를 다시 누르면 지금 면에 머문다 — 첫 면으로 되돌리지 않는다.
    const target = category === activeCategory && activeVisible ? activeVisible : faces[0]!;
    return [{ key: category, label: category, href: target.href, group: target.group }];
  });
  return {
    mode: "category",
    categories,
    activeCategory,
    faces: visible.filter((f) => f.category === activeCategory).map(chip),
  };
}
