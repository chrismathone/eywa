// 원아 신분 가드의 공용 판정(원장 2026-11-05 *"형제 원아 연결이 뒤바뀐건 크리티컬함. 아주 섬세한 가드로 매칭해야함"*).
// 사례는 2026-11-05 실측(DB select + ClassNote GET만)에서 그대로 옮겼다 — 이름은 실제 모양, 번호는 가짜.
import { describe, expect, it } from "vitest";
import { childGuardReasons, childNameConsistent, confirmedPairKey, familyFinder, familyOf, namesakeClash, namesakeFinder, phoneIndex, roomChildrenVerdict, siblingNameClash } from "./child-identity.mjs";

const SY = 2026; // 초3 = 2017생 · 초4 = 2016생 · 중1 = 2013생
const MOM = "010-1111-1111";
const OTHER = "010-9999-9999";

describe("childNameConsistent(옮겨 온 판정 그대로)", () => {
  it("포함 관계는 통과 · 쌍둥이 형제는 불통과", () => {
    expect(childNameConsistent("박서연E", "서연")).toBe(true);
    expect(childNameConsistent("이재희", "Jay(이재희)")).toBe(true);
    expect(childNameConsistent("김민서", "김민준")).toBe(false);
  });
});

describe("phoneIndex · familyOf — 같은 집 찾기", () => {
  const students = [
    { id: "a", name: "박세인", phones: [MOM] },
    { id: "b", name: "박세하", phones: ["01011111111"] }, // 표기만 다른 같은 번호
    { id: "c", name: "남", phones: [OTHER] },
    { id: "t", name: "학원이", phones: [MOM], isTest: true },
  ];
  it("번호 표기가 달라도 같은 집 · 테스트 학생은 빼고 · 중복 없이", () => {
    const fam = familyOf(phoneIndex(students), [MOM, "+82-10-1111-1111"]);
    expect(fam.map((s) => s.id).sort()).toEqual(["a", "b"]);
  });
  it("번호가 없거나 못 읽는 값은 아무도 안 찾는다", () => {
    expect(familyOf(phoneIndex(students), [null, "", "없음"])).toEqual([]);
  });
  it("familyFinder = 원아 보호자 전화 ∪ 학생 전화", () => {
    const find = familyFinder(students);
    // 학생(c)은 OTHER, 원아 보호자 전화는 MOM — 둘 다로 찾는다
    expect(find({ id: "c", phones: [OTHER] }, { phones: [MOM] }).map((s) => s.id).sort()).toEqual(["a", "b", "c"]);
  });
});

describe("siblingNameClash — ⑦ 같은 집 다른 아이", () => {
  const sein = { id: "sein", name: "박세인" };
  const seha = { id: "seha", name: "박세하" };
  it("🔴 형제 뒤바뀜(명부 '박세하' · 프로필 '박세인') — 프로필이 이 학생과 같아도 명부 이름이 형제와 정확히 같으면 걸린다", () => {
    expect(siblingNameClash(sein, ["박세하", "박세인"], [sein, seha])).toEqual(["박세하"]);
  });
  it("이름이 이 학생뿐이면 통과", () => {
    expect(siblingNameClash(sein, ["박세인", "박세인"], [sein, seha])).toEqual([]);
  });
  it("같은 아이의 중복 기록(퇴원 기록 + 재원 기록 — 이재윤)은 형제가 아니다", () => {
    const now = { id: "now", name: "이재윤" };
    const old = { id: "old", name: "이재윤" };
    expect(siblingNameClash(now, ["이재윤"], [now, old])).toEqual([]);
    // 동명이인 접미사가 붙은 중복 기록도 같다
    expect(siblingNameClash({ id: "x", name: "김근우A" }, ["김근우"], [{ id: "x", name: "김근우A" }, { id: "y", name: "김근우" }])).toEqual([]);
  });
  it("공유 계정(명부 '강지원&강수정' · 프로필 '강지원') — 이 학생과 정확히 같은 이름이 있으면 통과", () => {
    const jiwon = { id: "jw", name: "강지원" };
    const sujeong = { id: "sj", name: "강수정" };
    expect(siblingNameClash(jiwon, ["강지원&강수정", "강지원"], [jiwon, sujeong])).toEqual([]);
    // 같은 계정이 형제에게 잘못 붙었다면(학생 = 강수정) — 프로필 '강지원'이 강지원과 정확히 같아 걸린다
    expect(siblingNameClash(sujeong, ["강지원&강수정", "강지원"], [jiwon, sujeong])).toEqual(["강지원"]);
  });
  it("포함 관계로만 이어지면 형제와 겹치는지 본다(`김하`↔`김하늘`)", () => {
    const ha = { id: "ha", name: "김하" };
    const haneul = { id: "hn", name: "김하늘" };
    // 원아 '김하늘'을 김하에게 — 김하와는 포함 관계뿐이고 김하늘과는 정확히 같다
    expect(siblingNameClash(ha, ["김하늘"], [ha, haneul])).toEqual(["김하늘"]);
    // 원아 '김하'는 김하와 정확히 같다 — 김하늘과의 포함 관계는 보지 않는다
    expect(siblingNameClash(ha, ["김하"], [ha, haneul])).toEqual([]);
  });
  it("테스트 학생·자기 자신·이름 없는 줄은 비교하지 않는다", () => {
    expect(siblingNameClash(sein, ["박세하"], [sein, { ...seha, isTest: true }])).toEqual([]);
    expect(siblingNameClash(sein, ["", null], [sein, seha])).toEqual([]);
  });
});

describe("childGuardReasons — 수학 반 보드·영어 반 방 공용 가드", () => {
  const students = [
    { id: "sein", name: "박세인", grade: "초3", phones: [MOM] },
    { id: "seha", name: "박세하", grade: "초4", phones: [MOM] },
  ];
  const familyFor = familyFinder(students);
  const adm = (name, birth = "2017-05-01", phones = [MOM]) => new Map([[7, { name, birth, phones, phone: phones[0], boardNames: [] }]]);
  const ctx = (admissions) => ({ admissions, schoolYear: SY, verifiedOwners: null, familyFor });

  it("명부·보드 이름 · 전화 · 생년이 다 맞으면 통과", () => {
    expect(childGuardReasons(students[0], { id: 7, name: "박세인", date_birth: "2017-05-01" }, ctx(adm("박세인")))).toEqual([]);
  });
  it("🔴 확인 기록 출처도 명부 이름을 본다 — 보드 이름은 맞지만 명부 이름이 형제 것이면 ⑥·⑦로 보류", () => {
    const r = childGuardReasons(students[0], { id: 7, name: "박세인", date_birth: "2017-05-01" }, ctx(adm("박세하")));
    // 사유엔 실제로 걸린 이름과 출처(명부 = 입소 서류 · 프로필 = 앱 탭·보드 이름)를 적는다(재리뷰 2026-11-05)
    expect(r.join()).toContain('원아 "박세하"(명부) 이름이 학생(박세인)과 다름');
    expect(r.join()).toContain('원아 "박세하"(명부) 이름이 같은 집 다른 아이(박세하)와도 이어짐');
  });
  it("원아 연결 출처(nameChecks = 명부·프로필)는 명부 이름을 중복으로 넣지 않는다", () => {
    const r = childGuardReasons(students[0], { id: 7, name: "박세인", nameChecks: ["박세인", "박세인"], profileKnown: true, date_birth: "2017-05-01" }, ctx(adm("박세인")));
    expect(r).toEqual([]);
  });
  it("명부 이름이 비면 보드 이름만 본다(명부 줄이 있을 때 · 원아 연결 출처는 nameChecks가 빈 명부 이름을 잡는다)", () => {
    expect(childGuardReasons(students[0], { id: 7, name: "박세인", date_birth: "2017-05-01" }, ctx(adm(""))).join()).not.toContain("이름이 학생");
    const r = childGuardReasons(students[0], { id: 7, name: "박세인", nameChecks: ["", "박세인"], profileKnown: true, date_birth: "2017-05-01" }, ctx(adm("")));
    expect(r.join()).toContain('원아 "?" 이름이 학생(박세인)과 다름');
  });
  it("전화 불일치 · 명부 없음 · 생년 불일치 · 프로필 모름 — 사유에 전화 값은 싣지 않는다", () => {
    const off = childGuardReasons(students[0], { id: 7, name: "박세인", date_birth: "2017-05-01" }, ctx(adm("박세인", "2017-05-01", [OTHER]))).join(" ");
    expect(off).toContain("보호자 전화 불일치");
    expect(off).not.toContain("9999");
    expect(childGuardReasons(students[0], { id: 7, name: "박세인" }, ctx(new Map())).join()).toContain("운영관리 명부에 없음");
    expect(childGuardReasons(students[0], { id: 7, name: "박세인" }, ctx(adm("박세인", "2010-01-01"))).join()).toContain("생년 불일치");
    expect(childGuardReasons(students[0], { id: 7, name: "박세인", nameChecks: ["박세인", ""], profileKnown: false, date_birth: "2017-05-01" }, ctx(adm("박세인"))).join()).toContain("학부모 프로필(이름)을 확인하지 못함");
  });
  it("반 보드 기록에서 다른 학생에게 확인된 원아면 보류(④)", () => {
    const r = childGuardReasons(students[0], { id: 7, name: "박세인", date_birth: "2017-05-01" }, { ...ctx(adm("박세인")), verifiedOwners: new Map([[7, new Set(["seha"])]]) });
    expect(r.join()).toContain("다른 학생에게 확인된 원아");
  });
  it("같은 집 찾기가 없으면(familyFor 없음) ⑦은 건너뛴다 — ⑥은 그대로 건다", () => {
    const r = childGuardReasons(students[0], { id: 7, name: "박세인", date_birth: "2017-05-01" }, { admissions: adm("박세하"), schoolYear: SY });
    expect(r.join()).toContain("이름이 학생(박세인)과 다름");
    expect(r.join()).not.toContain("같은 집");
  });
});

describe("원장 확인 연결(linked_by='confirmed') — 입소 서류(명부 이름·보호자 전화)만 대조에서 뺀다", () => {
  // 실측(2026-11-05): 학부모가 입소 때 형제 서류를 바꿔 냈다(명부 '박세하' · 앱 탭 '박세인' · 반 배정·연결 = 박세인) · 학생 본인 번호로 가입한 계정(명부 보호자1 = 학생 이름).
  const students = [
    { id: "sein", name: "박세인", grade: "초3", phones: [MOM] },
    { id: "seha", name: "박세하", grade: "초4", phones: [MOM] },
    { id: "tj", name: "김태진", grade: "중2", phones: ["010-2222-2222"] },
  ];
  const familyFor = familyFinder(students);
  const adm = (id, name, birth, phones = [MOM]) => new Map([[id, { name, birth, phones, phone: phones[0], boardNames: [] }]]);
  const sein = (over = {}) => ({ id: 7, name: "박세인", date_birth: "2016-08-08", ...over });
  const confirmed = new Set([confirmedPairKey("sein", 7)]);

  it("열쇠 = 학생 id + 원아 번호(문자·숫자 번호가 같은 열쇠)", () => {
    expect(confirmedPairKey("sein", "7")).toBe(confirmedPairKey("sein", 7));
    expect(confirmedPairKey("seha", 7)).not.toBe(confirmedPairKey("sein", 7));
  });
  it("🔴 확인하지 않은 연결은 그대로 막는다(형제 서류 뒤바뀜)", () => {
    const r = childGuardReasons(students[0], sein(), { admissions: adm(7, "박세하", "2016-08-08"), schoolYear: SY, familyFor });
    expect(r.join()).toContain("같은 집 다른 아이(박세하)");
  });
  it("확인 연결은 명부 이름을 보지 않고 앱 탭(프로필) 이름으로 통과", () => {
    expect(childGuardReasons(students[0], sein(), { admissions: adm(7, "박세하", "2016-08-08"), schoolYear: SY, familyFor, confirmedPairs: confirmed })).toEqual([]);
  });
  it("🔴 확인은 그 학생 ↔ 그 원아 한 줄에만 — 형제(박세하)가 같은 원아를 가지면 확인이 아니다", () => {
    const r = childGuardReasons(students[1], { id: 7, name: "박세하", date_birth: "2016-08-08" }, { admissions: adm(7, "박세인", "2016-08-08"), schoolYear: SY, familyFor, confirmedPairs: confirmed });
    expect(r.join()).toContain("같은 집 다른 아이(박세인)");
  });
  it("🔴 확인 연결이어도 앱 탭 이름이 형제 것이면 막는다(⑥·⑦은 프로필 이름으로 그대로)", () => {
    const r = childGuardReasons(students[0], sein({ name: "박세하" }), { admissions: adm(7, "박세인", "2016-08-08"), schoolYear: SY, familyFor, confirmedPairs: confirmed });
    expect(r.join()).toContain("이름이 학생(박세인)과 다름");
    expect(r.join()).toContain("같은 집 다른 아이(박세하)");
  });
  it("원아 연결 출처는 name이 명부 이름이라도 profileName으로 본다 · 프로필을 못 읽으면 보류", () => {
    const ok = { id: 7, name: "박세하", nameChecks: ["박세하", "박세인"], profileKnown: true, profileName: "박세인", date_birth: "2016-08-08" };
    expect(childGuardReasons(students[0], ok, { admissions: adm(7, "박세하", "2016-08-08"), schoolYear: SY, familyFor, confirmedPairs: confirmed })).toEqual([]);
    const unknown = { id: 7, name: "박세하", nameChecks: ["박세하"], profileKnown: false, profileName: "", date_birth: "2016-08-08" };
    const r = childGuardReasons(students[0], unknown, { admissions: adm(7, "박세하", "2016-08-08"), schoolYear: SY, familyFor, confirmedPairs: confirmed });
    expect(r.join()).toContain("학부모 프로필(이름)을 확인하지 못함");
    expect(r.join()).toContain('원아 "?" 이름이 학생(박세인)과 다름');
  });
  it("확인 연결은 보호자 전화 불일치·대조 불가를 보지 않는다(학생 본인 번호로 가입한 계정)", () => {
    const tj = new Set([confirmedPairKey("tj", 9)]);
    const m = { id: 9, name: "김태진", date_birth: "2012-03-14" };
    const other = adm(9, "김태진", "2012-03-14", [OTHER]);
    expect(childGuardReasons(students[2], m, { admissions: other, schoolYear: SY, familyFor }).join()).toContain("보호자 전화 불일치");
    expect(childGuardReasons(students[2], m, { admissions: other, schoolYear: SY, familyFor, confirmedPairs: tj })).toEqual([]);
    expect(childGuardReasons({ ...students[2], phones: [] }, m, { admissions: other, schoolYear: SY, familyFor, confirmedPairs: tj })).toEqual([]);
  });
  it("🔴 확인 연결이어도 명부에 없는 원아 · 생년 불일치 · 다른 학생에게 확인된 원아는 막는다", () => {
    expect(childGuardReasons(students[0], sein(), { admissions: new Map(), schoolYear: SY, familyFor, confirmedPairs: confirmed }).join()).toContain("운영관리 명부에 없음");
    expect(childGuardReasons(students[0], sein({ date_birth: "2010-01-01" }), { admissions: adm(7, "박세하", "2010-01-01"), schoolYear: SY, familyFor, confirmedPairs: confirmed }).join()).toContain("생년 불일치");
    const owners = new Map([[7, new Set(["seha"])]]);
    expect(childGuardReasons(students[0], sein(), { admissions: adm(7, "박세하", "2016-08-08"), schoolYear: SY, familyFor, verifiedOwners: owners, confirmedPairs: confirmed }).join()).toContain("다른 학생에게 확인된 원아");
  });
  it("영어 반 방 판정도 같은 확인을 쓴다", () => {
    const base = { student: students[0], targets: [{ id: 7, name: "박세인", date_birth: "2016-08-08" }], admissions: adm(7, "박세하", "2016-08-08"), schoolYear: SY, familyFor, maxChildren: 2 };
    expect(roomChildrenVerdict(base).ok).toBe(false);
    expect(roomChildrenVerdict({ ...base, confirmedPairs: confirmed })).toEqual({ ok: true });
    // 반 방에서 프로필 이름을 못 읽으면 확인 연결이어도 보류
    expect(roomChildrenVerdict({ ...base, targets: [{ id: 7, name: "", date_birth: "2016-08-08" }], confirmedPairs: confirmed }).ok).toBe(false);
  });
});

describe("⑦-b 지점 전체 같은 이름(적대적 리뷰 2026-11-05 반례 — 형제가 서로 다른 번호로 적힘)", () => {
  const students = [
    { id: "ha", name: "김하", grade: "초4", phones: ["010-1111-2222"] },
    { id: "haneul", name: "김하늘", grade: "초3", phones: ["010-3333-4444"] },
    { id: "geun", name: "김근우A", grade: "중1", phones: ["010-5555-6666"] },
    { id: "geun2", name: "김근우", grade: "중1", phones: ["010-7777-8888"] },
    { id: "t", name: "학원이", grade: "중2", phones: [], isTest: true },
  ];
  const namesakesFor = namesakeFinder(students);
  it("이름 색인 = 매칭 키가 정확히 같은 학생(테스트 학생 제외)", () => {
    expect(namesakesFor(["김하늘"]).map((s) => s.id)).toEqual(["haneul"]);
    expect(namesakesFor(["김근우"]).map((s) => s.id).sort()).toEqual(["geun", "geun2"]);
    expect(namesakesFor(["학원이"])).toEqual([]);
    expect(namesakesFor(["하늘"])).toEqual([]); // 원아 이름보다 긴 이름·2글자 조각은 찾지 않는다
    // 원아 이름 안에 3글자 이상 기본이름이 들어 있는 학생도 찾는다(판정은 namesakeClash — 재리뷰 2026-11-05)
    expect(namesakesFor(["김하늘이"]).map((s) => s.id)).toEqual(["haneul"]);
    expect(namesakesFor(["김하늘(둘째)"]).map((s) => s.id)).toEqual(["haneul"]);
  });
  it("원아 이름이 다른 학생 이름과 똑같으면 걸린다 · 기본이름이 같은 학생(중복 기록·동명이인)은 보지 않는다", () => {
    expect(namesakeClash(students[0], ["김하늘"], namesakesFor(["김하늘"]))).toEqual(["김하늘"]);
    expect(namesakeClash(students[2], ["김근우"], namesakesFor(["김근우"]))).toEqual([]);
    expect(namesakeClash(students[1], ["김하늘"], namesakesFor(["김하늘"]))).toEqual([]);
  });
  it("🔴 가드: 김하 ← 원아 '김하늘'(엄마 번호 — 김하늘은 아빠 번호만) = ⑦은 못 보지만 ⑦-b가 보류", () => {
    const admissions = new Map([[77, { name: "김하늘", birth: "2017-04-01", phones: ["010-1111-2222"], phone: "010-1111-2222", boardNames: [] }]]);
    const ctx = { admissions, schoolYear: SY, familyFor: familyFinder(students), namesakesFor };
    const r = childGuardReasons(students[0], { id: 77, name: "김하늘", date_birth: "2017-04-01" }, ctx);
    expect(r.join()).toContain("다른 학생(김하늘)과 똑같음");
    expect(r.join()).not.toContain("같은 집");
    expect(roomChildrenVerdict({ student: students[0], targets: [{ id: 77, name: "김하늘", date_birth: "2017-04-01" }], ...ctx, maxChildren: 2 }).ok).toBe(false);
    // 지점 전체 이름 찾기가 없으면(옛 호출부) ⑦-b는 건너뛴다 — 반례가 통과하던 모양
    expect(childGuardReasons(students[0], { id: 77, name: "김하늘", date_birth: "2017-04-01" }, { ...ctx, namesakesFor: null })).toEqual([]);
  });
  it("같은 집으로 이미 잡힌 이름은 ⑦에서만 말한다(같은 사유 두 번 없음)", () => {
    const sameHome = students.map((s) => (s.id === "haneul" ? { ...s, phones: ["010-1111-2222"] } : s));
    const admissions = new Map([[77, { name: "김하늘", birth: "2017-04-01", phones: ["010-1111-2222"], phone: "010-1111-2222", boardNames: [] }]]);
    const r = childGuardReasons(sameHome[0], { id: 77, name: "김하늘", date_birth: "2017-04-01" }, { admissions, schoolYear: SY, familyFor: familyFinder(sameHome), namesakesFor: namesakeFinder(sameHome) });
    expect(r.join()).toContain("같은 집 다른 아이(김하늘)");
    expect(r.join()).not.toContain("똑같음");
  });
  it("🔴 원장 확인 연결이어도 앱 탭 이름이 다른 학생 이름과 똑같으면 보류(확인은 입소 서류만 대신한다)", () => {
    const admissions = new Map([[77, { name: "김하", birth: "2017-04-01", phones: ["010-1111-2222"], phone: "010-1111-2222", boardNames: [] }]]);
    const r = childGuardReasons(students[0], { id: 77, name: "김하늘", date_birth: "2017-04-01" }, { admissions, schoolYear: SY, familyFor: familyFinder(students), namesakesFor, confirmedPairs: new Set([confirmedPairKey("ha", 77)]) });
    expect(r.join()).toContain('원아 "김하늘"(프로필) 이름이 다른 학생(김하늘)과 똑같음');
  });
  it("사유엔 실제로 걸린 이름과 출처를 적는다 — 프로필 '김하' · 명부 '김하늘'이면 명부 이름이 걸렸다(재리뷰 2026-11-05)", () => {
    const admissions = new Map([[77, { name: "김하늘", birth: "2017-04-01", phones: ["010-1111-2222"], phone: "010-1111-2222", boardNames: [] }]]);
    const m = { id: 77, name: "김하늘", nameChecks: ["김하늘", "김하"], profileKnown: true, profileName: "김하", date_birth: "2017-04-01" };
    const r = childGuardReasons(students[0], m, { admissions, schoolYear: SY, familyFor: familyFinder(students), namesakesFor });
    expect(r.join()).toContain('원아 "김하늘"(명부) 이름이 다른 학생(김하늘)과 똑같음');
    expect(r.join()).not.toContain('"김하"(프로필) 이름이 다른 학생');
  });
});

describe("🔴 ⑦-b 포함 관계 — 원아 이름이 이 학생보다 긴 다른 학생 이름을 담고 있음(재리뷰 2026-11-05 반례 '김하늘이'·'김하늘(둘째)')", () => {
  const MOM2 = "010-1111-2222";
  const DAD2 = "010-3333-4444";
  const students = [
    { id: "ha", name: "김하", grade: "초4", phones: [MOM2] },
    { id: "haneul", name: "김하늘", grade: "초3", phones: [DAD2] },
    { id: "jw", name: "강지원", grade: "초5", phones: ["010-5555-0001"] },
    { id: "sj", name: "강수정", grade: "초3", phones: ["010-5555-0002"] },
  ];
  const namesakesFor = namesakeFinder(students);
  const ctx = (name) => ({
    admissions: new Map([[77, { name, birth: "2016-04-01", phones: [MOM2], phone: MOM2, boardNames: [] }]]),
    schoolYear: SY,
    familyFor: familyFinder(students),
    namesakesFor,
  });
  for (const nm of ["김하늘이", "김하늘(둘째)"]) {
    it(`김하 ← 원아 '${nm}'(엄마 번호 — 김하늘은 아빠 번호만) = ⑥·⑦은 통과하지만 ⑦-b가 보류`, () => {
      const r = childGuardReasons(students[0], { id: 77, name: nm, date_birth: "2016-04-01" }, ctx(nm));
      expect(r).toHaveLength(1);
      expect(r[0]).toContain(`원아 "${nm}"(명부·프로필) 이름에 다른 학생(김하늘) 이름이 들어 있음`);
      expect(roomChildrenVerdict({ student: students[0], targets: [{ id: 77, name: nm, date_birth: "2016-04-01" }], ...ctx(nm), maxChildren: 2 }).ok).toBe(false);
    });
  }
  it("그 원아의 주인(김하늘)에게는 통과 — 포함 관계는 이 학생보다 긴 이름만 본다", () => {
    expect(namesakeClash(students[1], ["김하늘이"], namesakesFor(["김하늘이"]))).toEqual([]);
  });
  it("이 학생과 정확히 같은 이름 자체는 보지 않는다(`Jay(이름)`)", () => {
    expect(namesakeClash(students[0], ["Sky(김하)"], namesakesFor(["Sky(김하)"]))).toEqual([]);
    expect(namesakeClash(students[0], ["김하"], namesakesFor(["김하"]))).toEqual([]);
  });
  it("🔴 이름마다 본다 — 프로필이 이 학생과 똑같아도('김하') 명부 '김하늘이'·'김하늘(둘째)'는 걸린다(형제 서류 모양 · 재확인 2026-11-05)", () => {
    for (const roster of ["김하늘이", "김하늘(둘째)"]) {
      expect(namesakeClash(students[0], [roster, "김하"], namesakesFor([roster, "김하"]))).toEqual(["김하늘"]);
      const m = { id: 77, name: roster, nameChecks: [roster, "김하"], profileKnown: true, profileName: "김하", date_birth: "2016-04-01" };
      const r = childGuardReasons(students[0], m, ctx(roster));
      expect(r.join()).toContain(`원아 "${roster}"(명부) 이름에 다른 학생(김하늘) 이름이 들어 있음`);
      expect(roomChildrenVerdict({ student: students[0], targets: [{ id: 77, name: "김하", date_birth: "2016-04-01" }], ...ctx(roster), maxChildren: 2 }).ok).toBe(false);
    }
  });
  it("같은 길이 형제 이름은 넓히지 않는다(공유 계정 `강지원&강수정` — 같은 집이면 ⑦이 본다 · 프로필 '강지원'과 함께여도)", () => {
    expect(namesakeClash(students[2], ["강지원&강수정"], namesakesFor(["강지원&강수정"]))).toEqual([]);
    expect(namesakeClash(students[2], ["강지원&강수정", "강지원"], namesakesFor(["강지원&강수정", "강지원"]))).toEqual([]);
  });
});
