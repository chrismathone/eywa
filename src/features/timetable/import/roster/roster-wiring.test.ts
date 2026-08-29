/**
 * **9월 명단 이동(`master-cutover --roster`)의 규약**을 잠근다.
 *
 * 이 경로는 프로덕션 학생 수강을 직접 바꾸는데 **테스트로 돌려 볼 수 없다**(구글 시트 + 실 DB).
 * 그래서 적대 리뷰(2026-08-29)에서 실제로 잡힌 결함들을 문자열로 못박는다 — 되돌아가면 여기서 걸린다.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const src = readFileSync(
  join(process.cwd(), "scripts", "_english_sync", "master-cutover.mts"),
  "utf8",
);
/** 주석은 규칙을 **설명**하는 자리라 순서 검사에서 뺀다 — 설명문이 스스로 위반으로 걸리지 않게. */
const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ 	]*\/\/.*$/gm, "");

describe("명단 이동 — 쓰기 전에 멈추는가", () => {
  it("파싱·인원 검산이 신설 반 생성(첫 쓰기)보다 먼저다", () => {
    // 🔴 검산 실패는 "시트를 잘못 읽었다"는 신호다. 그 뒤에 멈추면 이미 만들어진 반이 남는다.
    const check = code.indexOf("인원 검산 불일치");
    const firstWrite = code.indexOf("insert into classes");
    expect(check).toBeGreaterThan(-1);
    expect(firstWrite).toBeGreaterThan(-1);
    expect(check).toBeLessThan(firstWrite);
  });

  it("스냅샷을 못 만들면 명단을 쓰지 않는다", () => {
    // 되돌릴 수 없는 적용 금지 — applyDiff와 같은 규약.
    expect(src).toContain("되돌리기용 스냅샷을 저장하지 못해 명단 적용을 중단합니다");
  });
});

describe("명단 이동 — 반이동 RPC 호출", () => {
  it("이름 지정 인자로 부른다(위치 인자 금지)", () => {
    // 🔴 0235a의 순서는 `(p_moves, p_effective_date)`다. 위치로 쓰면 뒤집혀 실패하고,
    //    날짜를 빠뜨리면 기본값 current_date(UTC)로 떨어져 **예약이 아니라 오늘 이동**이 된다.
    expect(src).toMatch(/move_enrollments_batch\(\s*\n?\s*p_moves\s*=>/);
    expect(src).toMatch(/p_effective_date\s*=>\s*\$\{CUTOVER\}::date/);
  });

  it("분리등원(attendance_days)을 승계한다", () => {
    // 안 넘기면 RPC가 '{}'(전 요일)로 새 수강을 만든다 — 목요일만 오던 학생이 매일 등원이 된다.
    expect(src).toContain("attendanceDays: daysBy.get(m.enrollmentId) ?? []");
  });

  it("RPC가 준 새 수강 id를 스냅샷에 되쓴다", () => {
    // 이게 없으면 되돌리기가 좌표 폴백을 타고, 누가 날짜·반을 바꾼 뒤엔 못 찾는다(0236a).
    expect(src).toContain("m.newEnrollmentId = id");
    expect(src).toMatch(/update public\.timetable_snapshots set payload/);
  });

  it("추가는 휴원 표식을 승계한다", () => {
    expect(src).toContain("enrollmentOnHoldForStatus");
  });
});

describe("명단 이동 — 종료(수강 끊기)는 좁게", () => {
  it("기본값은 종료하지 않는다", () => {
    expect(src).toContain("const APPLY_REMOVES = args.includes(\"--apply-removes\")");
    expect(src).toContain("removes: APPLY_REMOVES ? plan.diff.removes : []");
  });

  it("제외가 남아 있으면 --apply-removes를 거절한다", () => {
    // 제외 = 시트와 DB를 아직 못 이었다는 뜻. 그 상태의 종료는 명단에 있는 학생을 자른다.
    expect(src).toMatch(/if \(APPLY_REMOVES && excluded\.length\)/);
  });

  it("동명이인 모호는 후보 전원을 종료 대상에서 뺀다", () => {
    expect(src).toContain("for (const c of m.candidates) excludedStudentIds.add(c.studentId)");
  });

  it("퇴원 학생을 자동으로 되살리지 않는다", () => {
    expect(src).toContain('hit.status === "withdrawn"');
    expect(src).toContain("사람이 확인 후 복구");
  });
});

describe("--roster-only — 명단만 맞추는 모드", () => {
  it("--roster 없이는 거절한다", () => {
    expect(src).toContain("--roster-only 에는 --roster=<탭> 이 필요합니다");
  });

  it("반을 새로 만들지 않는다", () => {
    // 명단만 맞추는 모드에서 반이 생기면 놀란다 — 신설은 컷오버 본 경로의 일이다.
    expect(src).toMatch(/ROSTER_ONLY \? \[\] : \[\.\.\.NEW_CLASSES_TO_CREATE/);
  });

  it("배치를 쓰기 전에 끝낸다", () => {
    // 🔴 exit이 구조 RPC보다 뒤면 배치까지 한 번 더 적용돼 스냅샷이 두 벌 생긴다.
    const only = code.indexOf("if (ROSTER_ONLY) {");
    const structureApply = code.indexOf("apply_english_structure(");
    expect(only).toBeGreaterThan(-1);
    expect(structureApply).toBeGreaterThan(-1);
    expect(only).toBeLessThan(structureApply);
  });
});

describe("명단 이동 — 미리보기가 사실을 말하는가", () => {
  it("드라이런이 신설·재활성 예정 반을 미리보기에 반영한다", () => {
    // 안 넣으면 그 반 명단이 통째로 '반 없음'으로 제외되고, 그 학생들이 원래 반에 남은 것으로 읽혀
    // **종료후보가 부풀려진다**(실측 9명·+8건).
    expect(src).toContain("dryCreated");
    expect(src).toContain("dryRevived");
    expect(src).toMatch(/if \(!APPLY && \(dryCreated\.length \|\| dryRevived\.length\)\)/);
  });
});
