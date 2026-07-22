import { describe, expect, it } from "vitest";
import {
  hasNoticeTargetAttachments,
  isNoticeImageAttachment,
  mergeNoticeAttachments,
  noticeAttachmentOverflow,
  NOTICE_ATTACHMENT_MAX,
  sanitizeNoticeAttachments,
  type NoticeAttachment,
} from "./notice-attachments";

const TENANT = "t1";
const ok = (p: string) => p.startsWith(`${TENANT}/report-attachments/`);
const A = (n: string, size = 100): NoticeAttachment => ({
  path: `${TENANT}/report-attachments/${n}`,
  name: n,
  size,
});

describe("sanitizeNoticeAttachments", () => {
  it("테넌트 밖 경로는 버린다(클라가 남의 파일을 큐에 싣는 것 차단)", () => {
    const list = [A("a.png"), { path: "other/report-attachments/b.png", name: "b.png", size: 1 }];
    expect(sanitizeNoticeAttachments(list, ok).map((a) => a.name)).toEqual(["a.png"]);
  });

  it("같은 path 중복은 한 번만", () => {
    expect(sanitizeNoticeAttachments([A("a.png"), A("a.png")], ok)).toHaveLength(1);
  });

  it("이름이 비면 '첨부'로, 잘못된 크기는 0으로 정규화", () => {
    const [a] = sanitizeNoticeAttachments(
      [{ path: `${TENANT}/report-attachments/x.png`, name: "  ", size: Number.NaN }],
      ok,
    );
    expect(a).toEqual({ path: `${TENANT}/report-attachments/x.png`, name: "첨부", size: 0 });
  });

  it("상한을 넘으면 자른다", () => {
    const many = Array.from({ length: NOTICE_ATTACHMENT_MAX + 5 }, (_, i) => A(`f${i}.png`));
    expect(sanitizeNoticeAttachments(many, ok)).toHaveLength(NOTICE_ATTACHMENT_MAX);
  });

  it("null/undefined는 빈 배열", () => {
    expect(sanitizeNoticeAttachments(null, ok)).toEqual([]);
    expect(sanitizeNoticeAttachments(undefined, ok)).toEqual([]);
  });
});

describe("mergeNoticeAttachments", () => {
  it("학생별(요청서)이 앞, 공통(표지)이 뒤", () => {
    expect(mergeNoticeAttachments([A("표지.png")], [A("요청서.png")]).map((a) => a.name)).toEqual([
      "요청서.png",
      "표지.png",
    ]);
  });

  it("상한에서 잘릴 땐 **공통이 먼저 잘린다** — 본인 요청서는 절대 밀려나지 않는다", () => {
    const covers = Array.from({ length: 4 }, (_, i) => A(`표지${i}.png`));
    const forms = Array.from({ length: 7 }, (_, i) => A(`요청서${i}.png`));
    const merged = mergeNoticeAttachments(covers, forms);
    expect(merged).toHaveLength(NOTICE_ATTACHMENT_MAX);
    for (const f of forms) expect(merged.some((m) => m.path === f.path)).toBe(true);
  });

  it("공통과 학생별에 같은 파일이 있으면 한 번만 올라간다", () => {
    expect(mergeNoticeAttachments([A("표지.png")], [A("표지.png")])).toHaveLength(1);
  });

  it("한쪽이 비어도 나머지가 그대로", () => {
    expect(mergeNoticeAttachments([], [A("요청서.png")]).map((a) => a.name)).toEqual(["요청서.png"]);
    expect(mergeNoticeAttachments(undefined, undefined)).toEqual([]);
  });
});

describe("noticeAttachmentOverflow", () => {
  it("상한 이내면 0", () => {
    expect(noticeAttachmentOverflow([A("표지.png")], [A("요청서.png")])).toBe(0);
  });

  it("넘치면 넘친 장수 — 호출부가 조용히 자르지 않고 막을 수 있게", () => {
    const covers = Array.from({ length: 4 }, (_, i) => A(`표지${i}.png`));
    const forms = Array.from({ length: 7 }, (_, i) => A(`요청서${i}.png`));
    expect(noticeAttachmentOverflow(covers, forms)).toBe(1);
  });

  it("중복 path는 한 장으로 세어 헛된 거부를 만들지 않는다", () => {
    const same = Array.from({ length: 6 }, (_, i) => A(`x${i}.png`));
    expect(noticeAttachmentOverflow(same, same)).toBe(0);
  });
});

describe("hasNoticeTargetAttachments", () => {
  it("한 타깃이라도 첨부가 있으면 true(일괄 수정 차단 판정)", () => {
    expect(hasNoticeTargetAttachments([{ board: "(수학)홍길동" }, { board: "(수학)김철수", attachments: [A("a.png")] }])).toBe(true);
  });
  it("첨부가 없거나 목록이 아니면 false", () => {
    expect(hasNoticeTargetAttachments([{ board: "(수학)홍길동", attachments: [] }])).toBe(false);
    expect(hasNoticeTargetAttachments(null)).toBe(false);
    expect(hasNoticeTargetAttachments("targets")).toBe(false);
  });
});

describe("isNoticeImageAttachment", () => {
  it("이름에 확장자가 없어도 경로로 판정한다(사진이 '첨부파일'로 가는 것 방지)", () => {
    expect(isNoticeImageAttachment({ name: "KakaoTalk_20260721", path: "t1/report-attachments/x.png" })).toBe(true);
  });
  it("이름이 이미지면 그대로 이미지", () => {
    expect(isNoticeImageAttachment({ name: "표지.JPG", path: "t1/report-attachments/y.jpg" })).toBe(true);
  });
  it("둘 다 비이미지면 파일", () => {
    expect(isNoticeImageAttachment({ name: "안내.pdf", path: "t1/report-attachments/z.pdf" })).toBe(false);
    expect(isNoticeImageAttachment({})).toBe(false);
  });
});
