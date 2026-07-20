import { describe, expect, it } from "vitest";
import { maskName, maskText, pseudonym } from "./export-masking";

describe("pseudonym", () => {
  it("같은 id는 항상 같은 코드, 다른 id는 다른 코드", () => {
    const a = pseudonym("dde6f250-9544-447a-9e2b-a9a4ee1c5074");
    expect(a).toBe(pseudonym("dde6f250-9544-447a-9e2b-a9a4ee1c5074"));
    expect(a).toMatch(/^학생#[0-9a-f]{6}$/);
    expect(a).not.toBe(pseudonym("00000000-0000-0000-0000-000000000000"));
  });
});

describe("maskName", () => {
  it("첫 글자만 남긴다", () => {
    expect(maskName("김철수")).toBe("김○○");
    expect(maskName("이승엽")).toBe("이○○");
    expect(maskName("남궁민수")).toBe("남○○○");
  });
  it("1자 이하·빈 값은 통째 마스킹", () => {
    expect(maskName("김")).toBe("○○");
    expect(maskName(" ")).toBe("○○");
  });
});

describe("maskText", () => {
  it("알려진 이름을 본문에서 치환한다(학생·학부모)", () => {
    const out = maskText("김철수 학생이 지각. 어머니 박영희님과 통화함.", ["김철수", "박영희"]);
    expect(out).toBe("김○○ 학생이 지각. 어머니 박○○님과 통화함.");
  });

  it("성을 뺀 호칭('지안이가')도 마스킹한다 — 실데이터에서 흔한 표기", () => {
    const out = maskText("지안이가 즐겁게 다니고 있다. 김지안 학생 칭찬.", ["김지안"]);
    expect(out).not.toContain("지안");
    expect(out).toBe("○○이가 즐겁게 다니고 있다. 김○○ 학생 칭찬.");
  });

  it("동명이인 접미사가 붙은 저장명('박채원B')의 핵심 이름부('채원')도 마스킹한다", () => {
    const out = maskText("채원이가 재미있게 다닌다.", ["박채원B"]);
    expect(out).not.toContain("채원");
    expect(out).toBe("○○이가 재미있게 다닌다.");
  });

  it("주민번호·휴대폰·유선·이메일 패턴을 마스킹한다", () => {
    const out = maskText("연락처 010-1234-5678, 집 053-424-1234, 주민 900101-1234567, mail@test.com");
    expect(out).not.toContain("1234-5678");
    expect(out).not.toContain("900101");
    expect(out).not.toContain("053-424");
    expect(out).not.toContain("mail@test.com");
    expect(out).toContain("010-****-****");
    expect(out).toContain("******-*******");
    expect(out).toContain("***@***");
  });

  it("주민번호가 전화 마스킹에 부분 잠식되지 않는다(순서 보장)", () => {
    expect(maskText("950505-2345678")).toBe("******-*******");
  });

  it("한 글자 이름은 오탐 방지를 위해 치환하지 않는다", () => {
    expect(maskText("이 문장은 그대로", ["이"])).toBe("이 문장은 그대로");
  });

  it("구분자 없는 긴 숫자(계좌 등 비전화)는 유선 패턴이 안 건드린다", () => {
    // ⚠️ 01x로 시작하면 휴대폰으로 간주돼 마스킹됨(의도) — 비전화 예시는 다른 선두 숫자로.
    expect(maskText("계좌 1101312745")).toBe("계좌 1101312745");
  });

  it("null/undefined 이름이 섞여도 안전", () => {
    expect(maskText("본문", [null, undefined, "김철수"])).toBe("본문");
  });

  it("이관 상담일지 서식의 기록자 줄(날짜 다음 단독 이름)을 마스킹한다", () => {
    const src = "상담 기록 항목:\n2026년 07월 20일\n이현이\n상담 내용: 잘 다닌다.";
    expect(maskText(src)).toBe("상담 기록 항목:\n2026년 07월 20일\n○○○\n상담 내용: 잘 다닌다.");
    // 콜론 붙은 항목명·이모지 줄은 건드리지 않는다
    const safe = "2026년 07월 19일\n조치사항:\n건의사항:";
    expect(maskText(safe)).toBe(safe);
  });
});
