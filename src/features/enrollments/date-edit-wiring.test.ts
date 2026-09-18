import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 구조 가드 — **날짜 편집 세 표면이 같은 한 벌을 쓰는지** 잠근다.
 *
 * 회귀의 실체(원장 제보 2026-09-10 *"수업에서 더블클릭으로 시작날짜는 수정되는데 종료날짜는 수정이
 * 안되네"*): 반 상세 명단만 `field="start"`를 걸고 종료일은 **그냥 글자**로 뒀다. 컴포넌트도 서버 액션도
 * 처음부터 두 필드를 다 지원했고, 액션은 `/classes/[id]`까지 revalidate하고 있었다 — 즉 배선 한 줄이
 * 빠진 것이고 화면엔 아무 반응이 없어 **고장으로 읽혔다**. 한 표면만 빠져도 같은 제보가 다시 온다.
 *
 * 함께 잠그는 것 둘:
 *  · 확인(출결 밀림) 게이트가 **서버**에 있다([[#77]]) — 화면이 확인창을 그리는 것만으로 통과하면
 *    폼 조작 한 번에 새어 나간다.
 *  · 저장 경로가 **하나**다 — 표면마다 자기 액션을 만들면 검증·감사로그가 갈린다.
 */
const ROOT = join(__dirname, "..", "..", "..");
// ⚠️ 체크아웃이 CRLF일 수 있다(Windows) — 줄바꿈을 정규화해야 여러 줄 패턴이 헛돌지 않는다.
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8").replace(/\r\n/g, "\n");
/**
 * 주석은 규칙을 **설명**하는 자리라 "이건 있으면 안 된다" 검사에서 뺀다 — 안 그러면 금지 대상을
 * 설명한 경고 문구가 스스로 위반으로 걸린다(rollback-id-wiring.test.ts와 같은 관례).
 */
const code = (rel: string) =>
  read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "");

/** 날짜 인라인 편집을 그리는 표면 전부. 새 표면을 만들면 여기에 추가할 것. */
const SURFACES = [
  "src/app/(shell)/classes/[id]/page.tsx",
  "src/app/(shell)/students/[id]/_tabs/classes-tab.tsx",
  "src/app/(shell)/withdrawals/[studentId]/page.tsx",
] as const;

describe("수강 날짜 인라인 편집 배선", () => {
  it.each(SURFACES)("%s 는 시작일·종료일을 **둘 다** 편집할 수 있다", (rel) => {
    const src = read(rel);
    expect(src).toContain("EditableDateCell");
    expect(src).toContain('field="start"');
    // 🔴 이 줄이 빠졌던 것이 이번 제보다 — 시작일만 열려 있으면 종료일이 "먹통"으로 보인다.
    expect(src).toContain('field="end"');
  });

  it("모든 표면이 같은 공용 컴포넌트를 import한다(자체 편집 UI 금지)", () => {
    for (const rel of SURFACES) {
      expect(read(rel)).toContain('from "@/features/enrollments/components/editable-date-cell"');
    }
  });

  /**
   * 편집을 여는 것과 **라벨을 바꾸는 것은 다른 일**이다 — 반 상세는 종료일이 빌 때 `~ 현재`(강사뷰 en
   * 전환 대상)를 쓰고 있었으므로 그 말을 그대로 넘긴다. 안 넘기면 명단 전 줄에 `재원중`이 새로 선다.
   */
  it("반 상세는 비었을 때의 말을 그대로 유지한다(emptyLabel)", () => {
    const src = read("src/app/(shell)/classes/[id]/page.tsx");
    // 2026-09-18부터 반 운영 종료일이 있으면 "~ 9/21 (운영 종료)"를 보인다(0274a — 저장이 아니라 표시). 없으면 종전 `~ 현재`.
    expect(src).toContain("emptyLabel={openEndLabel(s.enrolledAt)}");
    expect(src).toMatch(/: sheetT\(lang, "cls\.d\.toNow"\);/);
  });

  it("공용 컴포넌트는 저장 경로가 updateEnrollmentDates 하나뿐이다", () => {
    expect(read("src/features/enrollments/components/editable-date-cell.tsx")).toContain(
      "updateEnrollmentDates",
    );
    // 종료 전용 우회로를 몰래 내지 않았는지 — 종료는 '수강 종료'(endSingleEnrollment)와 축이 다르다.
    expect(code("src/features/enrollments/components/editable-date-cell.tsx")).not.toContain(
      "endSingleEnrollment",
    );
  });
});

describe("출결 밀림 확인 = 서버 게이트(#77)", () => {
  const actions = read("src/features/enrollments/server/actions.ts");

  it("서버가 위험을 스스로 계산하고 서명을 다시 만든다", () => {
    expect(actions).toContain("newlyExcludedAttendanceRanges");
    expect(actions).toContain("dateEditConfirmToken");
    // 반이동 짝(날짜로 이어 붙인 관계)도 같은 확인 경로를 탄다 — 빠뜨리면 조용히 끊긴다.
    expect(actions).toContain("transferPairRisk");
    expect(actions).toContain("is_transferred_in");
  });

  it("클라가 보낸 서명이 **정확히 같을 때만** 통과한다", () => {
    // 존재 여부(`confirmed`가 있으면 통과)로 느슨해지면 아무 문자열이나 넣어 우회된다.
    expect(actions).toMatch(/confirmed\s*!==\s*token/);
  });

  it("확인이 필요하면 update 전에 되돌린다 — 저장하고 나서 묻는 건 확인이 아니다", () => {
    // ⚠️ 서식이 바뀌어도 견디게 **의미 있는 조각**을 앵커로 쓴다(`confirm: { token,`은 줄바꿈 한 번에 깨졌다).
    const gate = actions.indexOf("confirmed !== token");
    const update = actions.indexOf('.from("enrollments").update(patch)');
    expect(gate).toBeGreaterThan(-1);
    expect(update).toBeGreaterThan(-1);
    expect(gate).toBeLessThan(update);
  });

  it("세는 조회는 행을 안 받는다(B2) — count:exact + limit(1)", () => {
    expect(actions).toContain('.select("session_date", { count: "exact" })');
  });

  it("서명이 이 수강 행에 묶인다 — 같은 숫자를 내는 남의 토큰이 통하면 안 된다", () => {
    expect(actions).toMatch(/dateEditConfirmToken\(\s*enrollmentId/);
  });

  it("제목도 서버가 정한다 — 화면이 고정 문구를 쓰면 위험 조합에 따라 거짓이 된다", () => {
    expect(actions).toContain("dateEditConfirmTitle");
    const cell = read("src/features/enrollments/components/editable-date-cell.tsx");
    expect(cell).toContain("{confirm.title}");
  });

  /**
   * 🔴 종료일을 비워 '재원중'으로 되돌릴 땐 이동 표식도 함께 푼다 — 안 그러면 옛 반이 다시 열리는데
   * 도착지 수강이 남아 학생이 두 반 명단에 서고(GiST는 반이 다르면 안 막는다), 그 상태에서 옆의
   * '수강 종료 · 오늘까지'를 누르면 종료 규약이 배타로 읽혀 버튼 문구가 그 자리에서 거짓이 된다.
   */
  it("종료일을 비우면 withdrawal_reason과 is_transferred를 함께 되돌린다", () => {
    expect(actions).toContain("end_date: null, withdrawal_reason: null, is_transferred: false");
  });

  it("감사로그가 붙어 있고, 확인 후 저장이면 그 사실도 함께 남는다", () => {
    expect(actions).toContain('action: "enrollment_dates_update"');
    expect(actions).toContain("attendanceOutside");
    expect(actions).toContain("transferPairBroken");
    // 뷰어가 영문 키 원문을 노출하지 않게 한글 설명도 함께 있어야 한다.
    const describe_ = read("src/features/audit/describe.ts");
    expect(describe_).toContain("기간 밖(확인 후 저장)");
    expect(describe_).toContain("반 이동 짝");
  });
});

describe("검증은 순수 함수 한 곳", () => {
  const actions = read("src/features/enrollments/server/actions.ts");

  it("액션이 날짜 검증을 다시 구현하지 않는다", () => {
    expect(actions).toContain("enrollmentDateEditError");
    // 옛 인라인 검증이 남아 있으면 두 벌이 갈린다(한쪽만 고쳐진다).
    const src = code("src/features/enrollments/server/actions.ts");
    expect(src).not.toContain('return { error: "시작일은 비울 수 없습니다" }');
    expect(src).not.toContain('return { error: "날짜 형식이 올바르지 않습니다" }');
  });

  it("순수 모듈은 server-only가 아니다 — 클라가 타입·문구를 읽는다([[#61]])", () => {
    expect(code("src/features/enrollments/date-edit.ts")).not.toContain('import "server-only"');
  });
});
