// 반 보드 자동 해제 **판정**(순수) — 누구를 내보내고 누구를 보류하나. 해제는 되돌리기 번거로운 쓰기라 보류 쪽 테스트가 더 많다.
import { describe, expect, it } from "vitest";
import { RELEASE_CLASS_SOFT_LIMIT, dropReleasedExtras, personalOwnerName, planChildReleases, planTeacherReleases } from "./class-board-release.mjs";

const student = (id, name, phones = []) => [id, { id, name, phones }];
const students = new Map([
  student("s-in", "김민준", ["010-1111-2222"]),
  student("s-out", "이서연", ["010-3333-4444"]),
  student("s-out2", "최하린", ["010-5555-6666"]),
  student("s-hold", "박서연E", ["010-7777-8888"]),
  student("s-never", "정도윤", ["010-9999-0000"]),
]);
const plan = (over = {}) => ({
  classId: "c1", className: "가반", board: { action: "exists", id: 100, name: "가반" }, assign: [], hold: [],
  extras: [], extraChildren: [], ...over,
});
/** 운영관리 명부 한 줄 — 기본은 전화·소속 보드를 모르는 원아(명부에는 있다). */
const adm = (phone = null, boardNames = []) => ({ phone, boardNames });
const ctx = (over = {}) => ({
  enrollmentsByClass: new Map([["c1", { open: ["s-in", "s-hold"], ended: ["s-out", "s-out2"] }]]),
  students,
  membersByBoard: new Map([[100, [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }, { id: 5 }, { id: 6 }]]]),
  admissions: new Map([[2, adm()], [3, adm()], [9, adm()]]),
  childLinks: new Map(),
  ...over,
});
const names = (r) => r.releases.map((x) => x.childName);
const heldText = (r) => r.held.map((x) => x.text);

describe("원아 해제 — 내보내는 경우", () => {
  it("원아 링크가 가리키는 학생의 이 반 수강이 끝났으면 내보낸다(사유에 학생 이름)", () => {
    const r = planChildReleases([plan({ extraChildren: [{ id: 2, name: "이서연" }] })], ctx({ childLinks: new Map([[2, "s-out"]]) }));
    expect(r.releases).toEqual([
      { classId: "c1", className: "가반", boardId: 100, childId: 2, childName: "이서연", studentId: "s-out", studentName: "이서연", reason: "이서연 학생의 이 반 수강이 끝났습니다(반 이동·수강 종료)" },
    ]);
    expect(r.held).toEqual([]);
  });
  it("원아 링크가 없어도 1인 보드 주인으로 학생이 특정되면 내보낸다", () => {
    const admissions = new Map([[3, adm("010-5555-6666", ["(수학)최하린", "가반"])]]);
    const r = planChildReleases([plan({ extraChildren: [{ id: 3, name: "하린" }] })], ctx({ admissions }));
    expect(names(r)).toEqual(["하린"]);
    expect(r.releases[0].studentId).toBe("s-out2");
  });
  it("이름이 같은 학생이 또 있어도 원아 링크가 그 후보 안에 있으면 링크로 확정한다(퇴원한 동명 학생 때문에 영영 보류되지 않게)", () => {
    const twins = new Map(students);
    twins.set("s-same", { id: "s-same", name: "이서연", phones: [] });
    const r = planChildReleases(
      [plan({ extraChildren: [{ id: 2, name: "Jay" }] })],
      ctx({ students: twins, admissions: new Map([[2, adm(null, ["(수학)이서연"])]]), childLinks: new Map([[2, "s-out"]]) }),
    );
    expect(r.releases.map((x) => x.studentId)).toEqual(["s-out"]);
  });
  it("반 명단이 비어 있어도(전원 수강 종료) 끝난 기록이 근거라 내보낸다", () => {
    const r = planChildReleases(
      [plan({ extraChildren: [{ id: 2, name: "이서연" }] })],
      ctx({ enrollmentsByClass: new Map([["c1", { open: [], ended: ["s-out"] }]]), childLinks: new Map([[2, "s-out"]]) }),
    );
    expect(names(r)).toEqual(["이서연"]);
  });
});

describe("🔴 원아 해제 — 보류하는 경우(지금 다니는 학생을 내보내지 않는다)", () => {
  const one = (child, over) => planChildReleases([plan({ extraChildren: [child] })], ctx(over));
  it("이 반 학생과 이름이 이어지면 보류 — 보류 학생(1인 보드 없음)의 원아는 '명단 밖'으로 떨어진다", () => {
    const r = one({ id: 9, name: "서연" }, { childLinks: new Map([[9, "s-out"]]) });
    expect(r.releases).toEqual([]);
    expect(heldText(r)[0]).toContain("이 반 학생 '박서연E'의 원아일 수 있습니다");
  });
  it("원아 링크가 이 반 학생이면 보류(원아 이름이 전혀 달라도)", () => {
    const r = one({ id: 9, name: "Jay" }, { childLinks: new Map([[9, "s-in"]]) });
    expect(r.releases).toEqual([]);
    expect(heldText(r)[0]).toContain("이 반 학생 '김민준'에 연결된 원아입니다");
  });
  it("이 반 학생의 1인 보드(수학·영어 어느 쪽이든)에 있는 원아면 보류", () => {
    const r = one({ id: 9, name: "Jay" }, { admissions: new Map([[9, adm(null, ["(영어)김민준"])]]), childLinks: new Map([[9, "s-out"]]) });
    expect(r.releases).toEqual([]);
    expect(heldText(r)[0]).toContain("'김민준'의 1인 보드에 있는 원아입니다");
  });
  it("보호자 전화가 이 반 학생과 같으면 보류(형제) — 전화 값은 사유에 싣지 않는다", () => {
    const r = one({ id: 2, name: "이서연" }, { admissions: new Map([[2, adm("010-1111-2222")]]), childLinks: new Map([[2, "s-out"]]) });
    expect(r.releases).toEqual([]);
    expect(heldText(r)[0]).toContain("'김민준'와 보호자 전화가 같습니다");
    expect(heldText(r)[0]).not.toContain("1111");
  });
  it("ClassNote 운영관리 명부에 없는 원아는 보류 — 1인 보드·전화를 대조하지 못한 채 원아 링크만 믿고 내보내지 않는다", () => {
    const r = one({ id: 2, name: "이서연" }, { admissions: new Map(), childLinks: new Map([[2, "s-out"]]) });
    expect(r.releases).toEqual([]);
    expect(heldText(r)[0]).toContain("운영관리 명부에 없어");
  });
  it("주인 후보가 둘 이상이면 보류 — 원아 링크와 1인 보드 주인이 다른 학생 · 이름이 같은 두 학생", () => {
    // 링크는 이서연, 1인 보드는 최하린 — 둘 다 이 반을 떠났지만 누구 원아인지 정하지 못한다.
    const mixed = one({ id: 9, name: "Jay" }, { admissions: new Map([[9, adm(null, ["(수학)최하린"])]]), childLinks: new Map([[9, "s-out"]]) });
    expect(mixed.releases).toEqual([]);
    expect(heldText(mixed)[0]).toContain("하나로 정하지 못했습니다(후보 2명");
    // 유효이름이 같은 두 학생(퇴원한 학생 + 이 반을 수강한 적 없는 재원생) — 퇴원한 학생의 종료 기록으로 재원생 원아를 내보내면 안 된다.
    const twins = new Map(students);
    twins.set("s-same", { id: "s-same", name: "이서연", phones: [] });
    const homonym = one({ id: 9, name: "Jay" }, { students: twins, admissions: new Map([[9, adm(null, ["(수학)이서연"])]]) });
    expect(homonym.releases).toEqual([]);
    expect(heldText(homonym)[0]).toContain("하나로 정하지 못했습니다");
  });
  it("누구의 원아인지 모르면 보류(원아 링크·1인 보드 둘 다 없음)", () => {
    const r = one({ id: 9, name: "모르는아이" });
    expect(r.releases).toEqual([]);
    expect(heldText(r)[0]).toContain("누구의 원아인지 확인하지 못했습니다");
  });
  it("그 학생이 이 반을 수강한 기록이 없으면 보류(사람이 넣은 원아일 수 있다)", () => {
    const r = one({ id: 9, name: "정도윤" }, { childLinks: new Map([[9, "s-never"]]) });
    expect(r.releases).toEqual([]);
    expect(heldText(r)[0]).toContain("'정도윤' 학생은 이 반 수강 기록이 없습니다");
  });
  it("나갔다가 다시 들어온 학생(끝난 기록 + 열린 수강)은 이 반 학생이다 — 보류", () => {
    const r = one({ id: 2, name: "이서연" }, { enrollmentsByClass: new Map([["c1", { open: ["s-out"], ended: ["s-out"] }]]), childLinks: new Map([[2, "s-out"]]) });
    expect(r.releases).toEqual([]);
  });
  it("반의 수강 기록을 읽지 못했으면(지도에 반이 없음) 전원 보류", () => {
    const r = one({ id: 2, name: "이서연" }, { enrollmentsByClass: new Map(), childLinks: new Map([[2, "s-out"]]) });
    expect(r.releases).toEqual([]);
    expect(heldText(r)[0]).toContain("수강 기록을 읽지 못해");
  });
  it("반 명단의 학생 정보를 다 못 읽었으면 전원 보류", () => {
    const r = one({ id: 2, name: "이서연" }, { enrollmentsByClass: new Map([["c1", { open: ["s-ghost"], ended: ["s-out"] }]]), childLinks: new Map([[2, "s-out"]]) });
    expect(r.releases).toEqual([]);
  });
  it("보드가 확인되지 않은 반(생성 전·특정 불가)·1인 보드 모양 이름은 손대지 않는다", () => {
    const links = new Map([[2, "s-out"]]);
    const kid = [{ id: 2, name: "이서연" }];
    expect(planChildReleases([plan({ board: { action: "create" }, extraChildren: kid })], ctx({ childLinks: links })).releases).toEqual([]);
    expect(planChildReleases([plan({ board: { action: "block", reason: "x" }, extraChildren: kid })], ctx({ childLinks: links })).releases).toEqual([]);
    const personal = planChildReleases([plan({ board: { action: "exists", id: 100, name: "(수학)김민준" }, extraChildren: kid })], ctx({ childLinks: links }));
    expect(personal.releases).toEqual([]);
    expect(heldText(personal)[0]).toContain("1인 보드·전체방 모양");
  });
  it("한 반에서 한꺼번에 많이(상한 초과 + 보드 절반 초과) 나가면 그 반은 통째로 보류", () => {
    const n = RELEASE_CLASS_SOFT_LIMIT + 1;
    const kids = Array.from({ length: n }, (_, i) => ({ id: 50 + i, name: `학생${i}` }));
    const many = new Map(students);
    const links = new Map();
    const ended = [];
    const book = new Map();
    kids.forEach((k, i) => { many.set(`x${i}`, { id: `x${i}`, name: `가나다${i}`, phones: [] }); links.set(k.id, `x${i}`); ended.push(`x${i}`); book.set(k.id, adm()); });
    const base = { students: many, childLinks: links, admissions: book, enrollmentsByClass: new Map([["c1", { open: ["s-in"], ended }]]) };
    const small = planChildReleases([plan({ extraChildren: kids })], ctx({ ...base, membersByBoard: new Map([[100, Array.from({ length: n + 1 }, (_, i) => ({ id: i }))]]) }));
    expect(small.releases).toEqual([]);
    expect(small.held).toHaveLength(n);
    const big = planChildReleases([plan({ extraChildren: kids })], ctx({ ...base, membersByBoard: new Map([[100, Array.from({ length: n * 2 }, (_, i) => ({ id: i }))]]) }));
    expect(big.releases).toHaveLength(n);
  });
  it("회차 상한을 넘는 것은 다음 동기화로 미룬다", () => {
    const r = planChildReleases(
      [plan({ extraChildren: [{ id: 2, name: "이서연" }, { id: 3, name: "최하린" }] })],
      ctx({ childLinks: new Map([[2, "s-out"], [3, "s-out2"]]), runLimit: 1 }),
    );
    expect(names(r)).toEqual(["이서연"]);
    expect(heldText(r)).toEqual(["원아 해제 미룸: 최하린 — 한 번에 해제하는 수를 넘어 다음 동기화에서 합니다"]);
  });
});

describe("담임 해제", () => {
  const teacherMap = { 이수진: 11, 김은정: 22, 허주연: 33 };
  const emp = (id, teacher_id, class_in_charge, is_approved = true) => ({ id, teacher_id, class_in_charge, is_approved });
  const board = (over = {}) => ({ className: "가반", boardId: 100, boardName: "가반", homeroom: "이수진", keepNames: ["이수진"], ...over });
  it("지금 담당이 아닌 아는 선생님의 살아 있는 연결만 푼다", () => {
    const r = planTeacherReleases({ boards: [board()], emps: [emp(1, 11, 100), emp(2, 22, 100), emp(3, 22, 999)], teacherMap });
    expect(r.releases).toEqual([{ className: "가반", boardId: 100, employmentId: 2, teacherId: 22, teacher: "김은정" }]);
  });
  it("교시 담당·위임(keepNames)은 남긴다 · 이미 해제된 줄(is_approved:false)·모르는 계정은 건드리지 않는다", () => {
    const r = planTeacherReleases({
      boards: [board({ keepNames: ["이수진", "김은정"] })],
      emps: [emp(1, 11, 100), emp(2, 22, 100), emp(4, 33, 100, false), emp(5, 77777, 100), { id: 6, teacher_id: 33, class_in_charge: 100 }],
      teacherMap,
    });
    expect(r.releases).toEqual([]);
    expect(r.held).toEqual([]);
  });
  it("🔴 담임이 비어 있는 반은 보류", () => {
    const r = planTeacherReleases({ boards: [board({ homeroom: null, keepNames: [] })], emps: [emp(2, 22, 100)], teacherMap });
    expect(r.releases).toEqual([]);
    expect(r.held[0].text).toContain("에이와에 이 반 담임이 없습니다");
  });
  it("🔴 담임이 재직 중이 아니면 보류 — 새 담임이 정해지기 전에 옛 선생님을 빼면 보드에 선생님이 없어진다", () => {
    const r = planTeacherReleases({ boards: [board({ homeroomActive: false })], emps: [emp(1, 11, 100), emp(2, 22, 100)], teacherMap });
    expect(r.releases).toEqual([]);
    expect(r.held[0].text).toContain("재직 중이 아닙니다");
  });
  it("🔴 지금 담당이 그 보드에 아직 연결되지 않았으면 보류 — 풀고 나서 선생님이 0명인 보드를 만들지 않는다", () => {
    const r = planTeacherReleases({ boards: [board()], emps: [emp(2, 22, 100), emp(9, 11, 100, false)], teacherMap });
    expect(r.releases).toEqual([]);
    expect(r.held[0].text).toContain("아직 이 반 보드에 연결되지 않았습니다");
  });
  it("🔴 남길 사람 중 대응표에 없는 이름이 있으면 보류 — 같은 사람을 다른 이름으로 적은 것일 수 있다", () => {
    const r = planTeacherReleases({ boards: [board({ homeroom: "셀린", keepNames: ["셀린"] })], emps: [emp(2, 22, 100)], teacherMap });
    expect(r.releases).toEqual([]);
    expect(r.held[0].text).toContain("'셀린'의 ClassNote 계정을 몰라");
  });
  it("1인 보드 모양 이름의 보드는 손대지 않는다 · 회차 상한을 넘으면 미룬다", () => {
    expect(planTeacherReleases({ boards: [board({ boardName: "(수학)김민준" })], emps: [emp(2, 22, 100)], teacherMap }).releases).toEqual([]);
    const r = planTeacherReleases({ boards: [board()], emps: [emp(1, 11, 100), emp(2, 22, 100), emp(3, 33, 100)], teacherMap, runLimit: 1 });
    expect(r.releases).toHaveLength(1);
    expect(r.held[0].text).toContain("담임 해제 미룸(허주연)");
  });
});

describe("보조", () => {
  it("1인 보드 주인 이름 — 과목 접두를 떼고 공백을 무시한다", () => {
    expect(personalOwnerName("(수학) 김민준")).toBe("김민준");
    expect(personalOwnerName("(영어)박서연E")).toBe("박서연E");
    expect(personalOwnerName("가반")).toBeNull();
  });
  it("해제한 원아를 계획의 '명단 밖 원아'에서 뺀다(그 보드의 그 원아만)", () => {
    const plans = [
      plan({ extras: ["이서연", "최하린"], extraChildren: [{ id: 2, name: "이서연" }, { id: 3, name: "최하린" }] }),
      plan({ classId: "c2", className: "나반", board: { action: "exists", id: 200, name: "나반" }, extras: ["이서연"], extraChildren: [{ id: 2, name: "이서연" }] }),
    ];
    dropReleasedExtras(plans, [{ boardId: 100, childId: 2 }]);
    expect(plans[0].extras).toEqual(["최하린"]);
    expect(plans[1].extras).toEqual(["이서연"]);
  });
});
