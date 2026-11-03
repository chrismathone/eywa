import { describe, expect, it } from "vitest";
import { taskKindLabel } from "@/features/staff-tasks/kinds";
import { FIXTURE_WORK } from "@/features/work-requests/testing/fixture";
import { checkRows } from "./check-board";
import { buildSecretaryPrompt, changedSince, groundSecretary, secretaryInput } from "./secretary-ai";
import { consultProgressDetail } from "./consult-progress-detail";
import { overdue, personDetail, secretaryDetails } from "./secretary-details";
import { isOverlap, peopleLoad, studentSignals, studentsOf } from "./secretary-facts";
import { autoPlan, secretaryBrief, studentLine } from "./secretary-plan";
import { ALL_KINDS, assigneeSections } from "./request-body";
import { overlapPrefill, personPrefill, requestFor } from "./secretary-requests";
import { FIXTURE_EXTRAS, FIXTURE_SNAPSHOT } from "./testing/fixture";

const ctx = { snapshot: FIXTURE_SNAPSHOT, extras: FIXTURE_EXTRAS, amounts: true, subjects: [], eieOn: true, can: () => true };
const rows = checkRows(ctx);
const signals = studentSignals(ctx);
const people = peopleLoad(signals, FIXTURE_EXTRAS, FIXTURE_WORK, FIXTURE_SNAPSHOT.today);
const brief = secretaryBrief(ctx, rows, FIXTURE_WORK, true);
const t0 = people.find((p) => p.id === "t0")!;

describe("업무 비서 재료 — 신호마다 책임진 담임", () => {
  it("겹친 학생 = 결석 · 숙제 중 하나 + 다른 신호 하나(무게 순)", () => {
    expect(signals.filter(isOverlap).map((s) => s.id)).toEqual(["s5", "s2", "s3"]);
    const s5 = signals.find((s) => s.id === "s5")!;
    // 결석은 반마다(두 반 · 두 담임), 숙제는 숙제가 나온 반의 담임만.
    expect(s5.absence?.by.map((b) => [b.id, b.dates.length])).toEqual([["t0", 2], ["t1", 1]]);
    expect(s5.homework?.by.map((b) => b.id)).toEqual(["t0"]);
    expect(s5.consult).toBeNull(); // 지난달엔 담임이 상담했다(prev self)
  });
  it("사람마다 그 사람 몫만 — 다른 반의 신호를 섞지 않는다", () => {
    expect([t0.absence, t0.homework, t0.consult]).toEqual([["s5", "s6"], ["s5", "s3"], ["s3"]]);
    const t1 = people.find((p) => p.id === "t1")!;
    expect([t1.absence, t1.homework, t1.consult]).toEqual([["s5"], ["s2"], ["s2"]]);
    expect(t0.lateKinds).toEqual([{ label: taskKindLabel("attendance_absent_desk"), late: 1 }]);
    expect(people[0]!.id).toBe("t0");
    expect(people.find((p) => p.id === "u2")?.work).toEqual({ open: 1, late: 0 });
  });
});

describe("업무 비서 후보 · 자동 정리", () => {
  it("내 차례 → 겹친 학생 순 · 월초 담임 상담은 미뤄도 되는 것", () => {
    expect(brief.auto.steps.slice(0, 3).map((s) => s.ref)).toEqual(["review", "report", "overlap"]);
    expect(brief.auto.later.map((l) => l.ref)).toEqual(["homeroom"]);
    expect(brief.auto.steps.some((s) => s.ref === "homeroom")).toBe(false);
    expect(brief.auto.headline).toContain("검토할 업무 요청 1건");
  });
  it("사람 후보는 가장 많이 몰린 것을 제목에, 나머지를 이유에", () => {
    const c = brief.candidates.find((x) => x.ref === "person:t0")!;
    expect(c.title).toBe("강사 가 선생님 · 반복 결석 2명");
    expect(c.why).toContain("반복 결석 학생 2명(학생 사 · 학생 아)이 가장 많습니다.");
    expect(c.why).toContain("기한 지난 할 일 1건");
    expect(c.label).toBe("한 번에 요청");
    expect(c.detail).toBe("person:t0");
  });
  it("요청할 수 없는 사람에겐 명단 보기", () => {
    const viewOnly = secretaryBrief(ctx, rows, FIXTURE_WORK, false);
    expect(viewOnly.candidates.find((c) => c.ref === "overlap")?.action).toEqual({ kind: "detail", key: "secretary:overlap" });
  });
  it("학생 한 줄은 신호마다 반 · 담임 · 날짜를 함께 적는다", () => {
    expect(studentLine(signals.find((s) => s.id === "s5")!)).toBe("학생 사(A중2) — 결석 3회(중2 수학 A 강사 가 10/26 · 10/28 / 초5 영어 강사 나 10/30) · 숙제 60% 미만 1/2회(0% 1회 · 중2 수학 A 강사 가)");
  });
});

describe("업무 비서 요청 초안", () => {
  it("겹친 학생은 신호가 난 반의 담임마다", () => {
    const p = overlapPrefill(signals, FIXTURE_SNAPSHOT.today)!;
    expect(p.students).toEqual([
      { id: "s5", name: "학생 사", assigneeId: "t0" }, { id: "s5", name: "학생 사", assigneeId: "t1" },
      { id: "s2", name: "학생 라", assigneeId: "t1" }, { id: "s3", name: "학생 마", assigneeId: "t0" },
    ]);
    expect(p.assigneeIds).toEqual(["t0", "t1"]);
    expect(p.dueOn).toBe("2026-11-04");
  });
  it("사람 묶음은 그 사람에게 그 사람 몫 학생만 · 결석일은 그 사람 반만", () => {
    const p = personPrefill(t0, signals, FIXTURE_SNAPSHOT.today)!;
    expect(p.assigneeIds).toEqual(["t0"]);
    expect(p.students?.map((s) => s.id).sort()).toEqual(studentsOf(t0).sort());
    // 학생 사의 영어 반 결석(10/30 · 강사 나)은 강사 가에게 가지 않는다.
    expect(p.body).toContain("<h3>반복 결석 · 2명</h3>");
    expect(p.body).toContain("<li><strong>학생 사</strong> A중2 — 결석 2회 · 중2 수학 A 10/26 · 10/28</li>");
    expect(p.body).not.toContain("초5 영어");
    // 상담만 다루는 묶음은 줄에서 '담임 상담 없음'을 되풀이하지 않는다.
    expect(p.body).toContain("<li><strong>학생 마</strong> A중2 — 마지막 담임 상담 9/2</li>");
    expect(requestFor("person:t0", ctx, signals, people)?.title).toBe(p.title);
    expect(requestFor("absence", ctx, signals, people)?.source).toBe("check:absence");
  });
  it("겹친 학생 내용은 담당자별 — 그 담당자 몫의 반 · 날짜만, 다른 담당자 몫은 한 줄", () => {
    const body = overlapPrefill(signals, FIXTURE_SNAPSHOT.today)!.body!;
    const [intro, ga, na] = body.split("<h3>");
    // 첫 문장은 모두가 받는다 — 전체 인원 수는 없고, 수는 선생님마다 자기 이름 제목에.
    expect(intro).toBe("<p>결석 · 숙제 · 상담 가운데 두 가지 이상이 겹친 학생입니다. 맡은 학생마다 사유를 확인하고 다음 계획을 보고해 주세요.</p>");
    expect(ga).toContain("강사 가 선생님 · 2명</h3>");
    expect(ga).toContain("<li><strong>학생 사</strong> A중2<ul><li>결석 2회 · 중2 수학 A 10/26 · 10/28</li><li>숙제 60% 미만 1/2회(0% 1회) · 중2 수학 A</li><li>함께 겹친 신호 — 결석 1회(강사 나)</li></ul></li>");
    expect(ga).not.toContain("초5 영어 10/30");
    expect(na).toContain("강사 나 선생님 · 2명</h3>");
    expect(na).toContain("<li>결석 1회 · 초5 영어 10/30</li><li>함께 겹친 신호 — 결석 2회(강사 가) · 숙제 60% 미만(강사 가)</li>");
  });
  it("확인할 일 줄 요청도 같은 묶음 — 근거 학생과 같은 담당자 아래 그 반 날짜", () => {
    const p = requestFor("absence", ctx, signals, people)!;
    expect(p.body?.startsWith("<p>사전 통보 없이 3회 이상 결석한 학생입니다. 맡은 학생의")).toBe(true);
    const [, ga, na] = p.body!.split("<h3>");
    expect(ga).toContain("강사 가 선생님 · 2명</h3>");
    expect(na).toBe("강사 나 선생님 · 1명</h3><ul><li><strong>학생 사</strong> A중2 — 결석 1회 · 초5 영어 10/30</li></ul>");
  });
  it("근거 학생 담당이 바뀌면 같은 규칙으로 다시 짓는다 — 빠진 담당자의 학생은 담당 미정 묶음으로", () => {
    const p = requestFor("absence", ctx, signals, people)!;
    const noStaff = () => undefined; // 직원 이름을 못 찾으면 신호의 담임 이름으로 — 처음 지은 글과 같다
    expect(p.rebody!(p.students!, noStaff)).toBe(p.body);
    // 강사 나를 담당자에서 빼면(만들기 창이 담당자 밖 학생을 담당 미정으로 넘긴다) 강사 나 묶음이 사라진다.
    const next = p.rebody!(p.students!.map((s) => ({ ...s, assigneeId: s.assigneeId === "t1" ? null : s.assigneeId })), noStaff);
    expect(next).not.toContain("강사 나 선생님");
    expect(next).toContain("<h3>담당 미정 · 1명</h3>");
    expect(overlapPrefill(signals, FIXTURE_SNAPSHOT.today)!.rebody).toBeTypeOf("function");
  });
  it("한도를 넘으면 목록 줄 단위로 멈추고 안내 한 줄은 묶음 앞에(모두가 받는다 · 태그를 자르지 않는다)", () => {
    const p = overlapPrefill(signals, FIXTURE_SNAPSHOT.today)!;
    const out = assigneeSections(p.students!, signals, { kinds: ALL_KINDS, context: true, budget: 260 });
    expect(out.length).toBeLessThanOrEqual(260 + 120);
    expect(out.startsWith("<p>글이 길어 일부 학생은 내용에 적지 못했습니다 — 담당자별 근거 학생에는 모두 있습니다.</p><h3>")).toBe(true);
    expect(out.split("<ul>").length).toBe(out.split("</ul>").length);
    expect(out.split("<li>").length).toBe(out.split("</li>").length);
  });
});

describe("업무 비서 상세", () => {
  it("사람 상세는 몰린 것마다 표 · 위 수치와 같은 수", () => {
    const d = personDetail(t0, signals, ctx, FIXTURE_SNAPSHOT.requestedAt);
    expect(d.title).toBe("강사 가 선생님에게 몰린 일");
    expect(d.period).toBe("반복 결석 14일 · 숙제 최근 7일 · 담임 상담 지난달부터 · 할 일 기한 지남");
    expect(secretaryDetails(ctx)["person:u1"]?.period).toBe("할 일 기한 지남");
    expect(d.stats).toEqual([["반복 결석", "2명"], ["숙제 60% 미만", "2명"], ["상담 빠진 학생", "1명"], ["기한 지난 할 일", "1건"]]);
    expect(d.tables.map((t) => [t.title, t.rows.length])).toEqual([["반복 결석", 2], ["숙제 60% 미만", 2], ["상담 빠진 학생", 1], ["기한 지난 할 일", 1]]);
    // 학생 사의 영어 반 결석(강사 나)은 강사 가 몫이 아니다.
    expect(d.tables[0]!.rows.find((r) => r.cells[0]!.startsWith("학생 사"))?.cells.slice(1, 5)).toEqual(["중2 수학 A", "2회", "10/26 · 10/28", "3회"]);
  });
  it("기한 지난 할 일은 건마다 처리 화면으로(링크가 없는 할 일은 글만)", () => {
    const tasks = secretaryDetails(ctx)["person:u1"]!.tables.find((t) => t.title === "기한 지난 할 일")!;
    expect(tasks.cols).toEqual(["종류", "할 일", "기한"]);
    expect(tasks.rows.map((r) => [r.cells[1], r.cells[2], r.href ?? null])).toEqual([
      ["학생 가 10/30 보고서 발송 실패", "1일 지남", "/lesson-reports?status=failed"],
      ["학생 나 10/31 보고서 발송 실패", "5시간 지남", null],
    ]);
    expect(overdue("2026-11-02T08:00:00Z", Date.UTC(2026, 10, 2, 8, 5))).toBe("1시간 지남");
  });
  it("상담 진행 — 단계는 막대 하나 · 멈춘 상담은 단계마다 표", () => {
    const d = consultProgressDetail(FIXTURE_SNAPSHOT.sections.consultProgress!.data!, ctx);
    expect(d.stats).toEqual([["접수", "28건"], ["등록", "9건"], ["수업 시작", "6건"], ["멈춘 상담", "1건"]]);
    expect(d.trend?.labels).toEqual(["접수", "상담", "입테", "등록", "반 배정", "수업 시작"]);
    expect(d.trend?.series[0]?.values).toEqual([28, 22, 14, 9, 8, 6]);
    expect(d.tables.map((t) => [t.title, t.cols[2], t.rows.map((r) => [r.cells[0], r.cells[2]])])).toEqual([["입테 뒤 등록 없음", "입테 뒤", [["상담 가", "9일"]]]]);
  });
  it("겹친 학생 · 사람 상세 키", () => {
    const all = secretaryDetails(ctx);
    expect(Object.keys(all).filter((k) => k.startsWith("person:")).sort()).toEqual(["person:t0", "person:t1", "person:u1"]);
    expect(all["secretary:overlap"]?.tables[0]?.rows[0]?.cells.slice(1, 3)).toEqual(["3회 · 강사 가 · 강사 나", "1/2회 · 강사 가"]);
  });
});

describe("AI 정리 — 후보에서만 · 자료에 있는 말만", () => {
  const input = secretaryInput(brief, FIXTURE_SNAPSHOT.today, "월", 2);
  it("프롬프트에 후보 ref · 근거 · 처리 방식", () => {
    const prompt = buildSecretaryPrompt(input);
    expect(prompt).toContain("ref=overlap · 결석·숙제·상담이 겹친 학생 3명 · 처리: 담당자에게 업무 요청");
    expect(prompt).toContain("2026-11-02(월) · 이번 달 2일째");
  });
  it("모르는 ref는 버리고 걸린 문장은 그 줄만 자동 문장으로", () => {
    const out = groundSecretary({
      headline: "겹친 학생부터 담임에게 맡기세요.",
      steps: [
        { ref: "overlap", title: "겹친 학생 3명 맡기기", why: "학생 사는 결석 3회에 숙제도 1/2회 60% 미만입니다." },
        { ref: "overlap", title: "중복", why: "같은 ref는 한 번만 씁니다." },
        { ref: "없는것", title: "지어낸 일", why: "후보에 없는 일입니다." },
        { ref: "tasks", title: "할 일 987건 정리", why: "자료에 없는 숫자입니다." },
        { ref: "absence", title: "AI 판단으로 결석 정리", why: "영어 단어가 섞였습니다." },
        { ref: "person:t0", title: "강사 가 선생님에게 맡기기", why: "김철수 선생님이 대신 볼 수 있습니다." },
      ],
      later: [{ ref: "homeroom", why: "월초라 이번 달 상담률은 낮게 보입니다." }, { ref: "overlap", why: "이미 단계에 있다." }],
    }, input)!;
    expect(out.plan.steps.map((s) => s.ref)).toEqual(["overlap", "tasks", "absence", "person:t0"]);
    expect(out.plan.steps[0]!.title).toBe("겹친 학생 3명 맡기기");
    expect(out.plan.steps.slice(1).map((s) => s.title)).toEqual(["tasks", "absence", "person:t0"].map((r) => brief.candidates.find((c) => c.ref === r)!.title));
    expect(out.replaced).toBe(3);
    expect(out.plan.later.map((l) => l.ref)).toEqual(["homeroom"]);
  });
  it("쓸 단계가 없으면 실패 · 한 줄이 걸리면 자동 한 줄", () => {
    expect(groundSecretary({ steps: [{ ref: "없는것", title: "x", why: "xxxxx" }] }, input)).toBeNull();
    expect(groundSecretary("문장", input)).toBeNull();
    const out = groundSecretary({ headline: "OK 오늘은 이것부터", steps: [{ ref: "overlap", title: "겹친 학생 맡기기", why: "신호가 겹친 학생입니다." }] }, input)!;
    expect(out.plan.headline).toBe("오늘 먼저 할 일은 1가지입니다 — 겹친 학생 맡기기부터 보시면 됩니다.");
  });
  it("정리한 뒤 바뀐 후보를 알린다", () => {
    const counts = Object.fromEntries(input.candidates.map((c) => [c.ref, c.count]));
    expect(changedSince({ counts }, brief.candidates)).toEqual([]);
    const later = brief.candidates.map((c) => (c.ref === "absence" ? { ...c, count: 5, title: "반복 결석 학생 5명" } : c));
    expect(changedSince({ counts: { ...counts, absence: 2 } }, later)).toEqual(["반복 결석 학생 2 → 5"]);
    expect(changedSince({ counts: {} }, brief.candidates.slice(0, 1))).toEqual([`새로 생김: ${brief.candidates[0]!.title}`]);
    expect(changedSince({ counts: {} }, brief.candidates.filter((c) => c.ref.startsWith("person:")))).toEqual([]);
  });
  it("자동 정리는 같은 후보로 언제든 다시 만든다", () => {
    expect(autoPlan(brief.candidates, "2026-11-20").later).toEqual([]);
  });
});
