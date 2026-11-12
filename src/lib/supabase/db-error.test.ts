import { describe, expect, it } from "vitest";
import { humanizeDbError, isMissingColumn as missCol, isMissingFunction as missFn, isMissingRelation as missRel } from "./db-error";

describe("humanizeDbError", () => {
  it("RLS 위반 원문을 한글 권한 안내로 바꾼다(영문 원문 미노출)", () => {
    const msg = humanizeDbError(
      'new row violates row-level security policy for table "academy_documents"',
    );
    expect(msg).toBe("저장 권한이 없습니다 — 이 문서를 다룰 수 있는 계정인지 확인하세요");
    expect(msg).not.toMatch(/row-level|academy_documents|policy/i);
  });

  it("동작 이름이 문장에 반영된다", () => {
    expect(humanizeDbError("permission denied for table x", "삭제")).toContain("삭제 권한이 없습니다");
  });

  it("만료된 로그인·네트워크·중복을 각각 구분한다", () => {
    expect(humanizeDbError("JWT expired")).toContain("로그인이 만료");
    expect(humanizeDbError("TypeError: fetch failed")).toContain("서버에 연결하지 못했습니다");
    expect(humanizeDbError('duplicate key value violates unique constraint "x"')).toContain(
      "이미 같은 내용",
    );
  });

  it("모르는 원문도 영문을 흘리지 않고 한글 폴백을 준다", () => {
    const msg = humanizeDbError("PGRST301: something totally unexpected");
    expect(msg).toBe("저장하지 못했습니다 — 자세한 내용은 마우스를 올려 확인하세요");
    expect(msg).not.toContain("PGRST301");
  });

  it("스키마/관계 오류는 사용자를 탓하지 않는다(입력·권한 문구로 새지 않음)", () => {
    // 2026-08-03 실제 원문 — 0171a가 makeup_class_id를 더해 lesson_reports→classes FK가 2개가 됐을 때.
    const msg = humanizeDbError(
      "Could not embed because more than one relationship was found for 'lesson_reports' and 'classes'",
      "조회",
    );
    expect(msg).toContain("입력하신 값 때문이 아니니");
    expect(msg).not.toMatch(/lesson_reports|classes|embed|relationship/i);
    // ⚠️ 배포로만 고쳐지는 오류라 "다시 시도"를 권하면 안 된다(원장이 같은 버튼을 계속 누르게 된다).
    expect(msg).not.toMatch(/다시 시도|새로고침/);
    expect(humanizeDbError("PGRST201", "조회")).toBe(msg);
  });

  it("스키마 오류가 '형식 확인'·'권한 없음'보다 먼저 잡힌다(문구 오진 방지)", () => {
    // 'does not exist'는 아래 입력/권한 패턴과 겹칠 수 있는 원문이라 순서가 중요하다.
    expect(humanizeDbError('column lesson_reports.foo does not exist', "조회")).toContain(
      "데이터 설정에 문제가",
    );
  });

  it("빈 값·null도 안전하게 한글 문장을 반환한다", () => {
    expect(humanizeDbError(null)).toContain("저장하지 못했습니다");
    expect(humanizeDbError(undefined, "삭제")).toContain("삭제하지 못했습니다");
    expect(humanizeDbError("")).toContain("저장하지 못했습니다");
  });
});


describe("'아직 없음' 판정 — 대상 식별자 + 없음 코드(P1-E · E2)", () => {
  it("표: 코드와 이름이 둘 다 맞아야", () => {
    expect(missRel({ code: "42P01", message: 'relation "public.love_note_suggestions" does not exist' }, "love_note_suggestions")).toBe(true);
    expect(missRel({ code: "PGRST205", message: "Could not find the table 'public.seat_placements' in the schema cache" }, "seat_placements")).toBe(true);
    // 다른 표가 없음 — 이 기능은 끄지 않는다
    expect(missRel({ code: "42P01", message: 'relation "public.other" does not exist' }, "love_note_suggestions")).toBe(false);
  });
  it("🔴 표 이름이 들어간 다른 오류(권한·유니크)는 없음이 아니다 — 코드가 이긴다", () => {
    expect(missRel({ code: "42501", message: 'permission denied for table love_note_suggestions' }, "love_note_suggestions")).toBe(false);
    expect(missRel({ code: "23505", message: 'duplicate key value violates unique constraint "love_note_suggestions_pkey"' }, "love_note_suggestions")).toBe(false);
  });
  it("코드 없는 문자열 오류(fetchAllPaged 감싼 것)는 문구 + 이름으로", () => {
    expect(missRel(new Error("fetchAllPaged: relation \"public.student_siblings\" does not exist"), "student_siblings")).toBe(true);
    expect(missRel("Could not find the table 'public.x' in the schema cache", "student_siblings")).toBe(false);
  });
  it("후보 여럿 중 하나", () => {
    expect(missRel({ code: "PGRST205", message: "Could not find the table 'public.seat_period_pins'" }, ["seat_period_moves", "seat_period_pins"])).toBe(true);
  });
  it("칸·함수", () => {
    expect(missCol({ code: "42703", message: "column users.shuttle_duty does not exist" }, "shuttle_duty")).toBe(true);
    expect(missCol({ code: "PGRST204", message: "Could not find the 'is_makeup_pool' column of 'classes' in the schema cache" }, "is_makeup_pool")).toBe(true);
    expect(missCol({ code: "42703", message: "column users.other does not exist" }, "shuttle_duty")).toBe(false);
    expect(missFn({ code: "PGRST202", message: "Could not find the function public.absorb_subject_key" }, "absorb_subject_key")).toBe(true);
    expect(missFn(null, "x")).toBe(false);
  });
});
