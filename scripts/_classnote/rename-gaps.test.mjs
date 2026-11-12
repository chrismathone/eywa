// 개명 감사(2026-09-30) G3·G4·G5·G6·G9 — 순수 함수 + 배선 가드.
import { describe, it, expect, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { classBoardKeys, classBoardStudentOf } from "./class-board-keys.mjs";
import { homonymPhoneGate } from "./homonym-phone-gate.mjs";
import { createLocalWorkerLock, decideWorkerLease } from "./worker-lease.mjs";
import { evaluateBoardSafety } from "./board-safety.mjs";
import { randomUUID } from "node:crypto";

vi.mock("@playwright/test", () => ({ chromium: {} }));
const { findChildReportId } = await import("./classnote-admin-core.mjs");

const DIR = path.dirname(fileURLToPath(import.meta.url));
// OS 잠금은 Windows·Linux만 지원(worker-lease.mjs) — 그 밖의 OS에서는 잠금 시험을 건너뛴다.
const OS_LOCK = process.platform === "win32" || process.platform === "linux";
const read = (f) => fs.readFileSync(path.join(DIR, f), "utf8");

describe("G3 — 중복 확인은 보드를 가리지 않는다(cls:null)", () => {
  const page = (list) => ({ evaluate: async () => list });
  const LINK = "https://www.aywa.co.kr/r/abc";
  it("다른 보드(옛 경로)에 이미 같은 링크가 있으면 찾는다", async () => {
    const r = await findChildReportId(page([{ id: 9, cls: 111, child: 5, content: LINK }]), 1, { cls: null, child: 5, content: [LINK] });
    expect(r).toEqual({ ok: true, id: 9 });
  });
  it("보드를 지정하면 종전처럼 그 보드만(사후 확인·교차 확인용)", async () => {
    const r = await findChildReportId(page([{ id: 9, cls: 111, child: 5, content: LINK }]), 1, { cls: 222, child: 5, content: LINK });
    expect(r).toEqual({ ok: true, id: null });
  });
  it("다른 원아·다른 링크는 일치로 보지 않는다", async () => {
    const r = await findChildReportId(page([{ id: 9, cls: 111, child: 6, content: LINK }, { id: 10, cls: 111, child: 5, content: LINK + "x" }]), 1, { cls: null, child: 5, content: [LINK] });
    expect(r.id).toBeNull();
  });
  it("발송 코어의 선확인·실패 후 확인은 cls:null + 옛·새 주소 후보를 쓴다", () => {
    const src = read("classnote-core.mjs");
    expect(src).toMatch(/const pre = await findChildReportId\(adminPage, centerId, \{ cls: null, child: child\.id, content: dedupContents \}\)/);
    expect(src).toMatch(/const found = await findChildReportId\(adminPage, centerId, \{ cls: null, child: child\.id, content: dedupContents \}\)/);
  });
});

describe("G4 — 반 보드 글은 보드 번호로 학생을 찾는다", () => {
  const st = { id: "s1", name: "김근우A" };
  const map = new Map(classBoardKeys({ boardId: 70, boardName: "옛이름", childId: 5 }).map((k) => [k, st]));
  it("반 이름이 바뀌어 글의 보드명이 달라도 번호로 찾는다", () => {
    expect(classBoardStudentOf(map, { cls: 70, className: "새이름", childId: 5 })).toBe(st);
  });
  it("번호가 있으면 이름이 같아도 번호가 다르면 안 붙인다", () => {
    expect(classBoardStudentOf(map, { cls: 71, className: "옛이름", childId: 5 })).toBeNull();
  });
  it("번호 없는 글은 이름으로 찾지 않는다(학생 확정 가드 2026-09-30 — 학생 미확정)", () => {
    expect(classBoardStudentOf(map, { cls: null, className: "옛이름", childId: 5 })).toBeNull();
  });
  it("피드 코어는 반 보드 지도 조회 실패를 삼키지 않는다", () => {
    const src = read("classnote-feed-core.mjs");
    const fn = src.slice(src.indexOf("async function loadClassBoardChildMap"), src.indexOf("async function teachersFor"));
    expect(fn).not.toContain(".catch(");
    expect(src).toContain("classBoardMatch(classMap, { cls: p.cls");
  });
});

describe("G5 — 동명이인 1인 보드 보호자 전화 대조", () => {
  const adm = new Map([
    [1, { phone: "010-1111-1111" }],
    [2, { phone: "010-9999-9999" }],
    [3, { phone: null }],
  ]);
  it("확실히 다른 번호면 보류(값은 사유에 안 싣는다)", () => {
    const r = homonymPhoneGate({ studentPhones: ["01011111111", null], children: [{ id: 2, name: "김채은" }], admissions: adm });
    expect(r.ok).toBe(false);
    expect(r.reason).not.toContain("9999");
  });
  it("번호가 맞거나 모르면 종전대로 통과(정상 발송을 새로 막지 않는다)", () => {
    expect(homonymPhoneGate({ studentPhones: ["010-1111-1111"], children: [{ id: 1 }], admissions: adm }).ok).toBe(true);
    expect(homonymPhoneGate({ studentPhones: ["010-1111-1111"], children: [{ id: 3 }], admissions: adm }).ok).toBe(true);
    expect(homonymPhoneGate({ studentPhones: [null, ""], children: [{ id: 2 }], admissions: adm }).ok).toBe(true);
    expect(homonymPhoneGate({ studentPhones: ["010-1111-1111"], children: [{ id: 2 }], admissions: null }).ok).toBe(true);
  });
  it("보호자2·3 번호가 맞으면 같은 집 — 통과(원장 2026-11-04 · 보호자1 엄마·aywa 아빠)", () => {
    const split = new Map([[5, { phone: "010-9999-0000", phones: ["010-9999-0000", "010-1111-1111"] }]]);
    expect(homonymPhoneGate({ studentPhones: ["01011111111"], children: [{ id: 5, name: "전유솔" }], admissions: split }).ok).toBe(true);
    const none = new Map([[5, { phone: "010-9999-0000", phones: ["010-9999-0000", "010-8888-0000"] }]]);
    expect(homonymPhoneGate({ studentPhones: ["01011111111"], children: [{ id: 5, name: "전유솔" }], admissions: none }).ok).toBe(false);
  });
  it("한 아이 2계정(보호자·학생 본인)은 두 번호가 aywa 4칸 안이면 통과(안은지·박세욱 예외)", () => {
    const two = new Map([[10, { phone: "010-1000-0000" }], [11, { phone: "010-2000-0000" }]]);
    expect(homonymPhoneGate({ studentPhones: ["010-1000-0000", "010-2000-0000"], children: [{ id: 10 }, { id: 11 }], admissions: two }).ok).toBe(true);
  });
});

describe("G6 — 실게시 워커는 지점당 한 대", () => {
  const row = (hostname, startedMinAgo, alive, post_mode = true) => ({
    hostname,
    started_at: new Date(Date.parse("2026-09-30T10:00:00Z") - startedMinAgo * 60_000).toISOString(),
    alive,
    post_mode,
  });
  it("시작 시각과 PC 이름만으로 실행 권한을 부여하지 않는다", () => {
    const rows = [row("PC-A", 60, true), row("PC-B", 5, true)];
    expect(decideWorkerLease({ rows, me: "PC-B" })).toEqual({ owner: false, holder: null });
    expect(decideWorkerLease({ rows, me: "PC-A" }).owner).toBe(false);
  });
  it("기존 heartbeat가 만료돼도 새 서버 승인 없이 이어받지 않는다", () => {
    expect(decideWorkerLease({ rows: [row("PC-A", 60, false), row("PC-B", 5, true)], instanceId: "new-instance" }).owner).toBe(false);
  });
  it("dry-run PC(표식 없음·false)는 주인이 되지 않는다", () => {
    const rows = [row("DEV", 600, true, false), row("OLD", 600, true, null)]
      .map((item) => ({ ...item, instance_id: "dry-instance" }));
    expect(decideWorkerLease({ rows, instanceId: "dry-instance" }).owner).toBe(false);
  });
  it.skipIf(!OS_LOCK)("같은 PC 두 번째 워커는 OS 소유권 해제 후에만 이어받는다", async () => {
    const scope = `rename-audit:${randomUUID()}`;
    const first = createLocalWorkerLock(scope), next = createLocalWorkerLock(scope);
    const missing = createLocalWorkerLock(null);
    try {
      expect(await first.acquire()).toBe(true);
      expect(await next.acquire()).toBe(false);
      await first.release();
      expect(await next.acquire()).toBe(true);
      expect(await missing.acquire()).toBe(false);
    } finally { await Promise.all([first.release(), next.release(), missing.release()]); }
  });
  it.skipIf(!OS_LOCK)("시계가 앞으로 뛰어도 살아 있는 OS 잠금을 빼앗지 않는다", async () => {
    const scope = `rename-clock:${randomUUID()}`;
    const first = createLocalWorkerLock(scope), next = createLocalWorkerLock(scope);
    const later = Date.now() + 24 * 60 * 60_000;
    const clock = vi.spyOn(Date, "now");
    try {
      expect(await first.acquire()).toBe(true);
      clock.mockReturnValue(later);
      expect(await next.acquire()).toBe(false);
    } finally { clock.mockRestore(); await Promise.all([first.release(), next.release()]); }
  });
  // 실제 실행기 잠금 배선은 watch-classnote-lease.test.mjs의 실행 시험으로 검증한다.
  // DB 인계 경쟁은 _sync-agent/lease-db-check.cjs, 프로세스 종료는 worker-lease.test.mjs.
  it("stale·멈춤복구는 게시 상한보다 길고 게시 직전 처리 시각을 갱신한다", () => {
    const core = read("classnote-core.mjs");
    const stale = Number(core.match(/export const STALE_MIN = (\d+);/)[1]);
    const postMin = Number(core.match(/export const POST_TIMEOUT_MS = (\d+) \* 60_000;/)[1]);
    expect(stale).toBeGreaterThan(postMin);
    expect(core).toMatch(/update lesson_reports set classnote_processing_at = now\(\)\s+where id = \$\{r\.id\} and tenant_id = \$\{tenant\} and classnote_status = 'processing' returning id/);
    const queue = fs.readFileSync(path.join(DIR, "../../src/features/report-admin/classnote-queue.ts"), "utf8");
    expect(Number(queue.match(/export const STUCK_MINUTES = (\d+);/)[1])).toBe(stale);
  });
});

describe("G5 — 발송 보류 예외(원장 등재) 보드는 전화 대조도 건너뛴다", () => {
  it("evaluateBoardSafety가 등재 보드에 allowlisted 표식 · 코어는 그걸 보고 전화 대조를 건너뛴다", () => {
    const v = evaluateBoardSafety({ className: "(수학)홍길동", boards: [{ id: 1, name: "(수학)홍길동" }], allowlist: ["(수학)홍길동"] });
    expect(v).toMatchObject({ ok: true, allowlisted: true });
    expect(read("classnote-core.mjs")).toContain("verdict.ok && !verdict.allowlisted && Array.isArray(live)");
  });
});

describe("G8 — 확인 안 된 새 보드는 연결·배정하지 않는다", () => {
  it("응답 성공 + 이름(공백 무시) 일치 + 예약 모양 아님일 때만 연결", () => {
    const apply = read("math-class-boards-apply.mjs");
    expect(apply).toContain("if (!res.ok || normBoard(madeName) !== normBoard(p.className) || reservedBoardName(madeName)) {");
  });
});

describe("G9·G8 배선 — 연결표는 삼키지 않고, 반 하나의 이름 실패가 동기화를 안 멈춘다", () => {
  it("loadLinkedBoards 기본값 strict · 동기화·프로비저닝에 strict:false 없음", () => {
    expect(read("math-class-boards-load.mjs")).toContain("{ strict = true } = {}");
    for (const f of ["math-class-boards-sync.mjs", "provision-math-class-boards.mjs"]) expect(read(f)).not.toContain("strict: false");
  });
  it("생성·개명 검증 실패는 그 반만 보류(ClassBoardStop 대신 skipped/renameFailed)", () => {
    const apply = read("math-class-boards-apply.mjs");
    expect(apply).toContain("entry.skipped = `반 생성 실패");
    expect(apply).toContain("entry.renameFailed =");
    expect(apply).not.toMatch(/throw new ClassBoardStop\(`\$\{p\.board\.rename\.from\}/);
  });
  it("방금 만든 보드는 번호로 연결에 얹는다(이름이 달라도 매일 재생성 안 함)", () => {
    for (const f of ["math-class-boards-sync.mjs", "provision-math-class-boards.mjs"])
      expect(read(f)).toContain("if (d.created && d.boardId != null) linkedAfter.set(d.classId, Number(d.boardId));");
  });
});
