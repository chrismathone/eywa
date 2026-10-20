import { describe, expect, it } from "vitest";
import { canonicalSchoolName, isSchoolLikeKey, normalizeSchoolName, schoolKindCandidate } from "./school-name";

// 아래 이름은 전부 **실제 값**이다 — 왼쪽은 학교알리미 2026 공시(대구), 오른쪽은 aywa 학생 입력값.
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
    // aywa에 "일중"(15명)과 "대구일중"(24명)이 따로 들어가 있어 점유율이 1.5%/2.5%로 쪼개졌었다.
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

  it("🔴 지역 접두를 지웠을 때 **급만 남으면** 지우지 않는다", () => {
    // 전부 실재하는 대구 학교다. 지우면 "대구초등학교"가 키 `초`가 되어, 상담 입력의 쓰레기 값
    // "초"(43건)·"중"(17건)이 그 학교에 붙었다 — 화면에 "대구초등학교 43건 / 전교생 444명 중 9.7%"로
    // 떴다. 존재하지 않는 점유율이다.
    expect(normalizeSchoolName("대구초등학교")).toBe("대구초");
    expect(normalizeSchoolName("대구중학교")).toBe("대구중");
    expect(normalizeSchoolName("대구고등학교")).toBe("대구고");
    expect(normalizeSchoolName("대구여자고등학교")).toBe("대구여고");
    // 이름이 남는 학교는 그대로 지운다(합치는 효과는 유지).
    expect(normalizeSchoolName("대구동신초등학교")).toBe("동신초");
    expect(normalizeSchoolName("대구북중학교")).toBe("북중");
  });

  it("학년 꼬리·'학교' 생략 표기를 흡수한다", () => {
    expect(normalizeSchoolName("달성초1")).toBe("달성초"); // 학교명은 숫자로 끝나지 않는다
    expect(normalizeSchoolName("종로초6")).toBe("종로초");
    expect(normalizeSchoolName("칠성초등")).toBe("칠성초");
  });

  it("원장이 확정한 별칭만 매핑 — 추측 금지", () => {
    // "달산"은 급이 없어 원칙상 기타지만 달산초등학교가 실재해 원장이 예외로 확정했다(2026-08-05).
    expect(normalizeSchoolName("달산")).toBe("달산초");
    expect(normalizeSchoolName("달산초등학교")).toBe("달산초");
  });

  it("isSchoolLikeKey — 급으로 끝나되 급만 있는 건 학교가 아니다", () => {
    for (const k of ["칠성초", "침산중", "경명여중", "대구초", "왜관동부초"])
      expect(isSchoolLikeKey(k), k).toBe(true);
    for (const k of ["초", "중", "고", "여고", "", "테스트06-", "국제학교"])
      expect(isSchoolLikeKey(k), k).toBe(false);
  });

  it("급이 없는 입력은 그대로 둔다 — 추측해서 붙이지 않는다", () => {
    // 실측 미매칭 2건: "침산"(급 없음)·"마이스터고"(학교명이 아니라 유형).
    expect(normalizeSchoolName("침산")).toBe("침산");
  });
});

// ── 저장 표기(canonicalSchoolName) ─────────────────────────────────────────────
// 원장 2026-09-01: "~초등학교도 -> ~초 로 변경해야함 · 저장할때 강제 변경" + "일중 -> 대구일중".
describe("canonicalSchoolName — DB에 남는 표기", () => {
  it("긴 접미는 줄인다(초등학교→초·중학교→중·고등학교→고)", () => {
    expect(canonicalSchoolName("옥산초등학교")).toBe("옥산초");
    expect(canonicalSchoolName("종로초등학교")).toBe("종로초");
    expect(canonicalSchoolName("침산중학교")).toBe("침산중");
    expect(canonicalSchoolName("칠성고등학교")).toBe("칠성고");
    expect(canonicalSchoolName("경명여자중학교")).toBe("경명여중");
  });

  it("이미 짧은 표기는 그대로 — 여러 번 통과해도 같다(멱등)", () => {
    expect(canonicalSchoolName("칠성초")).toBe("칠성초");
    expect(canonicalSchoolName(canonicalSchoolName("옥산초등학교"))).toBe("옥산초");
  });

  it("🔴 지역 접두는 **지우지 않는다** — 매칭 키와 방향이 반대다", () => {
    expect(canonicalSchoolName("대구일중")).toBe("대구일중");
    expect(canonicalSchoolName("대구동신초등학교")).toBe("대구동신초");
    // 같은 값이 매칭 키로는 여전히 지역 접두 없이 합쳐진다(점유율이 안 쪼개진다).
    expect(normalizeSchoolName("대구일중")).toBe(normalizeSchoolName("일중"));
  });

  it("원장이 확정한 별칭: 일중 → 대구일중(입력이 무엇이든 저장은 하나)", () => {
    expect(canonicalSchoolName("일중")).toBe("대구일중");
    expect(canonicalSchoolName("일중학교")).toBe("대구일중");
    expect(canonicalSchoolName("  일중  ")).toBe("대구일중"); // 양끝 공백만 다듬는다
    expect(canonicalSchoolName("대구일중학교")).toBe("대구일중");
  });

  it("학교가 아닌 값은 손대지 않는다(접수 원문 보존)", () => {
    expect(canonicalSchoolName("7세")).toBe("7세");
    expect(canonicalSchoolName("예비중1")).toBe("예비중1");
    expect(canonicalSchoolName("영어문의")).toBe("영어문의");
  });

  // 🔴 실데이터 드라이런에서 잡힌 것들 — 이 칸엔 학교가 아닌 메모가 섞여 있다.
  //    가운데 공백을 지우면 읽을 수 없는 값이 된다(칠성초2 7세 → 칠성초27세).
  it("가운데 공백은 건드리지 않는다", () => {
    expect(canonicalSchoolName("칠성초2 7세")).toBe("칠성초2 7세");
    expect(canonicalSchoolName("달산초6, 예비일중")).toBe("달산초6, 예비일중");
    expect(canonicalSchoolName("국제학교 (중국)")).toBe("국제학교 (중국)");
    expect(canonicalSchoolName("구미 해마루중")).toBe("구미 해마루중");
    expect(canonicalSchoolName("예비 침산초")).toBe("예비 침산초");
  });

  it("빈 값은 null(빈 문자열로 저장하지 않는다)", () => {
    expect(canonicalSchoolName("")).toBeNull();
    expect(canonicalSchoolName("   ")).toBeNull();
    expect(canonicalSchoolName(null)).toBeNull();
    expect(canonicalSchoolName(undefined)).toBeNull();
  });
});

describe("schoolKindCandidate", () => {
  it("급이 빠진 학교에 학년의 급을 붙인다", () => {
    expect(schoolKindCandidate("칠성", "초5")).toBe("칠성초");
    expect(schoolKindCandidate("경명여", "중2")).toBe("경명여중");
    expect(schoolKindCandidate("대구칠성", "초5")).toBe("칠성초");
    expect(schoolKindCandidate("대구일", "중1")).toBe("일중");
  });
  it("이미 급이 있거나 학년의 급을 모르면 후보가 없다", () => {
    expect(schoolKindCandidate("칠성초", "초5")).toBeNull();
    expect(schoolKindCandidate("칠성", "5")).toBeNull();
    expect(schoolKindCandidate("우주과학유치원", "7세")).toBeNull();
    expect(schoolKindCandidate(null, "초5")).toBeNull();
    expect(schoolKindCandidate("대구", "초3")).toBeNull();
  });
  it("숫자·공백·괄호가 섞인 메모는 손대지 않는다", () => {
    expect(schoolKindCandidate("예비초1", "초1")).toBeNull();
    expect(schoolKindCandidate("자퇴(검정고시)", "고2")).toBeNull();
    expect(schoolKindCandidate("구미 해마루", "중1")).toBeNull();
  });
});
