/**
 * '다른 강사 뷰' 신원 배선 가드(원장 2026-11-05 *"강사뷰 전환시에 실제 그 사람으로 완벽하게 전환되는지 … 모든 면에서 빠짐없이"*).
 *
 * 업무 판정(담당·소유·본인 글)과 업무 기록의 명의 칸은 **대상 X**(`getCurrentUser({ teacherView: true })`)다.
 * 실제 계정 A(`getCurrentUser()`)로 남는 것은 감사로그·인증·개인 표시 설정(ui_prefs)·푸시 구독뿐이다.
 * 동작 테스트가 무거운 곳(서버 컴포넌트 화면 · 관리자 작성 경로)은 여기서 **호출 모양**을 잠근다 — 누가 `getCurrentUser()`로
 * 되돌리면 에러 없이 'X 화면인데 A 명의'가 되살아난다.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (...p: string[]) => readFileSync(join(process.cwd(), ...p), "utf8").replace(/\r\n/g, "\n");
/** `export async function name(` 부터 다음 `export ` 전까지 — 그 함수 본문. */
function fnBody(src: string, name: string): string {
  const i = src.indexOf(`export async function ${name}(`);
  if (i < 0) throw new Error(`함수 없음: ${name}`);
  const j = src.indexOf("\nexport ", i + 10);
  return src.slice(i, j < 0 ? undefined : j);
}
const TV = "getCurrentUser({ teacherView: true })";

describe("강사뷰 신원 — 화면의 '나'가 서버 액션의 행위자와 같다", () => {
  it("교재 요청 — 요청 강사 이름 기본값·내 요청 판정이 대상 X", () => {
    const page = read("src", "app", "(shell)", "textbook-requests", "page.tsx");
    expect(page).toContain("requesterName={actor?.displayName ?? user.displayName}");
    expect(page).toContain("viewerUserId={actor?.id ?? user.id}");
  });

  it("지출결의서 — 작성자 표시가 대상 X", () => {
    expect(read("src", "app", "(shell)", "expense-requests", "page.tsx")).toContain("requesterName={actor?.displayName ?? user.displayName}");
  });

  it("원생상담 작성·수정 — 상담사 칸 기본값·자동 과목의 '나'가 대상 X", () => {
    const created = read("src", "app", "(shell)", "consultations", "new", "page.tsx");
    expect(created).toContain(TV);
    expect(created).toContain("currentUserId={me.id}");
    expect(created).toContain("currentUserName={me.displayName}");
    const edited = read("src", "app", "(shell)", "consultations", "[id]", "edit", "page.tsx");
    expect(edited).toContain(TV);
    expect(edited).toContain("currentUserId={(actor ?? viewer).id}");
  });

  it("신규 콜&상담 작성 — 상담자 칸 기본값이 대상 X", () => {
    const page = read("src", "app", "(shell)", "enrollment", "new", "page.tsx");
    expect(page).toContain(TV);
    expect(page).toContain("counselor={(actor ?? viewer).displayName}");
  });
});

describe("강사뷰 신원 — 관리자 작성·발송 경로의 명의가 대상 X", () => {
  it("관리자 보고서 작성(저장·발송·대량) — 담임 표기 기본값·보강 귀속", () => {
    const src = read("src", "features", "report-admin", "server", "compose-actions.ts");
    for (const fn of ["saveAdminReport", "saveAndQueueAdminReport", "sendBulkAdminReports"]) {
      expect(fnBody(src, fn), fn).toContain(TV);
    }
  });

  it("원생 개별 공지(미리보기·발송 공용 준비) — 큐의 created_by", () => {
    expect(read("src", "features", "report-admin", "server", "prepare-class-notice.ts")).toContain(TV);
  });

  it("ClassNote 원아 연결 — linked_by는 X, audit_logs 행위자는 실제 계정 그대로", () => {
    const src = read("src", "features", "report-admin", "server", "board-roster-actions.ts");
    expect(src).toContain(`linked_by: (await ${TV})?.id ?? user.id`);
    expect(src).toContain("actor_id: user.id");
  });
});
