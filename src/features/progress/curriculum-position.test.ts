import { describe, it, expect } from "vitest";
import {
  ALL_LESSONS,
  TOTAL_LESSONS,
  LESSON_TO_POS,
  positionOf,
  describePosition,
  gradeOfPosition,
  gradeRank,
  classifyTrack,
} from "./curriculum-position";

const FIRST_LESSON = "1-1-1 받아올림이 없는, 한 번 있는 (세 자리 수)+(세 자리 수)"; // 초3 첫 차시

describe("ALL_LESSONS / flatten", () => {
  it("1-based 연속 위치, 학년순(초3 먼저)", () => {
    expect(TOTAL_LESSONS).toBeGreaterThan(300);
    expect(ALL_LESSONS[0]!.position).toBe(1);
    expect(ALL_LESSONS[0]!.grade).toBe("초3");
    expect(ALL_LESSONS[0]!.lesson).toBe(FIRST_LESSON);
    expect(ALL_LESSONS[TOTAL_LESSONS - 1]!.position).toBe(TOTAL_LESSONS);
    expect(ALL_LESSONS[TOTAL_LESSONS - 1]!.grade).toBe("중3");
    // 위치가 1..N 연속
    ALL_LESSONS.forEach((l, i) => expect(l.position).toBe(i + 1));
  });

  it("차시 문자열이 커리큘럼 전체에서 유일(Map 크기 == 전체 수)", () => {
    expect(LESSON_TO_POS.size).toBe(TOTAL_LESSONS);
  });
});

describe("positionOf", () => {
  it("'수학 <차시>'에서 차시를 정확 조회(초3 첫 차시 = 1)", () => {
    expect(positionOf(`수학 ${FIRST_LESSON}`)?.position).toBe(1);
  });

  it("중등 고유명 차시 매핑(소인수분해 = 중1)", () => {
    const p = positionOf("수학 소인수분해");
    expect(p).not.toBeNull();
    expect(p!.grade).toBe("중1");
  });

  it("과목 라벨이 여러 단어여도 차시 조회('수학 (상) 소인수분해')", () => {
    expect(positionOf("수학 (상) 소인수분해")?.grade).toBe("중1");
    expect(positionOf(`수학 (상) ${FIRST_LESSON}`)?.position).toBe(1);
  });

  it("모든 차시 왕복(progress→위치→describe→같은 차시)", () => {
    for (const l of ALL_LESSONS) {
      const p = positionOf(`수학 ${l.lesson}`);
      expect(p?.position).toBe(l.position);
      expect(describePosition(l.position)?.lesson).toBe(l.lesson);
    }
  });

  it("edutrix 임포트 포맷(번호·여러 줄·총괄) 정규화 매핑", () => {
    expect(positionOf("1.각")?.grade).toBe("중1"); // 앞 번호 제거
    expect(positionOf("1.일차방정식의 활용(거리, 속력, 시간)")?.grade).toBe("중1");
    expect(positionOf("1.순서쌍과 좌표평면(응용)\n2.그래프의 이해")?.lesson).toBe("그래프의 이해"); // 마지막 줄
    expect(positionOf("1.좌표평면과 그래프 대단원 총괄")).toBeNull(); // 총괄=차시 아님
  });

  it("미스/빈값 → null", () => {
    expect(positionOf("수학 존재하지않는차시xyz")).toBeNull();
    expect(positionOf("영어 Unit 8 p.90")).toBeNull();
    expect(positionOf("수학")).toBeNull();
    expect(positionOf("")).toBeNull();
    expect(positionOf(null)).toBeNull();
  });
});

describe("describePosition / gradeOfPosition", () => {
  it("범위 밖 → null", () => {
    expect(describePosition(0)).toBeNull();
    expect(describePosition(TOTAL_LESSONS + 1)).toBeNull();
    expect(gradeOfPosition(1)).toBe("초3");
  });
});

describe("gradeRank / classifyTrack", () => {
  it("gradeRank 초<중<고", () => {
    expect(gradeRank("초3")).toBe(3);
    expect(gradeRank("중1")).toBe(11);
    expect(gradeRank("고1")).toBe(21);
    expect(gradeRank("없음")).toBeNull();
    expect(gradeRank(null)).toBeNull();
  });

  it("진도학년>학생학년=ahead(선행), 그 외=current(복습 포함)", () => {
    expect(classifyTrack("초3", "중1")).toBe("ahead"); // 초3 학생이 중1 진도
    expect(classifyTrack("중2", "중2")).toBe("current"); // 현행
    expect(classifyTrack("중2", "중1")).toBe("current"); // 복습(후행 없음)
    expect(classifyTrack("중2", "중3")).toBe("ahead");
    expect(classifyTrack(null, "중1")).toBeNull();
    expect(classifyTrack("중1", "없음")).toBeNull();
  });
});
