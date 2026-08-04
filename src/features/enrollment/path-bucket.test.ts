import { describe, expect, it } from "vitest";
import { bucketizePathStats, pathBucket, type PathStatRow } from "./path-bucket";

// 아래 문자열은 전부 **프로덕션 실제 값**(2026-08-04, injaewon 210종에서 발췌)이다.
// 지어낸 예시로 테스트하면 규칙이 실데이터에서 어떻게 깨지는지 영영 모른다.
describe("pathBucket — 실제 원문 분류", () => {
  it("소개·추천: 사람이 데려온 신호", () => {
    for (const s of [
      "지인 소개",
      "재원생 추천",
      "소개 (김성은)",
      "이규민 소개",
      "재원생소개 전효주",
      "김민승동생",
      "친구 (문주해,안수빈)",
      "오빠 수강중",
      "재원생(장린혜) 동생",
      "친구추천(입시관)",
      "영어재원생",
      "수학재원생",
      "강아 범어 수강생",
      "설명회 이서윤(재원생) 동생", // 설명회보다 소개가 먼저 — 데려온 사람이 있으면 그게 유입 이유다
    ])
      expect(pathBucket(s), s).toBe("소개·추천");
  });

  it("설명회", () => {
    for (const s of ["설명회", "9월설명회", "23년도에 설명회 참석", "영어설명회"])
      expect(pathBucket(s), s).toBe("설명회");
  });

  it("인터넷", () => {
    for (const s of [
      "인터넷 검색",
      "인터넷",
      "검색",
      "블로그",
      "인터넷 블로그",
      "블로그 침산동수학학원",
      "인터넷 침산동의 대형학원을 찾아봄",
    ])
      expect(pathBucket(s), s).toBe("인터넷");
  });

  it("간판·광고 — '간 판'처럼 띄어 쓴 것도 잡는다", () => {
    for (const s of ["간판", "간 판", "간판보고 전화", "외부광고", "광고 (전단지  엘리베이터  현수막)"])
      expect(pathBucket(s), s).toBe("간판·광고");
  });

  it("미기재 — null·빈칸은 버리지 않고 한 버킷으로 센다", () => {
    expect(pathBucket(null)).toBe("미기재");
    expect(pathBucket("")).toBe("미기재");
    expect(pathBucket("   ")).toBe("미기재");
  });

  it("모르는 값은 '기타'로 — 임의로 어딘가에 밀어 넣지 않는다", () => {
    for (const s of ["원래 알고 있었음", "예온", "주변학원"]) {
      const b = pathBucket(s);
      expect(["기타", "워크인·주변"], `${s} → ${b}`).toContain(b);
    }
  });

  it("🔴 섞여 적힌 값은 소개가 이긴다 — 데려온 사람이 실제 유입 이유다", () => {
    expect(pathBucket("인터넷 김나윤 친구")).toBe("소개·추천");
    expect(pathBucket("인터넷, 간판 이준혁 친구")).toBe("소개·추천");
    expect(pathBucket("인터넷 (침산동수학학원) 지인추천")).toBe("소개·추천");
  });

  it("소개 단서가 없이 섞이면 앞선 규칙(인터넷)으로", () => {
    expect(pathBucket("인터넷, 간판")).toBe("인터넷");
  });
});

describe("bucketizePathStats", () => {
  const rows: PathStatRow[] = [
    { path: "지인 소개", total: 10, enrolled: 7, paidSum: 700 },
    { path: "재원생 추천", total: 5, enrolled: 4, paidSum: 400 },
    { path: "인터넷 검색", total: 8, enrolled: 4, paidSum: 300 },
    { path: null, total: 100, enrolled: 20, paidSum: 0 },
  ];

  it("합계가 입력 총합과 같다 — 어느 건도 집계에서 사라지지 않는다", () => {
    const out = bucketizePathStats(rows);
    expect(out.reduce((a, b) => a + b.total, 0)).toBe(123);
    expect(out.reduce((a, b) => a + b.enrolled, 0)).toBe(35);
  });

  it("전환율은 반올림 정수, 분모 0이면 null(0%로 적으면 '다 놓쳤다'로 읽힌다)", () => {
    const out = bucketizePathStats(rows);
    const refer = out.find((b) => b.bucket === "소개·추천")!;
    expect(refer.total).toBe(15);
    expect(refer.enrolled).toBe(11);
    expect(refer.rate).toBe(73); // 11/15 = 73.3%
    expect(bucketizePathStats([]).length).toBe(0);
  });

  it("미기재는 건수가 많아도 항상 맨 끝 — 지표가 아니라 데이터 품질 표시다", () => {
    const out = bucketizePathStats(rows);
    expect(out.at(-1)!.bucket).toBe("미기재");
    expect(out.at(-1)!.total).toBe(100);
  });

  it("원문 표본을 많은 순으로 달아 둔다 — '무엇이 이렇게 묶였나'를 화면에서 열어볼 수 있게", () => {
    const refer = bucketizePathStats(rows).find((b) => b.bucket === "소개·추천")!;
    expect(refer.samples.map((s) => s.path)).toEqual(["지인 소개", "재원생 추천"]);
  });
});
