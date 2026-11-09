import { describe, expect, it } from "vitest";
import { OWNER_CATEGORIES, ownerTabRows } from "./tab-rows";
import { OWNER_FACES, type OwnerFaceKey } from "./tabs";

/**
 * 학원 설정 상단 탭의 줄 구성(2026-10-06, 설정 정리 3단계) — 면이 많으면 범주 줄 + 그 범주의 면 줄, 적으면 종전처럼 한 줄.
 * 주소는 면마다 `?tab=` 그대로라, 범주는 지금 면에서 읽는다.
 */
const CHINSAN = OWNER_FACES.filter((f) => !f.genericOnly); // 침산 원장: 일반판 전용 면('기능')을 뺀 전부
const DELEGATED = CHINSAN.filter((f) => !f.masterOnly); // 설정 전체를 위임받은 계정: 원장 위 전용 면이 빠진다
const pick = (...keys: OwnerFaceKey[]) => OWNER_FACES.filter((f) => keys.includes(f.key));
const labels = (chips: { label: string }[]) => chips.map((c) => c.label);

function category(visible: Parameters<typeof ownerTabRows>[0], active: OwnerFaceKey) {
  const rows = ownerTabRows(visible, active);
  if (rows.mode !== "category") throw new Error("두 줄 구성이어야 하는 사례다");
  return rows;
}

describe("범주", () => {
  it("면 목록에 나오는 순서 그대로 다섯", () => {
    expect(OWNER_CATEGORIES).toEqual(["학원 정보", "수업·운영", "청구·안내", "권한·화면", "관리"]);
  });
});

describe("두 줄 — 범주 줄 + 지금 범주의 면 줄", () => {
  it("원장: 범주 다섯, 둘째 줄에는 지금 범주의 면만", () => {
    const rows = category(CHINSAN, "subjects");
    expect(labels(rows.categories)).toEqual(["학원 정보", "수업·운영", "청구·안내", "권한·화면", "관리"]);
    expect(rows.activeCategory).toBe("수업·운영");
    // 2026-10-22 원생 기여도 면(contribution, 시범 지점만)이 더해졌다 — 고정값 CHINSAN은 면 전부라 함께 선다.
    expect(labels(rows.faces)).toEqual(["운영 체계", "과목 운영", "보강 운영", "강사평가", "원생 로열티"]);
  });

  it("범주를 누르면 그 범주의 첫 면으로 간다 — 주소는 면의 주소 그대로다(범주는 주소에 없다)", () => {
    const rows = category(CHINSAN, "profile");
    expect(Object.fromEntries(rows.categories.map((c) => [c.label, c.href]))).toEqual({
      "학원 정보": "/owner",
      "수업·운영": "/owner?tab=operations",
      "청구·안내": "/owner?tab=billing",
      "권한·화면": "/owner?tab=permissions",
      관리: "/owner?tab=popups",
    });
    for (const face of rows.faces) expect(OWNER_FACES.find((f) => f.key === face.key)?.href).toBe(face.href);
  });

  it("🔴 지금 범주를 다시 누르면 지금 면에 머문다 — 첫 면으로 되돌리지 않는다", () => {
    const rows = category(CHINSAN, "consultations");
    expect(rows.categories.find((c) => c.key === "청구·안내")?.href).toBe("/owner?tab=consultations");
    // 다른 범주는 여전히 그 범주의 첫 면이다.
    expect(rows.categories.find((c) => c.key === "수업·운영")?.href).toBe("/owner?tab=operations");
  });

  it("면이 하나뿐인 범주도 둘째 줄을 세운다 — 지금 어느 면인지 보이고, 범주를 옮겨도 줄 수가 바뀌지 않는다", () => {
    expect(labels(category(CHINSAN, "profile").faces)).toEqual(["프로필·브랜드"]);
  });

  it("'관리' 범주 앞에 구분선이 선다(설정 ┃ 관리) — 범주 칸의 묶음이 그 범주의 면과 같다", () => {
    const rows = category(CHINSAN, "profile");
    expect(rows.categories.map((c) => c.group)).toEqual(["설정", "설정", "설정", "설정", "관리"]);
  });

  it("일반판: '기능'이 권한·화면 범주 안에, 목록 순서대로 선다", () => {
    const rows = category([...OWNER_FACES], "modules");
    expect(rows.activeCategory).toBe("권한·화면");
    expect(labels(rows.faces)).toEqual(["역할·권한", "탭 및 메뉴 구성", "기능", "대시보드 관리"]);
  });
});

describe("권한으로 좁아진 목록", () => {
  it("🔴 열 수 있는 면이 없는 범주는 세우지 않는다", () => {
    const visible = CHINSAN.filter((f) => f.category !== "청구·안내");
    const rows = category(visible, "profile");
    expect(labels(rows.categories)).toEqual(["학원 정보", "수업·운영", "권한·화면", "관리"]);
  });

  it("범주의 첫 면을 못 여는 사람은 열 수 있는 첫 면으로 간다", () => {
    const visible = CHINSAN.filter((f) => f.key !== "operations" && f.key !== "popups");
    const rows = category(visible, "profile");
    expect(rows.categories.find((c) => c.key === "수업·운영")?.href).toBe("/owner?tab=subjects");
    expect(rows.categories.find((c) => c.key === "관리")?.href).toBe("/owner?tab=data");
  });

  it("입구가 안 서는 면에 주소로 직접 왔다 — 그 범주가 켜지고, 둘째 줄에는 열 수 있는 면만(켜진 칸 없음)", () => {
    const rows = category(DELEGATED, "audit");
    expect(rows.activeCategory).toBe("관리");
    expect(labels(rows.faces)).toEqual(["팝업 공지", "데이터 정리", "데이터 가져오기", "연동"]);
    expect(rows.faces.some((f) => f.key === "audit")).toBe(false);
    // 지금 면이 줄에 없으니 범주 칸은 그 범주의 첫 면으로 간다.
    expect(rows.categories.find((c) => c.key === "관리")?.href).toBe("/owner?tab=popups");
  });

  it("지금 면의 범주에 열 수 있는 면이 하나도 없다 — 범주 줄만 서고(켜진 칸 없음) 면 줄은 비어 있다", () => {
    const visible = CHINSAN.filter((f) => f.category !== "학원 정보");
    const rows = category(visible, "profile");
    expect(rows.categories.some((c) => c.key === rows.activeCategory)).toBe(false);
    expect(rows.faces).toEqual([]);
  });
});

describe("한 줄 — 접지 않는다", () => {
  it("🔴 보이는 면이 범주 수 이하면 종전처럼 한 줄이다(면 한두 개만 맡은 사람에게 범주 줄을 더하지 않는다)", () => {
    const one = ownerTabRows(pick("operations"), "operations");
    expect(one).toEqual({ mode: "flat", faces: [{ key: "operations", label: "운영 체계", href: "/owner?tab=operations", group: "설정" }] });
    const five = ownerTabRows(pick("operations", "subjects", "billing", "popups", "sheets"), "billing");
    expect(five.mode).toBe("flat");
    expect(labels(five.faces)).toEqual(["운영 체계", "과목 운영", "수납·청구", "팝업 공지", "연동"]);
    // 한 줄에서는 종전처럼 설정 ┃ 관리 구분선의 재료(group)를 그대로 싣는다.
    expect(five.faces.map((f) => f.group)).toEqual(["설정", "설정", "설정", "관리", "관리"]);
  });

  it("경계 — 여섯 면부터 접는다", () => {
    expect(ownerTabRows(pick("operations", "subjects", "billing", "popups", "sheets", "data"), "billing").mode).toBe("category");
  });

  it("보이는 면이 없어도 터지지 않는다", () => {
    expect(ownerTabRows([], "profile")).toEqual({ mode: "flat", faces: [] });
  });
});

describe("어느 면에서 보든", () => {
  it("모든 면이 제 범주의 둘째 줄에 서고, 켜진 범주는 그 면의 범주다", () => {
    for (const face of OWNER_FACES) {
      const rows = category([...OWNER_FACES], face.key);
      expect(rows.activeCategory, face.key).toBe(face.category);
      expect(rows.faces.map((f) => f.key), face.key).toContain(face.key);
      // 켜진 범주 칸의 주소는 지금 면이다.
      expect(rows.categories.find((c) => c.key === face.category)?.href, face.key).toBe(face.href);
    }
  });
});
