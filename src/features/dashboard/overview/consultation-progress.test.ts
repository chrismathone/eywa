/**
 * 운영실 '상담 진행'(원장 2026-09-22) — 단계 판정·칩·멈춘 상담·단계별 인원을 잠근다.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  chipOf,
  progressOf,
  stallOf,
  summarizeProgress,
  type ProgressConsultation,
  type ProgressEnrollment,
} from "./consultation-progress";

const TODAY = "2026-09-22";
const base: ProgressConsultation = {
  id: "c1",
  name: "정윤혁",
  outcome: "consulted",
  consultedOn: "2026-09-20",
  subject: "english",
  classKeys: ["english"],
  studentId: null,
};
const enr = (subject: string | null, startDate: string | null, studentId = "s1"): ProgressEnrollment => ({
  studentId,
  subject,
  startDate,
});

describe("progressOf — 칸반과 같은 단계", () => {
  it("배정이 없으면 outcome 칸 그대로(상담 전·상담 완료·미등록·등록)", () => {
    expect(progressOf({ ...base, outcome: "pending" }, [], [], TODAY).stage).toBe("before");
    expect(progressOf({ ...base, outcome: "ai_done" }, [], [], TODAY).stage).toBe("consulted");
    expect(progressOf({ ...base, outcome: "no_show" }, [], [], TODAY).stage).toBe("unregistered");
    expect(progressOf({ ...base, outcome: "enrolled" }, [], [], TODAY).stage).toBe("enrolled");
  });

  it("상담 과목의 미종료 수강이 있으면 outcome과 무관하게 등록(칸반 '반 배정 완료')", () => {
    const p = progressOf({ ...base, studentId: "s1" }, [enr("english", "2026-10-01")], [], TODAY);
    expect(p.stage).toBe("enrolled");
    expect(p.assigned).toBe(true);
    expect(p.started).toBe(false);
    expect(p.firstClassOn).toBe("2026-10-01");
  });

  it("다른 과목 수강은 이 상담의 배정이 아니다 · 과목이 없으면 전체 수강으로(칸반 폴백)", () => {
    expect(progressOf({ ...base, studentId: "s1" }, [enr("math", "2026-09-01")], [], TODAY).assigned).toBe(false);
    expect(progressOf({ ...base, studentId: "s1", subject: null, classKeys: null }, [enr("math", "2026-09-01")], [], TODAY).assigned).toBe(true);
  });

  it("옛 이관 글자도 칸반과 같은 반 과목 키로 판정 — 'EIE' 상담은 영어 반 · 못 읽는 글자는 배정 없음", () => {
    expect(progressOf({ ...base, studentId: "s1", subject: "EIE", classKeys: ["english"] }, [enr("english", "2026-09-01")], [], TODAY).stage).toBe("enrolled");
    expect(progressOf({ ...base, studentId: "s1", subject: "영수", classKeys: [] }, [enr("math", "2026-09-01")], [], TODAY).assigned).toBe(false);
  });

  it("서버가 칸반과 같은 판정(consultClassKeys)으로 반 과목 키를 만든다 — 운영실·매일 기록(ops-daily) 공용", () => {
    const server = readFileSync("src/features/dashboard/overview/consultation-progress-server.ts", "utf8");
    expect(server).toContain("classKeys: classKeysOf(c.subject)");
    expect(server).toContain("deps ? getTenantSettingsByTenantId(deps.tenantId) : getTenantSettings()");
    expect(server).toContain("class:class_id!inner ( subject )");
  });

  it("시작일이 오늘 이전·오늘·모름이면 수업 시작", () => {
    for (const start of ["2026-09-01", TODAY, null]) {
      expect(progressOf({ ...base, studentId: "s1" }, [enr("english", start)], [], TODAY).started).toBe(true);
    }
  });

  it("상담 = 상담 완료·등록 칸 + 거절. 노쇼·상담 전은 아니다", () => {
    expect(progressOf({ ...base, outcome: "declined" }, [], [], TODAY).consulted).toBe(true);
    expect(progressOf({ ...base, outcome: "no_show" }, [], [], TODAY).consulted).toBe(false);
    expect(progressOf({ ...base, outcome: "scheduled" }, [], [], TODAY).consulted).toBe(false);
  });

  it("입테 — 오늘 포함 가장 최근(last) · 내일부터 가장 이른(next) · 모르면 null", () => {
    expect(progressOf(base, [], ["2026-09-25", "2026-09-10", TODAY], TODAY).levelTest).toEqual({ last: TODAY, next: "2026-09-25" });
    expect(progressOf(base, [], null, TODAY).levelTest).toBeNull();
  });
});

describe("chipOf — 지금 단계 + 다음 일정", () => {
  const chip = (c: Partial<ProgressConsultation>, e: ProgressEnrollment[] = [], lt: string[] | null = []) =>
    chipOf(progressOf({ ...base, ...c }, e, lt, TODAY), TODAY);

  it("상담 전·상담 완료에 입테 일정을 붙인다(오늘 · 다음 날짜 · 끝)", () => {
    expect(chip({ outcome: "pending" }, [], ["2026-09-23"])).toMatchObject({ label: "상담 전", detail: "입테 9/23", color: "amber" });
    expect(chip({}, [], [TODAY])).toMatchObject({ label: "상담 완료", detail: "입테 오늘", color: "blue" });
    expect(chip({}, [], ["2026-09-15"])).toMatchObject({ label: "상담 완료", detail: "입테 끝" });
    expect(chip({}, [], null).detail).toBeNull();
  });

  it("등록 뒤 세 갈래 — 반 배정 전 / 반 배정(첫 수업 날짜) / 수업 시작", () => {
    expect(chip({ outcome: "enrolled" })).toMatchObject({ label: "등록", detail: "반 배정 전", color: "green" });
    expect(chip({ studentId: "s1" }, [enr("english", "2026-10-01")])).toMatchObject({ label: "반 배정", detail: "첫 수업 10/1" });
    expect(chip({ studentId: "s1" }, [enr("english", "2026-09-01")])).toMatchObject({ label: "수업 시작", detail: null });
  });

  it("미등록은 날짜를 안 붙인다", () => {
    expect(chip({ outcome: "declined" }, [], ["2026-09-25"])).toMatchObject({ label: "미등록", detail: null, color: "neutral" });
  });
});

describe("stallOf — 결정이 안 난 채 기다리는 건", () => {
  const stall = (c: Partial<ProgressConsultation>, lt: string[] | null = [], e: ProgressEnrollment[] = []) =>
    stallOf(progressOf({ ...base, ...c }, e, lt, TODAY), TODAY);

  it("상담 완료 뒤 7일을 넘기면 멈춤(7일째는 아직)", () => {
    expect(stall({ consultedOn: "2026-09-15" })).toBeNull();
    expect(stall({ consultedOn: "2026-09-14" })).toMatchObject({ reason: "consulted", days: 8, label: "상담 완료 8일째 · 결정 없음" });
  });

  it("입테가 지나고 3일을 넘기면 멈춤 — 상담 전 상태여도(입테는 치렀다)", () => {
    expect(stall({ consultedOn: TODAY }, ["2026-09-19"])).toBeNull();
    expect(stall({ outcome: "pending", consultedOn: "2026-09-01" }, ["2026-09-18"])).toMatchObject({ reason: "levelTest", days: 4 });
  });

  it("입테가 잡혀 있거나 최근에 치렀으면 기다리는 중이라 멈춤이 아니다", () => {
    expect(stall({ consultedOn: "2026-09-01" }, ["2026-09-24"])).toBeNull();
    expect(stall({ consultedOn: "2026-09-01" }, ["2026-09-21"])).toBeNull();
  });

  it("등록·배정·미등록·상담 전(입테 없음)은 멈춤이 아니다", () => {
    expect(stall({ outcome: "enrolled", consultedOn: "2026-08-01" })).toBeNull();
    expect(stall({ studentId: "s1", consultedOn: "2026-08-01" }, [], [enr("english", "2026-10-01")])).toBeNull();
    expect(stall({ outcome: "declined", consultedOn: "2026-08-01" }, ["2026-08-05"])).toBeNull();
    expect(stall({ outcome: "pending", consultedOn: "2026-08-01" })).toBeNull();
  });

  it("입테를 모르면(null) 상담 쪽 규칙만", () => {
    expect(stall({ consultedOn: "2026-09-01" }, null)).toMatchObject({ reason: "consulted", days: 21 });
  });
});

describe("summarizeProgress — 단계별 인원(30일)과 멈춘 상담(넘겨받은 60일 전부)", () => {
  const list = [
    progressOf({ ...base, id: "a", consultedOn: "2026-09-22", outcome: "pending" }, [], [], TODAY),
    progressOf({ ...base, id: "b", consultedOn: "2026-09-10" }, [], ["2026-09-12"], TODAY),
    progressOf({ ...base, id: "c", consultedOn: "2026-08-24", studentId: "s1" }, [enr("english", "2026-09-01")], [], TODAY),
    // 31일 전 — 인원에서 빠지고 멈춤 판정엔 남는다
    progressOf({ ...base, id: "d", name: "송보경", consultedOn: "2026-08-22" }, [], [], TODAY),
  ];

  it("창 첫날 = 오늘 포함 30일 · 각 단계는 닿은 수", () => {
    const sum = summarizeProgress(list, TODAY, true);
    expect(sum.from).toBe("2026-08-24");
    expect(sum.counts).toEqual({ received: 3, consulted: 2, levelTest: 1, enrolled: 1, assigned: 1, started: 1 });
  });

  it("입테를 모르면 null(0으로 적지 않는다)", () => {
    expect(summarizeProgress(list, TODAY, false).counts.levelTest).toBeNull();
  });

  it("멈춘 상담은 오래된 순 — 30일 창 밖도 포함", () => {
    expect(summarizeProgress(list, TODAY, true).stalled.map((x) => x.id)).toEqual(["d", "b"]);
  });
});

describe("배선 — 칩과 카드는 한 표를 읽는다", () => {
  const read = (p: string) => readFileSync(p, "utf8");
  it("서버: 일정 카드와 같은 상담 조회를 공유하고, 판정은 consultProgress 한 곳", () => {
    const server = read("src/features/dashboard/overview/server.ts");
    expect(server).toContain('addSliced("consultProgress", ["enrollment"]');
    expect(server).toContain("consultationRows!");
    expect(server.match(/admissionsConsultationCandidates\(consultationSince\)/g)?.length).toBe(1);
  });
});
