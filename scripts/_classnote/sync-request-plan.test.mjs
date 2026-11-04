import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CHILDMAP_REFRESH_GAP_MS,
  MAX_CLASSES_PER_RUN,
  childMapRefreshDue,
  normalizeScope,
  provisionCandidates,
  selectClassesToSync,
  summarizeSync,
  syncErrorLabel,
} from "./sync-request-plan.mjs";

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const C1 = id(1), C2 = id(2), C3 = id(3);
const S1 = id(11), S2 = id(12), S3 = id(13);
const FULL = normalizeScope({});

const base = () => ({
  classes: [
    { classId: C1, className: "중1 A", studentIds: [S1] },
    { classId: C2, className: "중2 B", studentIds: [S2] },
  ],
  links: new Map([
    [C1, { boardName: "중1 A" }],
    [C2, { boardName: "중2 B" }],
  ]),
  members: [
    { class_id: C1, student_id: S1, status: "ok", reason: null },
    { class_id: C2, student_id: S2, status: "ok", reason: null },
  ],
  recentStudentIds: new Set(),
  scope: FULL,
});

describe("바뀐 반만 고른다 — 과부하 방지(원장 2026-09-30)", () => {
  it("달라진 게 없으면 0개 — ClassNote에 로그인조차 안 한다", () => {
    expect(selectClassesToSync(base())).toEqual({ picked: [], remaining: 0 });
  });
  it("새 반·반 이름 변경·새 학생·배정 대기·떠난 학생을 잡는다", () => {
    const a = base();
    a.classes.push({ classId: C3, className: "고1 C", studentIds: [S3] }); // 새 반(연결 없음)
    a.classes[0] = { ...a.classes[0], className: "중1 A반" }; // 이름 변경
    a.classes[1] = { ...a.classes[1], studentIds: [S2, S3] }; // 새 학생
    const r = selectClassesToSync(a);
    expect(r.picked.map((p) => [p.className, p.reasons])).toEqual([
      ["고1 C", ["새 반"]],
      ["중1 A반", ["반 이름 변경"]],
      ["중2 B", ["새 학생"]],
    ]);
    const b = base();
    b.members = [
      { class_id: C1, student_id: S1, status: "hold", reason: "반 보드 배정 전 — 다음 동기화 때 배정됩니다" },
      { class_id: C2, student_id: S2, status: "ok", reason: null },
      { class_id: C2, student_id: S3, status: "ok", reason: null }, // S3는 반을 떠났다
    ];
    expect(selectClassesToSync(b).picked.map((p) => p.reasons[0])).toEqual(["배정 대기", "반을 떠난 학생"]);
  });
  it("보고서 미발송(JJ) 반 — 학생이 없으면 연결이 없어도 '새 반'으로 고르지 않는다(보드를 만들지 않아 같은 보류만 되풀이) · 학생이 있으면 고른다 · 지목하면 고른다 · 연결된 JJ 반은 종전대로", () => {
    const a = base();
    a.classes.push({ classId: C3, className: "초등M 개별 JJ2M", studentIds: [], reportOptout: true });
    expect(selectClassesToSync(a).picked).toEqual([]);
    expect(selectClassesToSync({ ...a, scope: { full: false, classIds: [C3], studentIds: [] } }).picked.map((p) => p.reasons)).toEqual([["지목한 반"]]);
    a.classes[2] = { ...a.classes[2], studentIds: [S3] };
    expect(selectClassesToSync(a).picked.map((p) => p.reasons)).toEqual([["새 반"]]);
    a.links.set(C3, { boardName: "초등M 개별 JJ2M" });
    expect(selectClassesToSync(a).picked.map((p) => p.reasons)).toEqual([["새 학생"]]);
  });
  it("가입 대기 보류는 최근 등록 학생만 다시 본다(오래된 미가입은 새벽 몫)", () => {
    const a = base();
    a.members[0] = { class_id: C1, student_id: S1, status: "hold", reason: "ClassNote 미가입·미배정(1인 보드 원아 0명)" };
    expect(selectClassesToSync(a).picked).toEqual([]);
    a.recentStudentIds = new Set([S1]);
    expect(selectClassesToSync(a).picked.map((p) => p.reasons)).toEqual([["가입 확인"]]);
    // 지금 문장(2026-11-02~ 원아 연결까지 없음 — class-board-plan.mjs JOIN_WAIT_REASON)도 같은 가입 대기다 · 옛 '1인 보드 없음'도
    for (const reason of ["ClassNote 미가입 — 이 학생으로 확인된 원아가 아직 없음", "1인 보드 없음"]) {
      a.members[0] = { class_id: C1, student_id: S1, status: "hold", reason };
      expect(selectClassesToSync(a).picked.map((p) => p.reasons)).toEqual([["가입 확인"]]);
    }
    // 원아 연결은 있는데 가드에 걸린 보류(형제 계정 등)는 가입 대기가 아니다 — 사람이 푼다
    a.members[0] = { class_id: C1, student_id: S1, status: "hold", reason: '원아 "박세인" 이름이 학생(박세하)과 다름 — 형제 계정일 수 있어 확인 필요' };
    expect(selectClassesToSync(a).picked).toEqual([]);
  });
  it("지목한 반·학생은 차이가 없어도 맨 앞 · 지목만이면 차이 반은 안 본다", () => {
    const a = base();
    a.classes.push({ classId: C3, className: "고1 C", studentIds: [S3] });
    a.scope = normalizeScope({ studentIds: [S2] });
    expect(selectClassesToSync(a).picked.map((p) => p.className)).toEqual(["중2 B"]);
    a.scope = { ...normalizeScope({ classIds: [C1] }), full: true };
    expect(selectClassesToSync(a).picked.map((p) => p.className)).toEqual(["중1 A", "고1 C"]);
  });
  it(`상한 ${MAX_CLASSES_PER_RUN}개 — 남은 수를 돌려준다`, () => {
    const a = base();
    a.links = new Map();
    a.classes = Array.from({ length: 20 }, (_, i) => ({ classId: id(100 + i), className: `반${String(i).padStart(2, "0")}`, studentIds: [] }));
    const r = selectClassesToSync(a);
    expect(r.picked).toHaveLength(MAX_CLASSES_PER_RUN);
    expect(r.remaining).toBe(20 - MAX_CLASSES_PER_RUN);
  });
});

describe("신입 1인 보드 준비 대상", () => {
  it("최근 등록 + 원아 연결 없음 · 지목 학생은 항상", () => {
    const r = provisionCandidates({ recentStudentIds: new Set([S1, S2]), childLinkedStudentIds: new Set([S2]), scope: FULL });
    expect(r).toEqual([S1]);
    const s = provisionCandidates({ recentStudentIds: new Set([S1]), childLinkedStudentIds: new Set(), scope: normalizeScope({ studentIds: [S3] }) });
    expect(s).toEqual([S3]); // 지목만이면 최근 등록 전체를 보지 않는다
  });
});

describe("한글 결과 · 오류", () => {
  it("변경 없음 / 요약", () => {
    expect(summarizeSync({ noChange: true })).toMatch(/건드리지 않았습니다/);
    expect(summarizeSync({ classes: 2, enrolled: 1, held: 1, remaining: 3 })).toBe(
      "반 2개 확인 · 원아 배정 1 · 보류 1(사유는 원스크린 노트 아이콘) · 남은 반 3(다시 누르거나 새벽 5시에)",
    );
  });
  it("원문 오류는 한글 한 줄로(원문은 result.raw에만)", () => {
    expect(syncErrorLabel("원아 조회 실패 2건 — 오늘 동기화를 건너뛴다")).toMatch(/원아 조회/);
    // 원아 연결(0185a)을 못 읽음 · 배정 직전 다시 읽었더니 바뀜 — 'ClassNote 반 구성' 문장으로 뭉개지 않는다
    expect(syncErrorLabel("원아 연결을 읽지 못했다 — 오늘 동기화를 건너뛴다(x)")).toMatch(/ClassNote 원아의 연결/);
    expect(syncErrorLabel("김근우A: 원아 연결이 계획과 다르다(그 사이 변경) — 중단")).toMatch(/ClassNote 원아의 연결/);
    expect(syncErrorLabel("김근우A: 1인 보드 원아가 계획과 다르다(그 사이 변경) — 중단")).toMatch(/반 구성이 예상과 달라/);
    expect(syncErrorLabel("TypeError: x is undefined")).not.toMatch(/TypeError/);
  });
});

describe("🔴 워커 배선 — 원자적 집기 · 새벽 표식 보존 · 일부 반 기록", () => {
  const read = (f) => readFileSync(join(process.cwd(), "scripts/_classnote", f), "utf8");
  it("집기는 skip locked + status='pending' 조건부 update, --post 워커만", () => {
    const src = read("classnote-sync-request.mjs");
    expect(src).toMatch(/for update skip locked/);
    expect(src).toMatch(/\) and status = 'pending'\s+returning/);
    expect(src).toMatch(/if \(!post \|\| \(tableMissingAt && /);
    // 끝낼 때도 running일 때만(그 사이 앱이 시간 초과로 내렸으면 덮지 않는다) — 성공·실패 둘 다 finish() 한 곳을 지난다
    expect(src).toMatch(/where id = \$\{id\} and status = 'running' returning next_scope/);
    expect(src.match(/await finish\(sql, tenant, row\.id, \{ status: "(done|failed)"/g)?.length).toBe(2);
    // 실행 중 합류분(next_scope)은 같은 트랜잭션에서 새 대기 요청으로 — 부분 유니크라 타깃 없는 do nothing
    expect(src).toMatch(/sql\.begin\(async \(tx\) =>/);
    expect(src).toMatch(/on conflict do nothing returning id/);
    expect(src).not.toMatch(/on conflict \(tenant_id\)/);
  });
  it("수동 실행은 새벽 프로비저닝의 '오늘 함' 표식을 남기지 않는다", () => {
    const src = read("classnote-provision-core.mjs");
    expect(src).not.toMatch(/^\s*markRun\(today\);/m);
    expect(src.match(/if \(!force\) markRun\(today\);/g)?.length).toBe(2);
  });
  it("범위 지정 신입 준비는 대상이 없으면 ClassNote에 로그인하지 않는다(대상 계산이 로그인보다 먼저)", () => {
    const src = read("classnote-provision-core.mjs");
    const plan = src.indexOf("await expectedFor(sql, tenant, g.keys, g.prefix)");
    const early = src.indexOf("if (studentIds && !plans.some((p) => p.targets.length))");
    const login = src.indexOf("await loginClassnote(page)");
    expect(plan).toBeGreaterThan(0);
    expect(early).toBeGreaterThan(plan);
    expect(login).toBeGreaterThan(early);
  });
  it("일부 반만 본 실행은 계획 밖 반의 연결을 지우지 않는다", () => {
    const db = read("math-class-boards-db.mjs");
    expect(db).toMatch(/if \(scoped\) return out;\s*(\r?\n)\s*const live = /);
    const sync = read("math-class-boards-sync.mjs");
    expect(sync).toMatch(/writeClassBoardSnapshot\(sql, tenant, fresh\.plans, \{ scoped: true \}\)/);
  });
  it("원아 연결 갱신(⓪)은 신입 준비(①)·반 보드 동기화(②)보다 앞에서 force·apply로 부른다(원장 2026-11-02 A안)", () => {
    const src = read("classnote-sync-request.mjs");
    const refresh = src.indexOf("await syncChildMapOnce(sql, browser, { tenant, apply: true, log, force: true })");
    expect(refresh).toBeGreaterThan(src.indexOf("childMapRefreshDue({ candidates: provIds.length, lastAt: lastChildMapRefreshAt, now: Date.now() })"));
    expect(refresh).toBeLessThan(src.indexOf("await provisionDailyOnce(sql, browser,"));
    expect(refresh).toBeLessThan(src.indexOf("await syncMathClassBoards(sql, page,"));
    expect(CHILDMAP_REFRESH_GAP_MS).toBeLessThan(5 * 60 * 1000); // 앱 쿨다운(5분)보다 짧게
    expect(summarizeSync({ classes: 1, enrolled: 1, childLinks: 2 })).toContain("새 학부모 가입 확인 2");
  });
  it("데몬이 요청 처리기를 부르고 caps.syncRequests를 알린다", () => {
    const w = read("watch-classnote-queue.mjs");
    expect(w).toMatch(/processSyncRequestOnce\(db\(\), b, \{ tenant, post: POST, host: HOSTNAME, log \}\)/);
    expect(w).toMatch(/syncRequests: true/);
  });
});

describe("지금 동기화 앞 원아 연결 갱신(원장 2026-11-02 A안 — 낮에 가입한 신입의 당일 배정)", () => {
  const now = 1_800_000_000_000;
  it("신입 준비 후보가 없으면 갱신하지 않는다(ClassNote 로그인 0)", () => {
    expect(childMapRefreshDue({ candidates: 0, lastAt: 0, now })).toBe(false);
  });
  it("후보가 있고 처음이면 갱신한다", () => {
    expect(childMapRefreshDue({ candidates: 2, lastAt: 0, now })).toBe(true);
  });
  it("마지막 갱신에서 10분이 안 지났으면 건너뛴다(로그인 반복 금지)", () => {
    expect(childMapRefreshDue({ candidates: 1, lastAt: now - CHILDMAP_REFRESH_GAP_MS + 1, now })).toBe(false);
    expect(childMapRefreshDue({ candidates: 1, lastAt: now - CHILDMAP_REFRESH_GAP_MS, now })).toBe(true);
  });
});
