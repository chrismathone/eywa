import { describe, expect, it } from "vitest";
import { tidyVendor, VENDOR_FIELDS, vendorColumns } from "./vendor";
import { parseVendorSheetRow, planVendorRows, VENDOR_SHEET_COLUMNS, vendorNameKey } from "./vendor-sheet";

const blank = Object.fromEntries(VENDOR_FIELDS.map((f) => [f.key, null])) as Parameters<typeof tidyVendor>[0];

describe("tidyVendor — 등록 창·엑셀이 같은 다듬기", () => {
  it("빈 칸 null · 번호 하이픈 · 업체명 필수", () => {
    const v = tidyVendor({ ...blank, name: "  대구서점 ", phone: "0533124567", bizNo: "1234567890", note: "  " });
    expect(v).toMatchObject({ name: "대구서점", phone: "053-312-4567", bizNo: "123-45-67890", note: null });
    expect(tidyVendor({ ...blank, name: "  " })).toEqual({ error: "업체명을 입력해 주세요" });
  });
  it("길이 상한(0448a 제약과 같다)", () => {
    expect(tidyVendor({ ...blank, name: "가".repeat(81) })).toEqual({ error: "업체명은(는) 80자까지입니다" });
  });
});

describe("업체리스트 엑셀 서식", () => {
  it("열 = 등록 창 칸 순서, 첫 열은 매칭 키 업체명", () => {
    expect(VENDOR_SHEET_COLUMNS.map((c) => c.header)).toEqual(["업체명", "분류", "대표전화", "담당자", "담당자 연락처", "주소", "사업자등록번호", "이메일", "비고"]);
  });
  it("행 오류는 행 번호를 단다", () => {
    expect(parseVendorSheetRow({ phone: "010" }, 7)).toEqual({ ok: false, error: "7행: 업체명을 입력해 주세요" });
  });
  it("매칭 키는 띄어쓰기·대소문자 무시", () => {
    expect(vendorNameKey("대구 서점 ABC")).toBe(vendorNameKey("대구서점abc"));
  });
});

describe("planVendorRows — 추가/덮어쓰기", () => {
  const row = (rowNum: number, name: string) => {
    const p = parseVendorSheetRow({ name }, rowNum);
    if (!p.ok) throw new Error(p.error);
    return p.row;
  };
  const existing = [{ id: "a", name: "대구 서점" }];
  it("추가 = 있는 이름 건너뜀, 덮어쓰기 = 갱신", () => {
    const rows = [row(2, "대구서점"), row(3, "새 업체")];
    expect(planVendorRows(rows, existing, "append").actions.map((a) => a.action)).toEqual(["skip", "insert"]);
    const ow = planVendorRows(rows, existing, "overwrite").actions;
    expect(ow.map((a) => [a.action, a.id])).toEqual([["update", "a"], ["insert", null]]);
  });
  it("🔴 파일 안 중복 이름은 오류", () => {
    expect(planVendorRows([row(2, "가게"), row(5, "가 게")], [], "append").errors).toEqual(['5행: 업체명 "가 게"이(가) 2행과 겹칩니다']);
  });
  it("🔴 DB에 같은 이름이 두 곳이면 어느 쪽인지 몰라 오류(추가 방식이어도)", () => {
    const res = planVendorRows([row(2, "정수기")], [{ id: "x", name: "정수기" }, { id: "y", name: "정 수기" }], "append");
    expect(res.actions[0]!.action).toBe("ambiguous");
    expect(res.errors).toHaveLength(1);
  });
});

describe("vendorColumns — 덮어쓰기는 파일에 있는 열만", () => {
  it("only를 주면 그 칸만 싣는다(없는 열은 지우지 않는다)", () => {
    const v = tidyVendor({ ...blank, name: "가게", note: "메모" });
    if ("error" in v) throw new Error(v.error);
    expect(vendorColumns(v, new Set(["name", "phone"]))).toEqual({ name: "가게", phone: null });
    expect(Object.keys(vendorColumns(v))).toHaveLength(9);
  });
});
