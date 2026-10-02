// 반 공지 큐 행의 이미지·반 이름 읽기(순수) — 서버 액션·내부 라우트·이력 화면이 같은 함수를 쓴다.
import { describe, expect, it } from "vitest";
import { classNoticeAttachmentsOf, classNoticeClassNames } from "./class-notice";

describe("반 공지 이미지 읽기", () => {
  const a = { path: "t/report-attachments/a.png", name: "시간표.png", size: 10 };
  const b = { path: "t/report-attachments/b.png", name: "  ", size: 20 };
  it("대상마다 같은 목록이 들어 있어 경로 기준으로 한 벌로 합친다(이름이 비면 '이미지')", () => {
    const targets = [{ classId: "c1", className: "가반", attachments: [a, b] }, { classId: "c2", className: "나반", attachments: [a, b] }];
    expect(classNoticeAttachmentsOf(targets)).toEqual([{ path: a.path, name: "시간표.png" }, { path: b.path, name: "이미지" }]);
  });
  it("이미지가 없는 옛 큐 행·모양이 깨진 값은 빈 목록", () => {
    expect(classNoticeAttachmentsOf([{ classId: "c1", className: "가반" }])).toEqual([]);
    expect(classNoticeAttachmentsOf(null)).toEqual([]);
    expect(classNoticeAttachmentsOf("x")).toEqual([]);
    expect(classNoticeAttachmentsOf([{ attachments: [null, { name: "x" }, { path: " " }] }])).toEqual([]);
  });
});

describe("이력에 보일 반 이름", () => {
  it("테스트 발송은 테스트반 — 이미지를 나르는 자리(대상)의 이름을 그대로 쓰지 않는다", () => {
    expect(classNoticeClassNames([{ classId: null, className: "[수학] 테스트반", attachments: [] }], true)).toEqual(["[수학] 테스트반"]);
    expect(classNoticeClassNames([], true)).toEqual(["[수학] 테스트반"]);
  });
  it("실제 발송은 대상 반 이름 — 이름 없는 대상은 뺀다", () => {
    expect(classNoticeClassNames([{ className: "가반" }, { className: "" }, null, { className: "나반" }], false)).toEqual(["가반", "나반"]);
    expect(classNoticeClassNames(null, false)).toEqual([]);
  });
});
