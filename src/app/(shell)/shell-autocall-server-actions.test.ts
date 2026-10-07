import { existsSync, readFileSync } from "node:fs";
import { dirname, join, normalize, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 구조 가드 — **Next 기본 오류 화면**("This page couldn't load", 2026-10-01 · gotchas #137)의 재발 방지.
 *
 * 원리(재현 수치는 gotchas #137): 문서를 새로 열 때 페이지가 loading.tsx(Suspense) 아래에서 redirect하면 Next가
 * meta refresh를 끼우고 그 이동을 하드 이동으로 처리한다. 그 순간 셸이 **서버 액션**을 부르고 있으면(라우터 작업 큐)
 * Router가 React #310으로 죽고, 우리 global-error보다 바깥의 Next 기본 화면이 뜬다. 막는 줄은 셋이다.
 *  ① 셸(풀셸·미니셸·창)에서 저절로(마운트·주기) 도는 조회는 서버 액션이 아니라 GET 라우트 + fetch.
 *  ② 대시보드 권한 게이트는 loading.tsx **앞**(레이아웃) — 거부가 HTTP 307로 나간다.
 *  ③ "처음으로"(로고·바탕 보기·관리자뷰 전환·로그인 착지)는 권한을 본 홈 — 권한 없는 사람을 `/dashboard`로 보내지 않는다.
 */
const ROOT = join(__dirname, "..", "..", "..");
const SRC = join(ROOT, "src");
// ⚠️ 체크아웃이 CRLF일 수 있다(Windows) — 줄바꿈을 정규화한다.
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8").replace(/\r\n/g, "\n");
const relOf = (abs: string) => relative(ROOT, abs).replace(/\\/g, "/");

const DIRECTIVE = (word: string) =>
  new RegExp(`^\\s*(?:\\/\\*[\\s\\S]*?\\*\\/\\s*|\\/\\/.*\\n\\s*)*["']use ${word}["']`);
const isServerAction = (src: string) => DIRECTIVE("server").test(src);

function resolveImport(spec: string, from: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = join(SRC, spec.slice(2));
  else if (spec.startsWith(".")) base = normalize(join(dirname(from), spec));
  else return null; // 패키지 — 따라가지 않는다
  for (const ext of ["", ".ts", ".tsx", ".js", ".jsx", "/index.ts", "/index.tsx"]) {
    const p = base + ext;
    if (/\.(tsx?|jsx?)$/.test(p) && existsSync(p)) return p;
  }
  return null;
}

/** 값으로 가져온 이름(`import type`·`type X`는 뺀다). 기본·네임스페이스 import는 그 형태를 이름으로 남긴다. */
function valueNames(clause: string): string[] {
  const names: string[] = [];
  const brace = clause.match(/\{([\s\S]*)\}/);
  const head = clause.replace(/\{[\s\S]*\}/, "").replace(/,/g, " ").trim();
  if (head) names.push(head.startsWith("*") ? "*" : "default");
  if (brace) {
    for (const part of brace[1]!.split(",")) {
      const t = part.trim();
      if (!t || t.startsWith("type ")) continue;
      names.push(t.split(/\s+as\s+/)[0]!.trim());
    }
  }
  return names;
}

/**
 * 셸·루트 레이아웃에서 import로 닿는 모듈 전부를 훑어 **서버 액션 파일에서 값을 가져오는 곳**을 모은다.
 * (클라 경계 안이든 밖이든 다 모은다 — 서버 컴포넌트가 액션을 prop으로 넘기는 길도 같은 입구다.)
 */
function collectShellServerActionImports(): Map<string, Set<string>> {
  const IMPORT = /(?:import|export)\s+(type\s+)?([\s\S]*?)\s+from\s+["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g;
  const found = new Map<string, Set<string>>();
  const seen = new Set<string>();
  const stack = [join(SRC, "app", "(shell)", "layout.tsx"), join(SRC, "app", "layout.tsx")];
  while (stack.length) {
    const file = stack.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    const src = readFileSync(file, "utf8").replace(/\r\n/g, "\n");
    for (const m of src.matchAll(IMPORT)) {
      const typeOnly = !!m[1];
      const spec = m[3] ?? m[4]!;
      const target = resolveImport(spec, file);
      if (!target) continue;
      const targetSrc = readFileSync(target, "utf8").replace(/\r\n/g, "\n");
      if (isServerAction(targetSrc)) {
        if (typeOnly) continue;
        const names = m[2] !== undefined ? valueNames(m[2]) : ["(dynamic)"];
        if (names.length === 0) continue;
        const key = `${relOf(file)} -> ${relOf(target)}`;
        const set = found.get(key) ?? new Set<string>();
        names.forEach((n) => set.add(n));
        found.set(key, set);
        continue; // 서버 액션 파일 안은 서버 코드다 — 더 따라가지 않는다
      }
      stack.push(target);
    }
  }
  return found;
}

/**
 * 셸에서 닿는 서버 액션 — **누를 때(또는 사용자가 연 대화창 안에서만) 부르는 것**만 여기 둔다.
 * 🔴 새 줄을 더하기 전에 확인할 것: 그 액션이 마운트·경로 변경·포커스·setInterval로 **저절로** 불리면 안 된다 —
 *    그런 조회는 GET 라우트 + fetch로 만든다(알림 벨 `/api/notifications` 선례, gotchas #137).
 */
const ALLOWED: Record<string, string[]> = {
  // 메뉴를 연 기록 — 클릭 때만
  "src/components/app-sidebar.tsx -> src/features/nav/server/visit-actions.ts": ["recordMenuVisit"],
  "src/components/workspace/menu-hub-grid.tsx -> src/features/nav/server/visit-actions.ts": ["recordMenuVisit"],
  // 뷰 전환 — 클릭(목록은 드롭다운을 열 때)
  "src/components/other-teacher-view.tsx -> src/features/shell/view-actions.ts": [
    "listTeacherViewTargets",
    "switchToAdminView",
    "switchToOtherTeacherView",
  ],
  "src/components/teacher-menu.tsx -> src/features/shell/view-actions.ts": ["switchToAdminView"],
  "src/components/view-mode-toggle.tsx -> src/features/shell/view-actions.ts": ["switchToTeacherView"],
  "src/components/user-menu.tsx -> src/app/(auth)/login/actions.ts": ["signOut"],
  "src/features/teacher-view/lang-switch.tsx -> src/features/teacher-view/server/actions.ts": ["setMyTeacherLang"],
  // 화면 최대화 저장 — '화면 최대화'·'화면 원래대로'를 누를 때만(setMaximized). 첫 값은 서버가 initial로 내려준다.
  "src/components/page-maximize/page-maximize-root.tsx -> src/features/page-maximize/server/actions.ts": [
    "setMyPageMaximized",
  ],
  // 공지 팝업 닫기 — 클릭
  "src/features/notices/components/notice-popup-card.tsx -> src/features/notices/server/dismiss-actions.ts": [
    "dismissNoticePopup",
    "undismissNoticePopup",
  ],
  // 알림 벨 — 읽음·보관·삭제(클릭). 🔴 목록 조회는 여기 없다(GET 라우트).
  "src/features/notifications/components/notification-bell.tsx -> src/features/notifications/server/actions.ts": [
    "archiveNotification",
    "deleteNotification",
    "markNotificationsRead",
    "unarchiveNotification",
  ],
  // 학부모 글 답글·공감 — 벨이 **열려 있는 동안**(열 때 + 열린 채 폴링으로 목록이 바뀔 때)·대화창을 연 뒤·처리 중(busy)에만
  // 돈다. 문서를 새로 연 순간엔 벨이 닫혀 있어 안 돈다(이번 오류의 조건 밖).
  // ⚠️ 이 가드는 **이름 단위**다 — 허용된 액션을 마운트 effect로 옮기는 변화는 못 잡는다(리뷰에서 그 자리를 함께 볼 것).
  "src/features/classnote-reply/components/use-reply-targets.ts -> src/features/classnote-reply/server/reply-actions.ts": [
    "getReplyTargetsForNotifications",
  ],
  "src/features/classnote-reply/components/use-reply-thread.ts -> src/features/classnote-reply/server/reply-actions.ts": [
    "getParentReplyContext",
  ],
  // 같은 답글 창을 알림에서 열 때 사용한다. 닫힌 셸에서는 마운트되지 않고, 열린 대화의 원문 복구만 폴링한다.
  "src/features/classnote-reply/components/use-reply-thread.ts -> src/features/classnote-reply/server/notification-reply.ts": [
    "getNotificationReplyContext",
  ],
  "src/features/classnote-reply/components/reply-thread.tsx -> src/features/classnote-reply/server/reply-actions.ts": [
    "requestParentReply",
    "requestParentReplyDelete",
    "requestParentReplyEdit",
  ],
  "src/features/classnote-reply/components/reaction-control.tsx -> src/features/classnote-reply/server/reaction-actions.ts": [
    "getParentReactionState",
    "requestParentReaction",
    "requestParentReactionRemove",
  ],
};

describe("셸이 저절로 부르는 서버 액션 없음(gotchas #137)", () => {
  it(
    "셸에서 닿는 서버 액션 import는 허용 목록(누를 때만 부르는 것)뿐이다",
    () => {
      const found = collectShellServerActionImports();
      const unexpected: string[] = [];
      for (const [key, names] of found) {
        const allowed = new Set(ALLOWED[key] ?? []);
        for (const n of names) if (!allowed.has(n)) unexpected.push(`${key} : ${n}`);
      }
      expect(
        unexpected,
        "셸(레이아웃)에서 닿는 새 서버 액션입니다. 마운트·폴링으로 저절로 부르면 Next 기본 오류 화면이 뜹니다(gotchas #137) —\n" +
          "저절로 도는 조회는 GET 라우트 + fetch로 바꾸고, 누를 때만 부르는 것이면 ALLOWED에 이유와 함께 더하세요.\n" +
          unexpected.join("\n"),
      ).toEqual([]);
      // 훑기가 헛돌지 않았는지(경로가 바뀌어 아무것도 못 찾으면 가드가 무의미해진다).
      expect(found.size).toBeGreaterThan(3);
    },
    60_000,
  );

  it("알림 벨 목록은 GET 라우트로 가져온다(서버 액션 아님)", () => {
    const bell = read("src/features/notifications/components/notification-bell.tsx");
    expect(bell).toContain("fetchMyNotificationsList(view, limit)");
    expect(read("src/features/notifications/fetch-my-notifications.ts")).toContain('"/api/notifications"');
    expect(read("src/features/notifications/server/actions.ts")).not.toMatch(/export async function fetchMyNotifications\b/);
    const route = read("src/app/api/notifications/route.ts");
    expect(route).toContain("getMyNotifications("); // 인증·격리는 종전 액션과 같은 함수(#77)
    expect(route).toContain('"Cache-Control": "no-store"');
  });
});

describe("대시보드 권한 게이트는 loading.tsx 앞(gotchas #137)", () => {
  it("dashboard/layout.tsx가 requireAccess('dashboard')로 막는다", () => {
    expect(existsSync(join(SRC, "app", "(shell)", "dashboard", "loading.tsx"))).toBe(true);
    const layout = read("src/app/(shell)/dashboard/layout.tsx");
    expect(layout).toContain('await requireAccess("dashboard")');
  });
});

describe("'처음으로'는 권한을 본 홈(gotchas #137)", () => {
  it("관리자뷰 전환은 본인 유효 매트릭스로 홈을 고른다", () => {
    const src = read("src/features/shell/view-actions.ts");
    // 🔑 **본인(행위자)** 매트릭스다 — 강사 뷰에서는 `getUserPermMatrix`가 보는 대상 강사의 권한을 따른다(2026-10-07).
    //    관리자뷰로 돌아가는 홈을 그것으로 고르면 그 강사 권한으로 정해진다. 매트릭스 없이 부르는 것(코드 기본값)도 여전히 금지.
    expect(src).toContain("roleHome(user.systemRole, await getActorPermMatrix())");
    expect(src).not.toMatch(/roleHome\(user\.systemRole\)/);
  });

  it("로고·바탕 보기는 /dashboard를 직접 적지 않는다", () => {
    for (const f of [
      "src/components/app-sidebar.tsx",
      "src/components/mobile-top-nav.tsx",
      "src/components/workspace/use-show-desktop.ts",
    ]) {
      const src = read(f);
      expect(src, f).not.toMatch(/href="\/dashboard"/);
      expect(src, f).toContain("useShellHome()");
    }
    expect(read("src/components/workspace/use-show-desktop.ts")).not.toContain('"/dashboard"');
    expect(read("src/app/(shell)/layout.tsx")).toContain("<ShellHomeProvider href={shellHome}>");
  });

  it("로그인 착지(/home)·루트 착지는 개인 예외까지 얹은 매트릭스를 쓴다", () => {
    for (const f of ["src/app/home/route.ts", "src/app/(marketing)/page.tsx"]) {
      const src = read(f);
      expect(src, f).toContain("landingPath(user.systemRole, await getUserPermMatrix())");
      expect(src, f).not.toMatch(/\bgetPermMatrix\b/);
    }
    // 총괄 화면에서 튕긴 일반 사용자 = 착지 단일 소스(/home) — 코드 기본 권한으로 /dashboard를 고르지 않는다.
    const superAdmin = read("src/lib/auth/super-admin.ts");
    expect(superAdmin).toContain('redirect("/home")');
    expect(superAdmin).not.toMatch(/["']\/dashboard["']/);
  });
});
