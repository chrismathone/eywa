// 반 보드 자동 해제 **판정**(순수) — 누구를 내보내고 누구를 보류하나. 해제는 되돌리기 번거로운 쓰기라 보류 쪽 테스트가 더 많다.
import { describe, expect, it } from "vitest";
import {
  LAST_ENROLLMENT_REASON,
  LAST_ENROLLMENT_UNKNOWN_REASON,
  RELEASE_CLASS_SOFT_LIMIT,
  dropReleasedExtras,
  formerFamilyOf,
  guardLastEnrollment,
  personalOwnerName,
  planChildReleases,
  planTeacherReleases,
} from "./class-board-release.mjs";

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
/** boards = 승인된 소속 배정(마지막 배정 가드 ④-b) — 기본은 [ALL] 전체방 + 이 반 보드(떼어도 하나가 남는다). */
const adm = (phone = null, boardNames = [], boards = [{ id: 1, name: "[ALL] 인재원 전체방" }, { id: 100, name: "가반" }]) => ({ phone, boardNames, boards });
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
      { classId: "c1", className: "가반", boardId: 100, boardKind: "class", childId: 2, childName: "이서연", studentId: "s-out", studentName: "이서연", reason: "이서연 학생의 이 반 수강이 끝났습니다(반 이동·수강 종료)", endedOn: null },
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
  it("보호자 전화는 carer1~N 전부(carerPhones) — phones에 쓸 값이 없으면 phone(carer1)으로 형제를 대조해 보류", () => {
    const r = one({ id: 2, name: "이서연" }, { admissions: new Map([[2, { ...adm("010-1111-2222"), phones: [null, ""] }]]), childLinks: new Map([[2, "s-out"]]) });
    expect(r.releases).toEqual([]);
    expect(heldText(r)[0]).toContain("'김민준'와 보호자 전화가 같습니다");
    const r2 = one({ id: 2, name: "이서연" }, { admissions: new Map([[2, { ...adm("010-9999-9999"), phones: ["010-9999-9999", "010-1111-2222"] }]]), childLinks: new Map([[2, "s-out"]]) });
    expect(r2.releases).toEqual([]);
    expect(heldText(r2)[0]).toContain("'김민준'와 보호자 전화가 같습니다");
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
describe("2026-11-03 — 넓힌 대상(영어 반 방·종강 반 보드·1인 보드)도 같은 판정 한 벌", () => {
  const onHold = new Map(students);
  onHold.set("s-out", { id: "s-out", name: "이서연", phones: ["010-3333-4444"], status: "on_hold" });
  const kids = (n) => Array.from({ length: n }, (_, i) => ({ id: 50 + i, name: `학생${i}` }));
  /** 원아 n명 = 각자 다른 학생(수강 종료) — 링크로 특정된다. */
  const crowd = (n) => {
    const many = new Map(students);
    const links = new Map();
    const ended = [];
    const book = new Map();
    kids(n).forEach((k, i) => { many.set(`x${i}`, { id: `x${i}`, name: `가나다${i}`, phones: [] }); links.set(k.id, `x${i}`); ended.push(`x${i}`); book.set(k.id, adm()); });
    return { students: many, childLinks: links, admissions: book, ended };
  };
  it("③-b 휴원 중인 학생의 원아는 수강 종료일이 들어가 있어도 내보내지 않는다(반 보드·1인 보드 모두)", () => {
    const links = new Map([[2, "s-out"]]);
    const r = planChildReleases([plan({ extraChildren: [{ id: 2, name: "이서연" }] })], ctx({ students: onHold, childLinks: links }));
    expect(r.releases).toEqual([]);
    expect(heldText(r)[0]).toContain("'이서연' 학생은 휴원 중입니다");
    const p = plan({ kind: "personal", subjectLabel: "영어", classId: "personal:300", className: "1인 보드 · (영어)이서연", board: { action: "exists", id: 300, name: "(영어)이서연" }, extraChildren: [{ id: 2, name: "이서연" }] });
    const r2 = planChildReleases([p], ctx({ students: onHold, childLinks: links, enrollmentsByClass: new Map([["personal:300", { open: [], ended: ["s-out"] }]]) }));
    expect(r2.releases).toEqual([]);
    expect(heldText(r2)[0]).toContain("휴원 중입니다");
  });
  const N = RELEASE_CLASS_SOFT_LIMIT + 2;
  const endedAt = (c, day) => Object.fromEntries(c.ended.map((sid) => [sid, day]));
  it("④ — 최근 7일 안에 끝난 수강만 센다: 몇 주 전에 끝난 지난 학생(JJ2M)은 한꺼번에 많아도 낸다 · 최근에 끝난 것이 많으면 그것만 보류", () => {
    const c = crowd(N);
    const members = new Map([[100, kids(N)]]);
    const run = (endedOn) => planChildReleases([plan({ extraChildren: kids(N) })], ctx({ ...c, today: "2026-11-03", enrollmentsByClass: new Map([["c1", { open: [], ended: c.ended, endedOn }]]), membersByBoard: members }));
    expect(run(endedAt(c, "2026-10-18")).releases).toHaveLength(N); // 굳은 사실 — 막지 않는다(원장 *"실제 반과 일치하지 않으면 이동해야지"*)
    const fresh = run(endedAt(c, "2026-10-27")); // 오늘 − 7일 = 10-27(포함) — 최근
    expect(fresh.releases).toEqual([]);
    expect(heldText(fresh)[0]).toContain(`이 반에서 최근 7일 안에 수강이 끝난 원아가 ${N}명으로 반 보드의 지금 다니는 원아와 합친 수(${N}명)의 절반을 넘습니다`);
    // 섞여 있으면 최근 것만 보류하고 오래된 것은 낸다(최근 것이 상한을 넘을 때만)
    const mixed = run({ ...endedAt(c, "2026-11-02"), x0: "2026-09-01" });
    expect(mixed.releases.map((x) => x.studentId)).toEqual(["x0"]);
    expect(mixed.held).toHaveLength(N - 1);
    // 종료일을 모르면 최근으로 센다(보수적)
    expect(run({}).releases).toEqual([]);
  });
  it("종강 반 보드도 같은 ④ 하나로 — 종강 7일 뒤라 그 반 수강은 이미 오래전에 끝나 있어 전원이 나가도 걸리지 않는다 · 사유에 종강일", () => {
    const c = crowd(N);
    const p = plan({ kind: "closed", closedAt: "2026-10-19", className: "종강 반 보드 · 가반", extraChildren: kids(N) });
    const r = planChildReleases([p], ctx({ ...c, today: "2026-11-03", enrollmentsByClass: new Map([["c1", { open: [], ended: c.ended, endedOn: endedAt(c, "2026-10-18") }]]), membersByBoard: new Map([[100, kids(N)]]) }));
    expect(r.releases).toHaveLength(N);
    expect(r.releases[0]).toMatchObject({ boardKind: "closed", endedOn: "2026-10-18", reason: "가나다0 학생의 이 반이 종강(2026-10-19)한 지 7일이 지났습니다" });
  });
  it("🔴 종강 반 보드에 열린 수강이 남은 학생이 있으면 그 학생의 원아는 ①이 보류하고, 끝난 학생의 원아만 낸다", () => {
    const p = plan({ kind: "closed", closedAt: "2026-10-19", extraChildren: [{ id: 2, name: "이서연" }, { id: 9, name: "Jay" }] });
    const r = planChildReleases([p], ctx({ childLinks: new Map([[2, "s-out"], [9, "s-in"]]) })); // 기본 ctx는 c1에 열린 수강 2명(김민준·박서연E)
    expect(names(r)).toEqual(["이서연"]);
    expect(heldText(r)[0]).toContain("이 반 학생 '김민준'에 연결된 원아입니다");
  });
  it("1인 보드 — `(수학)`·`(영어)` 모양만 받고 문구는 그 과목 단위 · 그 모양이 아니면 보류 · 반 보드 계획에 1인 보드 이름이면 종전대로 보류", () => {
    const base = { kind: "personal", subjectLabel: "수학", classId: "personal:300", extraChildren: [{ id: 2, name: "이서연" }] };
    const enr = new Map([["personal:300", { open: [], ended: ["s-out"] }]]);
    const ok = planChildReleases([plan({ ...base, className: "1인 보드 · (수학)이서연", board: { action: "exists", id: 300, name: "(수학)이서연" } })], ctx({ childLinks: new Map([[2, "s-out"]]), enrollmentsByClass: enr }));
    expect(ok.releases).toEqual([expect.objectContaining({ boardKind: "personal", boardId: 300, reason: "이서연 학생의 수학 수강이 모두 끝났습니다" })]);
    const odd = planChildReleases([plan({ ...base, className: "1인 보드 · 가반", board: { action: "exists", id: 300, name: "가반" } })], ctx({ childLinks: new Map([[2, "s-out"]]), enrollmentsByClass: enr }));
    expect(odd.releases).toEqual([]);
    expect(heldText(odd)[0]).toContain("1인 보드 이름 모양이 아니라");
    const never = planChildReleases([plan({ ...base, className: "1인 보드 · (수학)이서연", board: { action: "exists", id: 300, name: "(수학)이서연" } })], ctx({ childLinks: new Map([[2, "s-out"]]), enrollmentsByClass: new Map([["personal:300", { open: [], ended: [] }]]) }));
    expect(heldText(never)[0]).toContain("'이서연' 학생은 수학 수강 기록이 없습니다");
    // 그 과목 수강생에게 연결된 원아(형제 원아가 잘못 붙은 1인 보드) — 보류
    const sib = planChildReleases([plan({ ...base, className: "1인 보드 · (수학)이서연", board: { action: "exists", id: 300, name: "(수학)이서연" } })], ctx({ childLinks: new Map([[2, "s-in"]]), enrollmentsByClass: new Map([["personal:300", { open: ["s-in"], ended: ["s-out"] }]]) }));
    expect(sib.releases).toEqual([]);
    expect(heldText(sib)[0]).toContain("수학 수강생 '김민준'에 연결된 원아입니다");
  });
  it("🔴 ④ 분모 = 지금 다니는 학생의 원아 + 최근 해제 대상 — 묵은 잔류가 분모를 키워 오늘 사고를 놓치지 않는다(리뷰 A3: 보드 30 = 묵은 10 + 오늘 12 + 다니는 8)", () => {
    const c = crowd(22); // x0..x9 = 묵은(10-01) · x10..x21 = 오늘(11-02)
    const extras = kids(22);
    const members = new Map([[100, [...extras, ...Array.from({ length: 8 }, (_, i) => ({ id: 900 + i, name: `다니는${i}` }))]]]); // 보드 30명
    const endedOn = Object.fromEntries(c.ended.map((sid, i) => [sid, i < 10 ? "2026-10-01" : "2026-11-02"]));
    const r = planChildReleases([plan({ extraChildren: extras })], ctx({ ...c, today: "2026-11-03", enrollmentsByClass: new Map([["c1", { open: [], ended: c.ended, endedOn }]]), membersByBoard: members }));
    expect(r.releases.map((x) => x.studentId)).toEqual(c.ended.slice(0, 10)); // 묵은 10명만 낸다
    expect(r.held).toHaveLength(12);
    expect(heldText(r)[0]).toContain("12명으로 반 보드의 지금 다니는 원아와 합친 수(20명)의 절반을 넘습니다"); // 12/30이면 통과였다
  });
  it("⑤ 1인 보드는 한 회차 10명까지(전체 40과 별도 · 리뷰 A3)", () => {
    const c = crowd(12);
    const plans = kids(12).map((k, i) => plan({ kind: "personal", subjectLabel: "수학", classId: `personal:${300 + i}`, className: `1인 보드 · (수학)가나다${i}`, board: { action: "exists", id: 300 + i, name: `(수학)가나다${i}` }, extraChildren: [k] }));
    const enr = new Map(plans.map((p, i) => [p.classId, { open: [], ended: [`x${i}`], endedOn: { [`x${i}`]: "2026-09-01" } }]));
    const admissions = new Map(kids(12).map((k, i) => [k.id, adm(null, [`(수학)가나다${i}`], [{ id: 1, name: "[ALL] 인재원 전체방" }, { id: 300 + i, name: `(수학)가나다${i}` }])]));
    const r = planChildReleases(plans, ctx({ ...c, admissions, today: "2026-11-03", enrollmentsByClass: enr, membersByBoard: new Map() }));
    expect(r.releases).toHaveLength(10);
    expect(heldText(r).filter((t) => t.includes("1인 보드는 한 번에 10명까지만"))).toHaveLength(2);
  });
  it("🔴 ① 대조 상대에 그 반에 끝난 기록이 있는 휴원 학생도 넣는다 — 원아 연결이 형제에게 잘못 붙어도 휴원생 원아를 안 뗀다(리뷰 A4)", () => {
    const sts = new Map(students);
    sts.set("s-rest", { id: "s-rest", name: "윤서아", phones: ["010-4444-5555"], status: "on_hold" });
    sts.set("s-bro", { id: "s-bro", name: "윤도하", phones: ["010-4444-5555"] });
    // 원아 '서아'가 형제(s-bro, 이 반 수강 종료)에게 잘못 이어졌다 — 진짜 주인 윤서아는 휴원(이 반에 끝난 기록)
    const r = planChildReleases([plan({ extraChildren: [{ id: 2, name: "서아" }] })], ctx({ students: sts, childLinks: new Map([[2, "s-bro"]]), enrollmentsByClass: new Map([["c1", { open: [], ended: ["s-bro", "s-rest"] }]]) }));
    expect(r.releases).toEqual([]);
    expect(heldText(r)[0]).toContain("'윤서아' 학생은 휴원 중입니다");
    // 휴원 학생이 그 반에 끝난 기록이 없으면 대조 상대가 아니다(다른 반 휴원생까지 끌어오지 않는다)
    const r2 = planChildReleases([plan({ extraChildren: [{ id: 2, name: "서아" }] })], ctx({ students: sts, childLinks: new Map([[2, "s-bro"]]), enrollmentsByClass: new Map([["c1", { open: [], ended: ["s-bro"] }]]) }));
    expect(heldText(r2).join()).not.toContain("휴원");
  });
  it("🔴 영어 반 방 — 주인이 방 연결이 없는 다른 영어 반에 다니면 보류(같은 방을 쓰는데 한 반에만 연결된 경우 · 리뷰 A6)", () => {
    const p = plan({ kind: "english", className: "영어 반 방 · 가반", extraChildren: [{ id: 2, name: "이서연" }], elsewhere: new Map([["s-out", ["중등E_중2 정규 B"]]]) });
    const r = planChildReleases([p], ctx({ childLinks: new Map([[2, "s-out"]]) }));
    expect(r.releases).toEqual([]);
    expect(heldText(r)[0]).toContain("반 방 연결이 없는 다른 영어 반(중등E_중2 정규 B)에 다니고 있습니다");
    const free = planChildReleases([{ ...p, elsewhere: new Map() }], ctx({ childLinks: new Map([[2, "s-out"]]) }));
    expect(names(free)).toEqual(["이서연"]);
  });
  it("영어 반 방 — ④는 그대로 걸고 문구는 '반 방'", () => {
    const c = crowd(RELEASE_CLASS_SOFT_LIMIT + 1);
    const p = plan({ kind: "english", className: "영어 반 방 · 가반", extraChildren: kids(RELEASE_CLASS_SOFT_LIMIT + 1) });
    const r = planChildReleases([p], ctx({ ...c, enrollmentsByClass: new Map([["c1", { open: [], ended: c.ended }]]), membersByBoard: new Map([[100, kids(RELEASE_CLASS_SOFT_LIMIT + 1)]]) }));
    expect(r.releases).toEqual([]);
    expect(heldText(r)[0]).toContain("이 반 방에서 최근 7일 안에 수강이 끝난 원아가 5명으로 반 방의 지금 다니는 원아와 합친 수(5명)의 절반을 넘습니다");
  });
  it("⑤ 회차 상한은 종류를 합쳐서 센다(반 보드가 먼저)", () => {
    const links = new Map([[2, "s-out"], [3, "s-out2"]]);
    const personal = plan({ kind: "personal", subjectLabel: "수학", classId: "personal:300", className: "1인 보드 · (수학)최하린", board: { action: "exists", id: 300, name: "(수학)최하린" }, extraChildren: [{ id: 3, name: "최하린" }] });
    const enr = new Map([["c1", { open: [], ended: ["s-out"] }], ["personal:300", { open: [], ended: ["s-out2"] }]]);
    const r = planChildReleases([plan({ extraChildren: [{ id: 2, name: "이서연" }] }), personal], ctx({ childLinks: links, enrollmentsByClass: enr, runLimit: 1 }));
    expect(names(r)).toEqual(["이서연"]);
    expect(heldText(r)).toEqual(["원아 해제 미룸: 최하린 — 한 번에 해제하는 수를 넘어 다음 동기화에서 합니다"]);
  });
  it("formerFamilyOf — 같은 이름 보드의 낯선 원아 중 '이 반의 지난 학생'(①②③ 통과)만 고른다", () => {
    const strangers = [{ id: 2, name: "이서연" }, { id: 9, name: "서연" }, { id: 3, name: "정도윤" }];
    const links = new Map([[2, "s-out"], [9, "s-out"], [3, "s-never"]]);
    const book = new Map([[2, adm()], [9, adm()], [3, adm()]]);
    const out = formerFamilyOf([{ classId: "c1", className: "가반", boardId: 100, boardName: "가반", strangers }], ctx({ childLinks: links, admissions: book }));
    // 2 = 수강이 끝난 학생 · 9 = 이 반 학생 '박서연E'의 원아일 수 있음(①) · 3 = 이 반 수강 기록 없음(③)
    expect([...out.get("c1")]).toEqual([2]);
    const unread = formerFamilyOf([{ classId: "c9", className: "다반", boardId: 900, boardName: "다반", strangers }], ctx({ childLinks: links, admissions: book }));
    expect([...unread.get("c9")]).toEqual([]); // 수강 기록을 못 읽은 반 — 아무도 지난 학생으로 보지 않는다
  });
});

describe("담임 해제 — 종강 반 보드(남길 사람 없음)", () => {
  const teacherMap = { 이수진: 11, 김은정: 22 };
  const emp = (id, teacher_id, class_in_charge, is_approved = true) => ({ id, teacher_id, class_in_charge, is_approved });
  const closed = (over = {}) => ({ className: "종강 반 보드 · 가반", boardId: 100, boardName: "가반", closed: true, remainingChildren: 0, ...over });
  it("원아가 다 정리된 보드는 아는 선생님 연결을 전부 푼다 — 담임 정보가 없어도(⑦⑨⑩ 대신) · 모르는 계정은 그대로", () => {
    const r = planTeacherReleases({ boards: [closed()], emps: [emp(1, 11, 100), emp(2, 22, 100), emp(3, 77777, 100), emp(4, 11, 200)], teacherMap });
    expect(r.releases.map((x) => x.employmentId)).toEqual([1, 2]);
    expect(r.held).toEqual([]);
  });
  it("🔴 원아가 남았거나 남은 수를 모르면 선생님 연결을 두고 사유를 남긴다", () => {
    for (const remainingChildren of [1, undefined, Number.NaN]) {
      const r = planTeacherReleases({ boards: [closed({ remainingChildren })], emps: [emp(1, 11, 100)], teacherMap });
      expect(r.releases).toEqual([]);
      expect(r.held[0].text).toContain("종강 반 보드에 원아가 남아 있어 선생님 연결은 그대로 둡니다");
    }
  });
});
describe("🔴 ④-b 마지막 배정 가드 — 떼면 ClassNote가 원아를 자동 퇴소시킨다(2026-11-03 실측 · 되돌릴 수 없다)", () => {
  const links = new Map([[2, "s-out"]]);
  const kid = [{ id: 2, name: "이서연" }];
  it("그 원아의 승인된 소속 배정이 이 반 하나뿐이면 보류 · [ALL] 전체방 하나라도 남으면 통과", () => {
    const only = planChildReleases([plan({ extraChildren: kid })], ctx({ childLinks: links, admissions: new Map([[2, adm(null, ["가반"], [{ id: 100, name: "가반" }])]]) }));
    expect(only.releases).toEqual([]);
    expect(only.held).toEqual([{ className: "가반", childName: "이서연", why: LAST_ENROLLMENT_REASON, text: `원아 해제 보류: 이서연 — ${LAST_ENROLLMENT_REASON}`, studentId: "s-out", studentName: "이서연" }]);
    const withAll = planChildReleases([plan({ extraChildren: kid })], ctx({ childLinks: links }));
    expect(names(withAll)).toEqual(["이서연"]);
  });
  it("명부에 소속 반이 없으면(읽지 못함) 보류 — 모르면 안 뗀다", () => {
    const r = planChildReleases([plan({ extraChildren: kid })], ctx({ childLinks: links, admissions: new Map([[2, { phone: null, boardNames: [] }]]) }));
    expect(r.releases).toEqual([]);
    expect(r.held[0].why).toBe(LAST_ENROLLMENT_UNKNOWN_REASON);
  });
  it("한 회차에 같은 원아를 여러 보드에서 다 떼게 되면 하나를 남긴다 — 가장 최근에 끝난 반 → 같으면 반 보드(1인 보드는 12월에 지운다)", () => {
    const personal = plan({ kind: "personal", subjectLabel: "수학", classId: "personal:300", className: "1인 보드 · (수학)이서연", board: { action: "exists", id: 300, name: "(수학)이서연" }, extraChildren: kid });
    const admissions = new Map([[2, adm(null, ["가반", "(수학)이서연"], [{ id: 100, name: "가반" }, { id: 300, name: "(수학)이서연" }])]]);
    const run = (classOn, subjOn) => planChildReleases([plan({ extraChildren: kid }), personal], ctx({
      childLinks: links, admissions,
      enrollmentsByClass: new Map([["c1", { open: [], ended: ["s-out"], endedOn: classOn ? { "s-out": classOn } : {} }], ["personal:300", { open: [], ended: ["s-out"], endedOn: subjOn ? { "s-out": subjOn } : {} }]]),
    }));
    const tie = run("2026-10-18", "2026-10-18");
    expect(tie.releases.map((x) => x.boardId)).toEqual([300]);
    expect(tie.held.map((h) => [h.className, h.why])).toEqual([["가반", LAST_ENROLLMENT_REASON]]);
    const later = run("2026-09-01", "2026-10-18"); // 그 과목의 다른 반이 더 늦게 끝났다 — 1인 보드를 남긴다
    expect(later.releases.map((x) => x.boardId)).toEqual([100]);
    expect(later.held.map((h) => h.className)).toEqual(["1인 보드 · (수학)이서연"]);
  });
  it("guardLastEnrollment — 떼지 않은 보드만 남는 배정으로 센다 · 같은 보드 번호를 두 번 세지 않는다 · 명부와 어긋나면 보류", () => {
    const admissions = new Map([[7, { boards: [{ id: 1 }, { id: 2 }, { id: 3 }] }], [8, { boards: [] }]]);
    const g = guardLastEnrollment([{ childId: 7, boardId: 1 }, { childId: 7, boardId: 2 }, { childId: 7, boardId: 3 }, { childId: 8, boardId: 5 }, { childId: 9, boardId: 5 }], admissions);
    expect(g.pass).toEqual([{ childId: 7, boardId: 1 }, { childId: 7, boardId: 2 }]);
    expect(g.held.map((h) => [h.release.childId, h.release.boardId, h.why])).toEqual([
      [7, 3, LAST_ENROLLMENT_REASON], // 종료일·종류가 같으면 계획 순서 뒤를 남긴다
      [8, 5, LAST_ENROLLMENT_UNKNOWN_REASON], // 명부에 승인 배정이 없는데 보드에선 보인다 — 어긋남
      [9, 5, LAST_ENROLLMENT_UNKNOWN_REASON], // 명부에 소속 반 정보가 없다
    ]);
    // 가장 최근에 끝난 것을 남긴다(앞에 있어도)
    const recent = guardLastEnrollment([{ childId: 7, boardId: 1, endedOn: "2026-10-30" }, { childId: 7, boardId: 2, endedOn: "2026-10-01" }, { childId: 7, boardId: 3, endedOn: "2026-10-02" }], admissions);
    expect(recent.held.map((h) => h.release.boardId)).toEqual([1]);
    // 떼지 않는 배정이 하나라도 남으면 전부 통과
    expect(guardLastEnrollment([{ childId: 7, boardId: 1 }, { childId: 7, boardId: 2 }], admissions).held).toEqual([]);
  });
});
