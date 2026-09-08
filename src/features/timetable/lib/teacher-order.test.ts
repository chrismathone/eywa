import { describe, expect, it } from "vitest";
import {
  mergeTeacherOrderPref,
  moveTeacher,
  parseTeacherOrderPref,
  sortTeachersByOrder,
  teacherGroupKey,
} from "./teacher-order";

/**
 * 기본뷰 강사 열 순서(원장 2026-09-08 "드래그해서 … 월목 / 화금 / 수 그룹 내에서" + "개인마다 뷰 저장").
 * 규칙은 순수 함수라 여기서 잠근다 — 화면(드래그)은 이 함수의 결과를 저장할 뿐이다.
 */
describe("teacher-order — 요일 묶음별 강사 순서", () => {
  it("묶음 키는 요일에서 파생된다(별도 id 없음)", () => {
    expect(teacherGroupKey(["mon", "thu"])).toBe("mon-thu");
    expect(teacherGroupKey(["wed"])).toBe("wed");
  });

  it("저장된 이름이 먼저(저장 순), 없는 이름은 뒤에 가나다순 — 신규 강사가 사라지지 않는다", () => {
    const names = ["이성우", "김윤하", "허주연", "남정화"];
    expect(sortTeachersByOrder(names, ["허주연", "김윤하"])).toEqual(["허주연", "김윤하", "남정화", "이성우"]);
    // 저장이 없으면 종전 그대로 가나다순
    expect(sortTeachersByOrder(names)).toEqual(["김윤하", "남정화", "이성우", "허주연"]);
    // 저장에만 있고 화면에 없는 이름은 무해
    expect(sortTeachersByOrder(["김윤하"], ["없는사람", "김윤하"])).toEqual(["김윤하"]);
  });

  it("앞/뒤로 옮기기 — 결과는 묶음 전체 순서", () => {
    const list = ["A", "B", "C", "D"];
    expect(moveTeacher(list, "D", "B", "before")).toEqual(["A", "D", "B", "C"]);
    expect(moveTeacher(list, "A", "C", "after")).toEqual(["B", "C", "A", "D"]);
    // 제자리·없는 대상은 그대로(복사본)
    expect(moveTeacher(list, "A", "A", "before")).toEqual(list);
    expect(moveTeacher(list, "A", "Z", "after")).toEqual(list);
    expect(moveTeacher(list, "A", "Z", "after")).not.toBe(list);
  });

  it("jsonb 파싱 — 모양이 어긋난 조각은 버리고, 전부 비면 null", () => {
    expect(parseTeacherOrderPref(null)).toBeNull();
    expect(parseTeacherOrderPref([])).toBeNull();
    expect(parseTeacherOrderPref({ math: { "mon-thu": ["a", "", 3, "a", "b"], wed: "x" }, english: [] })).toEqual({
      math: { "mon-thu": ["a", "b"] },
    });
  });

  it("병합은 그 묶음 키만 갈아끼운다 — 다른 과목·묶음은 보존, 빈 배열은 그 묶음 초기화", () => {
    const cur = { math: { "mon-thu": ["a", "b"], "tue-fri": ["c"] }, english: { wed: ["e"] } };
    expect(mergeTeacherOrderPref(cur, { math: { "mon-thu": ["b", "a"] } })).toEqual({
      math: { "mon-thu": ["b", "a"], "tue-fri": ["c"] },
      english: { wed: ["e"] },
    });
    expect(mergeTeacherOrderPref(cur, { math: { "mon-thu": [], "tue-fri": [] } })).toEqual({ english: { wed: ["e"] } });
    expect(mergeTeacherOrderPref(cur, null)).toBeNull();
    // 원본을 건드리지 않는다
    expect(cur.math["mon-thu"]).toEqual(["a", "b"]);
  });
});
