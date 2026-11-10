// 코드·제약 이름 판정(describeDbError) — 2026-10-01, [[#138]]. 로그(등급·값 가림)는 db-error-log.test.ts.
import { describe, expect, it } from "vitest";
import { describeDbError, dbConstraintName } from "./db-error";

const FALLBACK = "저장에 실패했습니다. 잠시 후 다시 시도해주세요.";
const pg = (code: string, message: string, details = "") => ({ code, message, details, hint: "" });

describe("describeDbError — 코드·제약 이름으로 판정", () => {
  it("제약 이름은 따옴표 식별자에서만 읽는다", () => {
    expect(dbConstraintName(pg("23505", 'duplicate key value violates unique constraint "classrooms_tenant_name_idx"'))).toBe(
      "classrooms_tenant_name_idx",
    );
    expect(dbConstraintName({ code: "23502", message: 'null value in column "name" violates not-null constraint' })).toBeNull();
    expect(dbConstraintName(null)).toBeNull();
  });

  it("같은 23505라도 제약마다 다른 이유를 말한다(학생 자연키 ↔ 출결번호)", () => {
    const natural = describeDbError(
      pg("23505", 'duplicate key value violates unique constraint "ux_students_active_natural_key"'),
      { fallback: FALLBACK },
    );
    expect(natural.message).toContain("같은 이름·학교·학년의 학생이 이미 있습니다");
    expect(natural.field).toBe("name");
    const code = describeDbError(
      pg("23505", 'duplicate key value violates unique constraint "ux_students_attendance_code_active"'),
      { fallback: FALLBACK },
    );
    expect(code.message).toContain("같은 출결번호");
    expect(code.message).not.toContain("이름·학교·학년");
    expect(code.field).toBe("attendanceCode");
  });

  it("모르는 유니크 제약은 코드 기본 문구(영문 제약 이름은 안 나온다)", () => {
    const info = describeDbError(pg("23505", 'duplicate key value violates unique constraint "some_new_idx"'), { fallback: FALLBACK });
    expect(info.kind).toBe("duplicate");
    expect(info.known).toBe(true);
    expect(info.message).toContain("이미 같은 내용이 저장되어 있습니다");
    expect(info.message).not.toMatch(/some_new_idx|duplicate/);
  });

  it("EXCLUDE 겹침(23P01)은 수강 겹침 문구", () => {
    const info = describeDbError(
      pg("23P01", 'conflicting key value violates exclusion constraint "enrollments_no_overlap"'),
      { fallback: FALLBACK },
    );
    expect(info.kind).toBe("overlap");
    expect(info.message).toContain("기간이 겹치는 수강");
  });

  it("외래키(23503)는 동작 방향으로 뜻이 갈린다 — 같은 제약 이름이라도", () => {
    const del = describeDbError(
      pg("23503", 'update or delete on table "students" violates foreign key constraint "invoices_student_id_students_id_fk" on table "invoices"'),
      { fallback: FALLBACK, op: "delete" },
    );
    expect(del.kind).toBe("in_use");
    expect(del.message).toContain("청구(수납) 기록이 있어 지울 수 없습니다");
    // 넣기 방향에선 '지울 수 없다'고 말하면 거짓말 — 코드 기본 문구로.
    const ins = describeDbError(
      pg("23503", 'insert or update on table "invoices" violates foreign key constraint "invoices_student_id_students_id_fk"'),
      { fallback: FALLBACK },
    );
    expect(ins.kind).toBe("missing_ref");
    expect(ins.message).toContain("연결하려는 항목을 찾을 수 없습니다");
    expect(ins.message).not.toContain("지울 수 없습니다");
  });

  it("CHECK는 이름 규약(_len·_range_ordered)으로 고르고, 나머지는 범위 문구", () => {
    const at = (name: string) =>
      describeDbError(pg("23514", `new row for relation "x" violates check constraint "${name}"`), { fallback: FALLBACK }).message;
    // _len은 대개 `char_length(btrim(x)) between 1 and N` — 빈 값도 걸리니 "너무 깁니다"라고만 하면 거짓이다.
    expect(at("help_posts_title_len")).toContain("비어 있거나 너무 긴");
    expect(at("leave_forms_range_ordered")).toContain("시작보다 빠릅니다");
    expect(at("payslips_status_valid")).toContain("허용 범위");
    // 규약 이름인데 정의가 다른 CHECK는 표에 직접 적은 문구가 이긴다.
    expect(at("math_learning_goals_dates_ck")).toContain("730일");
    expect(at("class_textbook_plans_slot_picks_len")).toContain("교시 수");
    // 접미사는 규약과 같지만 정의가 다른 것(used_start 없이 used_end만 있어도 걸린다)은 표에 직접 적었다.
    expect(at("leave_adjustments_used_range_ordered")).toContain("시작일이 비었거나");
  });

  it("트리거 RAISE(P0001)의 한글 문장은 그대로, 영문 코드성 문장은 fallback", () => {
    const say = (m: string) => describeDbError(pg("P0001", m), { fallback: FALLBACK });
    expect(say("같은 반을 두 번 배분할 수 없습니다").message).toBe("같은 반을 두 번 배분할 수 없습니다");
    // 함수명 접두·괄호 속 영문 식별자는 걷는다.
    expect(say("학원 설정(tenant_settings)은 원장(master)만 삭제할 수 있습니다").message).toBe("학원 설정은 원장만 삭제할 수 있습니다");
    expect(say("merge_enrollment_consultations: 대상 상담을 찾을 수 없습니다").message).toBe("대상 상담을 찾을 수 없습니다");
    const code = say("invalid_move");
    expect(code.known).toBe(false);
    expect(code.message).toBe(FALLBACK);
    // 영문이 남으면(`%`로 컬럼 이름이 들어간 문장 등) 원문으로 본다.
    expect(say("자산이 쓰는 분류가 inventory_categories에 없습니다").message).toBe(FALLBACK);
  });

  it("42501: 보호 트리거의 한글 이유는 살리고, RLS 원문은 권한 문구로", () => {
    expect(describeDbError(pg("42501", "급여 항목은 원장만 바꿀 수 있습니다"), { fallback: FALLBACK }).message).toBe(
      "급여 항목은 원장만 바꿀 수 있습니다",
    );
    const rls = describeDbError(pg("42501", 'new row violates row-level security policy for table "students"'), { fallback: FALLBACK });
    expect(rls.kind).toBe("permission");
    expect(rls.message).not.toMatch(/row-level|students/);
  });

  it("호출부 제약 표가 공용 표보다 먼저", () => {
    const info = describeDbError(pg("23505", 'duplicate key value violates unique constraint "classrooms_tenant_name_idx"'), {
      fallback: FALLBACK,
      constraints: { classrooms_tenant_name_idx: { message: "다른 문장", field: "roomName" } },
    });
    expect(info.message).toBe("다른 문장");
    expect(info.field).toBe("roomName");
  });

  it("NOT NULL(23502)·형식 오류(22P02)는 대개 코드 버그 — 사용자를 탓하지 않고 fallback", () => {
    for (const e of [
      pg("23502", 'null value in column "name" of relation "students" violates not-null constraint'),
      pg("22P02", 'invalid input syntax for type uuid: "abc"'),
    ]) {
      const info = describeDbError(e, { fallback: FALLBACK });
      expect(info.known).toBe(false);
      expect(info.message).toBe(FALLBACK);
    }
  });

  it("모르는 오류·코드 없음·null은 fallback 그대로(원문 비노출)", () => {
    for (const e of [pg("XX000", "internal error: something"), { message: "TypeError: fetch failed" }, null, undefined, "boom"]) {
      const info = describeDbError(e, { fallback: FALLBACK });
      expect(info.known).toBe(false);
      expect(info.message).toBe(FALLBACK);
    }
  });

  it("어떤 판정 문구에도 영문 원문이 섞이지 않는다", () => {
    const samples = [
      pg("23505", 'duplicate key value violates unique constraint "users_tenant_email_idx"'),
      pg("23502", 'null value in column "name" of relation "students" violates not-null constraint'),
      pg("22P02", 'invalid input syntax for type uuid: "abc"'),
      pg("57014", "canceling statement due to statement timeout"),
      pg("PGRST204", "Could not find the 'foo' column of 'students' in the schema cache"),
      pg("42501", "permission denied for table students"),
    ];
    for (const s of samples) expect(describeDbError(s, { fallback: FALLBACK }).message).not.toMatch(/[A-Za-z]{3,}/);
  });
});

describe("23514 트리거 한글 사유(P1-E 리뷰)", () => {
  it("제약 이름 없는 23514의 한글 RAISE는 그대로 보인다", () => {
    const info = describeDbError(
      { code: "23514", message: "환불완료일자는 날짜(예: 2026-11-09)로 넣어 주세요." },
      { fallback: "저장 실패" },
    );
    expect(info.message).toBe("환불완료일자는 날짜(예: 2026-11-09)로 넣어 주세요.");
    expect(info.kind).toBe("invalid");
  });
  it("영문 원문 23514는 종전 일반 문구", () => {
    const info = describeDbError({ code: "23514", message: "new row violates check constraint" }, { fallback: "x" });
    expect(info.message).toContain("허용 범위");
  });
});

