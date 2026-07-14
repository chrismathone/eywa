import { describe, it, expect } from "vitest";
import {
  extractNoticeTags,
  validateNoticeTemplate,
  renderNoticeBody,
  type NoticeStudent,
} from "./notice-render";

const 민수: NoticeStudent = { name: "김민수", school: "경명여중", grade: "중2" };
const 서준: NoticeStudent = { name: "박서준", school: null, grade: null };

describe("extractNoticeTags", () => {
  it("태그 이름을 공백 정규화해 추출", () => {
    expect(extractNoticeTags("안녕하세요 {{이름}} 학생, {{ 학교 }}!")).toEqual(["이름", "학교"]);
  });
  it("태그 없으면 빈 배열", () => {
    expect(extractNoticeTags("공지입니다")).toEqual([]);
  });
});

describe("validateNoticeTemplate", () => {
  it("지원 태그만이면 ok", () => {
    expect(validateNoticeTemplate("{{이름}} {{학교학년}}")).toEqual({ ok: true, unknown: [], hasTags: true });
  });
  it("미지원 태그는 ok:false + unknown 목록", () => {
    const r = validateNoticeTemplate("{{이름}}님 {{전화번호}} {{학부모}}");
    expect(r.ok).toBe(false);
    expect(r.unknown).toEqual(["전화번호", "학부모"]);
    expect(r.hasTags).toBe(true);
  });
  it("태그 없으면 hasTags:false", () => {
    expect(validateNoticeTemplate("그냥 공지")).toEqual({ ok: true, unknown: [], hasTags: false });
  });
  it("공백 변형 {{ 이름 }}도 지원 태그로 인식", () => {
    expect(validateNoticeTemplate("{{  이름  }}").ok).toBe(true);
  });
});

describe("renderNoticeBody", () => {
  it("기본 치환", () => {
    expect(renderNoticeBody("{{이름}} 학생 어머님께", 민수)).toBe("김민수 학생 어머님께");
  });
  it("학생이름 별칭", () => {
    expect(renderNoticeBody("{{학생이름}}", 민수)).toBe("김민수");
  });
  it("공백 변형도 치환", () => {
    expect(renderNoticeBody("{{ 이름 }}", 민수)).toBe("김민수");
  });
  it("여러 태그·학교학년 압축", () => {
    expect(renderNoticeBody("{{이름}}({{학교학년}})", 민수)).toBe("김민수(경명여중2)");
  });
  it("결측 학교/학년은 빈칸(날조 금지)", () => {
    expect(renderNoticeBody("[{{학교}}][{{학년}}]", 서준)).toBe("[][]");
  });
  it("미지원 태그는 원문 보존", () => {
    expect(renderNoticeBody("{{이름}} {{전화번호}}", 민수)).toBe("김민수 {{전화번호}}");
  });
  it("복수 학생이 서로 섞이지 않는다(target별 고정)", () => {
    const tpl = "{{이름}} 어머님";
    expect(renderNoticeBody(tpl, 민수)).toBe("김민수 어머님");
    expect(renderNoticeBody(tpl, 서준)).toBe("박서준 어머님");
  });
  it("치환값의 $-특수문자는 리터럴(치환 오염 방지)", () => {
    expect(renderNoticeBody("{{이름}}", { name: "A$B$&C", school: null, grade: null })).toBe("A$B$&C");
  });
  it("치환값에 {{이름}}이 있어도 재주입 안 됨(1회 순회)", () => {
    expect(renderNoticeBody("{{이름}}", { name: "{{이름}}", school: null, grade: null })).toBe("{{이름}}");
  });
});
