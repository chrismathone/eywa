import { describe, expect, it } from "vitest";
import {
  DEFAULT_ENGLISH_TRACK,
  EIE_TRACK_UNAVAILABLE_MESSAGE,
  ENGLISH_TRACK_LABEL,
  eieTrackWriteError,
  keepEnglishTrack,
  matchesEnglishTrackFilter,
  normalizeEnglishTrack,
  normalizeEnglishTrackFilter,
  readEnglishTrack,
} from "./english-track";

describe("english-track — 저장값 읽기", () => {
  it("snake_case·camelCase 둘 다 읽는다(쿼리 매핑 전 raw row도 거른다)", () => {
    expect(readEnglishTrack({ english_track: "eie" })).toBe("eie");
    expect(readEnglishTrack({ englishTrack: "injaewon" })).toBe("injaewon");
  });

  it("모르는 값·null은 미분류(null)", () => {
    expect(readEnglishTrack({ english_track: null })).toBeNull();
    expect(readEnglishTrack({ english_track: "EIE" })).toBeNull(); // 대소문자 다른 값도 미분류
    expect(readEnglishTrack({})).toBeNull();
  });
});

describe("english-track — 필터", () => {
  const rows = [
    { id: "eie1", english_track: "eie" },
    { id: "inj1", english_track: "injaewon" },
    { id: "none", english_track: null }, // 미분류
  ];

  it("전체는 다 통과", () => {
    expect(keepEnglishTrack(rows, "all").map((r) => r.id)).toEqual(["eie1", "inj1", "none"]);
  });

  it("EiE는 정확히 일치한 것만", () => {
    expect(keepEnglishTrack(rows, "eie").map((r) => r.id)).toEqual(["eie1"]);
  });

  it("🔴 인재원 영어는 'EiE가 아닌 전부' — 미분류가 사라지지 않는다", () => {
    // 양쪽을 정확히 일치로 거르면 미분류 반이 두 필터 모두에서 증발한다(이 계약이 그걸 막는다).
    expect(keepEnglishTrack(rows, "injaewon").map((r) => r.id)).toEqual(["inj1", "none"]);
  });

  it("어떤 필터에서도 미분류 반은 최소 한 곳에 보인다", () => {
    const orphan = { english_track: null };
    const seen = (["eie", "injaewon"] as const).filter((f) => matchesEnglishTrackFilter(orphan, f));
    expect(seen.length).toBeGreaterThan(0);
  });

  it("깨진 저장값은 '전체'로 떨어진다(목록이 통째로 비지 않게)", () => {
    expect(normalizeEnglishTrackFilter("garbage")).toBe("all");
    expect(normalizeEnglishTrackFilter(undefined)).toBe("all");
    expect(normalizeEnglishTrackFilter("eie")).toBe("eie");
  });
});

describe("english-track — 폼 입력 정규화", () => {
  it("영어 반이 아니면 항상 null(다른 과목엔 트랙 개념이 없다)", () => {
    expect(normalizeEnglishTrack("math", "eie")).toBeNull();
    expect(normalizeEnglishTrack("english", "eie")).toBe("eie");
  });

  it("영어 반이어도 모르는 값은 null", () => {
    expect(normalizeEnglishTrack("english", "")).toBeNull();
    expect(normalizeEnglishTrack("english", undefined)).toBeNull();
  });

  it("기본값은 미분류와 같은 칸에 보인다(저장 전후로 자리가 안 바뀌게)", () => {
    expect(matchesEnglishTrackFilter({ english_track: DEFAULT_ENGLISH_TRACK }, "injaewon")).toBe(true);
    expect(matchesEnglishTrackFilter({ english_track: null }, "injaewon")).toBe(true);
  });

  it("라벨은 한글(raw 코드 노출 금지)", () => {
    expect(ENGLISH_TRACK_LABEL.injaewon).toBe("인재원 영어");
    expect(ENGLISH_TRACK_LABEL.eie).toBe("EiE");
  });
});

describe("english-track — 꺼진 지점의 새 EiE 지정 차단", () => {
  it("꺼진 지점은 새 반 생성과 다른 구분에서 EiE로 바꾸기를 거절한다", () => {
    expect(eieTrackWriteError(false, "eie")).toBe(EIE_TRACK_UNAVAILABLE_MESSAGE);
    expect(eieTrackWriteError(false, "eie", "injaewon")).toBe(EIE_TRACK_UNAVAILABLE_MESSAGE);
  });

  it("꺼진 지점도 기존 EiE 반의 값 보존 수정은 허용한다", () => {
    expect(eieTrackWriteError(false, "eie", "eie")).toBeNull();
    expect(eieTrackWriteError(false, "injaewon", "eie")).toBeNull();
  });

  it("켜진 지점(침산)은 생성·변경 모두 종전처럼 허용한다", () => {
    expect(eieTrackWriteError(true, "eie")).toBeNull();
    expect(eieTrackWriteError(true, "eie", "injaewon")).toBeNull();
  });
});
