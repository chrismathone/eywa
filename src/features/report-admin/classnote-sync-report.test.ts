/** ClassNote 반 보드 동기화 보고서(0329a, 원장 2026-10-02) — 글·요약 + 워커가 적고 앱이 읽는 배선. */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseReleaseNames, summarizeRelease, type ReleaseBoard } from "./classnote-release-list";
import { buildSyncReportText, parseRunEvents, reportAttention, summarizeSyncReport, syncReportFilename, toSyncRun, toSyncRunHead, type SyncRun } from "./classnote-sync-report";

const read = (...p: string[]) => readFileSync(join(process.cwd(), ...p), "utf8");
const board = (p: Partial<ReleaseBoard>): ReleaseBoard =>
  ({ boardName: "중등M 중1 MS2R", className: "중등M 중1 MS2R", names: [], checkedAt: "2026-10-01T20:12:00Z", ...p });
const run = (p: Partial<SyncRun> = {}): SyncRun => {
  const events = p.events ?? [];
  const n = (g: string) => events.filter((e) => e.group === g).length;
  return { kind: "daily", finishedAt: "2026-10-01T20:12:00Z", ok: true, error: null, truncated: false,
    counts: { changed: n("changed"), failed: n("failed"), held: n("held") }, ...p, events };
};

describe("해제 대상 칸", () => {
  it("문자열 배열만 — 빈 값·중복·모르는 모양은 버린다(없는 이름을 지어내지 않는다)", () => {
    expect(parseReleaseNames([" 김민준 ", "김민준", "", 3, null, "이서연"])).toEqual(["김민준", "이서연"]);
    expect(parseReleaseNames(null)).toEqual([]);
    expect(parseReleaseNames("김민준")).toEqual([]);
  });
  it("해제할 원아가 있는 반만 세고, 기준 시각은 가장 최근 확인", () => {
    const s = summarizeRelease([
      board({ names: ["김민준", "이서연"] }),
      board({ boardName: "고등M 고1", names: [], checkedAt: "2026-10-02T03:00:00Z" }),
    ]);
    expect(s).toEqual({ classes: 1, names: 2, checkedAt: "2026-10-02T03:00:00Z" });
    expect(summarizeRelease([])).toEqual({ classes: 0, names: 0, checkedAt: null });
  });
});

describe("회차 행 읽기", () => {
  it("줄은 묶음·글이 있는 것만 — 모르는 묶음·빈 글·객체가 아닌 것은 버린다", () => {
    expect(parseRunEvents([
      { group: "changed", className: " 가반 ", text: " 원아 배정: 김민준 " },
      { group: "boom", className: "가반", text: "x" },
      { group: "failed", className: "나반", text: "" },
      "줄", null, ["a"],
      { group: "held", text: "신입 준비 3건은 다음 동기화로 미뤘습니다" },
    ])).toEqual([
      { group: "changed", className: "가반", text: "원아 배정: 김민준" },
      { group: "held", className: "", text: "신입 준비 3건은 다음 동기화로 미뤘습니다" },
    ]);
    expect(parseRunEvents({ group: "changed" })).toEqual([]);
  });
  it("모르는 종류·끝난 시각 없는 행은 회차가 아니다", () => {
    expect(toSyncRun(null)).toBeNull();
    expect(toSyncRun({ kind: "manual", finished_at: "2026-10-01T20:12:00Z" })).toBeNull();
    expect(toSyncRun({ kind: "daily" })).toBeNull();
    expect(toSyncRun({ kind: "request", finished_at: "2026-10-01T20:12:00Z", ok: false, error: " 멈춤 ", summary: { truncated: true }, events: [] }))
      .toEqual({ kind: "request", finishedAt: "2026-10-01T20:12:00Z", ok: false, error: "멈춤", events: [], truncated: true, counts: { changed: 0, failed: 0, held: 0 } });
  });
  it("건수는 워커가 적어 둔 숫자를 쓴다(줄이 잘린 회차도 전체 기준) — 숫자가 없으면 줄에서 센다", () => {
    const events = [{ group: "held", className: "가반", text: "박도윤: 학부모 미가입" }];
    expect(toSyncRun({ kind: "daily", finished_at: "2026-10-01T20:12:00Z", ok: true, summary: { changed: 4, failed: 1, held: 2100, truncated: true }, events })?.counts)
      .toEqual({ changed: 4, failed: 1, held: 2100 });
    expect(toSyncRun({ kind: "daily", finished_at: "2026-10-01T20:12:00Z", ok: true, summary: {}, events })?.counts).toEqual({ changed: 0, failed: 0, held: 1 });
    // 머리만 읽는 길(버튼 요약) — 줄 없이도 같은 숫자
    expect(toSyncRunHead({ kind: "request", finished_at: "2026-10-01T20:12:00Z", ok: true, summary: { changed: 2, failed: 0, held: 1 } })?.counts)
      .toEqual({ changed: 2, failed: 0, held: 1 });
  });
});

describe("버튼 옆 요약", () => {
  it("가장 최근 회차의 줄 수 + 전 반의 해제 대상 수", () => {
    const latest = run({ events: [
      { group: "changed", className: "가반", text: "원아 배정: 김민준" },
      { group: "changed", className: "가반", text: "담임 연결: 이수진" },
      { group: "failed", className: "나반", text: "반 이름 변경 실패 — HTTP 400" },
      { group: "held", className: "나반", text: "박도윤: 학부모 미가입" },
      { group: "release", className: "가반", text: "해제 필요: 이서연" },
    ] });
    expect(summarizeSyncReport(latest, [board({ names: ["이서연", "최하린"] }), board({ boardName: "다반", names: ["정우진"] })]))
      .toEqual({ finishedAt: "2026-10-01T20:12:00Z", ok: true, changed: 2, failed: 1, held: 1, releaseNames: 3, releaseClasses: 2, dailyFailed: 0, dailyStopped: false });
  });
  it("🔴 가장 최근 회차가 '지금 동기화'면 가장 최근 전체 동기화의 실패·멈춤도 함께 센다 — 바뀐 반 없는 요청 한 번에 새벽 실패가 가려지지 않는다", () => {
    const daily = run({ ok: false, error: "멈춤", events: [{ group: "failed", className: "가반", text: "배정 실패" }, { group: "failed", className: "", text: "여기서 멈췄습니다" }] });
    const s = summarizeSyncReport(run({ kind: "request", finishedAt: "2026-10-02T00:10:00Z" }), [], daily);
    expect(s).toMatchObject({ changed: 0, failed: 0, held: 0, ok: true, dailyFailed: 2, dailyStopped: true });
    expect(reportAttention(s)).toBe(3);
    // 가장 최근 회차가 전체 동기화면 그 숫자가 곧 그것 — 두 번 세지 않는다
    const own = summarizeSyncReport(daily, [], daily);
    expect(own).toMatchObject({ failed: 2, ok: false, dailyFailed: 0, dailyStopped: false });
    expect(reportAttention(own)).toBe(3);
  });
});

describe("내려받는 글", () => {
  const events = [
    { group: "changed" as const, className: "초등M 초6", text: "원아 배정: 김민준" },
    { group: "changed" as const, className: "고등M 고1", text: "ClassNote 반 보드를 새로 만들었습니다" },
    { group: "changed" as const, className: "", text: "신입 1인 보드 2개 생성" },
    { group: "failed" as const, className: "중등M 중2", text: "반 이름 변경 실패 — HTTP 400 · 지금 \"옛 이름\"" },
    { group: "held" as const, className: "초등M 초6", text: "박도윤: 학부모 미가입 / 1인 보드 없음" },
  ];
  it("요약 · 변동 · 실패 · 보류 · 직접 해제 — 묶음마다 건수와 이유, 반 이름순, 메모장 줄바꿈(CRLF)", () => {
    const text = buildSyncReportText({ latest: run({ events }), lastDaily: null, academyName: "인재원",
      boards: [board({ boardName: "초등M 초6", className: "초등M 초6", names: ["이서연", "김민준"] })] });
    expect(!text.replace(/\r\n/g, "").includes("\n")).toBe(true);
    const lines = text.split("\r\n");
    expect(lines[0]).toBe("인재원 ClassNote 반 보드 동기화 보고서");
    expect(lines[1]).toBe("요약: 변동 3건 · 실패 1건 · 보류 1건 · 직접 해제 2명(1개 반)");
    expect(lines).toContain("동기화: 2026-10-02 05:12 · 매일 정기 동기화(전체 반)");
    expect(lines).toContain("결과: 정상 완료");
    const changed = lines.indexOf("■ 변동된 것 (3건) — 이번 동기화가 ClassNote에서 실제로 바꾼 것");
    expect(lines.slice(changed + 1, changed + 4)).toEqual([
      "  신입 1인 보드 2개 생성",
      "  [고등M 고1] ClassNote 반 보드를 새로 만들었습니다",
      "  [초등M 초6] 원아 배정: 김민준",
    ]);
    expect(lines).toContain("■ 변동 실패 (1건) — 하려다 안 된 것과 이유");
    expect(lines).toContain("  [중등M 중2] 반 이름 변경 실패 — HTTP 400 · 지금 \"옛 이름\"");
    expect(lines).toContain("  [초등M 초6] 박도윤: 학부모 미가입 / 1인 보드 없음");
    const rel = lines.findIndex((l) => l.startsWith("■ 직접 해제해야 할 원아 (2명 · 1개 반)"));
    const at = lines.indexOf("  [초등M 초6] 2명");
    expect(at).toBeGreaterThan(rel);
    expect(lines.slice(at + 1, at + 3)).toEqual(["    - 김민준", "    - 이서연"]);
    // 🔴 해제 전에 재원생인지 확인하라는 경고가 목록 위에 있다(확인 못 한 원아가 섞일 수 있다)
    expect(lines.slice(rel, at).join("\n")).toContain("해제 전에 그 반에 지금 다니는 학생이 아닌지 꼭 확인");
  });
  it("아무 일도 없던 회차는 묶음마다 '없음' — 빈 파일을 내지 않는다", () => {
    const text = buildSyncReportText({ latest: run({ kind: "request" }), lastDaily: null, boards: [board({})] });
    expect(text).toContain("요약: 변동 0건 · 실패 0건 · 보류 0건 · 직접 해제 0명(0개 반)");
    expect(text).toContain("동기화: 2026-10-02 05:12 · 지금 반 보드 동기화(바뀐 반만)");
    expect(text.match(/\r\n {2}없음/g)).toHaveLength(4);
  });
  it("멈춘 회차는 사유를 적고, 그 전에 한 일이 남아 있음을 밝힌다", () => {
    const stopLine = { group: "failed" as const, className: "", text: "여기서 멈췄습니다 — 최하린: 배정 실패" };
    const text = buildSyncReportText({ latest: run({ ok: false, error: "동기화 중 ClassNote 반 구성이 예상과 달라 안전하게 멈췄습니다", events: [stopLine, ...events.slice(0, 1)] }), lastDaily: null, boards: [] });
    expect(text).toContain("결과: 도중에 멈췄습니다 — 동기화 중 ClassNote 반 구성이 예상과 달라 안전하게 멈췄습니다");
    expect(text).toContain("멈추기 전에 이미 한 일은 아래 '변동된 것'에, 멈춘 자리와 못 한 반은 '변동 실패'·'보류'에 남아 있습니다");
    expect(text).toContain("  [초등M 초6] 원아 배정: 김민준");
  });
  it("반별 작업 전에 멈춘 회차(로그인·명단 조회 실패)는 '남아 있다'고 안내하지 않는다 — 아래 묶음이 비어 있다", () => {
    const text = buildSyncReportText({ latest: run({ ok: false, error: "ClassNote 로그인에 실패했습니다", events: [] }), lastDaily: null, boards: [] });
    expect(text).toContain("결과: 도중에 멈췄습니다 — ClassNote 로그인에 실패했습니다");
    expect(text).toContain("반별 작업을 시작하기 전에 멈춰 아래 묶음에 남은 줄이 없습니다");
    expect(text).not.toContain("'변동 실패'·'보류'에 남아 있습니다");
  });
  it("가장 최근 회차가 '지금 동기화'면 가장 최근 전체 동기화도 뒤에 붙인다(다른 반의 실패·보류가 거기 있다)", () => {
    const daily = run({ finishedAt: "2026-09-30T20:05:00Z", events: [{ group: "held", className: "나반", text: "정우진: 학부모 미가입" }] });
    const text = buildSyncReportText({ latest: run({ kind: "request", finishedAt: "2026-10-02T07:38:00Z" }), lastDaily: daily, boards: [] });
    expect(text).toContain("참고 — 가장 최근 전체 동기화");
    expect(text).toContain("동기화: 2026-10-01 05:05 · 매일 정기 동기화(전체 반)");
    expect(text).toContain("  [나반] 정우진: 학부모 미가입");
    // 가장 최근이 전체 동기화면 참고 묶음이 없다
    expect(buildSyncReportText({ latest: run(), lastDaily: daily, boards: [] })).not.toContain("참고 —");
    // 전체 동기화에 실패·멈춤이 있으면 요약 바로 아래에서부터 밝힌다
    const bad = run({ finishedAt: "2026-09-30T20:05:00Z", ok: false, error: "멈춤", events: [{ group: "failed", className: "나반", text: "배정 실패 HTTP 400" }] });
    const warned = buildSyncReportText({ latest: run({ kind: "request", finishedAt: "2026-10-02T07:38:00Z" }), lastDaily: bad, boards: [] });
    expect(warned.split("\r\n")[2]).toBe("⚠️ 가장 최근 전체 동기화(2026-10-01 05:05): 도중에 멈춤 · 실패 1건 — 아래 '참고'를 함께 보세요");
  });
  it("보드 이름이 aywa 반 이름과 다르면 둘 다 · 확인한 날이 다른 반은 그 날짜를 밝힌다", () => {
    const text = buildSyncReportText({ latest: run(), lastDaily: null, boards: [
      board({ boardName: "MS2R(옛 이름)", className: "중등M 중1 MS2R", names: ["김민준"], checkedAt: "2026-10-02T03:00:00Z" }),
      board({ boardName: "나반", className: null, names: ["이서연"], checkedAt: "2026-09-30T20:30:00Z" }),
    ] });
    expect(text).toContain("  [MS2R(옛 이름)] (aywa 반: 중등M 중1 MS2R) 1명\r\n");
    expect(text).toContain("  [나반] 1명 · 확인 2026-10-01 05:30");
  });
  it("줄이 잘린 회차는 그 사실을 적는다 · 파일 이름에 동기화 날짜와 시각(한국)", () => {
    expect(buildSyncReportText({ latest: run({ truncated: true }), lastDaily: null, boards: [] })).toContain("줄이 너무 많아 일부만 실었습니다");
    expect(syncReportFilename("2026-10-01T20:12:00Z")).toBe("ClassNote-동기화보고서-2026-10-02-0512.txt");
  });
});

describe("배선 — 워커가 적고 · 앱이 읽고 · 버튼이 그린다", () => {
  it("워커: 매일 동기화·지금 동기화 모두 회차를 적는다 — 멈춘 회차도(성공·실패 양쪽 길)", () => {
    const daily = read("scripts", "_classnote", "math-class-boards-sync.mjs");
    expect(daily.match(/await writeSyncRun\(sql, \{ tenant, kind: "daily"/g)).toHaveLength(2);
    const request = read("scripts", "_classnote", "classnote-sync-request.mjs");
    expect(request.match(/await writeSyncRun\(sql, \{ tenant, kind: "request"/g)).toHaveLength(2);
  });
  it("워커: 원아 배정은 학생 기록(감사로그)으로도 남긴다 — 멈춘 회차가 이미 배정한 것까지", () => {
    for (const file of ["math-class-boards-sync.mjs", "classnote-sync-request.mjs"])
      expect(read("scripts", "_classnote", file).match(/await auditEnrollments\(sql, tenant, applied/g), file).toHaveLength(2);
  });
  it("워커: 동기화가 연결 기록 뒤에 해제 대상을 적는다 · 값은 sql.json으로 · 실패는 삼킨다", () => {
    const sync = read("scripts", "_classnote", "math-class-boards-sync.mjs");
    expect(sync.indexOf("await writeReleaseNames(sql, tenant, fresh.plans, log)")).toBeGreaterThan(sync.lastIndexOf("await writeClassBoardSnapshot("));
    const db = read("scripts", "_classnote", "math-class-boards-db.mjs");
    const body = db.slice(db.indexOf("export async function writeReleaseNames"));
    expect(body).toContain("release_names = ${sql.json(names)}");
    expect(body).toMatch(/catch \(e\)[\s\S]*out\.skipped = true/);
  });
  it("앱: 요약은 받을 수 있는 사람만 읽고(강사 제외), 동기화 상태와 한 번에 내려간다", () => {
    const code = read("src", "features", "report-admin", "server", "classnote-sync-actions.ts");
    expect(code).toContain("g.canExport ? loadSyncReportSummary(admin, g.tenantId) : Promise.resolve(null)");
  });
  it("버튼: 동기화 버튼 옆 '동기화 보고서 다운로드' — 회차 기록이 있을 때만", () => {
    const code = read("src", "features", "report-admin", "components", "classnote-sync-now-button.tsx");
    expect(code).toContain("동기화 보고서 다운로드");
    expect(code).toContain("{report ? (");
  });
});
