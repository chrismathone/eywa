// 명부 퇴원처리(퇴소 — 전 과목 퇴원 45일 뒤, 원장 2026-11-03) **판정**(순수). 퇴소는 되돌릴 수 없어 보류 쪽 테스트가 더 많다.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  activityUnreadable,
  isPermissionDenied,
  MERGE_NOTE_PATTERN,
  OFFBOARD_DAILY_LIMIT,
  OFFBOARD_GRACE_DAYS,
  backupRestorable,
  buildOffboardBackup,
  centerWideRoomIds,
  checkChildPosts,
  commentsComplete,
  partialFamilyText,
  rosterConsistency,
  isMergedNote,
  offboardDailyLimit,
  offboardEnabled,
  offboardSkipForRun,
  planOffboard,
  sameName,
  verifyOffboard,
} from "./classnote-offboard-plan.mjs";

const TODAY = "2026-11-03";
const st = (id, name, over = {}) => [id, { id, name, status: "withdrawn", withdrawnAt: "2026-07-07", phones: ["010-1000-0000"], ...over }];
const ALL = { id: 900, name: "[ALL] 인재원 전체방" };
const adm = (name, over = {}) => ({ name, phone: "010-1000-0000", boardNames: [ALL.name], boards: [ALL], ...over });
function world(over = {}) {
  return {
    admissions: new Map([[1, adm("이지나")]]),
    students: new Map([st("s1", "이지나"), st("now", "김민준", { status: "enrolled", withdrawnAt: null, phones: ["010-9999-9999"] })]),
    enrollment: new Map([["s1", { open: false, lastEnd: "2026-07-07" }], ["now", { open: true, lastEnd: null }]]),
    childLinks: new Map([[1, "s1"]]),
    verifiedOwners: new Map(),
    billing: new Map(),
    centerBoards: [{ ...ALL, children: 9 }, { id: 901, name: "중등M 중2 A", children: 5 }],
    linkedBoardIds: [901],
    today: TODAY,
    ...over,
  };
}
const codes = (r) => r.excluded.map((x) => x.code);

describe("대상 — 원아가 퇴원생 한 명에게 이어지고 전 과목 수강이 없고 기준일 + 45일이 지났다", () => {
  it("기본 — 대상(기준일·경과일·소속 보드)", () => {
    const r = planOffboard(world());
    expect(OFFBOARD_GRACE_DAYS).toBe(45);
    expect(r.candidates).toEqual([{ childId: 1, childName: "이지나", studentId: "s1", studentName: "이지나", withdrawnAt: "2026-07-07", lastEnd: "2026-07-07", baseDate: "2026-07-07", days: 119, boardNames: ["[ALL] 인재원 전체방"] }]);
    expect(r.excluded).toEqual([]);
  });
  it("기준일 = max(퇴원일, 마지막 수강 종료일) — 수강이 퇴원일 뒤에 끝났으면 그날부터 45일", () => {
    const w = world({ enrollment: new Map([["s1", { open: false, lastEnd: "2026-09-25" }], ["now", { open: true, lastEnd: null }]]) });
    const r = planOffboard(w);
    expect(r.candidates).toEqual([]);
    expect(r.waiting[0]).toMatchObject({ baseDate: "2026-09-25", days: 39 });
    expect(planOffboard({ ...w, today: "2026-11-09" }).candidates).toHaveLength(1); // 45일째
  });
  it("0302a 확인 기록만으로 이어져도 대상 · 이어진 학생이 없으면 대상이 아니다(이름이 같아도 — 연결 없는 원아는 절대 대상 아님)", () => {
    expect(planOffboard(world({ childLinks: new Map(), verifiedOwners: new Map([[1, new Set(["s1"])]]) })).candidates).toHaveLength(1);
    const none = planOffboard(world({ childLinks: new Map() }));
    expect(none.candidates).toEqual([]);
    expect(none.excluded).toEqual([]);
    expect(none.unlinked).toBe(1);
  });
  it("지금 다니는 학생(재원·휴원·열린 수강)에게 이어진 원아는 대상이 아니다(조용히 넘어간다) · 퇴원인데 열린 수강이 있어도 그렇다", () => {
    expect(planOffboard(world({ childLinks: new Map([[1, "now"]]) })).candidates).toEqual([]);
    const open = planOffboard(world({ enrollment: new Map([["s1", { open: true, lastEnd: null }]]) }));
    expect(open.candidates).toEqual([]);
    expect(open.excluded).toEqual([]);
    const onHold = planOffboard(world({ students: new Map([st("s1", "이지나", { status: "on_hold" })]) }));
    expect(onHold.candidates).toEqual([]);
  });
  it("오래된 순 · 하루 상한 기본 10 · env로 조정 · 스위치", () => {
    expect(OFFBOARD_DAILY_LIMIT).toBe(10);
    expect(offboardDailyLimit({ CLASSNOTE_OFFBOARD_DAILY_LIMIT: "3" })).toBe(3);
    for (const v of ["", "0", "-1", "abc", "1000"]) expect(offboardDailyLimit({ CLASSNOTE_OFFBOARD_DAILY_LIMIT: v })).toBe(10);
    // 🔴 기본 꺼짐(관찰 모드 · 리뷰 B1) — 'on'일 때만 실제로 내린다
    expect(offboardEnabled({})).toBe(false);
    for (const v of ["off", "false", "0", "NO", " Off ", "", "켜짐"]) expect(offboardEnabled({ CLASSNOTE_OFFBOARD: v })).toBe(false);
    for (const v of ["on", "ON", " true ", "1", "yes"]) expect(offboardEnabled({ CLASSNOTE_OFFBOARD: v })).toBe(true);
    // 반 보드 자동 해제가 멈춘 회차 · 해제 멈춤 표식이 남은 날은 쉰다(O4/B4 — 표식은 해제 스위치와 무관하게 직접 본다)
    expect(offboardSkipForRun({ releaseHalted: "다른 배정이 함께 사라졌다" })).toContain("명부 퇴원처리도 하지 않았습니다");
    expect(offboardSkipForRun({ releaseHalted: null }, "2026-11-02T20:00Z 다른 배정 1개가 함께 사라졌다")).toContain("명부 퇴원처리도 하지 않았습니다");
    expect(offboardSkipForRun({ releaseHalted: null }, "")).toBeNull();
    expect(offboardSkipForRun({ releaseHalted: null })).toBeNull();
    const w = world({
      admissions: new Map([[1, adm("이지나")], [2, adm("홍유담")]]),
      students: new Map([st("s1", "이지나"), st("s2", "홍유담", { withdrawnAt: "2025-11-30" })]),
      enrollment: new Map(),
      childLinks: new Map([[1, "s1"], [2, "s2"]]),
    });
    expect(planOffboard(w).candidates.map((c) => c.childName)).toEqual(["홍유담", "이지나"]);
  });
});

describe("🔴 제외 — 모르면 내리지 않는다", () => {
  it("한 원아가 학생 둘에게 이어짐 · 학생 정보 없음", () => {
    expect(codes(planOffboard(world({ verifiedOwners: new Map([[1, new Set(["s1", "s9"])]]), students: new Map([st("s1", "이지나"), st("s9", "이지나A")]) })))).toEqual(["ambiguous_owner"]);
    expect(codes(planOffboard(world({ students: new Map() })))).toEqual(["no_student"]);
  });
  it("테스트 학생·보호 이름 · 중복 병합(진 쪽) · 퇴원일 없음", () => {
    expect(codes(planOffboard(world({ students: new Map([st("s1", "이지나", { isTest: true })]) })))).toEqual(["protected"]);
    expect(codes(planOffboard(world({ admissions: new Map([[1, adm("학원이")]]), students: new Map([st("s1", "학원이")]) })))).toEqual(["protected"]);
    expect(codes(planOffboard(world({ students: new Map([st("s1", "이지나", { notes: "중복 병합: abc와 통합됨 (2026-09-13)" })]) })))).toEqual(["merged"]);
    expect(codes(planOffboard(world({ students: new Map([st("s1", "이지나", { withdrawnAt: null })]) })))).toEqual(["no_withdrawn_at"]);
  });
  it("퇴원일 뒤의 돈 흔적(퇴원 다음 달 이후 청구 · 퇴원일 뒤 납부) — 퇴원 달 청구는 정상", () => {
    expect(codes(planOffboard(world({ billing: new Map([["s1", { lastPeriod: "2026-08", lastPaidAt: null }]]) })))).toEqual(["recent_billing"]);
    expect(codes(planOffboard(world({ billing: new Map([["s1", { lastPeriod: "2026-07", lastPaidAt: "2026-07-09" }]]) })))).toEqual(["recent_billing"]);
    expect(planOffboard(world({ billing: new Map([["s1", { lastPeriod: "2026-07", lastPaidAt: "2026-07-01" }]]) })).candidates).toHaveLength(1);
  });
  it("보호자 전화가 확실히 다르면(다른 집) · 원아 이름이 학생과 이어지지 않으면(형제 계정) 제외 · 🔴 전화가 하나도 없으면 제외(형제 대조 불가 · B7)", () => {
    expect(codes(planOffboard(world({ admissions: new Map([[1, adm("이지나", { phone: "010-5555-5555" })]]) })))).toEqual(["phone_mismatch"]);
    expect(codes(planOffboard(world({ admissions: new Map([[1, adm("한도현")]]) })))).toEqual(["name_mismatch"]);
    const none = planOffboard(world({ admissions: new Map([[1, adm("이지나", { phone: null })]]) }));
    expect(codes(none)).toEqual(["no_phone"]);
    expect(none.excluded[0].why).toBe("보호자 전화가 없어 형제 대조를 할 수 없습니다");
    expect(codes(planOffboard(world({ admissions: new Map([[1, adm("이지나", { phone: null, phones: [] })]]) })))).toEqual(["no_phone"]);
  });
  it("🔴 보호자 전화는 명부의 carer 전화 전부로 본다 — 둘째 보호자 전화가 퇴원하지 않은 형제와 같아도 제외(B7)", () => {
    const sts = new Map([st("s1", "이지나", { phones: ["010-1000-0000", "010-2000-0000"] }), st("now", "이후성", { status: "enrolled", withdrawnAt: null, phones: ["010-2000-0000"] })]);
    const r = planOffboard(world({ students: sts, admissions: new Map([[1, adm("이지나", { phone: "010-1000-0000", phones: ["010-1000-0000", "010-2000-0000"] })]]) }));
    expect(codes(r)).toEqual(["current_family_phone"]);
  });
  it("🔴 퇴원일 뒤 출결·수업보고서가 있으면 제외(수강 행 없이 자리·보강으로 다닌 경우 · B10) — 퇴원일 당일까지는 괜찮다", () => {
    const at = (lastAttendance, lastReport = null) => planOffboard(world({ activity: new Map([["s1", { lastAttendance, lastReport }]]) }));
    expect(at("2026-07-07").candidates).toHaveLength(1);
    expect(at("2026-07-08").excluded[0]).toMatchObject({ code: "recent_activity", why: expect.stringContaining("출결 2026-07-08") });
    expect(at(null, "2026-09-01").excluded[0].why).toContain("수업보고서 2026-09-01");
  });
  it("🔴 같은 이름 판정 — 양쪽 다 끝 알파벳이 있으면 그 알파벳까지 같아야 한다(명부 '이지아B' ≠ 학생 '이지아A' · B11)", () => {
    expect(sameName("이지아A", "이지아B")).toBe(false);
    expect(sameName("이지아A", "이지아a")).toBe(true);
    expect(sameName("이지아A", "이지아")).toBe(true);
    expect(codes(planOffboard(world({ admissions: new Map([[1, adm("이지나B")]]), students: new Map([st("s1", "이지나A")]) })))).toEqual(["name_mismatch"]);
  });
  it("🔴 끝 알파벳은 학생 이름 **전부**에서 모아 본다 — 학생 '이지나A' + ClassNote 이름 '이지나'(알파벳 없음)로 명부 '이지나B'가 새지 않는다(리뷰 R2)", () => {
    const two = (names) => new Map([st("s1", "이지나A", { names })]);
    expect(codes(planOffboard(world({ admissions: new Map([[1, adm("이지나B")]]), students: two(["이지나A", "이지나"]) })))).toEqual(["name_mismatch"]);
    expect(planOffboard(world({ admissions: new Map([[1, adm("이지나A")]]), students: two(["이지나A", "이지나"]) })).candidates).toHaveLength(1);
    expect(planOffboard(world({ admissions: new Map([[1, adm("이지나")]]), students: two(["이지나A", "이지나"]) })).candidates).toHaveLength(1); // 명부에 알파벳이 없으면 통과
    expect(planOffboard(world({ admissions: new Map([[1, adm("이지나B")]]), students: new Map([st("s1", "이지나")]) })).candidates).toHaveLength(1); // 학생 쪽에 알파벳이 없으면 통과
  });
  it("🔴 학생 쪽엔 알파벳이 없는데 명부 '박서준C' — '박서준C'인 다른 학생이 있으면(상태 무관) 그 학생의 원아일 수 있어 제외(2차 리뷰 F7)", () => {
    const other = (status) => new Map([st("s1", "박서준"), st("c", "박서준C", { status, withdrawnAt: status === "withdrawn" ? "2026-07-07" : null, phones: [] })]);
    for (const status of ["withdrawn", "enrolled"]) {
      const r = planOffboard(world({ admissions: new Map([[1, adm("박서준C")]]), students: other(status), enrollment: new Map() }));
      expect(r.excluded[0]?.codes ?? []).toContain("name_mismatch");
    }
    // 그런 다른 학생이 없으면 통과(동명이인 구분자를 학부모가 붙인 경우)
    expect(planOffboard(world({ admissions: new Map([[1, adm("박서준C")]]), students: new Map([st("s1", "박서준")]), enrollment: new Map() })).candidates).toHaveLength(1);
  });
  it("🔴 퇴원하지 않은 학생에게도 이어진 원아 → 함께 이어진 퇴원생의 다른 원아 계정도 둔다(한 집을 반만 내리지 않는다 · B6)", () => {
    const w = world({
      admissions: new Map([[1, adm("이지나")], [2, adm("이지나")]]),
      childLinks: new Map([[2, "s1"]]),
      verifiedOwners: new Map([[1, new Set(["s1", "now"])]]), // 원아 1 = 퇴원생 s1과 재원생 now 둘 다에 이어짐
    });
    const r = planOffboard(w);
    expect(r.candidates).toEqual([]);
    expect(r.excluded).toEqual([expect.objectContaining({ childId: 2, code: "sibling_account_held", why: expect.stringContaining("퇴원하지 않은 학생에게도 이어져") })]);
  });
  it("🔴 원아 이름 = 학생 이름(공백·끝 알파벳 제외 · 포함 관계는 같은 이름이 아니다) · 명부 이름이 기준(원아 목록 이름은 학부모가 바꿀 수 있다)", () => {
    expect(codes(planOffboard(world({ admissions: new Map([[1, adm("지나")]]) })))).toEqual(["name_mismatch"]);
    expect(planOffboard(world({ admissions: new Map([[1, adm("이 지나")]]), students: new Map([st("s1", "이지나A")]) })).candidates).toHaveLength(1);
    // 학부모가 원아 목록 이름을 바꿔도 명부 이름이 맞으면 통과
    expect(planOffboard(world({ childNames: new Map([[1, "나나 공주💋"]]) })).candidates).toHaveLength(1);
    // 명부 이름이 없으면 원아 목록 이름으로
    expect(codes(planOffboard(world({ admissions: new Map([[1, adm("")]]), childNames: new Map([[1, "한도현"]]) })))).toEqual(["name_mismatch"]);
    // 학생 이름 두 벌(에이와 이름 · ClassNote 이름) 중 하나가 같으면 통과
    expect(planOffboard(world({ admissions: new Map([[1, adm("이진아")]]), students: new Map([st("s1", "이지나", { names: ["이지나", "이진아"] })]) })).candidates).toHaveLength(1);
  });
  it("지금 다니는 학생의 원아일 수 있다(반 보드 해제 ①과 같은 판정) — 이름이 이어짐 · 그 학생의 1인 보드 · 보호자 전화가 같음(형제)", () => {
    const now = (name, phones) => new Map([st("s1", "이지나"), st("now", name, { status: "enrolled", withdrawnAt: null, phones })]);
    expect(planOffboard(world({ students: now("박이지나", ["010-9999-9999"]) })).excluded[0]).toMatchObject({ code: "current_family_name", why: expect.stringContaining("'박이지나'의 원아일 수 있습니다") });
    expect(planOffboard(world({ admissions: new Map([[1, adm("이지나", { boardNames: ["(수학)김민준"] })]]) })).excluded[0].why).toContain("'김민준'의 1인 보드");
    const sib = planOffboard(world({ students: now("이후성", ["010-1000-0000"]) }));
    expect(sib.excluded[0].why).toContain("'이후성'와 보호자 전화가 같습니다");
  });
  it("🔴 한 학생의 원아 계정 중 하나라도 보류되면 그 학생 원아는 모두 둔다(2026-11-03 박예서 — 전화가 적힌 계정만 형제 가드에 걸렸다)", () => {
    // 계정 1 = 형제(이후성)와 같은 전화 · 계정 2 = 학생의 다른 전화(형제와 다름) — 계정 2만 보면 대상이지만 한 집이라 함께 둔다
    const w = world({
      admissions: new Map([[1, adm("이지나")], [2, adm("이지나", { phone: "010-2000-0000" })]]),
      childLinks: new Map([[1, "s1"], [2, "s1"]]),
      students: new Map([st("s1", "이지나", { phones: ["010-1000-0000", "010-2000-0000"] }), st("now", "이후성", { status: "enrolled", withdrawnAt: null, phones: ["010-1000-0000"] })]),
    });
    const r = planOffboard(w);
    expect(r.candidates).toEqual([]);
    expect(r.excluded.map((x) => [x.childId, x.code])).toEqual([[1, "current_family_phone"], [2, "sibling_account_held"]]);
  });
  it("🔴 같은 이름 비교 상대 = 퇴원이 아닌 모든 상태(재원·휴원·예비원생·상담) — 2026-11-03 리뷰: 퇴원 이승민 ↔ 예비원생 이승민A", () => {
    for (const status of ["prospect", "consulted", "on_hold", "enrolled"]) {
      const w = world({ admissions: new Map([[1, adm("이승민")]]), students: new Map([st("s1", "이승민"), st("p", "이승민A", { status, withdrawnAt: null, phones: [] })]), enrollment: new Map() });
      expect(planOffboard(w).excluded[0]).toMatchObject({ code: "current_family_name", why: expect.stringContaining("'이승민A'") });
    }
    // 퇴원한 동명이인은 비교 상대가 아니다(둘 다 그만둔 학생)
    const gone = world({ admissions: new Map([[1, adm("이승민")]]), students: new Map([st("s1", "이승민"), st("g", "이승민A", { phones: [] })]), enrollment: new Map() });
    expect(planOffboard(gone).candidates).toHaveLength(1);
  });
  it("같은 이름은 원아 두 벌(명부·원아 목록) × 학생 두 벌(에이와·ClassNote 이름)로 본다", () => {
    const keeper = (over) => new Map([st("s1", "이지나"), st("now", "김민서", { status: "enrolled", withdrawnAt: null, phones: [], ...over })]);
    expect(codes(planOffboard(world({ students: keeper(), childNames: new Map([[1, "김민서 공주"]]) })))).toEqual(["current_family_name"]);
    expect(codes(planOffboard(world({ students: keeper({ names: ["김민서", "이지나"] }) })))).toEqual(["current_family_name"]);
  });
  it("사유는 모두 모은다(첫 사유 = 보고서 문구 · codes = 걸린 사유 전부)", () => {
    const r = planOffboard(world({ admissions: new Map([[1, adm("한도현", { boards: [ALL, { id: 901, name: "중등M 중2 A" }] })]]) }));
    expect(r.excluded[0]).toMatchObject({ code: "name_mismatch", codes: ["name_mismatch", "board_remaining"] });
  });
});

describe("🔴 ⑧ 남은 배정 모양 — 전체방과 본인 1인 보드만 남았을 때만", () => {
  it("반 보드·영어 반 방·그룹 보드·남의 1인 보드가 하나라도 남아 있으면 제외(사유에 보드 이름) · 본인 1인 보드는 괜찮다", () => {
    const one = (boards) => planOffboard(world({ admissions: new Map([[1, adm("이지나", { boards })]]) }));
    expect(one([ALL, { id: 901, name: "중등M 중2 A" }]).excluded[0]).toMatchObject({ code: "board_remaining", why: "반 배정이 남아 있습니다(중등M 중2 A) — 해제가 먼저입니다" });
    expect(one([ALL, { id: 902, name: "[EIE] 그룹반" }]).excluded[0].code).toBe("board_remaining");
    expect(one([ALL, { id: 903, name: "(영어)박예서" }]).excluded[0].code).toBe("board_remaining");
    expect(one([ALL, { id: 904, name: "(영어) 이지나" }]).candidates).toHaveLength(1);
    expect(one([]).candidates).toHaveLength(1); // 남은 배정이 없다
    expect(codes(one(undefined))).toEqual(["boards_unknown"]);
  });
  it("🔴 승인 대기 배정도 '남은 배정'이다(누가 그 원아로 반 보드 가입을 요청했다 · B5) — 해제 쪽 '남는 배정'(승인된 것만)과 반대", () => {
    const r = planOffboard(world({ admissions: new Map([[1, adm("이지나", { allBoards: [{ ...ALL, approved: true }, { id: 905, name: "중등M 중2 B", approved: false }] })]]) }));
    expect(r.excluded[0]).toMatchObject({ code: "board_remaining", why: "반 배정이 남아 있습니다(중등M 중2 B) — 해제가 먼저입니다" });
    expect(codes(planOffboard(world({ admissions: new Map([[1, adm("이지나", { allBoards: null })]]) })))).toEqual(["boards_unknown"]);
  });
  it("🔴 회차 건전성 — 명부의 전체방 배정 수와 전체방 보드 원아 수가 10% 넘게 다르면 그날은 하지 않는다(B3)", () => {
    const admissions = new Map(Array.from({ length: 10 }, (_, i) => [i, { boards: i < 9 ? [ALL] : [] }]));
    const boards = (children) => [{ ...ALL, children }];
    expect(rosterConsistency({ admissions, centerBoards: boards(9), wideIds: new Set([900]) })).toBeNull();
    expect(rosterConsistency({ admissions, centerBoards: boards(10), wideIds: new Set([900]) })).toBeNull(); // 1/10 = 10% — 넘지 않는다
    expect(rosterConsistency({ admissions, centerBoards: boards(12), wideIds: new Set([900]) })).toContain("크게 달라 오늘은 명부 퇴원처리를 하지 않았습니다");
    expect(rosterConsistency({ admissions, centerBoards: boards(null), wideIds: new Set([900]) })).toContain("모름");
    // 칸이 사라진 명부(boards null)는 전체방 배정이 0으로 보여 걸린다
    expect(rosterConsistency({ admissions: new Map([[1, { boards: null }]]), centerBoards: boards(345), wideIds: new Set([900]) })).toContain("0명");
    expect(rosterConsistency({ admissions, centerBoards: boards(1), wideIds: new Set() })).toBeNull(); // 전체방이 없으면 ⑧이 아무도 안 내린다
  });
  it("🔴 퇴원 뒤 활동 가드를 믿을 수 있나(R9) — 권한 없음(42501) · 읽힌 기록 없음(정책 빠져 0행) · 14일보다 오래됨이면 그날 보류", () => {
    const ok = { date: "2026-11-02", denied: false };
    expect(activityUnreadable({ lastAttendance: ok, lastReport: ok, today: TODAY })).toBeNull();
    expect(activityUnreadable({ lastAttendance: { date: null, denied: true }, lastReport: ok, today: TODAY })).toBe("출결 기록을 읽지 못해 오늘은 명부 퇴원처리를 하지 않았습니다(연동 PC에 읽기 권한이 없습니다)");
    expect(activityUnreadable({ lastAttendance: { date: null, denied: false }, lastReport: ok, today: TODAY })).toContain("읽힌 기록이 없습니다");
    expect(activityUnreadable({ lastAttendance: { date: "2026-10-14", denied: false }, lastReport: ok, today: TODAY })).toContain("20일 전 — 14일보다 오래됐습니다");
    expect(activityUnreadable({ lastAttendance: { date: "2026-10-20", denied: false }, lastReport: ok, today: TODAY })).toBeNull(); // 14일째는 괜찮다
    expect(activityUnreadable({ lastAttendance: ok, lastReport: { date: null, denied: true }, today: TODAY })).toContain("수업보고서 기록을 읽지 못해");
    expect(isPermissionDenied({ code: "42501" })).toBe(true);
    expect(isPermissionDenied(new Error("permission denied for table attendance_records"))).toBe(true);
    expect(isPermissionDenied({ code: "42P01" })).toBe(false);
  });
  it("한 집 일부만 처리 문구(B12) · 댓글을 다 받았나(B8)", () => {
    expect(partialFamilyText({ studentName: "황지민B", total: 2, done: 1 })).toBe("한 집 중 일부만 처리: 황지민B — 원아 계정 2개 중 1개만 퇴원처리했습니다(나머지는 ClassNote에서 확인해 주세요)");
    expect(partialFamilyText({ studentName: "황지민B", total: 2, done: 2 })).toBeNull();
    expect(partialFamilyText({ studentName: "황지민B", total: 2, done: 0 })).toBeNull();
    const posts = [{ id: 1, num_comments: 2 }, { id: 2, num_comments: 0 }];
    expect(commentsComplete(posts, { complete: new Set([1]) })).toBe(true);
    expect(commentsComplete(posts, { complete: new Set() })).toBe(false);
  });
  it("전체방이 정해지지 않으면 [ALL] 보드도 '남은 배정'이다(모르면 내리지 않는다)", () => {
    expect(codes(planOffboard(world({ centerBoards: null })))).toEqual(["board_remaining"]);
    expect(codes(planOffboard(world({ linkedBoardIds: null })))).toEqual(["board_remaining"]);
  });
  it("전체방 판정 — 이름 [ALL] · 센터에 하나 · 에이와 반 연결 없음 · 재원 명부의 절반 이상(보드 종류 값이 ClassNote에 없다)", () => {
    const b = (over = {}) => ({ ...ALL, children: 345, ...over });
    expect([...centerWideRoomIds({ boards: [b()], linkedBoardIds: [], rosterSize: 413 }).ids]).toEqual([900]);
    expect(centerWideRoomIds({ boards: [b()], linkedBoardIds: [], rosterSize: 413 }).basis).toContain("재원 명부 413명 중 345명");
    expect(centerWideRoomIds({ boards: [b(), b({ id: 905, name: "[ALL] 두 번째" })], linkedBoardIds: [], rosterSize: 413 }).ids.size).toBe(0);
    expect(centerWideRoomIds({ boards: [b()], linkedBoardIds: [900], rosterSize: 413 }).ids.size).toBe(0);
    expect(centerWideRoomIds({ boards: [b({ children: 100 })], linkedBoardIds: [], rosterSize: 413 }).ids.size).toBe(0);
    expect(centerWideRoomIds({ boards: [b({ children: null })], linkedBoardIds: [], rosterSize: 413 }).ids.size).toBe(0);
    expect(centerWideRoomIds({ boards: [b({ name: "인재원 전체방" })], linkedBoardIds: [], rosterSize: 413 }).ids.size).toBe(0);
    expect(centerWideRoomIds({ boards: null, linkedBoardIds: [], rosterSize: 413 }).ids.size).toBe(0);
    expect(centerWideRoomIds({ boards: [b()], linkedBoardIds: null, rosterSize: 413 }).ids.size).toBe(0);
  });
  it("같은 이름 판정(sameName) — 공백·끝 알파벳만 뗀다", () => {
    expect(sameName("이지나A", "이 지나")).toBe(true);
    expect(sameName("이지나", "지나")).toBe(false);
    expect(sameName("한민호", "한도현")).toBe(false);
    expect(sameName("", "")).toBe(false);
  });
});

describe("⑦ 그 원아의 글 — 실행 직전", () => {
  it("끝까지 못 받았으면 제외 · 최근 45일 안 글이 있으면 제외 · 오래된 글만이면 통과 · 글 0건도 통과", () => {
    expect(checkChildPosts({ complete: false, posts: [] }, TODAY)).toMatchObject({ ok: false, code: "posts_unknown" });
    expect(checkChildPosts({ complete: true, posts: [{ created: "2026-10-01T03:00:00Z" }] }, TODAY)).toMatchObject({ ok: false, code: "recent_post" });
    expect(checkChildPosts({ complete: true, posts: [{ created: "2026-07-07T03:00:00Z", date_written: "2026-07-07" }, { created: "2026-06-01T03:00:00Z" }] }, TODAY)).toEqual({ ok: true, lastPostAt: "2026-07-07", count: 2 });
    expect(checkChildPosts({ complete: true, posts: [] }, TODAY)).toEqual({ ok: true, lastPostAt: null, count: 0 });
    // 작성일이 늦게 적힌 글(date_written)도 본다
    expect(checkChildPosts({ complete: true, posts: [{ created: "2026-06-01T03:00:00Z", date_written: "2026-10-30" }] }, TODAY).ok).toBe(false);
  });
});

describe("실행 뒤 확인 · 백업", () => {
  it("그 원아만 빠지고 퇴소 명부에 있어야 성공 · 다른 원아가 함께 사라지면 멈춤 · 그대로면 실패(멈춤 아님)", () => {
    const before = new Set([1, 2, 3]);
    expect(verifyOffboard({ before, after: new Set([2, 3]), left: new Set([1]), childId: 1 })).toEqual({ ok: true });
    expect(verifyOffboard({ before, after: new Set([3]), left: new Set([1]), childId: 1 })).toMatchObject({ ok: false, halt: true });
    expect(verifyOffboard({ before, after: new Set([1, 2, 3]), left: new Set(), childId: 1 })).toMatchObject({ ok: false, halt: false });
    expect(verifyOffboard({ before, after: new Set([2, 3]), left: new Set(), childId: 1 })).toMatchObject({ ok: false, halt: false });
    // 그 사이 새로 들어온 원아는 정상
    expect(verifyOffboard({ before, after: new Set([2, 3, 4]), left: new Set([1]), childId: 1 })).toEqual({ ok: true });
  });
  it("백업 = 학부모(재초대 대상) + 글 목록 · 🔴 보호자 전화·주소는 싣지 않는다 · 학부모를 모르면 되돌릴 수 없다", () => {
    const detail = {
      date_birth: "2014-01-01", parent: { id: 77, name: "이지나 어머님", username: "mom", type: "parent", phone: "010-1000-0000" },
      enrollment: [{ belong_to_class: 1200521, class_name: "[ALL] 인재원 전체방", is_approved: true, center_id: 1 }, { belong_to_class: 5, removed_child: true }, { belong_to_class: 6, class_name: "남의 학원 반", center_id: 99 }],
    };
    const img = { id: 3, access_key: "k", original_file_name: "a.jpg", file_size: 10, width: 1, height: 1, original: "https://x/a.jpg", large: "https://x/l.jpg" };
    const posts = [{ id: 9, created: "2026-07-07T03:00:00Z", date_written: "2026-07-07", author_name: "셀린T", cls: 1, class_name: "가반", content: "글", attached_images: [img], attached_files: [], num_comments: 2, read_by_parent: { date_read: "2026-07-08" } }];
    const comments = new Map([[9, [{ id: 31, created: "2026-07-08T01:00:00Z", author: { id: 5, type: "parent", name: "이지나 어머님", username: "01010000000" }, author_name: "이지나 어머님", content: "감사합니다", emoticon_content: null, attached_images: [img], attached_files: [], attached_video: null }]]]);
    const b = buildOffboardBackup({ child: { id: 1, name: "이지나" }, student: { id: "s1", name: "이지나" }, detail, posts, comments, baseDate: "2026-07-07", days: 119, at: "2026-11-03T00:00:00Z", tenant: "t1", centerId: 1 });
    expect(b.version).toBe(2);
    expect(b.parent).toEqual({ id: 77, name: "이지나 어머님", username: "mom", type: "parent" });
    expect(b.enrollments).toEqual([{ boardId: 1200521, boardName: "[ALL] 인재원 전체방", approved: true }]); // 내보낸 줄·남의 학원 줄은 안 싣는다
    // 첨부 = 주소·이름·크기 메타만(원본 파일·접근 키 없음) · 댓글 = 이름·종류·본문(아이디 없음)
    expect(b.posts[0]).toMatchObject({ id: 9, authorName: "셀린T", boardName: "가반", numComments: 2, readByParent: "2026-07-08", attachedImages: [{ name: "a.jpg", size: 10, url: "https://x/a.jpg" }] });
    expect(b.posts[0].comments).toEqual([{ id: 31, created: "2026-07-08T01:00:00Z", authorName: "이지나 어머님", authorType: "parent", content: "감사합니다", emoticon: null, attachedImages: [{ name: "a.jpg", size: 10, url: "https://x/a.jpg" }], attachedFiles: [], attachedVideo: null }]);
    expect(JSON.stringify(b)).not.toContain("010-1000-0000");
    expect(JSON.stringify(b)).not.toContain("01010000000");
    expect(JSON.stringify(b)).not.toContain("access_key");
    // 학부모 아이디가 숫자·전화 꼴이면 뺀다
    const phoneId = buildOffboardBackup({ child: { id: 1, name: "이지나" }, student: { id: "s1", name: "이지나" }, detail: { ...detail, parent: { id: 77, name: "어머님", username: "010-1234-5678", type: "parent" } }, posts: [], baseDate: "2026-07-07", days: 119, at: "x", tenant: "t1" });
    expect(phoneId.parent.username).toBeNull();
    expect(backupRestorable(phoneId)).toBe(true); // 이름이 있으면 되돌릴 길은 있다
    expect(backupRestorable(b)).toBe(true);
    expect(backupRestorable({ ...b, parent: null })).toBe(false);
    expect(backupRestorable({ ...b, parent: { id: 77, name: null, username: null } })).toBe(false);
  });
  it("중복 병합 표식 = 앱 판정(merged.ts)과 같은 꼴 — 한쪽만 바뀌면 실패", () => {
    const app = readFileSync(join(process.cwd(), "src/features/students/status/merged.ts"), "utf8");
    expect(app).toContain(`const MERGE_NOTE_PATTERN = ${MERGE_NOTE_PATTERN.toString()};`);
    expect(isMergedNote("  중복 병합: x와 통합됨 (2026-09-13) 메모")).toBe(true);
    expect(isMergedNote("중복 병합: 확인 요망")).toBe(false);
    expect(isMergedNote(null)).toBe(false);
  });
  it("🔴 배선 가드 — 정기 동기화는 해제 멈춤 표식을 **직접** 보고(해제 스위치와 무관) 그날 퇴원처리를 쉰다 · 쉴 때는 runOffboard를 안 부른다(B4)", () => {
    const src = readFileSync(join(process.cwd(), "scripts/_classnote/math-class-boards-sync.mjs"), "utf8").replace(/\r\n/g, "\n");
    expect(src).toMatch(/const skip = offboardSkipForRun\(r, releaseHaltReason\(\)\);\n\s*if \(skip\) events\.push\(\{[^\n]*\}\);\n\s*else offboardPlanned = \(await runOffboard\(/);
    expect(src.match(/runOffboard\(/g)).toHaveLength(1); // 다른 곳에서 가드 없이 부르지 않는다
    // releaseHaltReason은 해제 스위치와 무관하게 표식 파일을 읽는다(스위치는 syncMathClassBoards 안에서만 본다)
    expect(src).toMatch(/export function releaseHaltReason\(\) \{\n(?:(?!autoReleaseEnabled)[^\n]*\n){1,8}\}/);
  });
});
