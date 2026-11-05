/**
 * 강사뷰 신원 — 운영 화면 묶음(2026-11-05 원장 *"강사뷰 전환시에 실제 그 사람으로 완벽하게 전환되는지 … 모든 면에서 빠짐없이"*).
 *
 * 메뉴 권한은 이미 대상 강사 X의 것인데(perm-matrix `getUserPermMatrix`), '내 반·담당·소유'와 기록 명의를 실제 계정 A로 정하던
 * 자리를 X로 옮겼다. 단위 테스트가 어려운 화면(서버 컴포넌트)과 얇은 액션 배선을 여기서 잠근다 — 되돌아가면 X의 화면에서
 * 업무가 막히거나(404·"담당 반이 아닙니다") 기록이 A 명의로 남는다.
 * 판정 단위 테스트: classes/server/class-scope.test.ts · attendance/live/server/teacher-view-identity.test.ts ·
 * attendance/seat/server/gate-teacher-view.test.ts · shuttle/server/teacher-view-identity.test.ts · progress/server/anomaly-actions.test.ts ·
 * students/server/homework-video-stream.test.ts · enrollments/server/date-access.test.ts · students/server/status-access.test.ts ·
 * class-sheets/server/viewer-prefs.test.ts · onescreen/teacher-view-video-owner.test.ts.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (...p: string[]) => readFileSync(join(process.cwd(), "src", ...p), "utf8");
/** 주석은 규칙을 설명하는 자리라 뺀다(경고 문구가 스스로 걸리지 않게). */
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
/** `export async function name(` 부터 다음 함수 선언 전까지. */
function fnBody(src: string, name: string): string {
  const at = src.search(new RegExp(`(?:export )?(?:async )?function ${name}\\s*\\(`));
  expect(at, name).toBeGreaterThan(-1);
  const next = src.slice(at + 1).search(/\n(?:export )?(?:async )?function |\nexport const /);
  return src.slice(at, next === -1 ? undefined : at + 1 + next);
}
const TARGET = "getCurrentUser({ teacherView: true })";

describe("반 — 담당 판정·명의는 화면 주인", () => {
  it("위임 게이트(created_by·revoked_by·알림 actor)가 대상 강사로 판정한다", () => {
    expect(fnBody(code(read("features", "classes", "server", "actions.ts")), "requireDelegationWrite")).toContain(TARGET);
  });

  it("반 레벨 변경도 같은 신원으로 담임을 본다", () => {
    expect(fnBody(code(read("features", "timetable", "server", "actions.ts")), "changeClassLevel")).toContain(TARGET);
  });

  it("순수 판정의 userId 설명이 열람 전용 시절 규칙('강사뷰 대상 강사 id가 아니다')으로 돌아가지 않는다", () => {
    const src = read("features", "classes", "class-write-scope.ts");
    expect(src).not.toContain("강사뷰 대상 강사 id가 아니다");
    expect(src).toContain(TARGET);
  });
});

describe("출결 — 자리 출석부 화면은 쓰기 게이트와 같은 신원", () => {
  it("하루 화면: 담당 토글은 화면 주인, 읽기 강사뷰는 토글 갈래를 끈다, presence 축(planMeta)은 실제 계정", () => {
    const page = code(read("app", "(shell)", "attendance", "seat", "[seat]", "page.tsx"));
    expect(page).toContain(`const owner = (await ${TARGET}) ?? user;`);
    expect(page).toContain("getActiveSeatDuties(owner.id, owner.tenantId)");
    expect(page).toContain("const dutyWrite = onDuty && !(await readonlyTeacherViewError());");
    expect(page).toContain('const canSeatWrite = dutyWrite || (await canWriteTenant(user.systemRole, "seat_attendance"));');
    expect(page).toContain("planMeta={{ tenantId: user.tenantId, userId: user.id");
  });

  it.each([
    ["app", "(shell)", "attendance", "seat", "[seat]", "month", "page.tsx"],
    ["app", "(print)", "attendance", "seat", "[seat]", "month", "print", "page.tsx"],
  ])("월간·인쇄 화면도 화면 주인의 토글로 연다 — %s", (...seg) => {
    const page = code(read(...seg));
    expect(page).toContain(`const user = await ${TARGET};`);
    expect(page).toContain("getActiveSeatDuties(user.id, user.tenantId)");
  });

  it("결석 통보 접수(알림 접수자)·출결 요약(requested_by)도 화면 주인 명의", () => {
    expect(fnBody(code(read("features", "attendance", "intake", "server", "actions.ts")), "recordAbsenceIntake")).toContain(TARGET);
    expect(fnBody(code(read("features", "attendance", "recap", "server", "actions.ts")), "generateRecapSummary")).toContain(TARGET);
  });
});

describe("출석부 — 원장 전용 금액·급여명세서 버튼은 화면 주인 기준", () => {
  const page = code(read("app", "(shell)", "attendance", "page.tsx"));

  it("정산액·명세서 판정이 실제 계정 역할로 돌아가지 않는다", () => {
    expect(page).toContain(`const viewer = (await ${TARGET}) ?? user;`);
    expect(page.split('viewer.systemRole === "master"').length - 1).toBe(2);
    expect(page).not.toContain('user.systemRole === "master"');
    expect(page).toContain("await canViewPayslipNow(viewer)");
    expect(page).not.toContain("canViewPayslipNow(user)");
  });
});

describe("보강 상세 — 화면의 '내가 실시한 수업'은 저장 액션과 같은 사람", () => {
  it("actorId가 화면 주인", () => {
    const page = code(read("app", "(shell)", "makeups", "[id]", "page.tsx"));
    expect(page).toContain(TARGET);
    expect(page).toContain("actorId={(owner ?? actor).id}");
    expect(page).not.toContain("actorId={actor.id}");
  });
});

describe("진도 이상 확인 — 버튼 노출도 서버와 같은 사람", () => {
  it("패널의 담당 판정이 화면 주인", () => {
    expect(fnBody(code(read("features", "progress", "components", "progress-panel.tsx")), "ProgressContainerPanel")).toContain(TARGET);
  });
});

describe("셔틀 — 기록 명의는 자격(canRecordBoarding)과 같은 사람", () => {
  const actions = code(read("features", "shuttle", "server", "actions.ts"));
  it.each(["gate", "recordGate"])("%s — 명의(created_by·recorded_by·started_by·ended_by)", (fn) => {
    expect(fnBody(actions, fn)).toContain(TARGET);
  });
  it("그날 등하원 변경(actorName·created_by) · 변경 내역 확인(acked_by) · 차량 위치(sent_by)", () => {
    expect(fnBody(code(read("features", "shuttle", "ride-change", "server", "staff-ride-gate.ts")), "staffDayGate")).toContain(TARGET);
    expect(fnBody(code(read("features", "shuttle", "ride-change", "server", "history-ack-actions.ts")), "ackShuttleHistory")).toContain(TARGET);
    expect(fnBody(code(read("features", "shuttle", "map", "server", "vehicle-position-actions.ts")), "reportVehiclePosition")).toContain(TARGET);
  });
});

describe("숙제 영상 AI 참고 메모 — 다시 분석은 대상 명의라 읽기 강사뷰를 먼저 막는다", () => {
  it("rerunVideoReview 맨 앞의 readonlyTeacherViewError", () => {
    const body = fnBody(code(read("features", "video-review", "server", "actions.ts")), "rerunVideoReview");
    expect(body.indexOf("readonlyTeacherViewError()")).toBeGreaterThan(-1);
    expect(body.indexOf("readonlyTeacherViewError()")).toBeLessThan(body.indexOf("reviewAccess("));
  });
});
