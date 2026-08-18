import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 구조 가드 — 보강 빼기의 **치명 사고 3종**은 순수 로직이 아니라 배선에 있었다(적대 리뷰 2026-08-18).
 * 판정 함수 테스트로는 안 잡히므로, 그 배선이 사라지면 여기서 깨지게 못박는다.
 * (같은 패턴 선례: class-sheets/attendance-wiring.test.ts)
 */
const read = (rel: string) => readFileSync(join(process.cwd(), "src", rel), "utf8");

describe("보강 빼기 서버 액션 배선", () => {
  const src = read("features/onescreen/server/makeup-remove-actions.ts");

  it("🔴 발송·회수 처리 중이면 **출결에 손대기 전에** 거절한다 — 통과시키면 워커가 학부모에게 게시한다", () => {
    const busyGuard = src.indexOf("plan.busyIds.length > 0");
    const attendanceDelete = src.indexOf('.eq("status", "makeup")');
    expect(busyGuard).toBeGreaterThan(-1);
    expect(attendanceDelete).toBeGreaterThan(-1);
    expect(busyGuard).toBeLessThan(attendanceDelete); // 가드가 먼저
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
  const client = read("features/onescreen/components/onescreen-client.tsx");
  const grid = read("features/onescreen/components/grid-row.tsx");
  const card = read("features/onescreen/components/report-card.tsx");

  it("확인창 없이 지우지 않는다(원장 '경고하고 확인하면 삭제')", () => {
    const fn = client.slice(client.indexOf("async function removeMakeupRow"));
    const body = fn.slice(0, fn.indexOf("\n  }\n"));
    expect(body).toContain("window.confirm");
    expect(body.indexOf("window.confirm")).toBeLessThan(body.indexOf("removeMakeupEntry("));
  });

  it("이미 발송된 보강은 게시글도 지워진다고 경고한다", () => {
    expect(client).toContain("학부모 게시글도 삭제(회수)됩니다");
  });

  it("표·카드 양쪽에 빼는 문이 있고, 정규 학생 카드의 순수 보강 행도 뺄 수 있다", () => {
    expect(grid).toContain("onRemoveMakeup");
    expect(card).toContain("onRemoveMakeup");
    // 학생 단위 isMakeup에만 달면 "정규 수업도 듣는 학생의 보강"에 문이 없다(적대 리뷰 M2).
    expect(grid).toContain("actions.onRemoveMakeup && !subject.classId");
    expect(card).toContain("subject.makeup && !subject.classId");
  });
});

describe("로스터가 회수된 보강을 되살리지 않는다", () => {
  const roster = read("features/onescreen/server/roster.ts");

  it("JS 판정(isRecallCleared)으로 거른다 — SQL not.in은 status NULL 행을 통째로 떨어뜨린다", () => {
    expect(roster).toContain("isRecallCleared");
    expect(roster).not.toContain('.not("classnote_status"');
  });
});
