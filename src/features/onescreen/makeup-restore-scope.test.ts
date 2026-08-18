import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 전수 가드 — 로스터의 "그날 보강 보고서 되살리기"는 **반이 없는 순수 보강만** 집어야 한다.
 *
 * 🔴 왜 소스 스캔인가: 이 조건이 빠지면 타입도 테스트도 안 깨지고 **하루 뒤에 화면에서만** 터진다.
 *    같은 날 정규+보강을 합치면 정규 보고서가 `makeup=true`인데 `class_id`가 붙은 행이 된다. 그걸 여기서
 *    집으면 로스터가 그 과목 "(보강)" 행을 한 줄 더 만들고(중복 가드는 반 없는 행만 본다), 강사가 그 빈
 *    행을 채워 보내면 **결국 같은 날 두 번 발송**된다 — 합치기 기능이 막으려던 바로 그 일이다.
 *    (2026-08-05 적대 리뷰에서 실제로 이 상태로 커밋됐다가 잡혔다.)
 *
 * 같은 계열 선례: postgrest-embed-hints.test.ts · textbook-onescreen-hotpath.test.ts.
 */
const ROSTER = join(process.cwd(), "src/features/onescreen/server/roster.ts");

describe("보강 행 복원 범위", () => {
  const src = readFileSync(ROSTER, "utf8");

  it("fetchMyMakeupReports는 makeup=true에 더해 class_id IS NULL로 좁힌다", () => {
    const fn = src.slice(src.indexOf("async function fetchMyMakeupReports"));
    const body = fn.slice(0, fn.indexOf("\n}\n"));
    expect(body).toContain('.eq("makeup", true)');
    expect(body).toMatch(/\.is\(\s*"class_id"\s*,\s*null\s*\)/);
  });

  it("보강 행을 만드는 자리는 여전히 classId=null·makeup=true 규약을 지킨다", () => {
    // unit_key = coalesce(class_id, subject) 분리의 전제 — 깨지면 정규 보고서와 저장 단위가 충돌한다.
    const block = src.slice(src.indexOf("5-b) 보강(수업외) 행 복원"));
    expect(block.slice(0, 2000)).toContain("classId: null");
  });

  it("출석부·ECS가 연 보강 칸도 같은 반 없는 행으로 되살린다", () => {
    const block = src.slice(src.indexOf("5-c) 출석부·ECS가 연 보강 칸"));
    expect(block.slice(0, 2500)).toContain("classId: null");
    expect(block.slice(0, 2500)).toContain("makeupClassId: row.classId");
  });
});
