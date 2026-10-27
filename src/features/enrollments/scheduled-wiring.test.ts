/**
 * **예약 배너의 게이트·쓰기 규약**을 잠근다.
 *
 * 세 가지가 함께 지켜져야 하고, 하나만 어긋나도 **에러 없이** 잘못 동작한다:
 *  ① 화면 버튼과 서버 액션이 **같은 축**의 게이트를 쓴다 — 갈리면 "버튼은 보이는데 누르면 거절"
 *     (또는 그 반대로 숨겨 놓고 서버는 열려 있는 [[#77]])이 된다.
 *  ② 쓰기 대상은 언제나 `enrollment.id` — 배너의 "A → B 이동"은 날짜 인접으로 **추론한 문구**라
 *     그걸로 대상을 고르면 남의 행을 건드린다.
 *  ③ 이미 시작된 예약은 **서버가** 거절한다 — 화면 조건은 게이트가 아니다.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { readMigration } from "@/lib/db/migrations-corpus.mjs";
const read = (...p: string[]) => readFileSync(join(process.cwd(), ...p), "utf8");
const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

const actions = stripComments(
  read("src", "features", "enrollments", "server", "scheduled-actions.ts"),
);
const studentPage = stripComments(read("src", "app", "(shell)", "students", "[id]", "page.tsx"));
const rpc = readMigration("0334a_scheduled_enrollment_atomic.sql");

describe("예약 수정·취소 — 게이트", () => {
  it("서버 액션은 반 관리(full) 게이트를 쓴다", () => {
    // 반 이동을 **만드는** 것과 같은 게이트(moveEnrollmentsBatch). 원장 전용 게이트를 쓰지 않는 이유는
    // 파일 주석 참조 — 아직 시작 안 한 예약은 취소+재생성과 같기 때문이다.
    expect(actions).toContain('canManageTenant(user.systemRole, "classes")');
  });

  it("화면 버튼도 같은 게이트를 쓴다(축이 갈리지 않게)", () => {
    expect(studentPage).toContain('canManageTenant(user.systemRole, "classes")');
    // 학생 권한으로 이 버튼을 열면 상담사에게 버튼이 보이고 서버가 거절한다.
    expect(studentPage).not.toMatch(/actions=\{\s*canManageStudent/);
  });

  it("이미 시작된 예약을 서버가 거절한다", () => {
    expect(actions).toContain("이미 시작된 수강은 예약으로 수정할 수 없습니다");
    expect(rpc).toContain("upcoming.start_date <= today");
  });

  it("과거 날짜로 옮기지 못한다", () => {
    expect(actions).toContain("date <= kstToday()");
    expect(rpc).toContain("next_date <= today");
  });
});

describe("예약 수정·취소 — 쓰기 대상", () => {
  it("두 액션 모두 enrollmentId로 행을 고른다", () => {
    // `.eq("id", …)`가 없으면 좌표·추론으로 대상을 고르고 있다는 뜻이다.
    expect(actions).toContain('rpc("change_scheduled_enrollment"');
    expect(actions).toContain("p_enrollment_id: input.enrollmentId");
    expect(actions).toContain("p_paired_enrollment_id: input.pairedEnrollmentId");
  });

  it("취소는 새 수강 삭제 → 옛 수강 재개방 순서다", () => {
    // 반대로 하면 두 수강이 겹쳐 GiST enrollments_no_overlap에 걸린다.
    const del = rpc.indexOf("delete from public.enrollments where id = upcoming.id");
    const reopen = rpc.indexOf("set end_date = null");
    expect(del).toBeGreaterThan(-1);
    expect(reopen).toBeGreaterThan(del);
  });

  it("옛 수강은 '반 이동' 흔적일 때만 되살린다", () => {
    // 그 사이 진짜 퇴원했으면 되살리지 않는다 — 되돌리기가 없던 재원생을 만들어서는 안 된다.
    expect(rpc).toContain("not previous.is_transferred");
    expect(rpc).toContain("previous.withdrawal_reason is distinct from '반 이동'");
  });

  it("짝 행 갱신이 0건이면 실패로 본다", () => {
    // 🔴 PostgREST는 매치 0을 **에러 없이** 돌려준다. 건수를 안 보면 새 시작일만 바뀌고 옛 종료일은
    //    그대로 남아(다른 반이라 GiST 미차단) 구멍·이중 등록이 된다. 취소 쪽은 반대로 그 학생이
    //    그날부터 어느 반에도 없게 된다.
    expect(rpc).toContain("get diagnostics changed = row_count");
    expect(rpc).toContain("if changed <> 1 then raise exception");
    expect(rpc).toContain("exception when others then");
  });

  it("짝 행이 같은 학생인지 확인한다", () => {
    // 짝 id는 클라가 보낸 값이다 — 확인 없이 쓰면 아무 전출 행이나 건드린다.
    expect(rpc).toContain("previous.student_id <> upcoming.student_id");
    expect(rpc).toContain("previous.tenant_id <> upcoming.tenant_id");
  });

  it("학생 기록을 바꾸므로 감사로그를 남긴다", () => {
    expect(actions).toContain("enrollment_reschedule");
    expect(actions).toContain("enrollment_schedule_cancel");
  });
});
