import { describe, expect, it } from "vitest";
import {
  buildTextbookNoticeBody,
  composeTextbookNotice,
  DEFAULT_TEXTBOOK_MENT,
  fillMentTemplate,
  formatWon,
  mentHasTokens,
  TEXTBOOK_NOTICE_HEADER,
  textbookNoticeCommon,
  textbookNoticeIndividual,
  type TextbookNoticeInput,
} from "./textbook-notice";

const ACCOUNT = { bank: "국민은행", holder: "인재원", number: "123456-04-567890" };

const base: TextbookNoticeInput = {
  bookName: "쎈 중등수학 3-1",
  bookDetail: "3단원 이차방정식",
  price: 12000,
  requestDate: "2026-07-21",
  account: ACCOUNT,
};

describe("formatWon", () => {
  it("천단위 콤마를 넣는다", () => {
    expect(formatWon(12000)).toBe("12,000");
    expect(formatWon(1234567)).toBe("1,234,567");
    expect(formatWon(999)).toBe("999");
  });

  it("음수·NaN은 0으로 (학부모에게 음수 금액 표기 금지)", () => {
    expect(formatWon(-5000)).toBe("0");
    expect(formatWon(Number.NaN)).toBe("0");
    expect(formatWon(null)).toBe("0");
  });
});

describe("fillMentTemplate", () => {
  it("기본 문구의 {학생}·{교재명}·{금액}을 치환한다", () => {
    const out = fillMentTemplate(DEFAULT_TEXTBOOK_MENT, {
      studentName: "김민수",
      bookName: "쎈 중등수학 3-1",
      price: 12000,
    });
    expect(out).toBe(
      "안녕하세요. 김민수이 쎈 중등수학 3-1 교재를 신청합니다. 금액은 12,000원이며 아래 계좌로 납부 부탁드립니다.",
    );
    expect(out).not.toContain("{");
  });

  it("치환 토큰이 없으면 원문 그대로 둔다(강사 자유 문장 보호)", () => {
    const free = "어머님, 이번 주 수업부터 새 교재를 사용합니다.\n확인 부탁드려요.";
    expect(fillMentTemplate(free, { studentName: "김민수", bookName: "쎈", price: 1000 })).toBe(free);
    expect(mentHasTokens(free)).toBe(false);
    expect(mentHasTokens(DEFAULT_TEXTBOOK_MENT)).toBe(true);
  });

  it("값이 비어도 raw 토큰을 학부모에게 노출하지 않는다", () => {
    const out = fillMentTemplate("{학생} 학생 {교재명} 신청", { studentName: null, bookName: "" });
    expect(out).not.toContain("{학생}");
    expect(out).not.toContain("{교재명}");
    expect(out).not.toMatch(/ {2}/); // 남는 연속 공백 정리
  });
});

describe("buildTextbookNoticeBody", () => {
  it("멘트 + 교재 + 금액 + 계좌 + 요청일을 순서대로 조립한다", () => {
    const body = buildTextbookNoticeBody({ ...base, ment: "안녕하세요. 교재 안내드립니다." });
    expect(body).toBe(
      [
        "안녕하세요. 교재 안내드립니다.",
        "",
        "[교재] 쎈 중등수학 3-1 (3단원 이차방정식)",
        "[금액] 12,000원",
        "[입금 계좌] 국민은행 123456-04-567890 (예금주 인재원)",
        "[요청일] 2026-07-21",
      ].join("\n"),
    );
  });

  it("멘트가 비면 멘트 줄 없이 교재 정보만(앞 빈 줄 없음)", () => {
    const body = buildTextbookNoticeBody(base);
    expect(body.startsWith("[교재]")).toBe(true);
    expect(body).not.toContain("\n\n\n");
  });

  it("계좌 정보가 없으면 계좌 줄 자체를 생략한다", () => {
    expect(buildTextbookNoticeBody({ ...base, account: null })).not.toContain("입금 계좌");
    expect(buildTextbookNoticeBody({ ...base, account: undefined })).not.toContain("입금 계좌");
    expect(
      buildTextbookNoticeBody({ ...base, account: { bank: "", holder: "", number: "" } }),
    ).not.toContain("입금 계좌");
    // 예금주만 있고 은행·번호가 없으면 계좌를 특정할 수 없어 역시 생략
    expect(
      buildTextbookNoticeBody({ ...base, account: { bank: "", holder: "인재원", number: "" } }),
    ).not.toContain("입금 계좌");
  });

  it("계좌가 일부만 있으면 있는 값만 쓴다(빈 값 노출 금지)", () => {
    const body = buildTextbookNoticeBody({ ...base, account: { bank: "", holder: "", number: "110-222-333" } });
    expect(body).toContain("[입금 계좌] 110-222-333");
    expect(body).not.toContain("예금주");
    expect(body).not.toContain("()");
  });

  it("상세(단원)가 없으면 괄호를 붙이지 않는다", () => {
    const body = buildTextbookNoticeBody({ ...base, bookDetail: null });
    const bookLine = body.split("\n").find((l) => l.startsWith("[교재]"));
    expect(bookLine).toBe("[교재] 쎈 중등수학 3-1");
    expect(buildTextbookNoticeBody({ ...base, bookDetail: "   " })).toContain("[교재] 쎈 중등수학 3-1\n");
  });

  it("금액 0·음수는 금액 줄을 생략한다(0원/-원 표기 금지)", () => {
    expect(buildTextbookNoticeBody({ ...base, price: 0 })).not.toContain("[금액]");
    expect(buildTextbookNoticeBody({ ...base, price: -12000 })).not.toContain("[금액]");
    expect(buildTextbookNoticeBody({ ...base, price: Number.NaN })).not.toContain("[금액]");
  });

  it("요청일이 없으면 요청일 줄을 생략한다", () => {
    expect(buildTextbookNoticeBody({ ...base, requestDate: null })).not.toContain("[요청일]");
  });

  it("교재명이 비면 교재 줄을 생략한다(빈 라벨 노출 금지)", () => {
    expect(buildTextbookNoticeBody({ ...base, bookName: "  " })).not.toContain("[교재]");
  });

  it("사무실 내부 메모(notes)는 어떤 경로로도 본문에 들어가지 않는다", () => {
    // 입력 타입에 notes가 없지만, 호출부가 행(row)을 통째로 넘겨도 새어나가지 않아야 한다.
    const withNotes = { ...base, notes: "사무실 전달: 급해요 이번 주 수업에 필요" } as TextbookNoticeInput;
    const body = buildTextbookNoticeBody(withNotes);
    expect(body).not.toContain("급해요");
    expect(body).not.toContain("사무실");
  });
});

describe("composeTextbookNotice (공통/개별 분리)", () => {
  it("토큰 멘트는 학생마다 달라지므로 공통엔 머리말, 개별에 치환된 멘트", () => {
    const c = composeTextbookNotice(DEFAULT_TEXTBOOK_MENT, { ...base, studentName: "김민수" });
    expect(c.common).toBe(TEXTBOOK_NOTICE_HEADER);
    expect(c.individual).toContain("김민수이 쎈 중등수학 3-1 교재를 신청합니다");
    expect(c.individual).toContain("[금액] 12,000원");
    // 워커가 게시하는 형태 = 공통 + 빈 줄 + 개별
    expect(c.full).toBe(`${c.common}\n\n${c.individual}`);
    // 같은 멘트가 두 번 나오지 않는다
    expect(c.full.match(/신청합니다/g)?.length).toBe(1);
  });

  it("토큰 없는 멘트는 전원 공통이라 공통 body로 나가고 개별엔 교재 정보만", () => {
    const ment = "어머님, 새 교재 안내드립니다.";
    const c = composeTextbookNotice(ment, { ...base, studentName: "김민수" });
    expect(c.common).toBe(ment);
    expect(c.individual.startsWith("[교재]")).toBe(true);
    expect(c.full.match(/새 교재 안내드립니다/g)?.length).toBe(1);
  });

  it("멘트가 비면 공통은 머리말, 개별은 교재 정보만", () => {
    const c = composeTextbookNotice("   ", { ...base, studentName: "김민수" });
    expect(c.common).toBe(TEXTBOOK_NOTICE_HEADER);
    expect(textbookNoticeCommon(null)).toBe(TEXTBOOK_NOTICE_HEADER);
    expect(c.individual.startsWith("[교재]")).toBe(true);
  });

  it("학생별 개별 본문은 학생 이름만 다르고 교재 정보는 같다", () => {
    const a = textbookNoticeIndividual(DEFAULT_TEXTBOOK_MENT, { ...base, studentName: "김민수" });
    const b = textbookNoticeIndividual(DEFAULT_TEXTBOOK_MENT, { ...base, studentName: "이서연" });
    expect(a).toContain("김민수");
    expect(b).toContain("이서연");
    expect(a).not.toContain("이서연");
    expect(a.split("[교재]")[1]).toBe(b.split("[교재]")[1]);
  });
});
