import { describe, expect, it } from "vitest";
import { planSiblingSave, resolveSiblingIds, siblingBasis, siblingHint, siblingPair } from "./siblings";

const kid = (id: string, name: string, parent_name: string | null, parent_phone: string | null) => ({ id, name, parent_name, parent_phone });

describe("원생 형제 판정", () => {
  it("학부모 휴대폰이 같으면 형제 — 표기(하이픈·띄어쓰기)가 달라도, 학부모 이름이 달라도(엄마·아빠)", () => {
    expect(siblingBasis(kid("a", "김유하", "장은혜", "010-7300-2311"), kid("b", "김유준", "김철수", "01073002311"))).toBe("phone");
  });

  it("학부모 이름이 같고 연락처가 부딪히지 않으면 형제 · 휴대폰이 서로 다르면 확인 후보로만", () => {
    expect(siblingBasis(kid("a", "김유하", "장은혜", "010-7300-2311"), kid("b", "김유준", "장 은혜", null))).toBe("name");
    expect(siblingBasis(kid("a", "김유하", "장은혜", null), kid("b", "김유준", "장은혜", null))).toBe("name");
    expect(siblingBasis(kid("a", "김유하", "장은혜", "010-7300-2311"), kid("b", "박서준", "장은혜", "010-1111-2222"))).toBe("conflict");
  });

  it("보호자2 휴대폰(s2_0024)도 같은 근거 — 한쪽 보호자1 = 다른 쪽 보호자2면 형제 · 이름만 같고 보호자 번호가 하나도 안 겹치면 확인 후보", () => {
    const withMom = (id: string, name: string, parent_phone: string | null, parent2_phone: string | null, parent_name: string | null = null) =>
      ({ id, name, parent_name, parent_phone, parent2_phone });
    // 동생은 아버지 번호만, 형은 보호자1 아버지 · 보호자2 어머니 — 어머니 번호로만 적힌 셋째와도 형제
    expect(siblingBasis(withMom("a", "김유하", "010-1111-2222", "010-7300-2311"), kid("b", "김유준", null, "01073002311"))).toBe("phone");
    expect(siblingBasis(kid("b", "김유준", null, "01073002311"), withMom("a", "김유하", "010-1111-2222", "010-7300-2311"))).toBe("phone");
    expect(siblingBasis(withMom("a", "김유하", null, "010-7300-2311"), withMom("b", "김유준", null, "010 7300 2311"))).toBe("phone");
    // 이름은 같은데 보호자 번호 넷이 하나도 안 겹치면 종전처럼 확인 후보
    expect(siblingBasis(withMom("a", "김유하", "010-1111-2222", "010-3333-4444", "장은혜"), withMom("b", "박서준", "010-5555-6666", null, "장은혜"))).toBe("conflict");
    // 보호자2 칸에 일반전화만 있으면 휴대폰이 없는 것과 같다 → 이름 근거
    expect(siblingBasis(withMom("a", "김유하", null, "053-333-0503", "장은혜"), withMom("b", "박서준", "010-5555-6666", null, "장은혜"))).toBe("name");
  });

  it("🔴 보호자2는 '다르다'(확인 후보)의 근거가 아니다 — 보호자1 기준 판정은 종전과 같다", () => {
    const withMom = (id: string, name: string, parent_phone: string | null, parent2_phone: string | null, parent_name: string | null = null) =>
      ({ id, name, parent_name, parent_phone, parent2_phone });
    // A = 보호자1 일반전화 + 보호자2 엄마 휴대폰 · B = 아빠 휴대폰 · 학부모 이름 같음 → 종전처럼 이름 근거 형제(보호자2 없을 때와 같다)
    const a = withMom("a", "김유하", "053-333-0503", "010-7300-2311", "장은혜");
    const b = withMom("b", "박서준", "010-5555-6666", null, "장은혜");
    expect(siblingBasis(a, b)).toBe("name");
    expect(siblingBasis(b, a)).toBe("name");
    expect(siblingBasis({ ...a, parent2_phone: null }, b)).toBe(siblingBasis(a, b));
    // 양쪽 다 보호자2만 있고 서로 다른 번호여도 보호자1이 없으면 이름 근거
    expect(siblingBasis(withMom("a", "김유하", null, "010-1111-2222", "장은혜"), withMom("b", "박서준", null, "010-3333-4444", "장은혜"))).toBe("name");
  });

  it("형제가 아니다 — 아무것도 안 같음 · 학부모 이름 한 글자 · 일반전화만 같음 · 자기 자신", () => {
    expect(siblingBasis(kid("a", "김유하", "장은혜", "010-7300-2311"), kid("b", "박서준", "이민정", "010-1111-2222"))).toBeNull();
    expect(siblingBasis(kid("a", "김유하", "장", null), kid("b", "박서준", "장", null))).toBeNull();
    expect(siblingBasis(kid("a", "김유하", null, "053-333-0503"), kid("b", "박서준", null, "053-333-0503"))).toBeNull();
    expect(siblingBasis(kid("a", "김유하", "장은혜", "010-7300-2311"), kid("a", "김유하", "장은혜", "010-7300-2311"))).toBeNull();
  });

  it("🔴 학생 이름이 같으면(동명이인 접미사 무시) 형제가 아니다 — 같은 아이의 중복 기록", () => {
    expect(siblingBasis(kid("a", "권민서A", "장은혜", "010-7300-2311"), kid("b", "권민서B", "장은혜", "010-7300-2311"))).toBeNull();
    expect(siblingBasis(kid("a", "권민서", "장은혜", "010-7300-2311"), kid("b", "권민서B", null, "010-7300-2311"))).toBeNull();
    // 영문 이름은 끝 글자를 접미사로 떼지 않는다.
    expect(siblingBasis(kid("a", "Daniel", null, "010-7300-2311"), kid("b", "Danielle", null, "010-7300-2311"))).toBe("phone");
  });

  it("짝 순서는 DB와 같다(student_a < student_b)", () => {
    expect(siblingPair("b0", "a9")).toEqual(["a9", "b0"]);
    expect(siblingPair("a9", "b0")).toEqual(["a9", "b0"]);
  });

  it("보일 형제 = (자동 ∪ 지정) − 뺀 짝", () => {
    const links = new Map([["m", true], ["x", false]]);
    expect(resolveSiblingIds(["p", "x"], links).sort()).toEqual(["m", "p"]);
  });

  it("🔴 저장은 화면에서 바꾼 것만 — 손대지 않은 자동 추천·지정은 쓰지 않는다", () => {
    // 자동 추천 p·q를 그대로 두고 저장 → 아무것도 안 쓴다(연락처를 고치면 자동 판정이 따라 바뀐다).
    expect(planSiblingSave(["p", "q"], ["p", "q"], ["p", "q"])).toEqual({ set: [], remove: [] });
    // r을 더함 → r만 지정.
    expect(planSiblingSave(["p", "q", "r"], ["p", "q"], ["p", "q"])).toEqual({ set: [{ other: "r", linked: true }], remove: [] });
    // q(자동)를 빼고 m(지정만 — 자동 아님)을 뺌 → q는 '형제 아님'(다시 안 들어오게) · m은 줄 삭제.
    expect(planSiblingSave(["p"], ["p", "q", "m"], ["p", "q"])).toEqual({ set: [{ other: "q", linked: false }], remove: ["m"] });
  });

  it("열어 둔 사이 다른 원생 화면에서 바꾼 짝을 덮지 않는다(그 칩을 안 건드렸으면)", () => {
    // 열 때 형제가 없었고 아무것도 안 건드림 → 다른 화면에서 새로 지정한 짝·뺀 짝은 그대로.
    expect(planSiblingSave([], [], [])).toEqual({ set: [], remove: [] });
    expect(planSiblingSave(["b"], ["b"], ["b"])).toEqual({ set: [], remove: [] });
  });

  it("꼬리 표기 — 학교학년, 재원이 아니면 상태", () => {
    expect(siblingHint({ school: "칠성초", grade: "초4", status: "enrolled" })).toBe("칠성초4");
    expect(siblingHint({ school: "칠성초", grade: "초4", status: "withdrawn" })).toBe("칠성초4 · 퇴원");
    expect(siblingHint({ school: null, grade: null, status: "enrolled" })).toBe("");
  });
});
