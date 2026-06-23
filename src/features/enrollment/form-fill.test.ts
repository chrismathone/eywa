import { describe, it, expect } from "vitest";
import { buildFormPatch } from "./form-fill";

describe("buildFormPatch — 빈 필드만 채우기", () => {
  it("비어있는 메인 필드를 추출값으로 채운다", () => {
    const p = buildFormPatch(
      { grade: "중3", schoolName: "서일중", parentName: "김영희", parentPhone: "010-1234-5678" },
      {},
    );
    expect(p).toMatchObject({
      prospect_grade: "중3",
      prospect_school: "서일중",
      parent_name: "김영희",
      parent_phone: "010-1234-5678",
    });
  });

  it("이미 값이 있는 필드는 덮어쓰지 않는다(수기 입력 보존)", () => {
    const p = buildFormPatch(
      { grade: "중3", schoolName: "서일중" },
      { prospectGrade: "중2", prospectSchool: null },
    );
    expect(p.prospect_grade).toBeUndefined(); // 기존 중2 보존
    expect(p.prospect_school).toBe("서일중"); // null이라 채움
  });

  it("빈 문자열/하이픈/공백 추출값은 무시", () => {
    const p = buildFormPatch({ grade: "  ", schoolName: "-", parentName: "" }, {});
    expect(p).toEqual({});
  });
});

describe("buildFormPatch — enum 검증", () => {
  it("보호자 관계는 RELATION_OPTIONS만 통과", () => {
    expect(buildFormPatch({ parentRelation: "모" }, {}).parent_relation).toBe("모");
    expect(buildFormPatch({ parentRelation: "이모" }, {}).parent_relation).toBeUndefined();
  });
  it("성별은 남/여·male/female 정규화", () => {
    expect(buildFormPatch({ gender: "남" }, {}).gender).toBe("male");
    expect(buildFormPatch({ gender: "여학생" }, {}).gender).toBe("female");
    expect(buildFormPatch({ gender: "기타" }, {}).gender).toBeUndefined();
  });
  it("상담경로·등록상태는 설정 목록만 통과", () => {
    expect(buildFormPatch({ consultationPath: "지인 소개" }, {}).consultation_path).toBe("지인 소개");
    expect(buildFormPatch({ consultationPath: "유튜브" }, {}).consultation_path).toBeUndefined();
    expect(buildFormPatch({ registrationStatus: "미등록" }, {}).registration_status).toBe("미등록");
  });
  it("주요 과목은 라벨·키 모두 키로 매핑", () => {
    expect(buildFormPatch({ subject: "수학" }, {}).subject).toBe("math");
    expect(buildFormPatch({ subject: "english" }, {}).subject).toBe("english");
    expect(buildFormPatch({ subject: "코딩" }, {}).subject).toBeUndefined();
  });
  it("생년월일은 YYYY-MM-DD만", () => {
    expect(buildFormPatch({ birthDate: "2013-05-01" }, {}).birth_date).toBe("2013-05-01");
    expect(buildFormPatch({ birthDate: "2013년 5월" }, {}).birth_date).toBeUndefined();
  });
});

describe("buildFormPatch — 셔틀 boolean", () => {
  it("명확히 true일 때만 켜고, 기존 true는 건드리지 않음", () => {
    expect(buildFormPatch({ shuttleBusRequest: "true" }, {}).shuttle_bus_request).toBe(true);
    expect(buildFormPatch({ shuttleBusRequest: true }, {}).shuttle_bus_request).toBe(true);
    expect(buildFormPatch({ shuttleBusRequest: "false" }, {})).not.toHaveProperty("shuttle_bus_request");
    expect(
      buildFormPatch({ shuttleBusRequest: "true" }, { shuttleBusRequest: true }),
    ).not.toHaveProperty("shuttle_bus_request");
  });
});

describe("buildFormPatch — learning_history jsonb 병합", () => {
  it("하위 키 단위로 빈 곳만 채우고 weakSubjects는 배열 분리", () => {
    const p = buildFormPatch(
      { prevAcademy: "외대어학원", lastScore: "85점", weakSubjects: "독해, 문법·쓰기" },
      { learningHistory: { lastScore: "기존성적" } },
    );
    expect(p.learning_history).toEqual({
      prevAcademy: "외대어학원",
      lastScore: "기존성적", // 보존
      weakSubjects: ["독해", "문법", "쓰기"],
    });
  });
  it("채울 게 없으면 learning_history 키 자체가 없음", () => {
    const p = buildFormPatch({}, { learningHistory: { prevAcademy: "기존" } });
    expect(p).not.toHaveProperty("learning_history");
  });
});

describe("buildFormPatch — subject_details jsonb 병합", () => {
  it("유효 과목만, 필드별 빈 곳만 채우고 기존 과목 보존", () => {
    const p = buildFormPatch(
      {
        subjectDetails: {
          math: { levelTestScore: "80", academyHistory: "A학원" },
          코딩: { foo: "bar" }, // 무효 과목 무시
        },
      },
      { subjectDetails: { math: { levelTestScore: "기존" }, english: { aiGradeLevel: "5" } } },
    );
    const sd = p.subject_details as Record<string, Record<string, string>>;
    expect(sd.math).toEqual({ levelTestScore: "기존", academyHistory: "A학원" });
    expect(sd.english).toEqual({ aiGradeLevel: "5" }); // 기존 과목 보존
    expect(sd).not.toHaveProperty("코딩");
  });
});

describe("buildFormPatch — 빈 추출", () => {
  it("아무것도 없으면 빈 패치", () => {
    expect(buildFormPatch({}, {})).toEqual({});
  });
});
