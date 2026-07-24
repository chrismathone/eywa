import { describe, expect, it } from "vitest";
import {
  activeReportFilterCount,
  defaultReportFilters,
  isAdminSendable,
  REPORT_SORT_KEYS,
  reportOrderSpecs,
} from "./report-filters";

// 기본 조회 범위 = 이번 달. 전체 기간이 기본이면 '강사' 정렬 1페이지가 두 달 전 기록으로만 채워진다(실측).
describe("defaultReportFilters", () => {
  it("오늘이 속한 달의 처음~끝", () => {
    expect(defaultReportFilters("2026-07-21")).toEqual({ page: 0, from: "2026-07-01", to: "2026-07-31" });
  });

  it("말일이 다른 달·윤년도 정확히", () => {
    expect(defaultReportFilters("2026-02-05").to).toBe("2026-02-28");
    expect(defaultReportFilters("2028-02-05").to).toBe("2028-02-29");
    expect(defaultReportFilters("2026-06-30").to).toBe("2026-06-30");
  });

  it("항상 1페이지부터 — 달을 바꿨는데 옛 페이지 번호가 남으면 빈 화면이 뜬다", () => {
    expect(defaultReportFilters("2026-07-21").page).toBe(0);
  });
});

// 헤더 클릭 정렬은 **서버 정렬**이다 — 목록이 30건씩 끊겨 오므로 화면에서 정렬하면 그 페이지 안에서만
// 정렬되고 사용자는 전체가 정렬된 줄 안다. 아래는 그 규약(빈 값 뒤로·tiebreak 유지)을 못 박는다.
describe("reportOrderSpecs", () => {
  it("정렬 지정이 없으면 기본 순서(수업일 → 실제 발송시각 → 등록시각 → id)", () => {
    expect(reportOrderSpecs()).toEqual([
      { column: "report_date", ascending: false, nullsFirst: false },
      { column: "classnote_sent_at", ascending: false, nullsFirst: false },
      { column: "created_at", ascending: false, nullsFirst: false },
      { column: "id", ascending: false, nullsFirst: false },
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

  it("모든 정렬(기본 포함)이 유일값 id로 끝난다 — 없으면 서버 페이징에서 행이 중복·누락된다", () => {
    // 이관분은 한 INSERT 배치의 created_at이 밀리초까지 같아, id가 없으면 같은 날짜 행이 30건을
    // 넘길 때 페이지마다 순서가 달라진다(적대 검증 확정).
    for (const key of [undefined, ...REPORT_SORT_KEYS]) {
      const specs = reportOrderSpecs(key, "asc");
      expect(specs.length).toBeGreaterThan(1);
      expect(specs[specs.length - 1]!.column).toBe("id");
    }
  });

  it("날짜 정렬은 자기 자신을 tiebreak로 중복해 넣지 않는다", () => {
    expect(reportOrderSpecs("date", "asc").map((o) => o.column)).toEqual(["report_date", "created_at", "id"]);
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

// 반 정렬(2026-07-24) — 조인 값이지만 PostgREST의 to-one 임베드 정렬로 부모를 줄 세운다.
describe("reportOrderSpecs — 반(class)", () => {
  it("반은 정렬 가능한 열이다", () => {
    expect(REPORT_SORT_KEYS).toContain("class");
  });

  it("임베드 합성 컬럼 형태로 나간다 — referencedTable 방식(임베드 행만 정렬)과 혼동 금지", () => {
    expect(reportOrderSpecs("class", "asc")[0]).toEqual({
      column: "classes(class_name)",
      ascending: true,
      nullsFirst: false,
    });
  });

  it("반 없는 행(이관분 대다수)은 방향과 무관하게 뒤 — 반 있는 건이 위로 모여야 '반별로 보기'가 된다", () => {
    for (const dir of ["asc", "desc"] as const) {
      expect(reportOrderSpecs("class", dir)[0]!.nullsFirst).toBe(false);
    }
  });

  it("반 정렬도 유일값 id로 끝난다(서버 페이징 중복·누락 방지)", () => {
    const specs = reportOrderSpecs("class", "asc");
    expect(specs.at(-1)!.column).toBe("id");
  });
});

// 필터를 팝오버로 숨기면 '걸려 있다'는 사실이 화면에서 사라진다 → 트리거 배지의 근거가 이 함수다.
describe("activeReportFilterCount", () => {
  const today = "2026-07-24";
  const base = defaultReportFilters(today);

  it("기본 상태(이번 달·필터 없음)는 0 — 기본을 세면 배지가 항상 켜져 의미가 없어진다", () => {
    expect(activeReportFilterCount(base, today)).toBe(0);
  });

  it("강사·과목·상태·읽음은 각각 1로 센다", () => {
    expect(activeReportFilterCount({ ...base, teacher: "이수진" }, today)).toBe(1);
    expect(
      activeReportFilterCount({ ...base, teacher: "이수진", subject: "math", status: "success", read: "unread" }, today),
    ).toBe(4);
  });

  it("기간이 기본(이번 달)과 다르면 1 — 전체 기간·직접 지정 모두", () => {
    expect(activeReportFilterCount({ page: 0 }, today)).toBe(1); // 전체 기간(from/to 없음)
    expect(activeReportFilterCount({ ...base, from: "2026-07-10" }, today)).toBe(1); // 직접 지정
  });

  it("정렬은 필터가 아니다 — 줄 세우기는 무엇이 보이는지를 바꾸지 않는다", () => {
    expect(activeReportFilterCount({ ...base, sort: "class", dir: "asc" }, today)).toBe(0);
  });
});
