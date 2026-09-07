import { describe, expect, it } from "vitest";
import {
  hasTranslatableText,
  noticeSourceHash,
  sensitiveSkipReason,
  type NoticeSource,
} from "./translate-rules";

const src = (p: Partial<NoticeSource>): NoticeSource => ({
  title: "제목",
  body: null,
  linkLabel: null,
  ...p,
});

describe("민감정보 — 보이면 번역하지 않고 원문을 유지한다", () => {
  it("주민등록번호(하이픈 있음/없음)를 잡는다", () => {
    expect(sensitiveSkipReason(src({ body: "김철수 900101-1234567 확인" }))).toContain("주민등록번호");
    expect(sensitiveSkipReason(src({ body: "9001011234567" }))).toContain("주민등록번호");
  });

  it("카드번호를 잡는다", () => {
    expect(sensitiveSkipReason(src({ body: "1234-5678-9012-3456" }))).toContain("카드번호");
  });

  it("은행 낱말 + 긴 숫자 = 계좌번호로 본다", () => {
    expect(sensitiveSkipReason(src({ body: "국민은행 123456-78-901234로 입금" }))).toContain("계좌번호");
    expect(sensitiveSkipReason(src({ body: "계좌 352-1234-5678-91 예금주 인재원" }))).toContain("계좌번호");
  });

  it("제목·링크 라벨도 함께 본다(본문만 검사하면 새어 나간다)", () => {
    expect(sensitiveSkipReason(src({ title: "환불 계좌 농협 302-1234-5678" }))).not.toBeNull();
    expect(sensitiveSkipReason(src({ linkLabel: "900101-1234567" }))).not.toBeNull();
  });

  it("🔴 전화번호는 막지 않는다 — 학원 대표번호가 흔해서 막으면 기능이 죽는다", () => {
    expect(sensitiveSkipReason(src({ body: "문의 053-123-4567 로 연락 주세요" }))).toBeNull();
    expect(sensitiveSkipReason(src({ body: "010-1234-5678" }))).toBeNull();
  });

  it("평범한 공지는 통과한다", () => {
    expect(sensitiveSkipReason(src({ title: "내 정보 수정 방법", body: "우측 상단 내 메뉴에서" }))).toBeNull();
  });

  it("사유 문구가 왜 안 했는지 사람 말로 설명한다(원인 오표시 금지)", () => {
    const why = sensitiveSkipReason(src({ body: "900101-1234567" }));
    expect(why).toContain("번역하지 않았습니다");
  });
});

describe("원문 해시 — 재번역 판정 축", () => {
  it("같은 글은 같은 해시", () => {
    expect(noticeSourceHash(src({ body: "가나다" }))).toBe(noticeSourceHash(src({ body: "가나다" })));
  });

  it("글자가 바뀌면 해시가 바뀐다(세 칸 각각)", () => {
    const base = noticeSourceHash(src({ body: "가나다" }));
    expect(noticeSourceHash(src({ title: "다른제목", body: "가나다" }))).not.toBe(base);
    expect(noticeSourceHash(src({ body: "가나라" }))).not.toBe(base);
    expect(noticeSourceHash(src({ body: "가나다", linkLabel: "열기" }))).not.toBe(base);
  });

  it("🔴 본문이 그대로면 해시도 그대로 — 이미지·기간만 바꿔도 다시 번역하지 않게", () => {
    // 이 함수는 애초에 이미지·기간을 안 받는다(그것이 이 판정의 요점).
    expect(noticeSourceHash({ title: "A", body: "B", linkLabel: "C" })).toBe(
      noticeSourceHash({ title: "A", body: "B", linkLabel: "C" }),
    );
  });

  it("null과 빈 문자열을 같게 본다(저장 경로가 둘 다 만든다)", () => {
    expect(noticeSourceHash({ title: "A", body: null, linkLabel: null })).toBe(
      noticeSourceHash({ title: "A", body: "", linkLabel: "" }),
    );
  });
});

describe("번역할 것이 있나", () => {
  it("전부 비면 false — 부를 이유가 없다", () => {
    expect(hasTranslatableText({ title: "  ", body: null, linkLabel: null })).toBe(false);
  });
  it("하나라도 있으면 true", () => {
    expect(hasTranslatableText({ title: "제목", body: null, linkLabel: null })).toBe(true);
    expect(hasTranslatableText({ title: "", body: "본문", linkLabel: null })).toBe(true);
  });
});
