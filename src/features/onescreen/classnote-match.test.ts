import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildCnMatchMap,
  cnLabelFor,
  cnLabelState,
  cnMatchVersion,
  cnMatchVersionOf,
  cnTipCard,
  CN_UNAVAILABLE,
  pickCnForClasses,
  pickCnForRoster,
} from "./classnote-match";

const boards = [{ class_id: "c1", board_name: "중등M 중1 MS2R" }];
const row = (over: Partial<Parameters<typeof buildCnMatchMap>[0][number]> = {}) => ({
  class_id: "c1",
  student_id: "s1",
  status: "ok" as const,
  child_name: "김지호",
  reason: null,
  ...over,
});

describe("buildCnMatchMap", () => {
  it("확인된 배정 = ok, 보드 이름이 붙는다", () => {
    const m = buildCnMatchMap([row()], boards, ["c1"]);
    expect(m.byKey["c1|s1"]).toEqual({ status: "ok", boardName: "중등M 중1 MS2R", childNames: ["김지호"], reasons: [] });
  });
  it("🔴 두 계정 중 하나라도 보류면 보류(한쪽만 받는 상태를 초록으로 보이지 않게)", () => {
    const m = buildCnMatchMap([row(), row({ status: "hold", child_name: "지호", reason: "반 보드 배정 전" })], boards, ["c1"]);
    expect(m.byKey["c1|s1"]!.status).toBe("hold");
    expect(m.byKey["c1|s1"]!.childNames).toEqual(["김지호", "지호"]);
    expect(m.byKey["c1|s1"]!.reasons).toEqual(["반 보드 배정 전"]);
  });
});

describe("cnLabelFor", () => {
  const map = buildCnMatchMap([row(), row({ student_id: "s2", status: "hold", child_name: null, reason: "보호자 전화 불일치" })], boards, ["c1", "c9"]);
  it("수학 반 행만 — 영어·보강(classId 없음)은 라벨 없음", () => {
    expect(cnLabelFor(map, { classId: "c1", subjectKey: "english", studentId: "s1" })).toBeNull();
    expect(cnLabelFor(map, { classId: null, subjectKey: "math", studentId: "s1" })).toBeNull();
    expect(cnLabelFor(map, { classId: "c1", subjectKey: "subject_1", studentId: "s1" })?.ok).toBe(true);
  });
  it("보류·기록 없음 = 빨강", () => {
    expect(cnLabelFor(map, { classId: "c1", subjectKey: "math", studentId: "s2" })?.ok).toBe(false);
    // 이 반(c9)엔 기록이 없지만 다른 반 보드(c1)에 배정이 확인된 학생 — 어느 반 보드인지 함께 싣는다(2026-10-06).
    expect(cnLabelFor(map, { classId: "c9", subjectKey: "math", studentId: "s1" })).toEqual({ ok: false, match: null, elsewhere: ["중등M 중1 MS2R"] });
    // 어디에도 기록이 없는 학생은 종전 그대로.
    expect(cnLabelFor(map, { classId: "c9", subjectKey: "math", studentId: "s7" })).toEqual({ ok: false, match: null });
  });
  it("🔴 반 보드 대상이 아닌 반(특강·종강)은 라벨 없음 — 가짜 빨간불 금지", () => {
    expect(cnLabelFor(map, { classId: "c7", subjectKey: "math", studentId: "s1" })).toBeNull();
  });
  it("🔴 표를 못 읽었으면 라벨 자체를 안 그린다(거짓 빨간불 금지)", () => {
    expect(cnLabelFor(CN_UNAVAILABLE, { classId: "c1", subjectKey: "math", studentId: "s1" })).toBeNull();
    expect(cnLabelFor(undefined, { classId: "c1", subjectKey: "math", studentId: "s1" })).toBeNull();
  });
});

describe("pickCnForClasses", () => {
  it("강사 로스터의 반만 남긴다(다른 반 학생의 보류 사유를 내려보내지 않음)", () => {
    const m = buildCnMatchMap([row(), row({ class_id: "c2", student_id: "s9", status: "hold", reason: "x" })], boards, ["c1", "c2"]);
    expect(Object.keys(pickCnForClasses(m, ["c1"]).byKey)).toEqual(["c1|s1"]);
    expect(pickCnForClasses(m, ["c1"]).eligibleClassIds).toEqual(["c1"]);
    expect(pickCnForClasses(CN_UNAVAILABLE, ["c1"]).available).toBe(false);
  });
});

describe("cnTipCard", () => {
  it("기록이 없으면 안내 문장, 있으면 사유를 싣는다", () => {
    expect(cnTipCard({ ok: false, match: null }, "A반").lines[0]).toContain("연결 기록이 없습니다");
    const tip = cnTipCard({ ok: false, match: { status: "hold", boardName: "A반", childNames: [], reasons: ["보호자 전화 불일치"] } }, "A반");
    expect(tip.meta).toBe("매칭 실패");
    expect(tip.lines).toEqual(["보호자 전화 불일치"]);
  });
});

// 원장 2026-10-06 *"클래스노트 연결은 되어있지만, 반 배정이 현재반과 다를때 아이콘을 노트 위에 ? 표시로 … 활성화는 체크,
// 반배정 오류는 ? 오버레이"* — 그림 셋: 체크(이 반 보드에 배정) · 물음표(연결은 됐는데 이 반 배정이 아님) · 회색(연결 모름).
describe("반 배정이 지금 반과 다를 때(물음표)", () => {
  const twoBoards = [
    { class_id: "c1", board_name: "A반" },
    { class_id: "c2", board_name: "B반" },
  ];
  // s1 = c1에 배정 확인(반 이동 전 반). 지금 보는 반은 c2 — 거기엔 기록이 없다.
  const moved = buildCnMatchMap([row()], twoBoards, ["c1", "c2"]);

  it("🔴 이 반은 아닌데 다른 반 보드에 배정이 확인됐다 = 물음표 — 어느 반 보드인지 함께 알려 준다", () => {
    const label = cnLabelFor(moved, { classId: "c2", subjectKey: "math", studentId: "s1" })!;
    expect(label).toEqual({ ok: false, match: null, elsewhere: ["A반"] });
    expect(cnLabelState(label)).toBe("mismatch");
    const tip = cnTipCard(label, "B반");
    expect(tip.meta).toBe("반 배정 확인 필요");
    expect(tip.rows).toContainEqual(["배정된 반 보드", "A반"]);
  });

  it("이 반 보드에 배정이 확인됐으면 체크 — 다른 반 보드에도 있다는 것은 적지 않는다(두 반을 다니는 학생)", () => {
    const both = buildCnMatchMap([row(), row({ class_id: "c2" })], twoBoards, ["c1", "c2"]);
    const label = cnLabelFor(both, { classId: "c2", subjectKey: "math", studentId: "s1" })!;
    expect(label.ok).toBe(true);
    expect(label.elsewhere).toBeUndefined();
    expect(cnLabelState(label)).toBe("ok");
    expect(cnTipCard(label, "B반").meta).toBe("매칭됨");
  });

  it("🔴 어느 반 보드에도 배정이 없고 원아도 모른다 = 물음표가 아니라 회색(연결 자체를 모른다)", () => {
    const label = cnLabelFor(moved, { classId: "c2", subjectKey: "math", studentId: "s9" })!;
    expect(label).toEqual({ ok: false, match: null });
    expect(cnLabelState(label)).toBe("none");
    expect(cnTipCard(label, "B반").meta).toBe("매칭 실패");
    // 원아를 못 찾아 보류된 줄(미가입 등)도 회색이다.
    const noChild = buildCnMatchMap([row({ status: "hold", child_name: null, reason: "ClassNote 미가입·미배정" })], twoBoards, ["c1"]);
    expect(cnLabelState(cnLabelFor(noChild, { classId: "c1", subjectKey: "math", studentId: "s1" })!)).toBe("none");
  });

  it("원아는 찾았는데 이 반 배정이 보류 = 물음표(연결은 돼 있다)", () => {
    const held = buildCnMatchMap([row({ status: "hold", child_name: "지호", reason: "반 보드 배정 전" })], twoBoards, ["c1"]);
    const label = cnLabelFor(held, { classId: "c1", subjectKey: "math", studentId: "s1" })!;
    expect(label.ok).toBe(false);
    expect(cnLabelState(label)).toBe("mismatch");
    // 사유는 종전처럼 카드의 줄로 나온다.
    expect(cnTipCard(label, "A반").lines).toEqual(["반 보드 배정 전"]);
  });

  it("다른 반 보드의 배정이 보류면 '연결됨'의 근거로 치지 않는다(확인된 배정만 센다)", () => {
    const heldElsewhere = buildCnMatchMap([row({ status: "hold", child_name: "지호", reason: "x" })], twoBoards, ["c1", "c2"]);
    expect(cnLabelFor(heldElsewhere, { classId: "c2", subjectKey: "math", studentId: "s1" })).toEqual({ ok: false, match: null });
  });

  it("🔴 다른 반에 원아가 둘이고 하나만 배정이 확인됐다 = 그 반은 확인된 배정이 아니다(한쪽만 받는 상태를 근거로 치지 않는다)", () => {
    const mixed = buildCnMatchMap([row(), row({ status: "hold", child_name: "지호(학생 계정)", reason: "반 보드 배정 전" })], twoBoards, ["c1", "c2"]);
    expect(mixed.okBoards).toEqual({});
    expect(cnLabelFor(mixed, { classId: "c2", subjectKey: "math", studentId: "s1" })).toEqual({ ok: false, match: null });
  });

  it("🔴 로스터로 좁힐 때 — 다른 반 보드 배정은 이 로스터의 학생 것만, 반 보드 이름만 남는다(다른 반의 사유·원아는 안 내려간다)", () => {
    const map = buildCnMatchMap(
      [row(), row({ student_id: "s2", child_name: "남의 원아" }), row({ class_id: "c1", student_id: "s3", status: "hold", child_name: "보류 원아", reason: "남의 반 사유" })],
      twoBoards,
      ["c1", "c2"],
    );
    const picked = pickCnForClasses(map, ["c2"], ["s1"]);
    expect(picked.byKey).toEqual({});
    expect(picked.okBoards).toEqual({ s1: [{ classId: "c1", boardName: "A반" }] });
    expect(JSON.stringify(picked)).not.toMatch(/남의|보류 원아/);
    // 그 지도로도 판정이 같다.
    expect(cnLabelFor(picked, { classId: "c2", subjectKey: "math", studentId: "s1" })).toEqual({ ok: false, match: null, elsewhere: ["A반"] });
    // 학생 목록을 안 넘기면(옛 호출) 다른 반 보드 배정은 아예 싣지 않는다.
    expect(pickCnForClasses(map, ["c2"]).okBoards).toEqual({});
  });

  it("학생 id가 객체의 물려받은 이름이어도 터지지 않는다", () => {
    expect(cnLabelFor(moved, { classId: "c2", subjectKey: "math", studentId: "constructor" })).toEqual({ ok: false, match: null });
    expect(pickCnForClasses(moved, ["c2"], ["constructor", "toString"]).okBoards).toEqual({});
  });
});

describe("보고서 미발송 줄 · 함께 다니는 반 — 물음표는 그날 안 다니는 반의 배정만(원장 2026-11-04)", () => {
  // 이연아 = JJ1G(보고서 쓰는 JJ 반)와 BS1D(일반 반)를 함께 다닌다 — BS1D 보드에만 배정이 확인됐고 JJ1G는 아직이다.
  const twoBoards = [
    { class_id: "bs1d", board_name: "초등M 개별 BS1D" },
    { class_id: "jj1g", board_name: "초등M 개별 JJ1G" },
  ];
  const yeonah = (over: Partial<Parameters<typeof buildCnMatchMap>[0][number]> = {}) =>
    row({ class_id: "bs1d", student_id: "lee", child_name: "이연아", ...over });
  const bothNow = [
    { class_id: "bs1d", student_id: "lee" },
    { class_id: "jj1g", student_id: "lee" },
  ];

  it("🔴 보고서 미발송 줄엔 라벨이 없다 — 대상 반에 없을 때(서버가 뺀다)도, 줄이 미발송으로 표시됐을 때(수업 나누기로 온 줄)도", () => {
    const map = buildCnMatchMap([], twoBoards, ["bs1d"], []);
    // 미발송 반 — 대상 반 목록 밖이라 라벨 없음(카드·표 둘 다 같은 함수).
    expect(cnLabelFor(map, { classId: "optout-jj", subjectKey: "math", studentId: "lee" })).toBeNull();
    // 대상 반이어도 줄이 미발송이면 없음 — 그 줄의 보고서는 ClassNote로 가지 않는다.
    expect(cnLabelFor(map, { classId: "bs1d", subjectKey: "math", studentId: "lee", reportOptout: true })).toBeNull();
    expect(cnLabelFor(map, { classId: "bs1d", subjectKey: "math", studentId: "lee", reportOptout: false })).toEqual({ ok: false, match: null });
  });

  it("🔴 두 반을 함께 다니면 다른 반 배정은 물음표의 근거가 아니다 — JJ1G 줄에 '배정된 반 보드: BS1D'가 뜨지 않는다", () => {
    const map = buildCnMatchMap([yeonah()], twoBoards, ["bs1d", "jj1g"], bothNow);
    const jj = cnLabelFor(map, { classId: "jj1g", subjectKey: "math", studentId: "lee" })!;
    expect(jj.elsewhere).toBeUndefined();
    expect(cnLabelState(jj)).toBe("none");
    expect(cnTipCard(jj, "초등M 개별 JJ1G").rows).not.toContainEqual(["배정된 반 보드", "초등M 개별 BS1D"]);
    // BS1D 줄은 그 반 보드 기준으로 체크.
    expect(cnLabelState(cnLabelFor(map, { classId: "bs1d", subjectKey: "math", studentId: "lee" })!)).toBe("ok");
    // 그날 다니는 반을 안 넘기면(옛 호출) 종전대로 물음표 — 이 구분이 고친 자리다.
    expect(cnLabelState(cnLabelFor(buildCnMatchMap([yeonah()], twoBoards, ["bs1d", "jj1g"]), { classId: "jj1g", subjectKey: "math", studentId: "lee" })!)).toBe("mismatch");
  });

  it("🔴 반을 옮긴 학생(옛 반은 그날 안 다닌다) — 옛 반 보드 배정은 그대로 물음표의 근거", () => {
    const moved = [...boards, { class_id: "c2", board_name: "B반" }];
    const map = buildCnMatchMap([row()], moved, ["c1", "c2"], [{ class_id: "c2", student_id: "s1" }]);
    const label = cnLabelFor(map, { classId: "c2", subjectKey: "math", studentId: "s1" })!;
    expect(label.elsewhere).toEqual(["중등M 중1 MS2R"]);
    expect(cnLabelState(label)).toBe("mismatch");
  });
});

describe("매칭 표 버전(새로고침 없는 갱신, 원장 2026-11-04)", () => {
  const members = [{ id: 5 }, { id: 12 }, { id: 9 }];
  const linkRows = [{ synced_at: "2026-11-04T05:00:12.345678+00:00" }, { synced_at: "2026-11-04T05:00:12.3+00:00" }];

  it("🔴 전체로 읽은 값과 가벼운 확인(행 수 + 맨 위 한 줄)이 같은 문자열을 낸다 — 시각은 밀리초로 맞춘다", () => {
    const full = cnMatchVersionOf(members, linkRows);
    const light = cnMatchVersion({ memberCount: 3, maxMemberId: 12, boardCount: 2, maxSyncedAt: Date.parse("2026-11-04T05:00:12.345678+00:00") });
    expect(full).toBe(light);
  });

  it("동기화가 반을 다시 쓰면(새 번호) · 지우기만 하면(행 수) · 연결 시각이 바뀌면 버전이 바뀐다", () => {
    const base = cnMatchVersionOf(members, linkRows);
    expect(cnMatchVersionOf([...members, { id: 13 }], linkRows)).not.toBe(base);
    expect(cnMatchVersionOf(members.slice(1), linkRows)).not.toBe(base);
    expect(cnMatchVersionOf(members, [...linkRows, { synced_at: "2026-11-04T06:00:00+00:00" }])).not.toBe(base);
    expect(cnMatchVersionOf(members, linkRows)).toBe(base);
  });

  it("빈 표·읽을 수 없는 시각도 터지지 않는다", () => {
    expect(cnMatchVersionOf([], [])).toBe(cnMatchVersion({ memberCount: 0, maxMemberId: null, boardCount: 0, maxSyncedAt: null }));
    expect(cnMatchVersionOf([{ id: null }], [{ synced_at: null }, { synced_at: "모름" }])).toBe("1.0.2.0");
  });
});

describe("pickCnForRoster — 페이지 첫 렌더와 갱신 라우트가 같은 함수로 좁힌다", () => {
  const twoBoards = [
    { class_id: "c1", board_name: "A반" },
    { class_id: "c2", board_name: "B반" },
  ];
  const map = { ...buildCnMatchMap([row(), row({ class_id: "c2", student_id: "s9", status: "hold", reason: "남의 반 사유" })], twoBoards, ["c1", "c2"]), version: "v1" };
  const attending = [
    { class_id: "c3", student_id: "s1" },
    { class_id: "c2", student_id: "s9" },
  ];

  it("🔴 학생 = 이 반들을 그날 다니는 학생만 — 다른 반 학생의 배정·사유는 안 내려간다", () => {
    const picked = pickCnForRoster({ map, attending }, ["c3"]);
    expect(picked.byKey).toEqual({});
    expect(picked.okBoards).toEqual({ s1: [{ classId: "c1", boardName: "A반" }] });
    expect(JSON.stringify(picked)).not.toMatch(/남의 반 사유|s9/);
    expect(picked.version).toBe("v1");
  });

  it("표를 못 읽은 지도는 그대로(라벨 없음) — 버전도 그대로 싣는다", () => {
    expect(pickCnForRoster({ map: { ...CN_UNAVAILABLE, version: "v0" }, attending }, ["c1"])).toEqual({ ...CN_UNAVAILABLE, version: "v0" });
    expect(pickCnForClasses(CN_UNAVAILABLE, ["c1"]).version).toBeUndefined();
  });

  it("🔴 배선 — 서버는 미발송 반을 대상에서 빼고 그날 다니는 반을 물음표 판정에 넘긴다 · 페이지와 갱신 라우트가 같은 조회·같은 좁히기", () => {
    // 주석은 지우고 본다(주석에 같은 글자가 있어도 통과하지 않게).
    const read = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8").replace(/\/\/[^\n]*/g, "");
    const server = read("src/features/onescreen/server/classnote-match.ts");
    expect(server).toContain('.eq("report_optout", false)');
    expect(server).toContain("resolveReportDate(rosterDate, today)");
    expect(server).toMatch(/buildCnMatchMap\([^;]*eligibleIds, attending\)/);
    const page = read("src/app/(shell)/onescreen/page.tsx");
    expect(page).toContain("loadClassnoteMatch(date)");
    expect(page).toContain("pickCnForRoster(");
    const route = read("src/app/api/onescreen/classnote-match/route.ts");
    expect(route).toContain("loadClassnoteMatch(q.date)");
    expect(route).toContain("pickCnForRoster(loaded, q.classIds)");
  });
});
