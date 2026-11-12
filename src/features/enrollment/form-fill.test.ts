import { describe, it, expect } from "vitest";
import { buildFormPatch, splitOutsideParens } from "./form-fill";

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
    expect(buildFormPatch({ registrationStatus: "미등록" }, {}).registration_status).toBeUndefined();
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
  it("셔틀 모듈이 꺼지면 추출값을 저장하지 않고, 미지정 호출은 기존처럼 동작한다", () => {
    expect(buildFormPatch({ shuttleBusRequest: true }, {}, { shuttleOn: false })).not.toHaveProperty("shuttle_bus_request");
    expect(buildFormPatch({ shuttleBusRequest: true }, {})).toHaveProperty("shuttle_bus_request", true);
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

describe("buildFormPatch — 약점 단원은 괄호 안을 나누지 않는다(2026-10-26)", () => {
  it("'문법(분사, 동명사, 능동태·수동태)'가 깨진 조각으로 저장되지 않는다", () => {
    const p = buildFormPatch({ weakSubjects: "문법(분사, 동명사, 능동태·수동태), 어휘, 리딩(전체 흐름 파악)" }, {});
    expect((p.learning_history as { weakSubjects: string[] }).weakSubjects).toEqual(["문법(분사, 동명사, 능동태·수동태)", "어휘", "리딩(전체 흐름 파악)"]);
  });
  it("괄호가 없으면 예전과 같다", () => {
    expect(splitOutsideParens("영어 단어(어휘), 수학 응용·심화/개념")).toEqual(["영어 단어(어휘)", "수학 응용", "심화", "개념"]);
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

describe("buildFormPatch — 후보정 하네스(약한 모델 오류 차단)", () => {
  // 실측(Solar/이윤건 녹음)에서 나온 오류 패턴들을 그대로 케이스화.
  const ctx = (transcript: string, studentName = "이윤건") => ({ studentName, transcript });

  it("학생 이름을 학교명에 복사하면 거부(echo)", () => {
    const p = buildFormPatch({ schoolName: "이윤건" }, {}, ctx("이윤건 학생, 신암초 다닙니다"));
    expect(p).not.toHaveProperty("prospect_school");
  });

  it("일반 호칭(어머니 등)은 보호자 '이름'이 아니다 → 거부", () => {
    const p = buildFormPatch({ parentName: "어머니" }, {}, ctx("어머니와 함께 상담했습니다"));
    expect(p).not.toHaveProperty("parent_name");
  });

  it("전사에 없는 학원명은 환각으로 보고 거부, 있으면 통과(grounding)", () => {
    expect(
      buildFormPatch({ prevAcademy: "수중학교" }, {}, ctx("외대어학원 다니다 그만뒀어요")),
    ).not.toHaveProperty("learning_history");
    const ok = buildFormPatch({ prevAcademy: "외대어학원" }, {}, ctx("외대어학원 다니다 그만뒀어요"));
    expect((ok.learning_history as { prevAcademy?: string }).prevAcademy).toBe("외대어학원");
  });

  it("학교명도 전사에 등장해야 통과(약어 prefix 허용)", () => {
    expect(buildFormPatch({ schoolName: "유령중" }, {}, ctx("신암초 6학년이에요")).prospect_school).toBeUndefined();
    // 🔴 통과한 값은 **저장 표기로 강제 정규화**된다(원장 2026-09-01) — 전사에 "신암초등학교"라고
    //    나왔어도 DB엔 앱 표기 하나(`신암초`)만 남는다. grounding(전사에 있었나) 판정은 그대로다.
    expect(buildFormPatch({ schoolName: "신암초등학교" }, {}, ctx("신암초 6학년이에요")).prospect_school).toBe("신암초");
  });

  it("한 글자/잡음 점수는 거부", () => {
    expect(buildFormPatch({ lastScore: "6" }, {}, ctx("점수 언급 없음"))).not.toHaveProperty("learning_history");
    expect(
      (buildFormPatch({ lastScore: "70%" }, {}, ctx("독해 70% 정도")).learning_history as { lastScore?: string }).lastScore,
    ).toBe("70%");
  });

  it("상태는 후속 조치에서만 정한다 — 옛 AI 응답도 등록 상태를 쓰지 않는다", () => {
    expect(buildFormPatch({ registrationStatus: "등록완료" }, {}).registration_status).toBeUndefined();
    expect(buildFormPatch({ registrationStatus: "미등록" }, {}).registration_status).toBeUndefined();
  });

  it("전화번호 형태(9~11자리)가 아니면 거부", () => {
    expect(buildFormPatch({ parentPhone: "있음" }, {}).parent_phone).toBeUndefined();
    expect(buildFormPatch({ parentPhone: "010-1234-5678" }, {}).parent_phone).toBe("010-1234-5678");
  });

  it("학교명 꼴이 아니면 거부 — 전사에 있어도(ASR 잡음 '호표학')", () => {
    // "호표학"이 전사에 섞여 grounding은 통과하지만, 학교명 꼴(초/중/고/교)이 아니라 거부.
    expect(buildFormPatch({ schoolName: "호표학" }, {}, ctx("어쩌고 호표학 저쩌고")).prospect_school).toBeUndefined();
    expect(buildFormPatch({ schoolName: "신암초" }, {}, ctx("신암초 다녀요")).prospect_school).toBe("신암초");
  });

  it("학년은 초1~고3 형식만(예: '중학교'·오학년 거부)", () => {
    expect(buildFormPatch({ grade: "중학교" }, {}).prospect_grade).toBeUndefined();
    expect(buildFormPatch({ grade: "초6" }, {}).prospect_grade).toBe("초6");
    // 미취학 학년(2026-08-18) — 학원설정에 있는 6·7세만 통과. 설정에 없는 값을 써 넣으면 상담 수정
    // 폼의 <select>에 옵션이 없어(다른 칸만 고쳐도) 학년이 지워지므로 일부러 좁게 잡는다.
    expect(buildFormPatch({ grade: "7세" }, {}).prospect_grade).toBe("7세");
    expect(buildFormPatch({ grade: "6세" }, {}).prospect_grade).toBe("6세");
    expect(buildFormPatch({ grade: "4세" }, {}).prospect_grade).toBeUndefined();
    expect(buildFormPatch({ grade: "30세" }, {}).prospect_grade).toBeUndefined();
  });

  it("모델 불확실 마커(미확인·확인 필요·XXXX·?)가 든 값 거부", () => {
    const t = ctx("수학 학원 다녔어요");
    expect(buildFormPatch({ prevAcademy: "수학 학원 (학원명 미확인)" }, {}, t)).not.toHaveProperty("learning_history");
    expect(buildFormPatch({ schoolName: "서울시? (확인 필요)" }, {}, t).prospect_school).toBeUndefined();
    expect(buildFormPatch({ parentPhone: "010-XXXX-XXXX" }, {}).parent_phone).toBeUndefined();
  });

  it("빈값 마커(미언급·없음·모름)를 값으로 적은 경우 거부", () => {
    expect(buildFormPatch({ lastScore: "미언급" }, {}, ctx("점수 얘기 없음"))).not.toHaveProperty("learning_history");
    expect(buildFormPatch({ careerGoal: "없음" }, {}).career_goal).toBeUndefined();
    // 단, 부분 포함은 보존(예: weakSubjects 문장)
    expect(
      (buildFormPatch({ lastScore: "특이사항 없음 70점" }, {}, ctx("70점 특이사항 없음")).learning_history as { lastScore?: string }).lastScore,
    ).toBe("특이사항 없음 70점");
  });

  it("전사 미제공 시 grounding 비활성(후방호환 — 기존 호출부 무영향)", () => {
    expect(buildFormPatch({ schoolName: "서일중", prevAcademy: "어딘가학원" }, {}).prospect_school).toBe("서일중");
  });
});

describe("buildFormPatch — 빈 추출", () => {
  it("아무것도 없으면 빈 패치", () => {
    expect(buildFormPatch({}, {})).toEqual({});
  });
});
