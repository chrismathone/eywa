import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 등록상담 칸반 4칸 배선 가드(원장 2026-09-01).
 *
 * 순수 규칙은 board-stages.test.ts가 잠근다. 여기서 잠그는 건 **연결**이다 — 규칙이 맞아도 화면이
 * 자기 배열을 다시 만들거나, 드래그가 드롭다운과 다른 경로로 저장하면 같은 상담이 화면마다 다른 칸에
 * 서고 감사·부수효과가 한쪽에만 붙는다.
 */
const ROOT = resolve(process.cwd());
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

const PAGE = "src/app/(shell)/enrollment/page.tsx";
const KANBAN = "src/app/(shell)/enrollment/_components/enrollment-kanban.tsx";
const CARDS = "src/app/(shell)/enrollment/_components/column-cards.tsx";
const MANAGE = "src/app/(shell)/enrollment/[id]/_components/consultation-manage.tsx";
const ACTIONS = "src/features/enrollment/server/actions.ts";
const WATCHER = "scripts/_makeedu/watch-sync-requests.cjs";

describe("칸 묶음은 board-stages 한 곳에서만 나온다", () => {
  it("페이지가 자기 컬럼 배열을 다시 만들지 않는다", () => {
    const page = read(PAGE);
    expect(page).not.toContain("const COLUMNS");
    // outcome 목록을 화면에서 다시 나열하는 것도 금지(칸 정의가 두 벌이 되는 첫 신호).
    expect(page).not.toMatch(/outcomes:\s*\[/);
  });

  it("보드와 카드가 같은 모듈에서 칸·표식을 읽는다", () => {
    expect(read(KANBAN)).toContain("@/features/enrollment/board-stages");
    expect(read(CARDS)).toContain("@/features/enrollment/board-stages");
  });
});

describe("드래그와 드롭다운은 같은 서버 액션을 탄다", () => {
  it("칸반 드롭도 setEnrollmentOutcome을 부른다(상세 '상태 변경'과 동일 경로)", () => {
    expect(read(KANBAN)).toContain("setEnrollmentOutcome");
    expect(read(MANAGE)).toContain("setEnrollmentOutcome");
  });

  it("전환 잠금 문구는 상수 하나에서 온다 — 서버가 리터럴을 따로 들지 않는다", () => {
    const actions = read(ACTIONS);
    expect(actions).toContain("ENROLLED_REVERT_BLOCKED");
    expect(actions).not.toContain("이미 '재원생 등록'으로 처리된 상담은 대기·예약");
  });
});

describe("makeedu 역동기화 — 수동 카드는 감추고 주간 자동으로", () => {
  it("등록상담 화면은 'makeedu 보내기' 카드를 그리지 않는다", () => {
    const page = read(PAGE);
    expect(page).not.toContain("MakeeduPushCard");
    // 후보 조회까지 함께 걷어냈는지(안 그리면서 쿼리만 남으면 순수 낭비다).
    expect(page).not.toContain("getUnpushedIntakeConsultations");
  });

  it("동기화 상태 배지는 그대로 둔다(지시 범위 밖)", () => {
    expect(read(PAGE)).toContain("MakeeduSyncBadge");
  });

  it("주간 자동 적재는 상주 워처가 부른다 — 앱에 자동 적재 경로를 새로 만들지 않는다", () => {
    expect(read(WATCHER)).toContain("runWeeklyPushEnqueue");
  });
});
