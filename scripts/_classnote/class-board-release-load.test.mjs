// 반 보드 자동 해제의 조회부 — 누구를 '이 반 학생'·'남길 선생님'으로 세는가(해제 판정의 입력). 쿼리 결과는 가짜로 넣는다.
import { describe, expect, it } from "vitest";
import { loadChildLinks, loadClassEnrollments, loadClassTeachers, loadClosedBoards, loadEnglishRooms, loadOpenEnglish, loadSubjectEnrollments } from "./class-board-release-load.mjs";

/** postgres.js 흉내 — 쿼리 글에 든 표 이름으로 결과를 고른다. */
function fakeSql(tables) {
  const seen = [];
  const sql = (strings) => {
    const text = strings.join("?");
    seen.push(text);
    const hit = Object.keys(tables).find((name) => text.includes(`from ${name}`));
    return Promise.resolve(hit ? tables[hit] : []);
  };
  return { sql, seen };
}

describe("반별 수강 기록", () => {
  it("열린 수강(open)과 끝난 기록(ended)을 가른다 — 나갔다가 다시 들어온 학생은 둘 다에 든다 · 기록 없는 반도 키로 든다", async () => {
    const { sql, seen } = fakeSql({
      enrollments: [
        { class_id: "c1", student_id: "s1", open: true, ended: false },
        { class_id: "c1", student_id: "s2", open: false, ended: true, ended_on: "2026-10-18" },
        { class_id: "c1", student_id: "s3", open: true, ended: true },
      ],
    });
    const out = await loadClassEnrollments(sql, "t1", ["c1", "c2"]);
    expect(out.get("c1")).toEqual({ open: ["s1", "s3"], ended: ["s2", "s3"], endedOn: { s2: "2026-10-18" } });
    expect(out.get("c2")).toEqual({ open: [], ended: [], endedOn: {} });
    // 🔴 열린 수강 = 종료일이 없거나 **오늘 이후**(종료일 당일은 아직 이 반 학생) · 끝난 기록 = 종료일이 **어제까지**. 학생 상태(휴원)·시작일은 보지 않는다.
    expect(seen[0]).toContain("bool_or(e.end_date is null or e.end_date >= ?) as open");
    expect(seen[0]).toContain("bool_or(e.end_date is not null and e.end_date < ?) as ended");
    expect(seen[0]).not.toMatch(/status|start_date/);
  });
  it("반이 없으면 조회하지 않는다", async () => {
    const { sql, seen } = fakeSql({});
    expect((await loadClassEnrollments(sql, "t1", [])).size).toBe(0);
    expect(seen).toEqual([]);
  });
});

describe("원아 링크", () => {
  it("원아 번호(숫자) → 학생", async () => {
    const { sql } = fakeSql({ classnote_child_links: [{ child_id: "501", student_id: "s1" }] });
    expect([...(await loadChildLinks(sql, "t1"))]).toEqual([[501, "s1"]]);
  });
});

describe("반별 남길 선생님", () => {
  const tables = {
    classes: [
      { id: "c1", teacher_id: "u-home", pending_teacher_id: "u-next" },
      { id: "c2", teacher_id: null, pending_teacher_id: null },
      { id: "c3", teacher_id: "u-gone", pending_teacher_id: null },
    ],
    class_schedules: [
      { class_id: "c1", teacher_id: "u-slot", slot_teacher_label: null },
      { class_id: "c1", teacher_id: null, slot_teacher_label: " Jane " },
      { class_id: "c1", teacher_id: null, slot_teacher_label: "LAB실" },
      { class_id: "c1", teacher_id: null, slot_teacher_label: "JJ" },
    ],
    class_delegations: [{ class_id: "c1", delegate_user_id: "u-del" }],
    users: [
      { id: "u-home", display_name: "이수진", status: "active" },
      { id: "u-next", display_name: "허주연", status: "active" },
      { id: "u-slot", display_name: "김은정", status: "active" },
      { id: "u-del", display_name: " 남정화 ", status: "active" },
      { id: "u-gone", display_name: "유형숙", status: "resigned" },
    ],
  };
  it("담임 · 예약된 새 담임 · 교시 담당 · 위임 · 이름만 적힌 교시를 남긴다 — 자리(LAB·JJ) 라벨은 사람이 아니라 뺀다", async () => {
    const { sql } = fakeSql(tables);
    const out = await loadClassTeachers(sql, "t1", ["c1", "c2", "c3"]);
    expect(out.get("c1")).toEqual({ homeroom: "이수진", homeroomActive: true, keepNames: ["이수진", "허주연", "김은정", "남정화", "Jane"] });
  });
  it("담임이 없는 반 · 담임이 재직 중이 아닌 반을 판정이 알아볼 수 있게 돌려준다", async () => {
    const { sql } = fakeSql(tables);
    const out = await loadClassTeachers(sql, "t1", ["c1", "c2", "c3"]);
    expect(out.get("c2")).toEqual({ homeroom: null, homeroomActive: false, keepNames: [] });
    expect(out.get("c3")).toEqual({ homeroom: "유형숙", homeroomActive: false, keepNames: ["유형숙"] });
  });
  it("이름을 못 읽은 사람은 '(이름 없음)'으로 남긴다 — 판정이 대응표에 없는 담당으로 보고 그 반을 보류한다", async () => {
    const { sql } = fakeSql({ ...tables, users: [] });
    const out = await loadClassTeachers(sql, "t1", ["c1"]);
    expect(out.get("c1").homeroom).toBe("(이름 없음)");
    expect(out.get("c1").keepNames).toContain("(이름 없음)");
    expect(out.get("c1").homeroomActive).toBe(false);
  });
  it("교시는 지금 유효하거나 앞으로 시작할 줄까지(끝난 이력만 뺀다) · 위임은 오늘 이후까지 걸린 것", async () => {
    const { sql, seen } = fakeSql(tables);
    await loadClassTeachers(sql, "t1", ["c1"]);
    const slots = seen.find((t) => t.includes("from class_schedules"));
    expect(slots).toContain("(valid_to is null or valid_to >= ?::date)");
    expect(slots).not.toContain("valid_from");
    expect(seen.find((t) => t.includes("from class_delegations"))).toContain("revoked_at is null and to_date >= ?::date");
  });
});
describe("넓힌 대상 조회(원장 2026-11-03)", () => {
  it("학생별 과목 수강 — 수학(math·subject_1)·영어로 열린/끝난을 가른다(반의 종강·미발송과 무관)", async () => {
    const { sql, seen } = fakeSql({ enrollments: [{ student_id: "s1", math_open: true, math_ended: false, english_open: null, english_ended: true, english_ended_on: "2026-10-01" }] });
    const out = await loadSubjectEnrollments(sql, "t1");
    expect(out.get("s1")).toEqual({ math: { open: true, ended: false, endedOn: null }, english: { open: false, ended: true, endedOn: "2026-10-01" } });
    expect(seen[0]).toContain("c.subject in ('math', 'subject_1') and (e.end_date is null or e.end_date >= ?)) as math_open");
  });
  it("종강 연결 반 — 이 조회는 report_optout을 거르지 않는다(11-04 되돌림 뒤 미발송 반 연결은 정기 동기화가 먼저 걷어 여기 오지 않는다)", async () => {
    const { sql, seen } = fakeSql({ classes: [{ id: "c1", class_name: "가반", closed_at: "2026-10-19", board_id: "7", board_name: "가반" }] });
    expect(await loadClosedBoards(sql, "t1")).toEqual([{ classId: "c1", className: "가반", closedAt: "2026-10-19", boardId: 7, boardName: "가반" }]);
    expect(seen[0]).not.toContain("report_optout");
  });
  it("영어 반 방 연결 — 표가 없으면(s2_0006 전 · 웹이 조회를 모름) null, 그 밖의 실패는 던진다", async () => {
    const { sql } = fakeSql({ classnote_english_class_boards: [{ class_id: "e1", board_id: "9", board_name: "방", class_name: "영A", is_active: true, closed_at: null }] });
    expect(await loadEnglishRooms(sql, "t1")).toEqual([{ classId: "e1", className: "영A", boardId: 9, boardName: "방", isActive: true, closedAt: null }]);
    const fail = (e) => () => Promise.reject(e);
    expect(await loadEnglishRooms(fail(Object.assign(new Error("x"), { code: "42P01" })), "t1")).toBeNull();
    expect(await loadEnglishRooms(fail(Object.assign(new Error("x"), { code: "unknown_operation" })), "t1")).toBeNull();
    await expect(loadEnglishRooms(fail(new Error("connection reset")), "t1")).rejects.toThrow("connection reset");
  });
});

describe("열린 영어 수강(영어 반 방 A6)", () => {
  it("🔴 반이 폐지(비활성)돼도 열린 수강이 남아 있으면 넣는다 — 활성 반으로 거르면 그 학생 원아가 영어 방에서 해제될 수 있다(리뷰 R8)", async () => {
    const { sql, seen } = fakeSql({ enrollments: [{ student_id: "s1", class_id: "e9", class_name: "폐지한 영어 반" }] });
    expect(await loadOpenEnglish(sql, "t1")).toEqual([{ studentId: "s1", classId: "e9", className: "폐지한 영어 반" }]);
    expect(seen[0]).not.toContain("is_active");
    expect(seen[0]).toContain("c.subject = 'english'");
    expect(seen[0]).toContain("(e.end_date is null or e.end_date >= ?)"); // 열린 수강 = 안 끝남(시작 전 포함)
  });
});
