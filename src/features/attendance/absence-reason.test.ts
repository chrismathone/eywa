import { describe, expect, it } from "vitest";
import { ABSENCE_REASON_LABEL, classifyAbsenceReason, isUrgentAbsence } from "./absence-reason";

/**
 * 🔴 **실데이터 고정**(프로덕션 injaewon, 최근 120일 결석 메모 전건 70종 / 311행 — 2026-08-20 조회).
 *    상상한 문장이 아니라 실제로 강사가 친 말이라, 규칙을 손볼 때 여기가 먼저 깨져야 한다.
 * 🔑 맨 아래 `unknown` 묶음이 이 표의 핵심이다 — 출석부를 손보는 **운영 메모**를 사전 통보로 삼키면
 *    "학부모가 알려왔다"는 거짓말이 화면에 남는다.
 */
const REAL_NOTES: Array<[string, ReturnType<typeof classifyAbsenceReason>]> = [
  // 사전 통보 — 여행·휴가
  ["여행", "planned"],
  ["가족여행", "planned"],
  ["가족 여행", "planned"],
  ["휴가", "planned"],
  ["가족 휴가", "planned"],
  ["가족휴가", "planned"],
  ["제주도 여행", "planned"],
  ["태국 여행", "planned"],
  ["프랑스여행", "planned"],
  ["유럽여행", "planned"],
  ["7일부터 12일까지 가족 여행", "planned"],
  ["8/3~5 가족여행", "planned"],
  ["8/18,21 휴가", "planned"],
  ["가족여행 (데스크 접수)", "planned"],
  ["휴가 - 수업료 차감으로 보강 필요X", "planned"],
  ["여행으로 결석", "planned"],
  ["여행 다녀옴. 교육비 제외함", "planned"],
  ["여행 선보강했음", "planned"],
  ["여행/ 8월 8일에 보강함.", "planned"],
  ["여행으로 결석 , 수업은8월3일 선보강함", "planned"],
  ["8/6일 귀국", "planned"],
  ["어학연수", "planned"],
  // 사전 통보 — 캠프·수련회
  ["7/19-8/8 캠프", "planned"],
  ["캠프", "planned"],
  ["KMA캠프 참가", "planned"],
  ["침산중 관악부 캠프", "planned"],
  ["교회 수련회", "planned"],
  // 사전 통보 — 가족·집안·개인 일정
  ["가족일정", "planned"],
  ["가족 행사", "planned"],
  ["가족생일", "planned"],
  ["결석 (가족생일)", "planned"],
  ["집안일", "planned"],
  ["집안 사정", "planned"],
  ["집안사정", "planned"],
  ["개인사정", "planned"],
  ["개인 사정", "planned"],
  ["개인 일정", "planned"],
  ["개인사정, 보강 요청함", "planned"],
  // 사전 통보 — 친척 방문·이주·놀러감
  ["일본 외할머니댁 방문", "planned"],
  ["할머니댁 방문", "planned"],
  ["할머니집", "planned"],
  ["친척집 방문", "planned"],
  ["이사", "planned"],
  ["놀러감", "planned"],
  // 사전 통보 — 학교 밖 일정
  ["미술학원 -> 다음 주 월요일 정규수업 이후 연강으로 보강 예정", "planned"],
  ["타학원일정", "planned"],
  ["동아리 활동으로 결석", "planned"],
  ["예고입시 준비로 결석 목요일 보강 (7/30)", "planned"],
  // 병결
  ["병결", "sick"],
  ["병결(부모연락)", "sick"],
  ["병원", "sick"],
  ["병원 진료", "sick"],
  ["복통", "sick"],
  ["복통 (Bellyache)", "sick"],
  ["(두통) 목요일 보강 (7/30)", "sick"],
  ["어깨 아파서 결석", "sick"],
  ["치과감", "sick"],
  // 학교 일정
  ["학교 활동으로 학원을 못옴", "school"],
  // 🔴 운영 메모·분류 불가 — 사전 통보로 삼키지 않는다
  ["이 수업에 원래 없음", "unknown"],
  ["원래 목요일 수업 없음", "unknown"],
  ["수업이 2개로 잡혀있음", "unknown"],
  ["시간표 이동", "unknown"],
  ["시트 대조 정정 — 7월 출석부 시트에 없는 회차(원장 확인 2026-08-10)", "unknown"],
  ["미리 수업함", "unknown"],
  ["8월 14알애 선 보강함", "unknown"],
  ["방학인줄 알고 결석\n8월에 보강 에정", "unknown"],
  ["잠을 자서 다음에 보강하기로 함.", "unknown"],
];

describe("classifyAbsenceReason", () => {
  it.each(REAL_NOTES)("실데이터 %j → %s", (note, kind) => {
    expect(classifyAbsenceReason(note)).toBe(kind);
  });

  it("메모가 없으면 unknown — 사유를 모르는 것이 기본값이다", () => {
    expect(classifyAbsenceReason(null)).toBe("unknown");
    expect(classifyAbsenceReason(undefined)).toBe("unknown");
    expect(classifyAbsenceReason("")).toBe("unknown");
    expect(classifyAbsenceReason("   ")).toBe("unknown");
  });

  it("흔한 오타도 흡수한다(실데이터 `가족일장`·`가족알정`·`캡프`)", () => {
    expect(classifyAbsenceReason("가족일장")).toBe("planned");
    expect(classifyAbsenceReason("가족알정")).toBe("planned");
    expect(classifyAbsenceReason("캡프")).toBe("planned");
  });

  it("띄어쓰기는 무시한다 — 같은 말을 자리마다 다르게 친다", () => {
    expect(classifyAbsenceReason("가 족 여 행")).toBe("planned");
    expect(classifyAbsenceReason("개인 사정")).toBe(classifyAbsenceReason("개인사정"));
  });

  it("🔴 `수학여행`은 학교 일정이다 — `여행`보다 먼저 걸려야 한다", () => {
    expect(classifyAbsenceReason("수학여행")).toBe("school");
    expect(classifyAbsenceReason("학교 수학여행으로 결석")).toBe("school");
  });

  it("🔴 `병원 방문`은 병결이지 사전 통보가 아니다 — 맨몸 `방문`을 사전에 넣지 않은 이유", () => {
    expect(classifyAbsenceReason("병원 방문")).toBe("sick");
  });

  it("🔴 모르는 말은 unknown — 긴급을 잘못 지우는 쪽이 더 비싸다", () => {
    expect(classifyAbsenceReason("연락 없이 안 옴")).toBe("unknown");
    expect(classifyAbsenceReason("확인 필요")).toBe("unknown");
    expect(classifyAbsenceReason("무단")).toBe("unknown");
  });

  it("맨몸 `열`이 낱말 속에 끼어도 병결로 오인하지 않는다", () => {
    expect(classifyAbsenceReason("나열된 사유 없음")).toBe("unknown");
    expect(classifyAbsenceReason("열심히 하기로 함")).toBe("unknown");
  });

  it("라벨은 한글이다(UI에 raw 키 금지)", () => {
    expect(ABSENCE_REASON_LABEL.planned).toBe("사전 통보");
    expect(ABSENCE_REASON_LABEL.sick).toBe("병결");
    expect(ABSENCE_REASON_LABEL.school).toBe("학교 일정");
  });
});

describe("isUrgentAbsence", () => {
  it("사유를 모르고 아직 안 매듭진 것만 긴급", () => {
    expect(isUrgentAbsence("unknown", false)).toBe(true);
    expect(isUrgentAbsence("unknown", true)).toBe(false);
    expect(isUrgentAbsence("planned", false)).toBe(false);
    expect(isUrgentAbsence("sick", false)).toBe(false);
    expect(isUrgentAbsence("school", false)).toBe(false);
  });
});
