import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SHEET_DICT } from "@/features/teacher-view/i18n";
// 원스크린 화면 + 옮겨 낸 훅(P3-O)을 한 덩어리로 읽는다 — 화면에서 코드를 옮겨도 같은 단언이 선다.
import { readOnescreenScreen } from "./components/onescreen-screen-source.test-util";

/**
 * 구조 가드 — 보강 빼기의 **치명 사고 3종**은 순수 로직이 아니라 배선에 있었다(적대 리뷰 2026-08-18).
 * 판정 함수 테스트로는 안 잡히므로, 그 배선이 사라지면 여기서 깨지게 못박는다.
 * (같은 패턴 선례: class-sheets/attendance-wiring.test.ts)
 */
const read = (rel: string) => readFileSync(join(process.cwd(), "src", rel), "utf8");

describe("보강 빼기 서버 액션 배선", () => {
  const src = read("features/onescreen/server/makeup-remove-actions.ts");

  it("🔴 발송분·처리 중이면 **출결에 손대기 전에** 거절한다 — 통과시키면 학부모 기록이 조용히 지워진다", () => {
    const guard = src.indexOf("plan.sentIds.length > 0 || plan.busyIds.length > 0");
    const attendanceDelete = src.indexOf('.eq("status", "makeup")');
    expect(guard).toBeGreaterThan(-1);
    expect(attendanceDelete).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(attendanceDelete); // 가드가 먼저
  });

  it("🔴 진도 되감기는 2단계 — capture(삭제 전) → 보고서 삭제 → apply(삭제 후)", () => {
    // capture가 뒤로 가면 FK SET NULL로 대상을 못 찾고, apply가 앞으로 가면 삭제 실패 시
    // 보고서는 남고 진도만 사라진다(둘 다 되돌릴 수 없는 유실 — 적대 리뷰).
    const capture = src.indexOf("captureProgressForReports(");
    const reportDelete = src.indexOf('.from("lesson_reports")', src.indexOf("plan.deleteIds.length"));
    const apply = src.indexOf("applyProgressRollback(");
    expect(capture).toBeGreaterThan(-1);
    expect(reportDelete).toBeGreaterThan(-1);
    expect(apply).toBeGreaterThan(-1);
    expect(capture).toBeLessThan(reportDelete);
    expect(reportDelete).toBeLessThan(apply);
  });

  it("이 문에서 회수(발송 취소)를 걸지 않는다 — 발송분은 애초에 막는다", () => {
    expect(src).not.toContain("requestReportRecall");
  });

  it("🔴 정규 데이터 보호 — 보고서는 makeup+class_id null만, 출결은 status='makeup'만 지운다", () => {
    expect(src).toContain('.eq("makeup", true)');
    expect(src).toContain('.is("class_id", null)');
    expect(src).toContain('.eq("status", "makeup")');
  });

  it("admin 클라이언트 삭제는 tenant_id를 명시한다(#104 — RLS 우회)", () => {
    const deletes = src.split(".delete()").slice(1);
    expect(deletes.length).toBeGreaterThan(0);
    for (const after of deletes) {
      expect(after.slice(0, 400)).toContain('.eq("tenant_id", tenantId)');
    }
  });

  it("과목 매칭을 SQL .eq(subject)로 하지 않는다 — 옛 보강은 subject가 NULL이라 통째로 안 잡힌다", () => {
    // 주석 속 예시 문자열은 제외하고 **실행되는 줄**만 본다.
    const code = src
      .split(/\r?\n/)
      .filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*"))
      .join("\n");
    expect(code).not.toContain('.eq("subject"');
    expect(code).toContain("LEGACY_REPORT_SUBJECT");
  });

  it("기록을 지우는 동작이라 감사로그를 남긴다", () => {
    expect(src).toContain('action: "makeup_remove"');
  });
});

describe("보강 빼기 화면 배선", () => {
  const client = readOnescreenScreen();
  const grid = read("features/onescreen/components/grid-row.tsx");
  const card = read("features/onescreen/components/report-card.tsx");

  it("확인창 없이 지우지 않는다(원장 '경고하고 확인하면 삭제')", () => {
    const fn = client.slice(client.indexOf("async function removeMakeupRow"));
    const body = fn.slice(0, fn.indexOf("\n  }\n"));
    expect(body).toContain("window.confirm");
    expect(body.indexOf("window.confirm")).toBeLessThan(body.indexOf("removeMakeupEntry("));
  });

  it("발송된 보강은 확인창을 띄우기 전에 막는다(원장 '발송된건은 보강취소를 못하게 강제해')", () => {
    const fn = client.slice(client.indexOf("async function removeMakeupRow"));
    const body = fn.slice(0, fn.indexOf("\n  }\n"));
    expect(body).toContain("makeupRemoveBlockReason");
    expect(body.indexOf("makeupRemoveBlockReason")).toBeLessThan(body.indexOf("window.confirm"));
  });

  it("경고에 진도 기록 삭제도 적는다(원장 '진도기록도 되돌려야지')", () => {
    // 문구는 강사뷰 사전으로 옮겼다(en 전환 13차) — 화면이 그 키를 쓰는지와
    // 사전이 여전히 그 사실을 적는지를 **둘 다** 본다(한쪽만 보면 조용히 빠진다).
    expect(client).toContain('t("os.c.removeMakeupLine1")');
    expect(SHEET_DICT["os.c.removeMakeupLine1"].ko).toContain("진도 기록이 모두 삭제됩니다");
    expect(SHEET_DICT["os.c.removeMakeupLine1"].en).toMatch(/progress/i);
  });

  it("발송분은 버튼 자체가 안 열린다(표·카드 모두 canRemoveMakeup 통과 필요)", () => {
    expect(grid).toContain("actions.canRemoveMakeup?.(student.id, subject.name)");
    expect(card).toContain("canRemoveMakeup?.(subject.name)");
  });

  it("표·카드 양쪽에 빼는 문이 있고, 정규 학생 카드의 순수 보강 행도 뺄 수 있다", () => {
    expect(grid).toContain("onRemoveMakeup");
    expect(card).toContain("onRemoveMakeup");
    // 학생 단위 isMakeup에만 달면 "정규 수업도 듣는 학생의 보강"에 문이 없다(적대 리뷰 M2).
    expect(grid).toContain("!subject.classId &&");
    expect(card).toContain("subject.makeup && !subject.classId");
  });
});

describe("로스터는 보강 행을 상태로 거르지 않는다", () => {
  const roster = read("features/onescreen/server/roster.ts");

  it("회수된 보강도 되살린다 — 회수 후 수정·재발송 흐름(2026-08-06 결정)을 끊지 않는다", () => {
    // ⚠️ 상태로 거르면 SQL not.in의 NULL 함정(미발송 29건 증발)까지 따라온다. 거르지 않는 게 규약.
    expect(roster).not.toContain('.not("classnote_status"');
    expect(roster).not.toContain("isRecallCleared");
  });
});
