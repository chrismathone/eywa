import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CONSULTATION_AUDIT_FIELDS, summarizeConsultationChanges } from "./consultation-audit";

const BEFORE = {
  prospect_name: "홍길동",
  prospect_school: "대구일중",
  prospect_grade: "중1",
  parent_name: "김보호",
  parent_phone: "010-1111-2222",
  student_phone: null,
  subject: "math",
  consultant_id: null,
  parent_request: "수학 상담",
};

describe("summarizeConsultationChanges — 등록상담 수정 감사 요약", () => {
  it("이름 변경은 전후 값까지 남긴다(자동 연결의 키)", () => {
    const s = summarizeConsultationChanges(BEFORE, { ...BEFORE, prospect_name: "홍길동A" });
    expect(s.changed).toEqual(["이름"]);
    expect(s.changes).toEqual([{ field: "이름", from: "홍길동", to: "홍길동A" }]);
  });

  it("🔴 연락처·상담 내용은 바뀌었다는 사실만 — 값은 남기지 않는다", () => {
    const s = summarizeConsultationChanges(BEFORE, {
      ...BEFORE,
      parent_phone: "010-3333-4444",
      parent_request: "영어도 같이",
    });
    expect(s.changed).toEqual(["보호자 연락처", "상담 내용"]);
    expect(s.changes).toEqual([]);
    expect(JSON.stringify(s)).not.toContain("3333");
  });

  it("이번 저장이 안 건드린 칸(after에 없는 키)은 비교하지 않는다 — 목록 칸 수정", () => {
    const s = summarizeConsultationChanges(BEFORE, { prospect_grade: "중2" });
    expect(s.changed).toEqual(["학년"]);
    expect(s.changes).toEqual([{ field: "학년", from: "중1", to: "중2" }]);
  });

  it("빈 문자열과 null은 같은 값 — 안 바뀐 칸이 '바뀜'으로 뜨지 않는다", () => {
    const s = summarizeConsultationChanges(
      { ...BEFORE, student_phone: "" },
      { ...BEFORE, student_phone: null, parent_name: "  김보호  " },
    );
    expect(s.changed).toEqual([]);
  });

  it("비어 있던 칸을 채우면 from이 null", () => {
    const s = summarizeConsultationChanges({ ...BEFORE, prospect_school: null }, { prospect_school: "대구일중" });
    expect(s.changes).toEqual([{ field: "학교", from: null, to: "대구일중" }]);
  });

  it("저장 전 값을 못 읽었으면 추측하지 않는다(빈 요약)", () => {
    expect(summarizeConsultationChanges(null, { prospect_name: "홍길동A" })).toEqual({
      changed: [],
      changes: [],
    });
  });
});

describe("배선 가드 — 저장 전 값 조회가 비교 칸을 전부 읽는다", () => {
  it("🔴 actions.ts의 감사 선조회 select(수정·목록 칸 수정)가 CONSULTATION_AUDIT_FIELDS를 전부 담는다", () => {
    const src = fs.readFileSync(path.join(process.cwd(), "src/features/enrollment/server/actions.ts"), "utf8");
    // 감사 선조회만 이름(prospect_name)과 상담 내용(parent_request)을 **함께** 읽는다 — 전환(이름만)·AI 요약
    // 덧붙이기(`id, parent_request`) 같은 다른 select와 그걸로 가른다.
    // 한쪽 select에만 칸이 빠지면 그 칸은 "안 바뀜"으로 기록돼 로그가 조용히 거짓이 된다.
    const selects = [...src.matchAll(/\.select\(\s*"([^"]*)"/g)]
      .map((m) => m[1]!)
      .filter((s) => s.includes("prospect_name") && s.includes("parent_request"));
    expect(selects.length, "수정·목록 칸 수정의 감사 선조회를 못 찾음").toBeGreaterThanOrEqual(2);
    for (const s of selects) {
      for (const f of CONSULTATION_AUDIT_FIELDS) expect(s, `${f.col} 누락`).toContain(f.col);
    }
  });
});
