import { describe, expect, it } from "vitest";
import { normalizeSchoolName } from "./school-name";

// 아래 이름은 전부 **실제 값**이다 — 왼쪽은 학교알리미 2026 공시(대구), 오른쪽은 eywa 학생 입력값.
// 지어낸 예시로 테스트하면 실데이터에서 어떻게 깨지는지 영영 모른다.
describe("normalizeSchoolName — 두 소스를 같은 키로", () => {
  it("공시명과 입력값이 같은 키가 된다", () => {
    const pairs: [string, string][] = [
      ["대구칠성초등학교", "칠성초"],
      ["대구침산초등학교", "침산초"],
      ["침산중학교", "침산중"],
      ["성광중학교", "성광중"],
      ["칠성고등학교", "칠성고"],
      ["대구달산초등학교", "달산초"],
      ["대구종로초등학교", "종로초"],
    ];
    for (const [official, ours] of pairs)
      expect(normalizeSchoolName(official), `${official} ↔ ${ours}`).toBe(normalizeSchoolName(ours));
  });

  it("🔴 여학교 — `여자중학교`를 `중학교`보다 먼저 지워야 붙는다", () => {
    // 순서가 틀리면 "경명여자중학교"가 "경명여자"가 되어 "경명여중"과 영영 안 붙는다.
    // 실측: 이 버그로 여학교 6종(경명여중 23명·경명여고 12·경상여고 6·성화여고 4·성명여중 1·경북여고 1)이
    // 통째로 매칭에서 빠졌다.
    expect(normalizeSchoolName("경명여자중학교")).toBe("경명여중");
    expect(normalizeSchoolName("경명여자고등학교")).toBe("경명여고");
    expect(normalizeSchoolName("경상여자고등학교")).toBe("경상여고");
    expect(normalizeSchoolName("경명여자중학교")).toBe(normalizeSchoolName("경명여중"));
    expect(normalizeSchoolName("경상여자고등학교")).toBe(normalizeSchoolName("경상여고"));
  });

  it("⚠️ 지역 접두를 지워 같은 학교의 두 표기를 합친다", () => {
    // eywa에 "일중"(15명)과 "대구일중"(24명)이 따로 들어가 있어 점유율이 1.5%/2.5%로 쪼개졌었다.
    expect(normalizeSchoolName("대구일중")).toBe("일중");
    expect(normalizeSchoolName("일중")).toBe("일중");
    expect(normalizeSchoolName("대구일중학교")).toBe("일중");
  });

  it("학교명 안의 '대구'는 건드리지 않는다 — 접두일 때만 지운다", () => {
    // 둘 다 대구 공시 명부의 실제 학교다. 접두가 아닌 '대구'까지 지우면 다른 학교가 된다.
    expect(normalizeSchoolName("남대구초등학교")).toBe("남대구초");
    expect(normalizeSchoolName("경북대학교사범대학부설초등학교")).toBe("경북대학교사범대학부설초");
  });

  it("공백·괄호 주석을 흡수한다", () => {
    expect(normalizeSchoolName(" 대구 칠성 초등학교 ")).toBe("칠성초");
    expect(normalizeSchoolName("대구칠성초등학교(분교)")).toBe("칠성초");
  });

  it("빈 값은 빈 문자열 — 매칭에서 조용히 아무 학교에나 붙지 않게", () => {
    expect(normalizeSchoolName(null)).toBe("");
    expect(normalizeSchoolName("")).toBe("");
    expect(normalizeSchoolName("   ")).toBe("");
  });

  it("급이 없는 입력은 그대로 둔다 — 추측해서 붙이지 않는다", () => {
    // 실측 미매칭 2건: "침산"(급 없음)·"마이스터고"(학교명이 아니라 유형).
    expect(normalizeSchoolName("침산")).toBe("침산");
  });
});
