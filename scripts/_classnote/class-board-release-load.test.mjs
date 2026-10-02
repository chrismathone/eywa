// 반 보드 자동 해제의 조회부 — 누구를 '이 반 학생'·'남길 선생님'으로 세는가(해제 판정의 입력). 쿼리 결과는 가짜로 넣는다.
import { describe, expect, it } from "vitest";
import { loadChildLinks, loadClassEnrollments, loadClassTeachers } from "./class-board-release-load.mjs";

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
        { class_id: "c1", student_id: "s2", open: false, ended: true },
        { class_id: "c1", student_id: "s3", open: true, ended: true },
      ],
    });
    const out = await loadClassEnrollments(sql, "t1", ["c1", "c2"]);
    expect(out.get("c1")).toEqual({ open: ["s1", "s3"], ended: ["s2", "s3"] });
    expect(out.get("c2")).toEqual({ open: [], ended: [] });
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
