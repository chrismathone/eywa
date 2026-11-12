import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// @shadcn/lint — Tailwind 디자인 시스템 규칙. 테마·컴포넌트는 components.json에서 읽는다.
// 고치는 법·예외 기준·남은 경고 목록은 docs/design-lint.md.
// ⚠️ 패키지가 아직 없는 node_modules(본체 것을 정션으로 빌려 쓰는 워크트리 등)에서 lint 전체가 죽지 않게,
//    없으면 이 규칙만 건너뛰고 알린다. CI에서는 건너뛰지 않고 실패시킨다(신호가 조용히 빠지지 않게).
async function loadShadcnPlugin() {
  try {
    return (await import("@shadcn/lint")).plugin;
  } catch (error) {
    // 이 패키지 자체가 없을 때만 넘어간다 — 안쪽 의존성이 빠진 경우 등은 원인을 가리지 않게 그대로 던진다.
    const missingItself =
      error?.code === "ERR_MODULE_NOT_FOUND" && String(error.message).includes("'@shadcn/lint'");
    if (process.env.CI || !missingItself) throw error;
    console.warn(
      "[eslint] @shadcn/lint가 설치돼 있지 않아 shadcn/* 규칙을 건너뜁니다. pnpm install 뒤 다시 실행하세요.",
    );
    return null;
  }
}

const shadcn = await loadShadcnPlugin();

// 패키지가 없을 때 세우는 빈 규칙 — 소스의 `eslint-disable shadcn/…` 주석이 "없는 규칙" 오류로 바뀌지 않게 이름만 둔다.
const shadcnStub = {
  rules: Object.fromEntries(
    [
      "no-arbitrary-values",
      "no-inline-styles",
      "no-raw-colors",
      "no-restyle",
      "no-unknown-classes",
      "require-static-classes",
    ].map((name) => [name, { create: () => ({}) }]),
  ),
};

const SHADCN_FILES = ["src/**/*.{ts,tsx}"];

const shadcnConfig = !shadcn
  ? [
      {
        files: SHADCN_FILES,
        plugins: { shadcn: shadcnStub },
        // 빈 규칙은 아무것도 보고하지 않아 예외 주석이 '안 쓰는 주석'으로 잡힌다 — `--fix`가 그 주석을 지우지 않게 끈다.
        linterOptions: { reportUnusedDisableDirectives: "off" },
      },
    ]
  : [
      {
        files: SHADCN_FILES,
        plugins: { shadcn },
        settings: {
          // 모든 shadcn/* 경고 끝에 붙는다.
          shadcn: { note: "고치는 법과 예외 기준: docs/design-lint.md" },
        },
        rules: {
          "shadcn/no-raw-colors": "warn",
          "shadcn/no-unknown-classes": [
            "warn",
            {
              // 스타일 없이 이름으로만 찾는 표식 클래스 — 찾는 쪽을 함께 적는다.
              allow: [
                "cf-turnstile", // Cloudflare Turnstile 스크립트가 이 div를 찾아 위젯을 그린다
                "report-capture", // ClassNote 워커의 보고서 캡처 대상
                "tt-editing", // 시간표의 `[.tt-editing_&]` 변형
                "ecs-slot-edge", // today-roster-table의 `:not(.ecs-slot-edge)` 선택자
                "conn-l", // route-line-diagram의 li nth-child 변형이 찾는 표식(여기에 클래스 원문을 적지 말 것 — Tailwind가 이 파일도 훑어 깨진 CSS를 만든다)
                "conn-r", // 같은 파일 `_.conn-r` 변형
                "route-flow", // route-line-diagram이 품은 <style>의 애니메이션 클래스
                "route-nudge", // 같은 <style>
                "loyalty-detail", // student-contribution/components/loyalty-detail.css의 범위 클래스
                "toaster", // shadcn sonner 기본 표식(Sonner가 받는 className)
              ],
            },
          ],
        },
      },
      // 자체 CSS로 그리는 화면(랜딩·학원 소개·시간표 편집기·운영실 계기판) — 테마 밖 클래스가 정상이다.
      {
        files: [
          "src/app/(marketing)/**",
          "src/app/(academy)/**",
          "src/features/timetable-lab/editor/**",
          // 편집기가 뜨기 전 자리 표시 — 편집기 CSS를 그대로 불러 같은 클래스로 그린다(2026-11-05 스켈레톤 검수).
          "src/app/(shell)/timetable/editor/_components/editor-skeleton.tsx",
          "src/app/(shell)/dashboard/_instruments/**",
        ],
        rules: { "shadcn/no-unknown-classes": "off" },
      },
      // 학부모 보고서 그래프 — ClassNote 워커 캡처에는 앱 스타일시트가 없어 색을 일부러 hex로 적는다.
      {
        files: ["src/features/onescreen/components/report-trend-graph.tsx"],
        rules: { "shadcn/no-raw-colors": "off" },
      },
    ];

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  ...shadcnConfig,
  // Electron's main/preload and native build helpers intentionally use CommonJS.
  {
    files: ["apps/sync-agent/**/*.cjs"],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
      "@next/next/no-assign-module-variable": "off",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "coverage/**",
    "work/**",
    "apps/sync-agent/build/**",
    "apps/sync-agent/dist/**",
    "apps/sync-agent/lib/protocol.cjs",
    "next-env.d.ts",
    // Design handoff reference files (HTML/JSX prototypes, not source code)
    "data/**",
    // Claude tooling: nested git worktrees ship their own .next build artifacts +
    // duplicated source — linting them produces false errors/OOM (see CLAUDE.md trap).
    ".claude/**",
    // 일회용 마이그레이션 POC(수동 실행, 앱 빌드 비포함). Firestore 무타입 입력 특성상 any 다수 → 린트 제외.
    "scripts/_poc_migration/**",
    // 수동 실행 CJS 운영 도구(CORS 설정 등) — 앱 빌드 비포함, require 사용.
    "scripts/**/*.cjs",
    // Standalone timetable experiment: lint source, not generated bundles/browser artifacts.
    "experiments/timetable-lab-p0/dist/**",
    "experiments/timetable-lab-p0/.artifacts/**",
    "experiments/timetable-lab-p0/test-results/**",
    "experiments/timetable-lab-p0/playwright-report/**",
  ]),
]);

export default eslintConfig;
