/**
 * '다른 강사 뷰'(열람 전용, 2026-08-19)의 배선이 **되돌아가지 않게** 잠근다.
 *
 * 이 기능은 "권한이 아니라 스코프만" 바꾼다 — effectiveTeacherId가 열람 대상을 돌려주는 순간,
 * 그 id를 **쓰기 귀속**에 쓰는 액션은 관리자가 그 강사 명의로 저장·발송하는 구멍이 된다. 방어는 두 겹:
 *  ① perm-matrix 중앙 캡 — canWriteTenant/accessLevelTenant를 지나는 모든 mutation이 자동 거절.
 *  ② effectiveTeacherId를 게이트·귀속으로 직접 쓰는 액션 파일의 명시 가드(readonlyTeacherViewError).
 * ②의 파일 목록이 아래다 — **effectiveTeacherId를 쓰기 게이트로 쓰는 액션 파일을 새로 만들면 가드를
 * 넣고 여기에도 추가**할 것. (canWriteTenant만 지나는 쓰기는 ①이 커버하므로 등재 불요.)
 *
 * 추가로: 열람 사실이 대상 강사에게 새는 유일한 통로였던 presence track 차단과, 열람 감사로그가
 * 계속 배선돼 있는지도 잠근다(원장 지시: "강사가 모르도록").
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (...p: string[]) => readFileSync(join(process.cwd(), ...p), "utf8");

/** ② 명시 가드 파일 — effectiveTeacherId(또는 본인 축 우회)가 쓰기 게이트인 액션들. */
const GUARDED_ACTION_FILES: { file: string[]; what: string }[] = [
  {
    file: ["src", "features", "onescreen", "server", "actions.ts"],
    what: "보고서 저장·발송·공유링크·AI 멘트·개인 설정",
  },
  {
    file: ["src", "features", "onescreen", "server", "notice-actions.ts"],
    what: "학부모 공지 발송(외부 발신)",
  },
  {
    file: ["src", "features", "onescreen", "server", "notice-attachment-actions.ts"],
    what: "공지 이미지 첨부",
  },
  {
    file: ["src", "features", "onescreen", "server", "order-actions.ts"],
    what: "학생 표시 순서(teacher_id=대상 행 클로버링)",
  },
  {
    file: ["src", "features", "onescreen", "server", "attachment-actions.ts"],
    what: "보고서 이미지 첨부(겸직 본인 축 우회)",
  },
  {
    file: ["src", "features", "report-admin", "server", "recall-actions.ts"],
    what: "학부모 게시글 회수(겸직 본인 축 우회 — canWriteTenant 캡 후 소유 판정이 본인 id로 열린다)",
  },
  {
    // ECS 쓰기 게이트(accessLevelTenant)가 캡으로 이미 거절하지만, 열람자의 편집 기록이 남을 여지를 두지 않게
    // 명시 가드를 먼저 둔다(원장 결정 2026-09-14 칸 편집 감사로그).
    file: ["src", "features", "class-sheets", "server", "edit-audit-actions.ts"],
    what: "강사 시트 칸 편집 감사로그(열람 중엔 기록도 없다)",
  },
  {
    // 수학 시트 목표 칸 감사로그(범위 확대 2026-09-14) — 같은 이유로 명시 가드를 먼저 둔다.
    file: ["src", "features", "math-sheets", "server", "goal-audit-actions.ts"],
    what: "수학 시트 목표 칸 편집 감사로그(열람 중엔 기록도 없다)",
  },
  {
    // 할 일 게이트가 '다른 강사 뷰'면 대상 강사를 돌려준다(2026-11-05) — 업무 요청은 그 강사 명의로 쓰므로 읽기 강사뷰를 막는다.
    file: ["src", "features", "work-requests", "server", "actions.ts"],
    what: "업무 요청 만들기·처리(강사뷰 대상 명의)",
  },
];

describe("'다른 강사 뷰'(열람 전용) 배선 가드", () => {
  it("perm-matrix가 중앙 쓰기 캡(isReadonlyTeacherView)을 문다 — canWriteTenant·accessLevelTenant", () => {
    const src = read("src", "lib", "auth", "perm-matrix.ts");
    expect(src).toContain("isReadonlyTeacherView");
  });

  for (const { file, what } of GUARDED_ACTION_FILES) {
    it(`${file.at(-1)}(${what})에 readonlyTeacherViewError 가드가 있다`, () => {
      expect(read(...file)).toContain("readonlyTeacherViewError");
    });
  }

  it("전환 액션 — 진입은 감사로그, 이탈(관리자뷰·본인 강사뷰)은 대상 쿠키를 지운다", () => {
    const src = read("src", "features", "shell", "view-actions.ts");
    expect(src.match(/jar\.set\(VIEW_AS_COOKIE/g)?.length).toBe(1); // 세팅은 switchToOtherTeacherView 한 곳
    expect(src.match(/jar\.delete\(VIEW_AS_COOKIE\)/g)?.length).toBe(2); // adminView + 본인 teacherView
    expect(src).toContain('action: "teacher_view_impersonate"');
  });

  it("presence — 열람 중엔 track이 전면 차단된다(대상 강사가 열람을 모르게)", () => {
    expect(read("src", "features", "presence", "edit-presence.tsx")).toContain("trackDisabled");
    // (shell) 레이아웃의 세 EditPresenceProvider(임베드·미니셸·풀셸) 전부에 걸려 있어야 한다 —
    // 한 곳이라도 빠지면 그 셸에서 연 화면이 대상 강사의 원스크린 '동시 열림' 경고에 뜬다.
    const layout = read("src", "app", "(shell)", "layout.tsx");
    // 2026-10-12: 운영 콘솔의 '지점 보기'(읽기 전용)도 같은 자리에서 막는다 — 조건 뒤에 `|| !!user.tenantView`가 붙었다.
    expect(layout.match(/trackDisabled=\{viewAs\?\.access === "readonly" \|\| !!user\.tenantView\}/g)?.length).toBe(3);
  });

  it("원스크린 로스터 — 강사 축이 열람 대상(viewAsTeacher)을 따른다", () => {
    expect(read("src", "features", "onescreen", "server", "roster.ts")).toContain("viewAsTeacher");
  });

  it("지난 보고서·발송 달력 — 이름 축이 열람 대상을 따른다(안 맞추면 열람자 본인의 빈 이력이 나온다)", () => {
    expect(read("src", "features", "onescreen", "server", "history-actions.ts")).toContain("viewAsTeacher");
    expect(read("src", "features", "onescreen", "server", "calendar-actions.ts")).toContain("viewAsTeacher");
  });

  it("대상 검증은 loadViewAsTarget 단일 소스 — 진입 액션이 자체 select로 갈라지지 않는다", () => {
    const actions = read("src", "features", "shell", "view-actions.ts");
    expect(actions).toContain("loadViewAsTarget");
    // 진입 액션 안에 대상 users select 복제본이 없어야 한다(활성·비학생 조건이 두 벌이면 반드시 갈라진다).
    expect(actions).not.toContain('select("id, tenant_id, display_name');
  });

  it("거절 문구는 서버·클라 단일 소스(view-as-message) — 사본이면 한쪽만 고쳐진다", () => {
    expect(read("src", "lib", "auth", "view-as.ts")).toContain('from "@/lib/auth/view-as-message"');
    expect(read("src", "features", "onescreen", "components", "onescreen-client.tsx")).toContain(
      'from "@/lib/auth/view-as-message"',
    );
  });

  it("원스크린 클라 — 열람 전용이면 카드·표의 입력·발송이 화면에서도 잠긴다(원장 2026-08-19 제보)", () => {
    // 서버 거절만으론 부족하다 — 버튼이 활성으로 보이면 "발송될 것처럼" 읽힌다. locked 축과 핸들러 가드 둘 다.
    expect(read("src", "features", "onescreen", "components", "onescreen-client.tsx")).toContain("readonlyBlocked");
    expect(read("src", "features", "onescreen", "components", "report-card.tsx")).toContain(
      "readonlyView || !isRowInputEditable",
    );
    expect(read("src", "features", "onescreen", "components", "grid-row.tsx")).toContain(
      "gen.readonlyView || !isRowInputEditable",
    );
    expect(read("src", "app", "(shell)", "onescreen", "page.tsx")).toContain('readonlyView={viewAs?.access === "readonly"}');
  });

  it("감사 레지스트리 — 열람·토글 액션 키가 한글 라벨로 등록돼 있다", () => {
    const src = read("src", "features", "audit", "server", "log.ts");
    expect(src).toContain("teacher_view_impersonate:");
    expect(src).toContain("staff_teacher_view_access:");
  });
});

/**
 * '다른 강사 뷰' = **그 사람**(원장 2026-11-05 *"강사뷰 전환시에 실제 그 사람으로 완벽하게 전환되는지 … 모든 면에서 빠짐없이"*).
 * 메뉴 권한만 대상으로 바뀌고 '내 알림 · 내 할 일 · 담당 · 운영 계정 우회'가 보는 사람으로 남던 구멍(점검 2026-11-05 45곳)이
 * 되돌아가지 않게 잠근다. 계기: 김태건 선생님 앞 '퇴원보고서 작성 요청'이 강사뷰 벨 · 내 할 일에 안 떴다.
 */
describe("'다른 강사 뷰' = 그 사람(신원 축)", () => {
  it("운영 계정 우회는 강사뷰 중 꺼지고, 강사뷰 자격 · 실제 계정 권한표만 실제 계정 판정을 쓴다(순환 방지)", () => {
    const sa = read("src", "lib", "auth", "super-admin.ts");
    const current = /export const isCurrentUserSuperAdmin[\s\S]*?\n}\);/.exec(sa)?.[0] ?? "";
    expect(current).toContain("await isSignedInSuperAdmin()");
    expect(current).toContain("viewAsTeacher()");
    for (const f of [["src", "lib", "auth", "perm-matrix.ts"], ["src", "lib", "auth", "view-as.ts"]]) {
      const src = read(...f);
      expect(src).not.toContain("isCurrentUserSuperAdmin");
      expect(src).toContain("isSignedInSuperAdmin()");
    }
  });
  it("벨 받은함 — 강사뷰면 그 강사의 알림(관리 연결 + 받는 사람 · 지점 명시), 목록 · 쓰기 · 할 일 칩이 한 문을 지난다", () => {
    const inbox = read("src", "features", "notifications", "server", "inbox.ts");
    expect(inbox).toContain("await viewAsTeacher()");
    expect(inbox).toContain('writable: target.access === "full"');
    for (const f of [["src", "features", "notifications", "server", "queries.ts"], ["src", "features", "notifications", "server", "actions.ts"], ["src", "features", "staff-tasks", "server", "bell.ts"]]) {
      const src = read(...f);
      expect(src).toContain("notificationInbox()");
      expect(src).not.toContain('from "@/lib/supabase/server"');
    }
    // 쓰기는 모두 받는 사람 · 지점을 명시한다(관리 연결은 RLS가 없다).
    const actions = read("src", "features", "notifications", "server", "actions.ts");
    expect(actions.split('.eq("recipient_id", inbox.recipientId)').length - 1).toBeGreaterThanOrEqual(6);
  });
  it("내 할 일 — 할 일 게이트가 강사뷰 대상을 쓴다", () => {
    expect(read("src", "features", "staff-tasks", "server", "gate.ts")).toContain("getCurrentUser({ teacherView: true })");
  });
  it("착지 경로 — 자리 · 셔틀 담당을 강사뷰 대상으로 본다", () => {
    const home = read("src", "lib", "auth", "teacher-home.ts");
    const landing = /export async function landingPath[\s\S]*?\n}/.exec(home)?.[0] ?? "";
    expect(landing).toContain("getCurrentUser({ teacherView: true })");
  });
  it("공지 팝업 — 대상 역할은 강사뷰 대상, '다시 보지 않기'는 보는 사람 본인(셸과 라우트가 같은 판정)", () => {
    expect(read("src", "app", "(shell)", "layout.tsx")).toContain("getActivePopups(viewAs?.systemRole ?? user.systemRole, user.tenantId, user.id)");
    expect(read("src", "app", "api", "notice-popups", "route.ts")).toContain("getActivePopupsOrThrow(viewAs?.systemRole ?? user.systemRole, user.tenantId, user.id)");
  });
  it("전자결재 — 강사뷰에서 메뉴를 닫고, 메뉴를 보지 않는 결재 · 회수 문도 막는다(결재는 본인 서명)", () => {
    const perm = read("src", "lib", "auth", "perm-matrix.ts");
    expect(perm).toMatch(/export const TEACHER_VIEW_CLOSED_MENUS: readonly MenuKey\[\] = \["approvals"\];/);
    expect(perm).toContain("TEACHER_VIEW_CLOSED_MENUS.includes(menu)");
    const approvals = read("src", "features", "approvals", "server", "actions.ts");
    const signedIn = /async function requireSignedIn[\s\S]*?\n}/.exec(approvals)?.[0] ?? "";
    expect(signedIn).toContain("if (await viewAsTeacher()) return { error: TEACHER_VIEW_APPROVAL_ERROR };");
  });
});
