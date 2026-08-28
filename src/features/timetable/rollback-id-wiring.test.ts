/**
 * **예약 취소는 '좌표'가 아니라 id로 되돌린다** — 회귀 방지.
 *
 * 2026-08-29 적대 리뷰(codex·grok)에서 드러난 결함: `rollback_enrollment_import`(0233a)가 새 수강을
 * `(student_id, class_id = toClassId, start_date = 적용일)` **좌표**로 찾아 지웠다. 그 좌표는 누구든
 * 날짜나 반을 바꾸는 순간 깨진다 —
 *   · 대상 반이 바뀌면 → delete 0건 + 옛 수강만 재개방 = **이중 등록**(다른 반이라 GiST도 안 막는다)
 *   · 적용일이 바뀌면 → delete·update 모두 0건 = **조용한 no-op**("모든 게 무로"가 거짓말)
 * 가상의 위험이 아니었다: `EditableDateCell`(학생 상세 수업 탭·반 상세 명단)이 지금도 그 행의
 * `start_date`를 바꾼다. 그래서 0235a(RPC가 새 id 반환) + 0236a(id 우선 롤백)로 고쳤다.
 *
 * 이 파일은 그 세 조각(RPC 반환·롤백 판정·호출부 기록)이 **함께** 살아 있는지 잠근다. 하나만 되돌아가도
 * 되돌리기는 조용히 부정확해진다(에러가 안 난다 — 그래서 테스트가 필요하다).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (...p: string[]) => readFileSync(join(process.cwd(), ...p), "utf8");

/** 주석은 규칙을 **설명**하는 자리라 검사에서 뺀다(경고 문구가 스스로 위반으로 걸리지 않게). */
const stripSqlComments = (s: string) => s.replace(/^\s*--.*$/gm, "");
const stripTsComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

describe("0235a — 반 이동 RPC가 새 수강 id를 돌려준다", () => {
  const sql = stripSqlComments(
    read("supabase", "migrations", "0235a_move_enrollments_return_new_id.sql"),
  );

  it("insert가 만든 id를 받아 결과에 싣는다", () => {
    expect(sql).toMatch(/returning\s+id\s+into\s+v_new_id/i);
    expect(sql).toContain("'newEnrollmentId', v_new_id");
  });

  it("0228a의 on_hold·요일 승계를 잃지 않는다", () => {
    // 이 파일은 0228a의 **전체 재정의**다 — 새 id만 얹고 나머지는 그대로여야 한다.
    expect(sql).toContain("coalesce(v_on_hold, false)");
    expect(sql).toContain("attendance_days");
  });
});

describe("0236a — 되돌리기는 id 우선, 좌표는 폴백", () => {
  const sql = stripSqlComments(
    read("supabase", "migrations", "0236a_rollback_enrollment_import_by_id.sql"),
  );

  it("moves를 newEnrollmentId로 지운다", () => {
    expect(sql).toContain("newEnrollmentId");
    expect(sql).toMatch(/delete from public\.enrollments\s+where id = v_new_id/i);
  });

  it("옛 스냅샷용 좌표 폴백을 남긴다", () => {
    // 이미 쌓인 스냅샷엔 새 id가 없다 — 폴백을 지우면 그 예약들의 취소가 통째로 죽는다(#95 읽기 쪽).
    expect(sql).toContain("toClassId");
    expect(sql).toMatch(/start_date = v_eff/);
  });

  it("옛 수강 재개방에 종료일 일치를 요구하지 않는다", () => {
    // `end_date = v_eff`를 걸면 누가 종료일을 옮긴 순간 되돌리기가 조용히 no-op이 된다.
    expect(sql).not.toMatch(/end_date\s*=\s*v_eff\s*;/);
    expect(sql).toContain("end_date is not null");
  });

  it("반 이동이 남긴 흔적일 때만 재개방한다(진짜 퇴원을 되살리지 않는다)", () => {
    // 되돌리기가 '없던 재원생'을 만들어서는 안 된다 — 사유·전출 표식 둘 다 확인한다.
    expect(sql).toContain("is_transferred = true");
    expect(sql).toContain("withdrawal_reason = '반 이동'");
  });

  it("미래 예약분만 되돌린다", () => {
    expect(sql).toContain("v_eff <= current_date");
  });

  it("행 수를 get diagnostics로 센다(분기 밖 found 금지)", () => {
    // `if found`는 직전 문장에 좌우돼 분기 안팎에서 뜻이 달라진다 — 카운트가 조용히 틀어진다.
    expect(sql).toMatch(/get diagnostics v_n = row_count/i);
  });
});

describe("applyDiff — 스냅샷 없이는 쓰지 않고, 만든 id를 적어 둔다", () => {
  const src = stripTsComments(
    read("src", "features", "timetable", "server", "import-actions.ts"),
  );

  it("스냅샷 insert 오류를 확인하고 적용을 중단한다", () => {
    // 예전엔 `{ data: snap }`만 받아 실패해도 그대로 적용했다 = 되돌릴 수 없는 적용.
    expect(src).toMatch(/error:\s*snapErr/);
    expect(src).toMatch(/if \(snapErr \|\| !snap\?\.id\)/);
  });

  it("RPC 결과의 newEnrollmentId를 moves에 기록한다", () => {
    expect(src).toContain("newEnrollmentId");
    expect(src).toMatch(/m\.newEnrollmentId = id/);
  });

  it("추가한 수강의 id도 기록한다", () => {
    expect(src).toMatch(/a\.enrollmentId = made\.id/);
  });

  it("기록한 id를 스냅샷 payload에 되쓴다", () => {
    // 스냅샷은 쓰기 **전에** 저장되므로, 새 id는 적용 후 갱신하지 않으면 영원히 안 남는다.
    expect(src).toMatch(/from\("timetable_snapshots"\)\s*\.update\(\{ payload: diff \}\)/);
  });
});
