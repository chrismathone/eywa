import { describe, expect, it } from "vitest";
import {
  buildTextbookNoticeBody,
  composeTextbookNotice,
  DEFAULT_TEXTBOOK_MENT,
  fillMentTemplate,
  formatWon,
  mentHasTokens,
  LEGACY_TEXTBOOK_MENTS,
  resolveTextbookMent,
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
      "안녕하세요. 김민수 학생의 쎈 중등수학 3-1 교재를 신청합니다. 금액은 12,000원이며 아래 계좌로 납부 부탁드립니다.",
    );
    expect(out).not.toContain("{");
  });

  // 🔴 2026-08-03 원장: "'이하준이'로 나가서 완전 어색해." 받침 판정은 맞았지만(준=받침 ㄴ → 이)
  //    학부모가 읽기엔 아이 이름을 부르는 말투로 읽힌다 → 기본 문구는 **주어 조사를 아예 안 쓴다**.
  it("기본 문구는 {학생} 뒤에 조사를 붙이지 않는다 — '~ 학생의'로 받는다", () => {
    expect(DEFAULT_TEXTBOOK_MENT).toContain("{학생} 학생의");
    // 어떤 이름이 와도 '이/가'가 붙지 않는다(받침 있는 이름·없는 이름 둘 다).
    for (const name of ["이하준", "김지우"]) {
      const out = fillMentTemplate(DEFAULT_TEXTBOOK_MENT, { studentName: name, bookName: "쎈", price: 1000 });
      expect(out).toContain(`${name} 학생의`);
      expect(out).not.toContain(`${name}이 `);
      expect(out).not.toContain(`${name}가 `);
    }
  });

  // 🔴 2026-07-31 실사고: 템플릿의 `{학생}이`가 그대로 나가 "김지우이 …"가 학부모에게 발송됐다.
  //    기본 문구에선 조사를 걷어냈지만(위) **원장이 화면에서 조사를 다시 쓸 수 있으므로** 규칙은 그대로 잠근다.
  const JOSA_TEMPLATE = "{학생}이 {교재명} 교재를 신청합니다.";
  it("토큰 뒤 조사를 받침에 맞춘다 — 학부모가 읽는 글이다", () => {
    const of = (studentName: string) =>
      fillMentTemplate(JOSA_TEMPLATE, { studentName, bookName: "쎈", price: 1000 });
    expect(of("김지우")).toContain("김지우가 쎈 교재를"); // 받침 없음 → 가 (실제 사고 사례)
    expect(of("김민수")).toContain("김민수가 쎈 교재를");
    expect(of("박성혁")).toContain("박성혁이 쎈 교재를"); // 받침 있음 → 이
    expect(of("김태희A")).toContain("김태희A가 쎈 교재를"); // 동명이인 접미 A(에이) → 가
    expect(of("이수빈L")).toContain("이수빈L이 쎈 교재를"); // L(엘) → 이
  });

  it("원장이 템플릿의 조사를 바꿔도 받침 규칙이 적용된다", () => {
    const t = "{학생}은 {교재명}을 신청했습니다.";
    // 쎈=받침 ㄴ → 을 · 가우스=받침 없음 → 를 (교재명도 같은 규칙을 탄다)
    expect(fillMentTemplate(t, { studentName: "김지우", bookName: "쎈" })).toBe("김지우는 쎈을 신청했습니다.");
    expect(fillMentTemplate(t, { studentName: "박성혁", bookName: "가우스" })).toBe(
      "박성혁은 가우스를 신청했습니다.",
    );
  });

  it("조사가 아닌 글자는 건드리지 않는다(오작동 방지)", () => {
    // `{교재명}과학` — `과`를 조사로 오인하면 "…와학"이 된다. 뒤에 한글이 오면 조사로 안 본다.
    expect(fillMentTemplate("{교재명}과학", { bookName: "쎈" })).toBe("쎈과학");
    // 받침을 판정할 수 없는 값(기호)은 적힌 조사를 그대로 둔다.
    expect(fillMentTemplate("{학생}이 왔다", { studentName: "★" })).toBe("★이 왔다");
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
    expect(c.individual).toContain("김민수 학생의 쎈 중등수학 3-1 교재를 신청합니다");
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

describe("resolveTextbookMent — 옛 기본값이 굳은 저장값 흡수", () => {
  it("비어 있으면 현재 기본 문구", () => {
    for (const v of [null, undefined, "", "   "]) expect(resolveTextbookMent(v)).toBe(DEFAULT_TEXTBOOK_MENT);
  });

  it("옛 기본 문구 그대로면 현재 기본 문구로 — 이게 없으면 기본을 고쳐도 아무도 안 바뀐다", () => {
    // 2026-08-03 실측: 저장값 보유 5명 중 4명이 옛 기본값과 완전히 동일한 복사본이었다
    // (발송 다이얼로그가 멘트를 자동 중간저장하므로 손대지 않아도 저장된다).
    for (const legacy of LEGACY_TEXTBOOK_MENTS) {
      expect(resolveTextbookMent(legacy)).toBe(DEFAULT_TEXTBOOK_MENT);
      expect(resolveTextbookMent(`  ${legacy}  `)).toBe(DEFAULT_TEXTBOOK_MENT); // 앞뒤 공백도 같은 것으로
    }
  });

  it("직접 쓴 문구는 그대로 둔다 — 남의 저장값을 말없이 갈아치우지 않는다", () => {
    const mine = "안녕하세요. {학생} 어머님, {교재명} 교재비 {금액}원 안내드립니다.";
    expect(resolveTextbookMent(mine)).toBe(mine);
  });
})
