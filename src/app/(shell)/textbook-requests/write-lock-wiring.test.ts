import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 구조 가드 — 읽기 권한 화면 규칙(원장 2026-11-05, src/lib/write-lock.ts)이 교재 요청·지출결의서·교재목록 배정 면에서
 * 다시 풀리지 않게 잠근다. 회의록에서 난 증상("'+ 새 회의록'이 떠서 다 쓰고 저장하면 그제서야 권한이 없다")은
 * 화면이 쓰기 판정을 **안 받거나**, 서버와 **다른 함수**를 보면 조용히 되살아난다 — 둘 다 에러가 없다.
 */
const ROOT = join(__dirname, "..", "..", "..", "..");
// ⚠️ 체크아웃이 CRLF일 수 있다(Windows) — 줄바꿈을 정규화해야 여러 줄 패턴이 헛돌지 않는다.
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8").replace(/\r\n/g, "\n");

describe("교재 요청 — 서버 게이트와 같은 판정으로 양식을 잠근다", () => {
  const page = read("src/app/(shell)/textbook-requests/page.tsx");
  const client = read("src/app/(shell)/textbook-requests/_client.tsx");
  const history = read("src/app/(shell)/textbook-requests/request-history.tsx");
  const actions = read("src/features/billing/server/textbook-actions.ts");

  it("페이지는 서버 액션과 같은 행위자·같은 메뉴 키로 쓰기 여부를 계산해 내린다", () => {
    expect(actions).toContain('canWriteTenant(user.systemRole, "textbook_requests")');
    expect(page).toContain("getCurrentUser({ teacherView: true })");
    expect(page).toContain('canWriteTenant(actor.systemRole, "textbook_requests")');
    expect(page).toContain("canWrite={canWrite}");
  });

  it("읽기 권한이면 저장·발송 단추(양식 하단)를 그리지 않고 칸은 권한 안내로 잠근다", () => {
    expect(client).toMatch(/\{canWrite \? \(\s*<TextbookFormFooter/);
    expect(client).toContain('writeLockedPlaceholder("textbook_requests")');
    expect(client).toContain("<TextbookMentField value={ment} onChange={editMent} disabled={!canWrite} />");
  });

  it("요청 내역의 수정·삭제·발송은 소유 판정 전에 쓰기 권한을 본다(사무실은 mine이 늘 참)", () => {
    expect(history).toContain("const canManage = canWrite && mine && isUntouched(row);");
    expect(history).toContain("onSend={canWrite ? onSend : undefined}");
  });
});

describe("지출결의서 — 화면과 서버가 expenseWriteScope 한 함수를 쓴다", () => {
  const page = read("src/app/(shell)/expense-requests/page.tsx");
  const client = read("src/app/(shell)/expense-requests/_client.tsx");
  const actions = read("src/features/billing/server/expense-actions.ts");

  it("판정 함수는 서버 전용 모듈 하나 — 액션 파일 안에 사본을 다시 두지 않는다", () => {
    expect(actions).toContain('import { expenseWriteScope } from "./expense-scope";');
    expect(actions).not.toMatch(/async function expenseWriteScope/);
    expect(page).toContain("expenseWriteScope(actor.systemRole)");
  });

  it("읽기 권한이면 '새 지출결의서'를 그리지 않고 증빙 창은 열람 전용으로 연다", () => {
    expect(client).toMatch(/\{canWrite \? \(\s*<Button onClick=\{\(\) => setDialog\(\{ expense: null \}\)\}>/);
    expect(client).toContain("canEdit={canWrite}");
  });
});

describe("교재목록 배정 면 — [배정 삭제]는 서버와 같은 반 단위 ECS 쓰기 게이트로 고른다", () => {
  const page = read("src/app/(shell)/textbooks/page.tsx");
  const face = read("src/app/(shell)/textbooks/_components/plans-face.tsx");
  const access = read("src/features/textbooks/server/plan-delete-access.ts");

  it("화면 판정 = deleteClassTextbookPlan의 게이트(requireEcsClassAccess write)", () => {
    expect(access).toContain("requireEcsClassAccess(classId, { write: true })");
    expect(page).toContain("planDeletableClassIds(");
    expect(face).toContain("deletable.has(p.classId)");
  });
});
