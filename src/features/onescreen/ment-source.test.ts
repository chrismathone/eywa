import { describe, it, expect } from "vitest";
import {
  computeClientMentSource,
  isMentSourceMissingError,
  parseMentSource,
  resolveMentSource,
} from "./ment-source";

describe("parseMentSource — 신뢰 경계 정규화", () => {
  it("알려진 3값만 통과", () => {
    expect(parseMentSource("auto")).toBe("auto");
    expect(parseMentSource("auto_edited")).toBe("auto_edited");
    expect(parseMentSource("manual")).toBe("manual");
  });
  it("그 외(임의 문자열·null·숫자)는 undefined", () => {
    expect(parseMentSource("ai")).toBeUndefined();
    expect(parseMentSource("")).toBeUndefined();
    expect(parseMentSource(null)).toBeUndefined();
    expect(parseMentSource(3)).toBeUndefined();
  });
});

describe("computeClientMentSource — 세션 스냅샷 비교", () => {
  it("멘트 없음 → undefined(저장 시 null)", () => {
    expect(computeClientMentSource("", "AI 문장")).toBeUndefined();
    expect(computeClientMentSource("   ", null)).toBeUndefined();
  });
  it("자동작성 그대로 = auto (trim 차이는 동일 취급)", () => {
    expect(computeClientMentSource("오늘 수업 잘했습니다.", "오늘 수업 잘했습니다.")).toBe("auto");
    expect(computeClientMentSource("  오늘 수업 잘했습니다. ", "오늘 수업 잘했습니다.")).toBe("auto");
  });
  it("자동작성 후 수정 = auto_edited (전부 지우고 새로 써도 세션 안이면 auto_edited — 보수 규칙)", () => {
    expect(computeClientMentSource("오늘 수업 아주 잘했습니다.", "오늘 수업 잘했습니다.")).toBe("auto_edited");
    expect(computeClientMentSource("완전히 새로 쓴 문장", "AI 문장")).toBe("auto_edited");
  });
  it("자동작성 이력 없음 = manual", () => {
    expect(computeClientMentSource("직접 쓴 멘트", "")).toBe("manual");
    expect(computeClientMentSource("직접 쓴 멘트", null)).toBe("manual");
  });
});

describe("resolveMentSource — 서버 최종 판정(sticky)", () => {
  it("새 멘트 없음 → null (클라가 뭐라 하든)", () => {
    expect(resolveMentSource({ client: "manual", nextNotes: "" })).toBeNull();
    expect(resolveMentSource({ client: "auto", prevSource: "manual", prevNotes: "이전", nextNotes: "  " })).toBeNull();
  });
  it("텍스트 불변 → 기존 라벨 유지(도입 전 행 null도 그대로 — 안 고친 저장이 라벨을 지어내지 않는다)", () => {
    expect(resolveMentSource({ client: "manual", prevSource: "auto", prevNotes: "같은 문장", nextNotes: "같은 문장" })).toBe("auto");
    expect(resolveMentSource({ client: "manual", prevSource: null, prevNotes: "같은 문장", nextNotes: "같은 문장" })).toBeNull();
    // 알 수 없는 저장값(임의 문자열)도 지어내지 않고 null
    expect(resolveMentSource({ client: "manual", prevSource: "ai", prevNotes: "같은 문장", nextNotes: "같은 문장" })).toBeNull();
  });
  it("클라 auto/auto_edited는 신뢰(자동작성 사실은 클라만 안다)", () => {
    expect(resolveMentSource({ client: "auto", nextNotes: "AI 문장" })).toBe("auto");
    expect(resolveMentSource({ client: "auto_edited", prevSource: "manual", prevNotes: "이전", nextNotes: "수정" })).toBe("auto_edited");
  });
  it("클라 manual + 기존 auto 계열 → auto_edited로 강등(어제 AI 멘트를 오늘 새 세션에서 고친 경우)", () => {
    expect(resolveMentSource({ client: "manual", prevSource: "auto", prevNotes: "AI 문장", nextNotes: "고친 문장" })).toBe("auto_edited");
    expect(resolveMentSource({ client: "manual", prevSource: "auto_edited", prevNotes: "AI 문장", nextNotes: "고친 문장" })).toBe("auto_edited");
  });
  it("클라 manual + 기존 manual/없음 → manual", () => {
    expect(resolveMentSource({ client: "manual", nextNotes: "직접 쓴 멘트" })).toBe("manual");
    expect(resolveMentSource({ client: "manual", prevSource: "manual", prevNotes: "이전", nextNotes: "고침" })).toBe("manual");
  });
  it("클라 판정 없음(구 클라·서버 직접) → 기존 auto 계열이면 auto_edited, 아니면 null", () => {
    expect(resolveMentSource({ prevSource: "auto", prevNotes: "AI 문장", nextNotes: "고친 문장" })).toBe("auto_edited");
    expect(resolveMentSource({ nextNotes: "누가 썼는지 모르는 문장" })).toBeNull();
    expect(resolveMentSource({ prevSource: "manual", prevNotes: "이전", nextNotes: "고침" })).toBeNull();
  });
});

describe("isMentSourceMissingError — 0214a 미적용 판별", () => {
  it("select(42703)·upsert(PGRST204) 메시지 모두 잡는다", () => {
    expect(isMentSourceMissingError("column lesson_reports.ment_source does not exist")).toBe(true);
    expect(
      isMentSourceMissingError("Could not find the 'ment_source' column of 'lesson_reports' in the schema cache"),
    ).toBe(true);
  });
  it("다른 에러는 아니다", () => {
    expect(isMentSourceMissingError("permission denied for table lesson_reports")).toBe(false);
    expect(isMentSourceMissingError(null)).toBe(false);
    expect(isMentSourceMissingError(undefined)).toBe(false);
  });
});
