import { describe, expect, it } from "vitest";
import { resolveNoticeTargets, type NoticeCandidate } from "./notice-targets";

const ALLOWED = ["math"]; // 현 운영 opt-in

const cand = (over: Partial<NoticeCandidate>): NoticeCandidate => ({
  studentId: "s1",
  name: "김민수",
  classnoteName: null,
  subject: "math",
  ...over,
});

describe("resolveNoticeTargets", () => {
  it("기본: 유효이름으로 (수학)보드 타깃 생성", () => {
    const { targets, skipped } = resolveNoticeTargets([cand({})], ALLOWED);
    expect(targets).toEqual([{ studentId: "s1", studentName: "김민수", board: "(수학)김민수" }]);
    expect(skipped).toEqual([]);
  });

  it("classnote_name 오버라이드가 보드명을 결정", () => {
    const { targets } = resolveNoticeTargets([cand({ name: "박서준C", classnoteName: "박서준" })], ALLOWED);
    expect(targets[0].board).toBe("(수학)박서준");
  });

  it("opt-in 밖 과목·미지원 과목은 subject_off로 제외 — 발송 게이트와 동일", () => {
    const { targets, skipped } = resolveNoticeTargets(
      [cand({ subject: "english" }), cand({ studentId: "s2", subject: null }), cand({ studentId: "s3", subject: "art" })],
      ALLOWED,
    );
    expect(targets).toEqual([]);
    expect(skipped.map((s) => s.reason)).toEqual(["subject_off", "subject_off", "subject_off"]);
  });

  it("같은 학생이 여러 반에서 뽑혀도 같은 보드는 1회(중복 제거)", () => {
    const { targets } = resolveNoticeTargets([cand({}), cand({})], ALLOWED);
    expect(targets).toHaveLength(1);
  });

  it("서로 다른 학생이 같은 보드명이면 양쪽 다 name_collision 제외(동명이인 오발송 방지)", () => {
    const { targets, skipped } = resolveNoticeTargets(
      [cand({ studentId: "a" }), cand({ studentId: "b" })],
      ALLOWED,
    );
    expect(targets).toEqual([]);
    expect(skipped.filter((s) => s.reason === "name_collision")).toHaveLength(2);
  });

  it("subject_1(수학 계열)도 (수학) 보드 — 화이트리스트와 동일 매핑", () => {
    const { targets } = resolveNoticeTargets([cand({ subject: "subject_1" })], ["subject_1"]);
    expect(targets[0].board).toBe("(수학)김민수");
  });
});
