import { describe, expect, it } from "vitest";
import { seesAll, statusText } from "./model";
import { bodyFor, forAssignee, lacksOwnPart, ownedBlocks, recipientNames, splitsByRecipient, topBlocks, twinHeadings } from "./recipient-body";
import { FIXTURE_WORK } from "./testing/fixture";

const INTRO = "<p>모두에게 가는 첫 문장</p>";
const GA = "<h3>강사 가 선생님 · 2명</h3><ul><li><strong>학생 사</strong> A중2<ul><li>결석 2회 · 중2 수학 A</li></ul></li><li><strong>학생 마</strong> — 상담 없음</li></ul>";
const NA = "<h3>강사 나 선생님 · 1명</h3><ul><li><strong>학생 사</strong> — 결석 1회 · 초5 영어</li></ul>";
const LOOSE = "<h3>담당 미정 · 1명</h3><ul><li><strong>학생 차</strong></li></ul>";
const TAIL = "<h2>확인 부탁</h2><ul><li><p>보호자 연락 여부도 적어 주세요</p></li></ul><p></p>";
const BODY = INTRO + GA + NA + LOOSE + TAIL;
const NAMES = ["강사 가", "강사 나", "강사 다"];

describe("받는 사람마다 내용 — 선생님마다 자기 몫만", () => {
  it("맨 위 블록으로 나눈다(안쪽 목록 · 줄바꿈은 그대로, 맨 위 구분선은 한 블록)", () => {
    const html = "<p>가<br>나</p><ul><li>a<ul><li>b</li></ul></li></ul><hr><p style=\"text-align: center\">다</p>";
    expect(topBlocks(html)).toEqual(["<p>가<br>나</p>", "<ul><li>a<ul><li>b</li></ul></li></ul>", "<hr>", "<p style=\"text-align: center\">다</p>"]);
    expect(topBlocks(BODY).join("")).toBe(BODY);
  });
  it("선생님은 첫 문장 + 자기 이름 제목 아래 + 그 밖의 제목 아래만 받는다 — 다른 선생님 몫 · 담당 미정은 안 간다", () => {
    expect(bodyFor(BODY, "강사 가", NAMES)).toBe(INTRO + GA + TAIL);
    expect(bodyFor(BODY, "강사 나", NAMES)).toBe(INTRO + NA + TAIL);
    expect(bodyFor(BODY, "강사 나", NAMES)).not.toContain("학생 차");
  });
  it("내 이름 제목이 없으면 모두에게 가는 글만 — 다른 선생님 몫은 안 간다(미리보기가 알린다)", () => {
    expect(bodyFor(BODY, "강사 다", NAMES)).toBe(INTRO + TAIL);
    expect(lacksOwnPart(BODY, "강사 다", NAMES)).toBe(true);
    expect(lacksOwnPart(BODY, " 강사  가 ", NAMES)).toBe(false);
    expect(lacksOwnPart("<p>모두 같은 글</p>", "강사 다", NAMES)).toBe(false);
  });
  it("제목 이름 — 담당자끼리 같은 이름이면 과목(없으면 역할) · 그래도 같으면 id 순 순번(만들 때와 읽을 때가 같다)", () => {
    const people = [
      { id: "b", name: "김민지", role: "강사", subjects: ["수학"] }, { id: "a", name: "김민지", role: "강사", subjects: ["영어"] },
      { id: "d", name: "박하나", role: "강사", subjects: ["수학"] }, { id: "c", name: "박하나", role: "강사", subjects: ["수학"] },
      { id: "e", name: " 이  솔 ", role: "매니저", subjects: [] },
    ];
    expect([...recipientNames(people).entries()]).toEqual([["b", "김민지(수학)"], ["a", "김민지(영어)"], ["d", "박하나(2)"], ["c", "박하나(1)"], ["e", "이 솔"]]);
    const names = [...recipientNames(people).values()];
    const body = "<p>모두</p><h3>김민지(수학) 선생님 · 1명</h3><ul><li>수학 몫</li></ul><h3>김민지(영어) 선생님 · 1명</h3><ul><li>영어 몫</li></ul>";
    expect(bodyFor(body, "김민지(영어)", names)).toBe("<p>모두</p><h3>김민지(영어) 선생님 · 1명</h3><ul><li>영어 몫</li></ul>");
    // 꼬리표 없이 적은 동명이인 제목 — 누구인지 몰라 그 이름의 담당자 모두에게만(다른 담당자에게는 안 간다).
    const plain = "<p>모두</p><h2>김민지 선생님</h2><p>둘에게</p>";
    expect(bodyFor(plain, "김민지(수학)", names)).toBe(plain);
    expect(bodyFor(plain, "박하나(1)", names)).toBe("<p>모두</p>");
    expect(twinHeadings(plain, names)).toEqual(["김민지(수학) · 김민지(영어)"]);
    expect(lacksOwnPart(plain, "김민지(영어)", names)).toBe(false);
  });
  it("요청자가 쓴 '○○ 선생님' 제목은 그 선생님만 · 담당자가 아닌 이름의 선생님 제목은 모두에게 · 담당자가 아닌 사람의 묶음은 아무에게도", () => {
    const body = INTRO + GA + "<h2>강사 나 선생님</h2><p>나에게만</p>" + "<h2>담임 선생님</h2><p>모두에게</p>" + "<h3>강사 라 선생님 · 1명</h3><ul><li>라 몫</li></ul>";
    expect(bodyFor(body, "강사 나", NAMES)).toBe(INTRO + "<h2>강사 나 선생님</h2><p>나에게만</p><h2>담임 선생님</h2><p>모두에게</p>");
    expect(bodyFor(body, "강사 가", NAMES)).toBe(INTRO + GA + "<h2>담임 선생님</h2><p>모두에게</p>");
    expect(ownedBlocks(body, NAMES).at(-1)?.owner).toEqual({ to: "none" });
  });
  it("가를 제목이 없으면 모두 같은 글 — 옛 요청(글자만)도 그대로", () => {
    expect(splitsByRecipient(BODY, NAMES)).toBe(true);
    expect(splitsByRecipient("<p>가</p><h2>안내</h2><p>나</p>", NAMES)).toBe(false);
    expect(splitsByRecipient("강사 가 선생님 · 2명\n- 학생 사", NAMES)).toBe(false);
    expect(bodyFor("강사 가 선생님 · 2명\n- 학생 사", "강사 나", NAMES)).toBe("강사 가 선생님 · 2명\n- 학생 사");
  });
  it("에디터가 고친 모양(목록 줄 문단 · 가운데 정렬 제목)도 같은 몫", () => {
    const edited = `${INTRO}<h3 style="text-align: center">강사 가 선생님 · 2명</h3><ul><li><p><strong>학생 사</strong></p></li></ul>${NA}<p></p>`;
    expect(bodyFor(edited, "강사 가", NAMES)).toBe(`${INTRO}<h3 style="text-align: center">강사 가 선생님 · 2명</h3><ul><li><p><strong>학생 사</strong></p></li></ul>`);
  });
  it("담당자에게 내려줄 때 — 내 몫 글 · 내 학생 · 내 보고만, 전체를 보는 사람은 요청자 · 검토자 · 현황 권한", () => {
    const w2 = FIXTURE_WORK.items.find((i) => i.id === "w2")!;
    const mine = forAssignee(w2, "t1");
    expect(mine.links.map((l) => l.id)).toEqual(["s5"]);
    expect(mine.body).toContain("<h3>강사 나 선생님 · 2명</h3>");
    expect(mine.body).not.toContain("강사 가 선생님");
    expect(mine.body).not.toContain("담당 미정");
    // 남의 보고 글(맡은 학생 이름으로 시작한다)은 단계 · 사건 기록 어디에도 안 간다 — 상태 · 결과 · 시각은 그대로.
    expect(JSON.stringify(mine)).not.toContain("학생 아");
    expect(mine.steps.map((s) => [s.user.id, s.state, s.outcome, s.reportedAt])).toEqual(w2.steps.map((s) => [s.user.id, s.state, s.outcome, s.reportedAt]));
    expect(mine.steps.find((s) => s.user.id === "t1")?.note).toBe("학생 사: 학교 시험 · 보호자 통화함");
    expect(mine.events.map((e) => e.note)).toEqual([null, null, "학생 사: 학교 시험 · 보호자 통화함", null]);
    // 보완 요청 기록은 내게 온 글(내 단계에 남은 글)과 같을 때만.
    const returned = { ...w2, steps: w2.steps.map((s) => ({ ...s, state: "acked" as const, returnedNote: "보강 날짜를 적어 주세요", returned: true })),
      events: [...w2.events, { at: "2026-11-02T07:00:00Z", actor: "원장 가", actorId: "u0", kind: "returned" as const, note: "보강 날짜를 적어 주세요" }, { at: "2026-11-02T07:01:00Z", actor: "원장 가", actorId: "u0", kind: "returned" as const, note: "강사 가만: 상담 기록도" }] };
    expect(forAssignee(returned, "t1").events.slice(-2).map((e) => e.note)).toEqual(["보강 날짜를 적어 주세요", null]);
    expect(forAssignee(returned, "t1").steps.find((s) => s.user.id === "t0")?.returnedNote).toBeNull();
    // 남의 보완 글을 비워도 상태 문구는 보는 사람마다 같다(표식 `returned`).
    const onlyT0 = { ...w2, status: "working" as const, steps: w2.steps.map((s) => (s.user.id === "t0" ? { ...s, state: "acked" as const, returnedNote: "강사 가만: 상담 기록도", returned: true } : s)) };
    expect(statusText(forAssignee(onlyT0, "t1"))).toBe(statusText(onlyT0));
    expect(statusText(onlyT0)).toBe("보완 중");
    // 이모지가 섞인 1,000자 넘는 보완 글도 내게 온 것이면 남는다(DB는 글자 단위로 자른다).
    const long = "😀".repeat(1200);
    const emoji = { ...w2, steps: w2.steps.map((s) => (s.user.id === "t1" ? { ...s, state: "acked" as const, returnedNote: "😀".repeat(1000), returned: true } : s)),
      events: [{ at: "2026-11-02T07:00:00Z", actor: "원장 가", actorId: "u0", kind: "returned" as const, note: long }] };
    expect(forAssignee(emoji, "t1").events[0]?.note).toBe(long);
    expect(seesAll(w2, "u0", false)).toBe(true);
    expect(seesAll(w2, "t1", false)).toBe(false);
    expect(seesAll(w2, "t1", true)).toBe(true);
    expect(seesAll({ ...w2, reviewer: w2.steps[0]!.user }, "t0", false)).toBe(true);
    expect(seesAll(w2, null, false)).toBe(false);
  });
});
