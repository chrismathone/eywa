/**
 * 명단 매칭 — **실측 5건**으로 고정.
 *
 * 시트는 원장이 손으로 쓰는 문서라 동명이인 접미사를 안 붙인다. `matchStudent`는 이름 완전일치가
 * 0건이면 즉시 포기해서 이 다섯을 전부 놓쳤다(2026-08-29 적대 리뷰 grok이 지적, 코드로 확인).
 * 놓치면 그 학생이 "명단에 없는 사람"이 되어 **수강이 종료 후보로 넘어간다** — 조용한 데이터 손실이다.
 */
import { describe, expect, it } from "vitest";
import { matchRosterStudent, type RosterStudentRef } from "./match-roster";

const S = (
  studentId: string,
  name: string,
  school: string | null,
  grade: string | null,
  status = "enrolled",
): RosterStudentRef => ({ studentId, name, school, grade, status });

/** 실측 DB 모양(2026-08-29). 퇴원 형제가 섞여 있는 것이 핵심이다. */
const DB: RosterStudentRef[] = [
  S("s1", "이도윤", "침산중", "중2", "withdrawn"),
  S("s2", "이도윤A", "침산중고", "중3", "withdrawn"),
  S("s3", "이도윤B", "칠성초", "초3"),
  S("s4", "김준서", "성광중", "중2", "withdrawn"),
  S("s5", "김준서A", "칠성초", "초6"),
  S("s6", "박서준", "칠성초", "초6"),
  S("s7", "박서준B", "칠성초", "초6", "withdrawn"),
  S("s8", "박서준C", "성광중", "중3"),
  S("s9", "박인유", "종로초", "초4", "withdrawn"),
  S("s10", "김하윤C", "침산초", "초1"),
  S("s11", "이서은A", "대구일중", "중2"),
  S("s12", "이서은", "경북여상", "고2"),
];

describe("matchRosterStudent — 실측 5건", () => {
  it("이도윤(칠성초3) → 이도윤B (접미사 형제 + 학교·학년)", () => {
    expect(matchRosterStudent("이도윤", "칠성초", "초3", DB)).toMatchObject({
      status: "ok",
      studentId: "s3",
      viaSuffix: true,
    });
  });

  it("김준서(칠성초6) → 김준서A", () => {
    expect(matchRosterStudent("김준서", "칠성초", "초6", DB)).toMatchObject({
      status: "ok",
      studentId: "s5",
      viaSuffix: true,
    });
  });

  it("박서준 C(성광중3) → 박서준C (공백 표기차)", () => {
    expect(matchRosterStudent("박서준 C", "성광중", "중3", DB)).toMatchObject({
      status: "ok",
      studentId: "s8",
      viaSuffix: false, // 공백만 다르므로 정규화 후엔 완전일치다
    });
  });

  it("박인유(종로초4) → 퇴원 학생이라도 **매칭은 된다**(제외 판단은 호출부 몫)", () => {
    // 여기서 status로 거르면 "왜 이 아이만 빠졌지"의 이유를 호출부가 설명할 수 없다.
    expect(matchRosterStudent("박인유", "종로초", "초4", DB)).toMatchObject({
      status: "ok",
      studentId: "s9",
    });
  });

  it("이서은(경북여상, 학년 미상) → 학교로만 좁혀 확정", () => {
    // 실업계라 파서가 학년을 비운다(경북여상2 → 학년 null). 학교만으로도 유일하다.
    expect(matchRosterStudent("이서은", "경북여상", null, DB)).toMatchObject({
      status: "ok",
      studentId: "s12",
      viaSuffix: false,
    });
  });
});

describe("matchRosterStudent — 안전장치", () => {
  it("완전일치가 유일하면 그대로 쓴다(232/237의 빠른 길)", () => {
    expect(matchRosterStudent("김하윤C", "침산초", "초1", DB)).toMatchObject({
      status: "ok",
      studentId: "s10",
      viaSuffix: false,
    });
  });

  it("학교가 어긋나도 다른 축으로 유일하면 고른다(시트 학교 표기는 흔들린다)", () => {
    // 🔴 하드 필터로 거르면 안 되는 이유가 이것이다 — 실측 237명 중 21명이 시트와 DB의 학교·학년이
    //    다르다(`일중` vs `대구일중`이 DB에 둘 다 있고, 진급 반영 시차·전학도 섞인다). 거르면 그들이
    //    '명단에 없는 사람'이 되어 수강이 종료 후보로 넘어간다 = 조용한 퇴출.
    expect(matchRosterStudent("이도윤", "없는초", "초3", DB)).toMatchObject({
      status: "ok",
      studentId: "s3",
      basis: "grade",
    });
  });

  it("어떤 축으로도 안 갈리면 고르지 않는다", () => {
    // 학교·학년 둘 다 어긋나고 재원 형제가 여럿이면 근거가 없다 — 사람이 정해야 한다.
    const twins = [
      S("t1", "한별A", "칠성초", "초3"),
      S("t2", "한별B", "칠성초", "초3"),
    ];
    expect(matchRosterStudent("한별", "없는초", "고9", twins).status).toBe("ambiguous");
  });

  it("완전일치라도 학교가 모순되면 안 고른다 — 실측 이도윤 함정", () => {
    // DB에 `이도윤`(침산중2·퇴원)이 있어서 완전일치는 1건이다. 그걸 믿으면 **퇴원한 남**을 옮긴다.
    // 시트가 준 학교·학년은 이름과 동급의 증거다.
    const r = matchRosterStudent("이도윤", "칠성초", "초3", DB);
    expect(r).toMatchObject({ status: "ok", studentId: "s3" });
  });

  it("형제의 학교·학년까지 같으면 시트에 적힌 그대로의 이름을 고른다", () => {
    // 제외하면 그 학생이 '명단에 없는 사람'이 되어 수강이 종료 후보로 넘어간다 — 조용한 이탈이
    // 잘못 고르는 것만큼 나쁘다. 문자 그대로 일치하는 후보가 최선의 근거다.
    const twins = [S("t1", "한별", "칠성초", "초3"), S("t2", "한별A", "칠성초", "초3")];
    expect(matchRosterStudent("한별", "칠성초", "초3", twins)).toMatchObject({
      status: "ok",
      studentId: "t1",
      viaSuffix: false,
    });
  });

  it("문자 그대로도 안 갈리면 ambiguous로 남긴다", () => {
    const twins = [S("t1", "한별A", "칠성초", "초3"), S("t2", "한별B", "칠성초", "초3")];
    expect(matchRosterStudent("한별", "칠성초", "초3", twins).status).toBe("ambiguous");
  });

  it("아예 없는 이름은 none", () => {
    expect(matchRosterStudent("없는사람", "칠성초", "초3", DB)).toEqual({ status: "none" });
  });

  it("빈 이름은 none", () => {
    expect(matchRosterStudent("", "칠성초", "초3", DB)).toEqual({ status: "none" });
  });
});
