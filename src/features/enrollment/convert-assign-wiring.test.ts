import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 구조 가드 — 등록상담 '수업 배정'의 **배정일**과 **교재 신청서 연결**(원장 2026-09-09)이
 * "만들었는데 아무도 안 쓴다"로 굳지 않게 잠근다.
 *
 * 이 영역의 실패 모드는 둘 다 조용하다: ① 날짜 칸만 만들고 서버가 여전히 `kstToday()`를 쓰면 화면이
 * 받은 날짜가 **말없이 버려진다**(에러 없음) ② 교재 경로를 클라 체크박스로 판정하면 아무 수강도 안
 * 생긴 저장에서 "교재 신청하세요"가 뜬다.
 */
const ROOT = join(__dirname, "..", "..", "..");
// ⚠️ 체크아웃이 CRLF일 수 있다(Windows) — 줄바꿈을 정규화해야 여러 줄 패턴이 헛돌지 않는다.
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8").replace(/\r\n/g, "\n");

const actions = read("src/features/enrollment/server/actions.ts");
const dialog = read("src/app/(shell)/enrollment/[id]/_components/convert-dialog.tsx");
const page = read("src/app/(shell)/enrollment/[id]/page.tsx");

describe("배정일이 화면에서 DB까지 이어진다", () => {
  it("서버 액션이 폼의 startDate를 같은 순수 함수로 검증한다", () => {
    expect(actions).toContain("normalizeAssignStartDate");
    expect(actions).toContain('formData.get("startDate")');
  });

  it("검증이 학생 INSERT **앞**에 있다 — 날짜 때문에 학생만 남으면 다음 시도가 자연키 충돌로 떨어진다", () => {
    const gate = actions.indexOf("const startAt = normalizeAssignStartDate");
    const insert = actions.indexOf('.from("students")\n    .insert(');
    expect(gate).toBeGreaterThan(-1);
    expect(insert).toBeGreaterThan(-1);
    expect(gate).toBeLessThan(insert);
  });

  it("수강 start_date가 오늘이 아니라 확정된 배정일이다", () => {
    expect(actions).toContain("start_date: startDate,");
    expect(actions).not.toContain("start_date: today,");
  });

  it("감사로그도 같은 날짜를 남긴다 — 기록과 실제가 갈리면 역검수가 거짓말한다", () => {
    expect(actions).toContain('action: "enrollment_assign"');
    expect(actions).toContain("metadata: { studentId, classId, startDate,");
  });

  it("students.enrolled_at은 여전히 오늘 — 등록일과 배정일은 다른 축이다(신입생 집계 보호)", () => {
    expect(actions).toContain("enrolled_at: today,");
  });

  it("다이얼로그가 startDate 칸을 실제로 제출하고 같은 규칙으로 미리 막는다", () => {
    expect(dialog).toContain('name="startDate"');
    expect(dialog).toContain("normalizeAssignStartDate");
    // 범위를 벗어난 날짜면 저장 버튼이 잠긴다(서버 거절 전에 이유를 보여준다).
    expect(dialog).toContain("!!startError");
    // 오늘이 아닌 날짜는 무슨 일이 벌어지는지 한 줄로 말한다.
    expect(dialog).toContain("assignStartDateNotice");
  });
});

describe("수학 반 배정 → 교재 신청서 연결", () => {
  it("판정 근거가 서버가 돌려준 assignedClassIds다 — 클라 선택(selected)으로 세지 않는다", () => {
    expect(actions).toContain("assignedClassIds: assignClassIds,");
    expect(dialog).toContain("success?.assignedClassIds");
    expect(dialog).not.toMatch(/selected[^\n]*TEXTBOOK_SUBJECT_KEY/);
  });

  it("과목은 반 이름이 아니라 subject 키로 판정한다", () => {
    expect(dialog).toContain('const TEXTBOOK_SUBJECT_KEY = "math"');
    expect(dialog).toContain("c.subject === TEXTBOOK_SUBJECT_KEY");
  });

  it("권한 없는 사람에겐 안 그린다 — 페이지가 textbook_requests 게이트를 넘긴다", () => {
    expect(page).toContain('canWriteTenant(user.systemRole, "textbook_requests")');
    expect(page).toContain("canRequestTextbook={canRequestTextbook}");
    expect(dialog).toContain("canRequestTextbook && mathAssigned");
  });

  it("새 교재 신청 경로를 만들지 않고 기존 화면을 학생만 채워 연다", () => {
    expect(dialog).toContain("/textbook-requests?studentId=");
    // 받는 쪽이 실제로 그 파라미터를 읽어야 '미리 채워진 폼'이 성립한다.
    const tbPage = read("src/app/(shell)/textbook-requests/page.tsx");
    const tbClient = read("src/app/(shell)/textbook-requests/_client.tsx");
    expect(tbPage).toContain("searchParams: Promise<{ studentId?: string | string[] }>");
    expect(tbPage).toContain("initialStudentIds={initialStudentIds}");
    // 스코프 밖 id는 조용히 무시(raw UUID 칩·서버 거절 방지).
    expect(tbClient).toContain("students.some((s) => s.id === id)");
  });
});
