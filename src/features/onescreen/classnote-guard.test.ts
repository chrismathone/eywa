import { describe, expect, it } from "vitest";
import {
  classnoteMinDate,
  classnoteSendWindowHint,
  isClassnoteAllowed,
  isClassnoteSubjectEnabled,
} from "./classnote-guard";

describe("classnoteMinDate", () => {
  it("전 달 1일", () => {
    expect(classnoteMinDate("2026-07-07")).toBe("2026-06-01");
    expect(classnoteMinDate("2026-07-01")).toBe("2026-06-01");
  });
  it("1월 → 전년 12월", () => {
    expect(classnoteMinDate("2026-01-10")).toBe("2025-12-01");
  });
});

describe("isClassnoteAllowed (KST 문자열 비교)", () => {
  const today = "2026-07-07"; // minDate 2026-06-01
  it("전 달 1일 이후는 허용", () => {
    expect(isClassnoteAllowed("2026-06-01", today)).toBe(true);
    expect(isClassnoteAllowed("2026-07-05", today)).toBe(true);
    expect(isClassnoteAllowed("2026-07-07", today)).toBe(true);
  });
  it("전 달 1일 이전은 차단(사고 방지)", () => {
    expect(isClassnoteAllowed("2026-05-31", today)).toBe(false);
    expect(isClassnoteAllowed("2026-01-15", today)).toBe(false);
  });
  it("빈 값은 차단", () => {
    expect(isClassnoteAllowed("", today)).toBe(false);
  });
  it("1월 경계", () => {
    expect(isClassnoteAllowed("2025-12-01", "2026-01-10")).toBe(true);
    expect(isClassnoteAllowed("2025-11-30", "2026-01-10")).toBe(false);
  });
});

describe("isClassnoteSubjectEnabled (과목별 발송 게이트)", () => {
  it("허용 목록에 든 과목만 발송", () => {
    expect(isClassnoteSubjectEnabled("math", ["math"])).toBe(true);
    expect(isClassnoteSubjectEnabled("english", ["math"])).toBe(false);
    expect(isClassnoteSubjectEnabled("math", ["math", "english"])).toBe(true);
    expect(isClassnoteSubjectEnabled("subject_1", ["subject_1"])).toBe(true);
  });
  it("빈 목록 = 어떤 과목도 발송 안 함(명시 opt-in)", () => {
    expect(isClassnoteSubjectEnabled("math", [])).toBe(false);
    expect(isClassnoteSubjectEnabled("english", [])).toBe(false);
  });
  // P0-2(2026-07-10): 구버전은 null→math 정규화로 통과시켰음 — 이관/레거시 행이 math opt-in에
  // 편승해 발송되는 벡터라 발송 경로에선 거부로 전환(조회용 정규화는 score-history 별도).
  it("subject=null/빈값은 발송 거부(이관·레거시 편승 차단)", () => {
    expect(isClassnoteSubjectEnabled(null, ["math"])).toBe(false);
    expect(isClassnoteSubjectEnabled(undefined, ["math"])).toBe(false);
    expect(isClassnoteSubjectEnabled("", ["math"])).toBe(false);
    expect(isClassnoteSubjectEnabled(null, ["english"])).toBe(false);
  });
  // P0-3(2026-07-10): 화이트리스트 밖 과목은 opt-in돼 있어도 거부 — 워커가 보드 라벨을 못 만들어
  // 전부 "(수학)" 보드로 가던 오게시 구멍 차단.
  it("발송 가능 화이트리스트 밖 과목은 opt-in돼도 거부", () => {
    expect(isClassnoteSubjectEnabled("science", ["science"])).toBe(false);
    expect(isClassnoteSubjectEnabled("subject_2", ["subject_2", "math"])).toBe(false);
  });
});

// 발송 허용 시간창 안내 — 워커 send-window.mjs의 앱측 미러(의미론 동일: fail-open·자정 넘김·시작 포함/종료 제외).
// 여긴 안내 문구만 담당(실제 지연은 워커 게이트) — 의미론이 어긋나면 안내만 틀리지만, 그래도 양쪽 함께 유지.
describe("classnoteSendWindowHint", () => {
  it("창 밖이면 창 라벨 반환(대기 안내 필요)", () => {
    expect(classnoteSendWindowHint("09:00", "21:00", 22 * 60)).toBe("09:00~21:00"); // 밤 10시
    expect(classnoteSendWindowHint("09:00", "21:00", 8 * 60)).toBe("09:00~21:00"); // 아침 8시
    expect(classnoteSendWindowHint("09:00", "21:00", 21 * 60)).toBe("09:00~21:00"); // 종료 정각 제외
  });
  it("창 안이면 null(안내 불필요)", () => {
    expect(classnoteSendWindowHint("09:00", "21:00", 9 * 60)).toBeNull(); // 시작 정각 포함
    expect(classnoteSendWindowHint("09:00", "21:00", 12 * 60)).toBeNull();
  });
  it("무제한(빈 값·한쪽만·형식 오류·시작=종료) = null — fail-open, 워커와 동일", () => {
    expect(classnoteSendWindowHint("", "", 22 * 60)).toBeNull();
    expect(classnoteSendWindowHint("09:00", "", 22 * 60)).toBeNull();
    expect(classnoteSendWindowHint("", "21:00", 22 * 60)).toBeNull();
    expect(classnoteSendWindowHint("9시", "21:00", 22 * 60)).toBeNull();
    expect(classnoteSendWindowHint("09:00", "09:00", 22 * 60)).toBeNull();
  });
  it("자정 넘김 창(21:00~08:00) — 낮이 창 밖", () => {
    expect(classnoteSendWindowHint("21:00", "08:00", 12 * 60)).toBe("21:00~08:00");
    expect(classnoteSendWindowHint("21:00", "08:00", 23 * 60)).toBeNull();
    expect(classnoteSendWindowHint("21:00", "08:00", 3 * 60)).toBeNull();
  });
});
