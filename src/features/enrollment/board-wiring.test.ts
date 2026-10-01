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
    expect(actions).not.toContain("이미 '등록 완료'로 처리된 상담은");
  });
});

describe("상태 선택은 어디서나 4단계", () => {
  it("툴바 필터가 옛 outcome 7종(OUTCOME_OPTIONS)이 아니라 칸 4단계를 쓴다", () => {
    const bar = read("src/app/(shell)/enrollment/_components/kanban-filters.tsx");
    expect(bar).toContain("BOARD_STAGE_OPTIONS");
    expect(bar).not.toContain("OUTCOME_OPTIONS");
  });

  it("상세 '상태 변경' 다이얼로그도 같은 4단계 + 같은 대표값 규칙", () => {
    const manage = read(MANAGE);
    expect(manage).toContain("BOARD_STAGE_OPTIONS");
    expect(manage).toContain("outcomeForDrop"); // 드래그와 같은 대표값 함수
    expect(manage).not.toContain("OUTCOME_OPTIONS");
  });
});

describe("월 이동은 앱 전역 PeriodNav", () => {
  it("등록상담 툴바가 자기 화살표를 다시 만들지 않는다", () => {
    const bar = read("src/app/(shell)/enrollment/_components/kanban-filters.tsx");
    expect(bar).toContain("PeriodNav");
    // 손수 만든 화살표 링크의 흔적(PeriodNav는 `prevAriaLabel`로 넘긴다).
    expect(bar).not.toContain('aria-label="이전 달"');
  });
});

describe("makeedu 역동기화 — 본문 카드 대신 머리글 버튼 + 주간 자동", () => {
  const SECTION = "src/app/(shell)/enrollment/_components/makeedu-push-section.tsx";
  const BUTTON = "src/app/(shell)/enrollment/_components/makeedu-push-button.tsx";
  const PUSH_ACTIONS = "src/features/integrations/server/actions.ts";
  const ACCESS = "src/features/integrations/server/makeedu-push-access.ts";

  it("콜&상담 본문엔 카드를 펼치지 않는다 — 페이지가 후보를 직접 조회하지도 않는다(원장 2026-09-01)", () => {
    const page = read(PAGE);
    expect(page).not.toContain("MakeeduPushCard");
    // 조회는 머리글 섹션(Suspense 안)에서만 — 페이지 본문 await에 끼면 첫 페인트가 막힌다(B7).
    expect(page).not.toContain("getUnpushedIntakeConsultations");
  });

  it("머리글 'makeedu 보내기'(원장 2026-10-01)는 전송 액션과 같은 게이트 뒤 · Suspense 안에 선다", () => {
    const page = read(PAGE);
    expect(page).toContain("canPushToMakeedu(user.systemRole)");
    // 게이트를 못 지나면 대체 화면(잠긴 버튼)조차 안 그린다 — 권한 없음·모듈 꺼짐 = 흔적 없이.
    expect(page).toMatch(/canPushMakeedu \? \(\s*<Suspense fallback=\{<MakeeduPushButton candidates=\{null\} \/>\}>\s*<MakeeduPushSection \/>/);
    // 섹션도 같은 게이트를 **조회보다 먼저** 본다.
    const section = read(SECTION);
    const gate = section.indexOf("canPushToMakeedu(");
    expect(gate).toBeGreaterThan(-1);
    expect(gate).toBeLessThan(section.indexOf("getUnpushedIntakeConsultations("));
  });

  it("게이트는 한 함수 — 전송 액션도 그것을 지나고, 그 함수는 integrations 쓰기 권한(모듈 꺼짐 캡 포함)이다", () => {
    expect(read(PUSH_ACTIONS)).toMatch(/enqueueConsultationPush[\s\S]{0,600}canPushToMakeedu\(user\.systemRole\)/);
    expect(read(ACCESS)).toContain('canWriteTenant(role, "integrations")');
  });

  it("버튼은 연동 면과 같은 카드를 다이얼로그로 연다 — 새 조회·전송 경로를 만들지 않는다", () => {
    const button = read(BUTTON);
    expect(button).toContain("@/features/integrations/components/makeedu-push-card");
    expect(button).toContain("<MakeeduPushCard");
    // 전송은 카드 안의 enqueueConsultationPush 하나뿐 — 버튼이 액션·fetch를 따로 부르지 않는다(#137: 저절로 도는 서버 액션 금지).
    expect(button).not.toMatch(/from "@\/features\/integrations\/server\/actions"/);
    expect(button).not.toContain("fetch(");
    // 보낸 뒤 갱신 = 액션의 재검증이 이 화면을 다시 그린다.
    expect(read(PUSH_ACTIONS)).toContain('revalidatePath("/enrollment")');
  });

  it("연동 면의 카드는 그대로 둔다(실패 건 재전송)", () => {
    const face = read("src/app/(shell)/owner/_components/sheets-face.tsx");
    expect(face).toContain("<MakeeduPushCard candidates={pushCandidates} />");
  });

  it("동기화 상태 배지는 그대로 둔다(지시 범위 밖)", () => {
    expect(read(PAGE)).toContain("MakeeduSyncBadge");
  });

  it("주간 자동 적재는 상주 워처가 부른다 — 앱에 자동 적재 경로를 새로 만들지 않는다", () => {
    expect(read(WATCHER)).toContain("runWeeklyPushEnqueue");
  });
});
