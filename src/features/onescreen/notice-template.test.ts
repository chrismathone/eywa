import { describe, expect, it } from "vitest";
import { fillNoticeTemplate, NOTICE_BODY_MAX } from "./notice-template";

const context = { studentName: "김민서G", authorName: "이수진" };

describe("개별 공지 이름 태그", () => {
  it("성 포함·성 제외 이름을 구분하고 구분용 알파벳은 보내지 않는다", () => {
    expect(fillNoticeTemplate("{학생} 학부모님, {학생이름}이는 오늘 열심히 참여했어요. {작성자}입니다.", context))
      .toEqual({ ok: true, body: "김민서 학부모님, 민서는 오늘 열심히 참여했어요. 이수진 선생님입니다." });
  });
  it("받침 있는 이름과 없는 이름의 조사·호칭을 각각 맞춘다", () => {
    expect(fillNoticeTemplate("{학생이름}이는 {학생}과 함께합니다.", { ...context, studentName: "김민준A" }))
      .toEqual({ ok: true, body: "민준이는 김민준과 함께합니다." });
    expect(fillNoticeTemplate("{학생이름}이 잘했어요.", context)).toEqual({ ok: true, body: "민서가 잘했어요." });
    expect(fillNoticeTemplate("{학생 이름}이는 잘했어요.", context)).toEqual({ ok: true, body: "민서는 잘했어요." });
  });
  it("알 수 없는 태그·이중 중괄호·이름 누락은 내용을 지우거나 원문 발송하지 않고 거절한다", () => {
    expect(fillNoticeTemplate("{진도} 안내", context)).toMatchObject({ ok: false, error: expect.stringContaining("{진도}") });
    expect(fillNoticeTemplate("{{학생}} 안내", context).ok).toBe(false);
    expect(fillNoticeTemplate("{학생} 안내", { ...context, studentName: "" }).ok).toBe(false);
    expect(fillNoticeTemplate("{작성자}입니다", { ...context, authorName: "" }).ok).toBe(false);
  });
  it("영문 이름과 태그 없는 본문의 공백·줄바꿈은 그대로 유지한다", () => {
    expect(fillNoticeTemplate("{학생} / {학생이름}", { ...context, studentName: "Mary Jane" }))
      .toEqual({ ok: true, body: "Mary Jane / Mary Jane" });
    const body = "휴강  안내\n\n\n다음 주에 만나요.";
    expect(fillNoticeTemplate(body, context)).toEqual({ ok: true, body });
  });
  it("치환 후 길이에도 발송 상한을 적용한다", () => {
    expect(fillNoticeTemplate("가".repeat(NOTICE_BODY_MAX), context).ok).toBe(true);
    expect(fillNoticeTemplate("{작성자}".repeat(600), context).ok).toBe(false);
  });
});
