/**
 * 특이사항 속 학부모께 드리는 사과 문장 = AI를 거치지 않고 멘트 맨 앞에(2026-09-22 강사 제보 — 네 명 중 한 명에게만 반영됐다).
 */
import { describe, expect, it } from "vitest";
import { prependParentAddress, splitParentAddress } from "./parent-address";

const APOLOGY = "9월 18일(금) 수업일지 발송을 누락시켜서 늦게 보내드려서 죄송합니다.";
// 제보 캡처의 특이사항 그대로(세 줄)
const NOTE = `${APOLOGY}\n제곱근과 실수에 대한 개념영상 발표 내용 정리해 오세요.\n3학년 2학기 월말평가에서 72점으로 다음시간에 재시험 있습니다.`;

describe("splitParentAddress", () => {
  it("제보 사례 — 사과 줄만 떼고 나머지 줄은 그대로 AI 재료로", () => {
    const { address, rest } = splitParentAddress(NOTE);
    expect(address).toEqual([APOLOGY]);
    expect(rest).toBe("제곱근과 실수에 대한 개념영상 발표 내용 정리해 오세요.\n3학년 2학기 월말평가에서 72점으로 다음시간에 재시험 있습니다.");
  });

  it("한 줄 안에 섞여 있어도 문장 단위로 가른다", () => {
    const { address, rest } = splitParentAddress("늦게 보내 드려 죄송합니다. 오늘은 개념을 어려워했습니다.");
    expect(address).toEqual(["늦게 보내 드려 죄송합니다."]);
    expect(rest).toBe("오늘은 개념을 어려워했습니다.");
  });

  it("양해·사과드립니다도 전할 말", () => {
    expect(splitParentAddress("다음 주 수업 시간이 바뀝니다. 양해 부탁드립니다").address).toEqual(["양해 부탁드립니다"]);
    expect(splitParentAddress("일정 변경으로 불편을 드려 사과드립니다.").address).toHaveLength(1);
  });

  it("아이의 말을 전하는 관찰은 건드리지 않는다(끝이 사과가 아니다)", () => {
    const note = "지각해서 죄송하다고 했습니다. 죄송합니다라고 말하고 자리에 앉았습니다.";
    const { address, rest } = splitParentAddress(note);
    expect(address).toEqual([]);
    expect(rest).toBe(note);
  });

  it("비었거나 없으면 빈 결과(종전과 같다)", () => {
    expect(splitParentAddress("")).toEqual({ address: [], rest: "" });
    expect(splitParentAddress(null)).toEqual({ address: [], rest: "" });
    expect(splitParentAddress("조퇴함")).toEqual({ address: [], rest: "조퇴함" });
  });

  it("공백 없이 붙은 마침표·부호 없이 이어 쓴 존댓말도 문장 경계로 본다", () => {
    expect(splitParentAddress("오늘 개념 어려워함.늦게 보내 죄송합니다.")).toEqual({
      address: ["늦게 보내 죄송합니다."],
      rest: "오늘 개념 어려워함.",
    });
    expect(splitParentAddress("숙제를 안 해와서 남아서 하고 갔습니다 늦게 보내드려 죄송합니다").address).toEqual(["늦게 보내드려 죄송합니다"]);
  });

  it("개조식 나열·긴 문장은 AI에 맡긴다(관찰이 원문 그대로 첫 줄에 서지 않게)", () => {
    expect(splitParentAddress("개념이해 부족, 오답노트 작성 필요, 늦게 보내드려 죄송합니다").address).toEqual([]);
    const long = `${"오늘은 수업 중에 여러 번 자리를 비웠고 문제를 거의 풀지 못해 남아서 보충하고 돌아갔습니다 ".repeat(2)}죄송합니다`;
    expect(splitParentAddress(long.replace(/니다 /g, "니다, ")).address).toEqual([]);
  });

  it("인용·화자 표기는 선생님의 사과가 아니다", () => {
    const quoted = '학생이 "늦어서 죄송합니다. 다음부터 일찍 올게요"라고 했습니다.';
    expect(splitParentAddress(quoted)).toEqual({ address: [], rest: quoted });
    expect(splitParentAddress("민수: 선생님 죄송합니다.").address).toEqual([]);
  });

  it("🔴 아이의 말을 옮긴 문장 한가운데의 '죄송합니다'는 떼지 않는다(마지막 토막만 후보)", () => {
    for (const note of ["지각해서 선생님 죄송합니다 하고 들어왔습니다.", "숙제를 못 해 와서 죄송합니다 라고 하며 화장실 다녀옴"]) {
      expect(splitParentAddress(note)).toEqual({ address: [], rest: note });
    }
  });

  it("주소·영문 이름·쪽수의 마침표는 안 쪼갠다(AI 재료가 깨지지 않게)", () => {
    const note = "자료는 drive.google.com 에 올렸습니다. Mr.Kim 선생님 보강. ~63p.설공까지. 늦게 보내 죄송합니다.";
    const { address, rest } = splitParentAddress(note);
    expect(address).toEqual(["늦게 보내 죄송합니다."]);
    expect(rest).toContain("drive.google.com");
    expect(rest).toContain("Mr.Kim");
    expect(rest).toContain("63p.설공");
  });

  it("띄어 쓴 표현·끝의 이모티콘도 잡는다", () => {
    expect(splitParentAddress("일정이 바뀌었습니다. 양해 부탁 드립니다^^").address).toEqual(["양해 부탁 드립니다^^"]);
  });

  it("떼어 낼 문장이 없는 줄은 띄어쓰기까지 원문 그대로", () => {
    expect(splitParentAddress("A반.  B반  함께").rest).toBe("A반.  B반  함께");
  });

  it("소수점은 문장 경계가 아니다", () => {
    expect(splitParentAddress("1.9까지 풀었습니다").rest).toBe("1.9까지 풀었습니다");
  });
});

describe("prependParentAddress", () => {
  it("전할 말을 맨 앞 줄로", () => {
    expect(prependParentAddress("수업 태도가 매우 좋았습니다.", [APOLOGY])).toBe(`${APOLOGY}\n수업 태도가 매우 좋았습니다.`);
  });
  it("전할 말이 없으면 멘트 그대로(같은 참조 값)", () => {
    expect(prependParentAddress("멘트", [])).toBe("멘트");
  });
  it("특이사항·반 안내에 같은 문장이 둘이면 한 번만", () => {
    expect(prependParentAddress("멘트", [APOLOGY, APOLOGY])).toBe(`${APOLOGY}\n멘트`);
  });
  it("멘트가 비면 전할 말만", () => {
    expect(prependParentAddress("", [APOLOGY])).toBe(APOLOGY);
  });
});
