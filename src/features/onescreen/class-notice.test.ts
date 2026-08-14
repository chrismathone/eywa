/**
 * 반 전체 안내 판별 잠금 테스트.
 * 실측 배경(2026-08-13): 한 반 6명의 특이사항이 글자까지 동일 → 멘트도 6명이 거의 같아졌다.
 */
import { describe, expect, it } from "vitest";
import { detectClassNotices, MIN_SHARED, splitNoticeFromNote } from "./class-notice";

const NOTICE = "내일 특강은 1시입니다.\n중2-2 진도가 완료되었습니다. 내일은 전범위 시험있습니다.";

describe("detectClassNotices", () => {
  it("같은 반에서 특이사항이 전부 동일하면 반 공지다 — 실측 사례", () => {
    const rows = Array.from({ length: 6 }, () => ({ classId: "c1", note: NOTICE }));
    expect(detectClassNotices(rows).get("c1")).toBe(NOTICE);
  });

  it("🔴 한 명이라도 다르게 썼으면 손대지 않는다(개인 관찰이 섞인 것)", () => {
    const rows = [
      { classId: "c1", note: NOTICE },
      { classId: "c1", note: NOTICE },
      { classId: "c1", note: "오늘 개념을 어려워해 연습문제 한 번 더" },
    ];
    expect(detectClassNotices(rows).has("c1")).toBe(false);
  });

  it("한 명만 썼으면 반 공지가 아니다 — 그건 그냥 그 아이 특이사항", () => {
    expect(detectClassNotices([{ classId: "c1", note: NOTICE }]).has("c1")).toBe(false);
  });

  it("🔴 두 명이 우연히 같아도 반 공지로 보지 않는다 — 오판이 새 거짓을 만든다(적대 검토)", () => {
    const rows = [
      { classId: "c1", note: "조퇴" },
      { classId: "c1", note: "조퇴" },
    ];
    expect(detectClassNotices(rows).has("c1")).toBe(false);
  });

  it("안 쓴 학생은 판정에서 뺀다(전원이 써야 하는 건 아니다)", () => {
    const rows = [
      { classId: "c1", note: NOTICE },
      { classId: "c1", note: "" },
      { classId: "c1", note: "   " },
      { classId: "c1", note: NOTICE },
      { classId: "c1", note: NOTICE },
    ];
    expect(detectClassNotices(rows).get("c1")).toBe(NOTICE);
  });

  it("하한(MIN_SHARED)은 상수로 노출한다 — 기준을 바꾸면 테스트가 같이 움직이게", () => {
    const rows = Array.from({ length: MIN_SHARED }, () => ({ classId: "c1", note: NOTICE }));
    expect(detectClassNotices(rows).get("c1")).toBe(NOTICE);
    expect(detectClassNotices(rows.slice(0, MIN_SHARED - 1)).has("c1")).toBe(false);
  });

  it("공백·줄바꿈 차이는 같은 글로 본다(비교만 정규화, 원문은 보존)", () => {
    const rows = [
      { classId: "c1", note: "내일 특강은 1시입니다." },
      { classId: "c1", note: "내일  특강은 1시입니다.  " },
      { classId: "c1", note: "내일 특강은 1시입니다.\n" },
    ];
    expect(detectClassNotices(rows).get("c1")).toBe("내일 특강은 1시입니다."); // 첫 행 원문 그대로
  });

  it("반이 없는 행(순수 보강)은 '반 전체'가 성립하지 않아 무시한다", () => {
    const rows = [
      { classId: null, note: NOTICE },
      { classId: null, note: NOTICE },
      { classId: null, note: NOTICE },
    ];
    expect(detectClassNotices(rows).size).toBe(0);
  });

  it("반이 다르면 서로 섞이지 않는다", () => {
    const rows = [
      { classId: "c1", note: "A" },
      { classId: "c1", note: "A" },
      { classId: "c1", note: "A" },
      { classId: "c2", note: "B" },
      { classId: "c2", note: "B" },
      { classId: "c2", note: "B" },
    ];
    const m = detectClassNotices(rows);
    expect(m.get("c1")).toBe("A");
    expect(m.get("c2")).toBe("B");
  });
});

describe("splitNoticeFromNote — 둘 다에 넣지 않는다", () => {
  const notices = new Map([["c1", NOTICE]]);

  it("반 공지면 안내로만 가고 특이사항은 비운다", () => {
    expect(splitNoticeFromNote(NOTICE, "c1", notices)).toEqual({ classNotice: NOTICE, specialNote: "" });
  });

  it("개인 특이사항은 그대로 특이사항으로", () => {
    const own = "감기로 조퇴";
    expect(splitNoticeFromNote(own, "c1", notices)).toEqual({ classNotice: "", specialNote: own });
  });

  it("반 공지가 없는 반은 무조건 개인 특이사항", () => {
    expect(splitNoticeFromNote(NOTICE, "c9", notices)).toEqual({ classNotice: "", specialNote: NOTICE });
  });

  it("반이 없는 행(보강)도 개인 특이사항", () => {
    expect(splitNoticeFromNote(NOTICE, null, notices)).toEqual({ classNotice: "", specialNote: NOTICE });
  });
});
