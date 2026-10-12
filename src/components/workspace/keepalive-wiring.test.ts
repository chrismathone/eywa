import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { KEEPALIVE_MAIN_CLASS, KEEPALIVE_RAIL_SCRIPT } from "./keepalive-frame";

/**
 * 단일 화면(이전 화면 유지) 배선 가드(원장 2026-10-01). 겉모습·숨김·주소가 **CSS 클래스·표식·레이아웃 분기**에 걸려 있어
 * 타입체크가 못 잡는다 — 한 줄이 빠지면 "창용 한 줄 머리글로 접힌다"·"숨은 화면이 그대로 보인다"가 조용히 난다.
 */
const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8").replaceAll("\r\n", "\n");

describe("이전 화면 유지 — 겉모습은 단일 화면과 같게", () => {
  it("🔴 화면 본문(<main>)에 embed-main이 없다 — 있으면 머리글이 창용 한 줄로 접혀 단일 화면과 달라진다", () => {
    expect(KEEPALIVE_MAIN_CLASS).not.toContain("embed-main");
    expect(KEEPALIVE_MAIN_CLASS).toContain("keepalive-main");
  });

  it("단일 화면 셸 <main>의 여백·스크롤 클래스를 그대로 쓴다", () => {
    const layout = read("src/app/(shell)/layout.tsx");
    const shellMain = layout.match(/<main className="(relative flex-1 overflow-auto[^"]*)"/)![1];
    for (const token of ["px-3", "pt-2", "pb-8", "desk:px-6", "desk:pt-5", "lg:pb-10", "[scrollbar-gutter:stable]"]) {
      expect(shellMain, `단일 화면 셸 main에 ${token}`).toContain(token);
      expect(KEEPALIVE_MAIN_CLASS, `이전 화면 유지 main에 ${token}`).toContain(token);
    }
  });

  it("레이아웃 창 문서 분기: 이전 화면 유지면 그 본문 클래스·브리지를 쓰고 창용 최소 크기 안내는 안 낸다", () => {
    const layout = read("src/app/(shell)/layout.tsx");
    // 화면 모양은 부모가 이 문서에서 쓰는 방식(쿠키)을 따른다 — 없을 때만 서버 판정(적대 리뷰: 방식 전환·조회 실패 때 새 화면만 다른 모양)
    expect(layout).toContain("const parentMode = (await cookies()).get(SHELL_MODE_COOKIE)?.value;");
    expect(layout).toContain("const frameMode = isShellMode(parentMode) ? parentMode : (await shellModePromise).mode;");
    expect(layout).toContain('const keepaliveFrame = !teacherEmbed && frameMode === "keepalive";');
    expect(layout).toMatch(/className=\{keepaliveFrame \? KEEPALIVE_MAIN_CLASS : "embed-main /);
    expect(layout).toContain("{keepaliveFrame ? <KeepaliveFrameBridge /> : null}");
    expect(layout).toContain("{keepaliveFrame ? null : <WindowMinSizeNotice />}");
    // 창 모드의 본문도 숨김 설명이 문서 스크롤로 새지 않도록 위치 기준을 갖는다.
    expect(layout).toContain('"embed-main relative bg-background text-foreground h-screen overflow-auto px-1.5 pt-2 pb-8 lg:pb-10 [scrollbar-gutter:stable]"');
  });

  it("첫 페인트 판정이 이전 화면 유지 본문도 본문 도착으로 읽는다(안 읽으면 덮개가 안 걷힌다)", () => {
    expect(read("src/components/workspace/window-signals-core.ts")).toContain('main.embed-main, main.keepalive-main');
  });

  it("창 크롬이 없어 사라지는 인페이지 '← 뒤로'를 이 방식에선 되살린다", () => {
    expect(read("src/components/back-link.tsx")).toMatch(/\(embed \|\| inFrame\) && !keepaliveFrame/);
  });

  it("사이드바 폭을 창 문서가 읽을 표식이 있다(왼쪽 안쪽 여백의 재료)", () => {
    expect(read("src/components/app-sidebar.tsx")).toContain('data-shell-sidebar=""');
    expect(KEEPALIVE_RAIL_SCRIPT).toContain("[data-shell-sidebar]");
  });
});

describe("이전 화면 유지 — 숨은 화면", () => {
  // 설명 주석은 뺀다(display:none을 **금지한다고 적은** 문장이 걸리지 않게).
  const stage = read("src/components/workspace/keepalive-stage.tsx").replace(/\/\*[\s\S]*?\*\//g, "");

  it("🔴 숨김은 display:none이 아니라 visibility:hidden(invisible)이다(#131)", () => {
    expect(stage).toContain("pointer-events-none invisible");
    expect(stage).not.toMatch(/className=\{?[`"][^`"]*\bhidden\b/);
    expect(stage).not.toContain("display: none");
    expect(stage).not.toContain("display:none");
  });

  it("iframe에 visibility:visible을 못박지 않는다 — 조상이 숨겨도 iframe만 남아 그려지는 것을 막는다", () => {
    const route = read("src/components/workspace/route-window.tsx");
    expect(route).not.toMatch(/visibility: dragging \? "hidden" : "visible"/);
    expect(route).toContain('style={dragging ? { visibility: "hidden" } : undefined}');
  });

  it("무대는 창 크롬(FloatingWindow·스위처·스냅·앨범)을 안 쓴다", () => {
    for (const banned of ["FloatingWindow", "WindowSwitcher", "SnapAssist", "SnapLayoutsBar", "SpotlightStrip"]) {
      expect(stage).not.toContain(banned);
    }
  });
});

describe("이전 화면 유지 — 캔버스 배선", () => {
  const canvas = read("src/components/workspace/workspace-canvas.tsx");

  it("지점 방식을 영속본 채택에 함께 넘긴다(방식이 바뀌면 초기화 — 창 모드를 끈 지점에서도 돈다)", () => {
    expect(canvas).toContain("adoptOwner(owner, shellMode, shellEpoch)");
    // 판을 모르면(라이선스 조회 실패) 방식은 채택하지 않는다 — 일시 장애 한 번에 유지 화면이 지워지지 않게
    expect(canvas).toContain("shellEpoch === null ? adoptOwner(owner) : adoptOwner(owner, shellMode, shellEpoch)");
    // 효과는 데스크톱 판정(isDesktop) 앞에서 돈다 = 단일 화면·폰에서도 전환을 잡는다
    expect(canvas.indexOf("adoptOwner(owner, shellMode, shellEpoch)")).toBeLessThan(canvas.indexOf("if (!isDesktop) return null;"));
  });

  it("딥링크·빈 작업면 홈은 이 방식에서 끄고 주소 동기화(useKeepaliveFollow)가 맡는다", () => {
    expect(canvas).toContain("useDeepLinkWindow(isDesktop && !isDesktopSurface && !keepalive);");
    expect(canvas).toContain("useEmptyWorkspaceHome(isDesktop && !isDesktopSurface && !keepalive, homeHref);");
    expect(canvas).toContain("useKeepaliveFollow(keepalive, homeHref);");
  });

  it("이전 화면 유지 분기는 무대만 그린다", () => {
    const branch = canvas.slice(canvas.indexOf("if (keepalive) {"), canvas.indexOf("// 드래그 중 레이아웃 바"));
    expect(branch).toContain("<KeepaliveStage />");
    expect(branch).not.toContain("FloatingWindow");
  });
});

describe("이전 화면 유지 — 화면 최대화·계측", () => {
  it("화면 최대화: 창 엔진이 있어도 이전 화면 유지에선 켜진다(창 모드만 막는다)", () => {
    const root = read("src/components/page-maximize/page-maximize-root.tsx");
    expect(root).toContain("const shellMode = useShellMode();");
    expect(root).toContain('const windowMode = engine && shellMode !== "keepalive";');
  });

  it("화면과의 최대화 메시지는 이전 화면 유지 무대만 붙인다(최대화 루트는 판정 한 줄만 바뀐다 — 다른 작업과 겹침 최소)", () => {
    expect(read("src/components/workspace/keepalive-stage.tsx")).toContain("<KeepaliveMaximizeSync />");
    expect(read("src/components/page-maximize/page-maximize-root.tsx")).not.toContain("PAGE_MAXIMIZE_SET_MESSAGE");
  });

  it("화면 최대화 버튼은 이전 화면 유지 화면(iframe)에서도 선다", () => {
    expect(read("src/components/page-maximize/page-maximize-button.tsx")).toContain("(inFrame && !keepaliveFrame)");
  });

  it("바탕 문서의 이용 분석은 보이는 화면 주소를 따라가지 않는다(화면은 iframe이 따로 센다)", () => {
    expect(read("src/features/usage/usage-tracker.tsx")).toContain("useKeepaliveMode()");
  });

  it("'오늘' 이동은 라우터 이동을 또 하지 않는다(기록이 두 칸 쌓이지 않게)", () => {
    expect(read("src/components/workspace/use-show-desktop.ts")).toContain("if (!keepalive && pathname !== home) router.push(home);");
  });
});

describe("이전 화면 유지 — 화면 문서의 뷰포트 기준 레이어", () => {
  const css = read("src/app/globals.css");

  it("가운데 놓이는 고정 레이어만 사이드바 밖으로 비킨다(표식은 하이드레이션 뒤 브리지가 단다)", () => {
    for (const sel of [
      "html[data-keepalive-frame] .fixed.inset-0.flex",
      "html[data-keepalive-frame] .fixed.inset-0.grid",
      "html[data-keepalive-frame] .fixed.inset-0.m-auto",
      "html[data-keepalive-frame] dialog:modal",
      String.raw`html[data-keepalive-frame] .fixed.left-1\/2`,
    ]) {
      expect(css, sel).toContain(sel);
    }
    const bridge = read("src/components/workspace/keepalive-frame-bridge.tsx");
    expect(bridge).toContain("html.setAttribute(KEEPALIVE_FRAME_ATTR");
    expect(bridge).toContain("html.style.setProperty(KEEPALIVE_RAIL_VAR");
  });

  it("🔴 자식을 뷰포트 좌표로 놓는 덮개(F1 도움말 `fixed inset-0 overflow-hidden`)는 옮기지 않는다 — 맨 `.fixed.inset-0` 규칙 금지", () => {
    expect(css).not.toMatch(/html\[data-keepalive-frame\] \.fixed\.inset-0\s*[,{]/);
    expect(read("src/components/help/screen-help-overlay.tsx")).toContain("fixed inset-0 overflow-hidden");
  });
});

describe("이전 화면 유지 — 주소·바탕", () => {
  const follow = read("src/components/workspace/use-keepalive-follow.ts");

  it("바탕이 실제로 그리는 화면은 주소가 아니라 라우터 트리로 안다", () => {
    expect(follow).toContain("renderedPathOf(useSelectedLayoutSegments())");
  });

  it("바탕을 미리 옮기는 타이머가 없다 — 첫 화면으로 갈 때 바탕이 첫 화면이 아니면 그때만 라우터로", () => {
    expect(follow).not.toContain("setTimeout");
    expect(follow).toContain("if (id === null && !isHomePath(renderedRef.current, home)) {");
    expect(follow).toContain("routerRef.current.push(home, { scroll: false });");
  });

  it("창 모드 전용 '새 창으로 하나 더' 안내는 이 방식의 사이드바에 없다", () => {
    expect(read("src/components/app-sidebar.tsx")).toContain("{windows && !keepalive ? (");
  });
});

describe("이전 화면 유지 — 문서 하나 동안 방식 고정 · 바탕 잠재우기 · src 고정", () => {
  it("셸 공급자는 처음 받은 방식·판을 끝까지 쓴다(useState 고정) — 쓰던 화면이 도중에 갈아엎히지 않게", () => {
    const provider = read("src/components/workspace/shell-mode.tsx");
    expect(provider).toContain("const [frozen] = useState(() => {");
    expect(provider).toContain("<ShellModeCtx.Provider value={frozen.mode}>");
  });

  // 일부러 조건부로 감싼다 — 늘 감싸면(Activity visible) 운영 중인 단일 화면 지점(침산)의 바탕 경로까지 바뀐다. 대가: 방식이 바뀐 직후
  // 바탕 재렌더가 돌면 그 문서의 바탕 본문이 한 번 다시 마운트될 수 있다(드묾 — decisions/shell.md 알려진 차이).
  it("바탕 본문 잠재우기(Activity)는 이 방식일 때만 감싼다 — 창 모드·단일 화면의 바탕은 그대로", () => {
    const layout = read("src/app/(shell)/layout.tsx");
    expect(layout).toContain('{shellMode === "keepalive" ? <KeepaliveMainGate>{children}</KeepaliveMainGate> : children}');
  });

  it("이 방식의 iframe src는 처음 실은 주소로 고정 — 옮기기는 location.replace(합동 세션 기록에 죽은 칸 금지)", () => {
    const route = read("src/components/workspace/route-window.tsx");
    expect(route).toContain("src={frameSrc}");
    expect(route).toContain("withEmbed((keepalive ? pinnedHref : undefined) ?? href ?? \"/\")");
    expect(route).toContain("el.contentWindow?.location.replace(withEmbed(href));");
  });

  it("규칙(복제 금지·사용 도장)은 영속본이 아니라 지금 그려진 방식(kaActive)을 본다", () => {
    const store = read("src/components/workspace/window-store.ts");
    expect(store).toContain("if (s.kaActive) return get().open(kind, params, anchor);");
    expect(store).not.toContain('s.shellMode === "keepalive"');
    expect(read("src/components/workspace/workspace-canvas.tsx")).not.toContain('st.shellMode === "keepalive"');
  });
});

describe("이전 화면 유지 — 셸에서 저절로 도는 호출 없음(#137)", () => {
  it("새 파일들은 서버 액션을 부르지 않는다 — 셸 마운트·폴링이 서버 액션을 쓰면 라우터가 죽는다", () => {
    for (const f of [
      "src/components/workspace/use-keepalive-follow.ts",
      "src/components/workspace/keepalive-stage.tsx",
      "src/components/workspace/keepalive-frame-bridge.tsx",
      "src/components/workspace/keepalive-rules.ts",
      "src/components/workspace/keepalive-url.ts",
      "src/components/workspace/keepalive-follow-location.ts",
      "src/components/workspace/keepalive-main-gate.tsx",
      "src/components/page-maximize/keepalive-page-maximize.tsx",
    ]) {
      expect(read(f), f).not.toMatch(/\/server\/|"use server"/);
    }
  });
});
