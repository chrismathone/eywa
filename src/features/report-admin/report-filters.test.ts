import { describe, expect, it } from "vitest";
import { isAdminSendable, REPORT_SORT_KEYS, reportOrderSpecs } from "./report-filters";

// 헤더 클릭 정렬은 **서버 정렬**이다 — 목록이 30건씩 끊겨 오므로 화면에서 정렬하면 그 페이지 안에서만
// 정렬되고 사용자는 전체가 정렬된 줄 안다. 아래는 그 규약(빈 값 뒤로·tiebreak 유지)을 못 박는다.
describe("reportOrderSpecs", () => {
  it("정렬 지정이 없으면 기본 순서(수업일 → 실제 발송시각 → 등록시각)", () => {
    expect(reportOrderSpecs()).toEqual([
      { column: "report_date", ascending: false, nullsFirst: false },
      { column: "classnote_sent_at", ascending: false, nullsFirst: false },
      { column: "created_at", ascending: false, nullsFirst: false },
    ]);
  });

  it("고른 열이 맨 앞에 오고 방향이 반영된다", () => {
    expect(reportOrderSpecs("teacher", "asc")[0]).toEqual({ column: "teacher_name", ascending: true, nullsFirst: false });
    expect(reportOrderSpecs("read", "desc")[0]).toEqual({ column: "classnote_read_at", ascending: false, nullsFirst: false });
  });

  it("빈 값은 방향과 무관하게 항상 뒤 — 화면 정렬 규약(lib/table/sort)과 같게", () => {
    for (const key of REPORT_SORT_KEYS) {
      for (const dir of ["asc", "desc"] as const) {
        expect(reportOrderSpecs(key, dir).every((o) => o.nullsFirst === false)).toBe(true);
      }
    }
  });

  it("정렬 열마다 tiebreak가 남는다 — 동률 순서가 페이지마다 뒤바뀌면 행이 중복·누락된다", () => {
    for (const key of REPORT_SORT_KEYS) {
      const specs = reportOrderSpecs(key, "asc");
      expect(specs.length).toBeGreaterThan(1);
      expect(specs[specs.length - 1]!.column).toBe("created_at");
    }
  });

  it("날짜 정렬은 자기 자신을 tiebreak로 중복해 넣지 않는다", () => {
    expect(reportOrderSpecs("date", "asc").map((o) => o.column)).toEqual(["report_date", "created_at"]);
  });

  it("학생·과목은 서버 정렬 대상이 아니다(조인 값·내부 키라 한글 라벨 순서와 어긋남)", () => {
    expect([...REPORT_SORT_KEYS]).not.toContain("student");
    expect([...REPORT_SORT_KEYS]).not.toContain("subject");
  });
});

// 관리자 최초 발송 대상 판정 — 서버 하드필터(sendClassnoteForUnsent)와 계약이 같아야 한다.
// 핵심: 발송 이력이 있는 행(어떤 상태든)과 이관분은 절대 대상 아님 = 중복발송·이관 재게시 차단.
describe("isAdminSendable", () => {
  it("미발송 native 행만 발송 가능", () => {
    expect(isAdminSendable({ classnoteStatus: null, source: "onescreen" })).toBe(true);
  });

  it("발송 이력이 있으면 상태 불문 거부(중복발송 방어) — success 포함", () => {
    for (const status of ["queued", "processing", "success", "failed", "too_old", "name_conflict", "blocked_shared"]) {
      expect(isAdminSendable({ classnoteStatus: status, source: "onescreen" })).toBe(false);
    }
  });

  it("이관(edutrix_import)은 미발송이어도 거부 — Edutrix가 이미 학부모에게 발송한 기록", () => {
    expect(isAdminSendable({ classnoteStatus: null, source: "edutrix_import" })).toBe(false);
  });

  it("source 미상(null)은 미발송이면 통과 — 서버 게이트(too_old·과목)가 최종 방어", () => {
    expect(isAdminSendable({ classnoteStatus: null, source: null })).toBe(true);
  });
});
