import { describe, it, expect } from "vitest";
import { childKeys, childIdentityKeys, studentIdentityKeys, matchesIdentity } from "./identity-keys.mjs";

// ⚠️ 이 파일의 첫 블록은 **이동 parity**를 지킨다 — childKeys는 classnote-admin-core.mjs에서 옮겨온 것이고
// provision·assign(planChildMatches)이 "원문 키 그대로(공백 유지)"를 전제로 비교한다. 동작이 바뀌면 조용히 깨진다.
describe("childKeys — admin-core에서 이동(동작 불변)", () => {
  it("원문 + 라틴/괄호 제거본을 담는다", () => {
    expect([...childKeys("Jay(이재희)")].sort()).toEqual(["Jay(이재희)", "이재희"]);
  });

  it("⭐ F6: 한글(별명) 괄호는 이름 키로 승격하지 않는다 — 다른 학생과 오매칭 연료", () => {
    const keys = childKeys("박지민(지민)");
    expect(keys.has("지민")).toBe(false);
    expect(keys.has("박지민(지민)")).toBe(true);
    expect(childKeys("김하늘(동생)").has("동생")).toBe(false);
  });

  it("⭐ 공백을 지우지 않는다(planChildMatches가 원문 비교를 전제)", () => {
    expect(childKeys("김 민수").has("김 민수")).toBe(true);
    expect(childKeys("김 민수").has("김민수")).toBe(false);
  });

  it("빈 이름은 빈 집합", () => {
    expect(childKeys("").size).toBe(0);
    expect(childKeys(null).size).toBe(0);
  });
});

describe("childIdentityKeys — 교집합 비교용(공백 정규화)", () => {
  it("내부 공백을 제거해 '김 민수'와 '김민수'가 같은 키가 된다", () => {
    expect(childIdentityKeys("김 민수").has("김민수")).toBe(true);
  });

  it("영문닉(한글)도 정규화된 한글 키를 갖는다", () => {
    expect(childIdentityKeys("Jay (이재희)").has("이재희")).toBe(true);
  });
});

describe("studentIdentityKeys — A~G 접미사 base 승격", () => {
  it("⭐ 접미사 학생은 원문과 base 둘 다 갖는다(학부모는 가입 시 알파벳을 안 붙인다)", () => {
    const keys = studentIdentityKeys("박서준C", null);
    expect(keys.has("박서준C")).toBe(true);
    expect(keys.has("박서준")).toBe(true);
  });

  it("접미사 없는 학생은 자기 이름만", () => {
    expect([...studentIdentityKeys("박서준", null)]).toEqual(["박서준"]);
  });

  it("classnote_name 오버라이드가 있으면 그것을 유효이름으로 쓴다", () => {
    const keys = studentIdentityKeys("박서준", "박서준C");
    expect(keys.has("박서준C")).toBe(true);
    expect(keys.has("박서준")).toBe(true);
  });

  it("base가 2자 미만이면 승격하지 않는다(잡음 키 방지)", () => {
    expect(studentIdentityKeys("가A", null).has("가")).toBe(false);
  });

  it("한글이 없는 이름은 접미사 규칙을 적용하지 않는다", () => {
    const keys = studentIdentityKeys("ABC", null);
    expect(keys.has("AB")).toBe(false);
  });
});

describe("matchesIdentity — 부분 문자열 매칭 금지", () => {
  const child = (n) => childIdentityKeys(n);
  const student = (n, o = null) => studentIdentityKeys(n, o);

  it("⭐ 접미사 양방향: 박서준·박서준C 둘 다 원아 '박서준'의 후보가 된다(카디널리티로 걸러야 함)", () => {
    expect(matchesIdentity(student("박서준"), child("박서준"))).toBe(true);
    expect(matchesIdentity(student("박서준C"), child("박서준"))).toBe(true);
  });

  it("⭐ '이윤' vs '이윤건'은 다른 사람 — 부분일치로 매칭되지 않는다", () => {
    expect(matchesIdentity(student("이윤"), child("이윤건"))).toBe(false);
    expect(matchesIdentity(student("이윤건"), child("이윤"))).toBe(false);
  });

  it("영문닉(한글) 원아는 한글 이름으로 매칭된다", () => {
    expect(matchesIdentity(student("이재희"), child("Jay(이재희)"))).toBe(true);
  });

  it("⭐ '엄채율학생'은 '엄채율'과 매칭되지 않는다(의도된 결과 — 부분일치로 구제하지 않는다)", () => {
    expect(matchesIdentity(student("엄채율"), child("엄채율학생"))).toBe(false);
  });

  it("빈 집합끼리는 매칭되지 않는다", () => {
    expect(matchesIdentity(new Set(), child("박서준"))).toBe(false);
    expect(matchesIdentity(student("박서준"), new Set())).toBe(false);
  });
});
