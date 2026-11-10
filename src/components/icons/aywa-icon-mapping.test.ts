import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { AYWA_ICON_COMPAT_MAP } from "./aywa-icon-compat";
import { AYWA_ICON_CATALOG, MENU_ICON } from "./aywa-icons";

const COMPAT_MODULE = "@/components/icons/aywa-icon-compat";
const FORBIDDEN_NATURE_ICONS = new Set([
  "tree",
  "leaf",
  "pulse",
  "branch",
  "seed",
  "sprout",
  "wave",
  "falling",
  "roots",
  "pollen",
  "rings",
  "spore",
]);
const LEGACY_VISIBLE_GLYPHS = [
  "⚠️",
  "⚠",
  "☑",
  "☐",
  "✅",
  "❌",
  "✓",
  "✔",
  "✕",
  "✖",
  "▲",
  "▼",
  "📈",
  "📋",
  "💬",
  "📌",
  "🎤",
  "💡",
  "🌱",
  "🌿",
  "🍃",
  "🌳",
] as const;
const APPROVED_INLINE_SVG = [
  // 2026-11-10 차트 셋(P0-3b 정리) — 원생상담 담임 게이지(role="img"+aria-label) · 과목 성적 추이 선(aria-hidden, 점·라벨은 HTML) ·
  // 공용 분석 차트(도넛·추이, role="img"+aria-label — 숫자 카드 머리 아이콘은 EyIcon). 데이터 그림이지 아이콘 대용이 아니다.
  "src/app/(shell)/consultations/_components/stats/stats-homeroom-gauge.tsx",
  "src/app/(shell)/exams/_components/subject-trend-chart.tsx",
  "src/components/analytics/charts.tsx",
  // 2026-11-05 연결 탐색 도넛(조각 경로·글자)과 네트워크 판(점·선을 엔진이 그린다) — 데이터 그림이지 아이콘 대용이 아니다.
  "src/features/explore/components/donut.tsx",
  "src/features/explore/components/network/explore-network.tsx",
  // 2026-09-23 통합 성적관리 월별 추이 선(role="img"+aria-label, 선만 SVG·점·라벨은 HTML) — 차트이지 아이콘이 아니다.
  "src/app/(shell)/exams/_components/trend-chart.tsx",
  "src/features/onescreen/components/report-trend-graph.tsx",
  // 2026-09-11 인재원 학습분석지(wide)의 시험 점수 추이 선 — 차트(report-trend-graph와 같은 성격).
  "src/features/ijw/components/jj-study-parts.tsx",
  // 2026-09-10~11 운영실 현황 차트(도넛·막대·등원율 선, role="img"+aria-label) — 차트(sparkline과 같은 성격).
  "src/app/(shell)/dashboard/_overview/charts.tsx",
  // 2026-09-16 F1 겹침 도움말의 **스템**(포커스 알약 ↔ 캡션, `<path Q>` 하나 · aria-hidden) — 장식이지 아이콘이 아니다.
  "src/components/help/help-stem.tsx",
  // 2026-09-14 수학 학습 진도맵의 동심원 지도(분기·연·월·주·일 링 + 가운데) — 차트이지 아이콘이 아니다.
  // 2026-09-15 드릴다운이 들어오며 <svg>가 progress-map.tsx → 겹침 레이어 dial-layer.tsx로 옮겨갔다(role="presentation").
  "src/features/math-progress-map/components/dial-layer.tsx",
  // 2026-09-15 진도맵 세로 타임라인 옆 **시계**(회전 표시 삼각형 aria-hidden · '실제 오늘' 점 aria-label) —
  // 차트 부품이지 아이콘이 아니다(dial-layer와 같은 성격).
  "src/features/math-progress-map/components/timeline/circular-progress-clock.tsx",
  // 2026-09-17 MCS 학습 레일의 **블록 눈금**(작은/긴 눈금·안내선·양끝 `<path>` 넷, aria-hidden) —
  // 차트 눈금이지 아이콘이 아니다(sparkline과 같은 성격). 레일을 만든 커밋이 이 목록을 안 고쳐
  // 가드가 하루 동안 빨간 채였다 — 새 인라인 SVG는 **같은 커밋에서** 여기에 적을 것.
  "src/features/math-sheets/components/learning-rails.tsx",
  // 2026-10-07 보카킹 종합평가 리포트의 **3축 역량 그래프**(정답률·의미·철자, role="img"+aria-label) — 차트이지 아이콘이 아니다.
  "src/features/vocabking/components/vk-competency.tsx",
  // 2026-10-07 보카킹 리포트 점수 영역의 **점수 원 그래프**(/100, role="img"+aria-label) — 차트이지 아이콘이 아니다.
  "src/features/vocabking/components/vk-score.tsx",
  // 2026-09-30 원생상담 통계 패널 분해 줄의 **작은 막대 12칸**(최근 12개월/12주 건수, aria-hidden) — 0부터 세는 막대라
  // 운영실 선 스파크라인(최솟값~최댓값 정규화)을 못 쓴다. 차트이지 아이콘이 아니다(sparkline과 같은 성격).
  "src/app/(shell)/consultations/_components/stats/stats-breakdown.tsx",
  // 2026-09-29 공개 랜딩의 대시보드 **개념도**(연결선 지도·추이 선, 둘 다 aria-hidden) — 장식 그림이지 아이콘이 아니다.
  // eb3787b2가 이 목록을 안 고쳐 가드가 빨갰다(보안 감사 푸시에 함께 고침).
  "src/app/(marketing)/_scroll/dashboard-mock.tsx",
  // 2026-10-13 직원 포트폴리오의 **총점 원 그래프**(/100, 바탕 원 + 값 호 · aria-hidden, 점수는 버튼의 aria-label과 HTML 숫자) —
  // 차트이지 아이콘이 아니다(vk-score와 같은 성격).
  "src/app/(shell)/class-review/_components/portfolio/score-hero.tsx",
  // 2026-10-22 원생 기여도 학생 상세의 **월별 누적 점수 추이**(눈금선·면·선·월 점, aria-label · 점마다 그 달 점수 버튼) —
  // 차트이지 아이콘이 아니다(trend-chart와 같은 성격). 81691e56d가 이 목록을 안 고쳐 가드가 빨갰다.
  "src/features/student-contribution/components/score-trend.tsx",
  // 2026-10-19 영어 시간표 오른쪽 **메모 시트**(엑셀 판) — 칸 격자·채우기·테두리를 그리는 바탕 층(grid-base), 고른 범위 틀(grid-overlay),
  // 테두리 고르기 창의 **선 모양 견본**(실선·점선·이중선 한 줄씩, border-picker). 셋 다 aria-hidden이고 표를 그리는 그림이지 아이콘이 아니다.
  "src/features/timetable-memo/ui/border-picker.tsx",
  "src/features/timetable-memo/ui/grid-base.tsx",
  "src/features/timetable-memo/ui/grid-overlay.tsx",
] as const;

// 이 파일의 검사 3개가 각각 src/ 전체를 훑는다 — 디렉터리 워크는 파일 목록이 같으므로 한 번만 한다
// (전 스위트 병렬 실행에서 이 파일이 타임아웃으로 빨개졌다. 진짜 비용은 아래 ts.createSourceFile이지만
//  워크를 3번 반복할 이유는 없다.)
const sourceFilesCache = new Map<string, string[]>();

function sourceFiles(directory: string): string[] {
  const cached = sourceFilesCache.get(directory);
  if (cached) return cached;

  const result: string[] = [];

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      result.push(...sourceFiles(entryPath));
    } else if (/\.[cm]?[jt]sx?$/.test(entry.name)) {
      result.push(entryPath);
    }
  }

  sourceFilesCache.set(directory, result);
  return result;
}

function importedCompatIcons(): Set<string> {
  const imported = new Set<string>();

  for (const file of sourceFiles(path.join(process.cwd(), "src"))) {
    const source = ts.createSourceFile(
      file,
      fs.readFileSync(file, "utf8"),
      ts.ScriptTarget.Latest,
      true,
      file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );

    for (const statement of source.statements) {
      if (
        !ts.isImportDeclaration(statement) ||
        !ts.isStringLiteral(statement.moduleSpecifier) ||
        statement.moduleSpecifier.text !== COMPAT_MODULE
      ) {
        continue;
      }

      const bindings = statement.importClause?.namedBindings;
      if (!bindings || !ts.isNamedImports(bindings)) continue;

      for (const element of bindings.elements) {
        const importedName = (element.propertyName ?? element.name).text;
        if (importedName !== "LucideIcon") imported.add(importedName);
      }
    }
  }

  return imported;
}

function filesImporting(moduleName: string): string[] {
  const importers: string[] = [];

  for (const file of sourceFiles(path.join(process.cwd(), "src"))) {
    const source = ts.createSourceFile(
      file,
      fs.readFileSync(file, "utf8"),
      ts.ScriptTarget.Latest,
      true,
      file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );

    const importsModule = source.statements.some(
      (statement) =>
        ts.isImportDeclaration(statement) &&
        ts.isStringLiteral(statement.moduleSpecifier) &&
        statement.moduleSpecifier.text === moduleName,
    );

    if (importsModule) importers.push(path.relative(process.cwd(), file));
  }

  return importers;
}

function visibleLegacyIconGlyphs(): string[] {
  const hits: string[] = [];

  for (const file of sourceFiles(path.join(process.cwd(), "src")).filter((name) => name.endsWith(".tsx"))) {
    const source = ts.createSourceFile(
      file,
      fs.readFileSync(file, "utf8"),
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    );

    const visit = (node: ts.Node) => {
      if (ts.isJsxText(node) || ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
        const value = ts.isJsxText(node) ? node.getText(source) : node.text;
        const glyph = LEGACY_VISIBLE_GLYPHS.find((candidate) => value.includes(candidate));
        if (glyph) {
          const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
          hits.push(`${path.relative(process.cwd(), file)}:${line + 1} ${glyph}`);
        }
      }
      ts.forEachChild(node, visit);
    };

    visit(source);
  }

  return hits;
}

function inlineSvgFiles(): string[] {
  return sourceFiles(path.join(process.cwd(), "src"))
    .filter((file) => file.endsWith(".tsx"))
    // 🔴 테스트·스토리 픽스처는 뺀다 — 이 가드가 지키는 것은 **사용자에게 그려지는 화면**이지 픽스처가 아니다.
    // 픽스처가 `<svg>`를 하나 그렸다고 허용 목록에 올리면, 그 목록이 "검토한 차트"라는 뜻을 잃는다
    // (2026-09-15: 진도맵 `map-state.test.tsx`가 걸려 main이 빨갰다).
    // 이름 규칙 셋을 다 본다 — `.test.`만 빼면 다음에 `.spec.`이나 `__tests__/`로 들어온 픽스처에 또 빨개진다.
    .filter((file) => !/(\.(test|spec|stories)\.|[\\/]__tests__[\\/])/.test(file))
    .filter((file) => path.basename(file) !== "aywa-icons.tsx")
    .filter((file) => fs.readFileSync(file, "utf8").includes("<svg"))
    .map((file) => path.relative(process.cwd(), file).replaceAll("\\", "/"))
    .sort();
}

describe("Aywa icon compatibility mapping", () => {
  it(
    "maps every compatibility import exactly once without unused aliases",
    () => {
      const imported = importedCompatIcons();
      const mapped = new Set(Object.keys(AYWA_ICON_COMPAT_MAP));

      expect(mapped).toEqual(imported);
      // 절대 개수 트립와이어(위 toEqual과 별개로 대량 유실을 잡는다). 별칭을 의도적으로 늘리거나
      // 줄였을 때만 갱신할 것 — 143→142는 2026-07-29 `Lock` 제거분(소비처가 1beee908 '재인증 제거'에서 사라짐).
      // 142→141은 2026-09-03 `BarChart3` 제거분(등록상담 보기 토글이 아이콘 칩 3개 → 드롭다운 하나가 되며 소비처 0, 디자인 v5 §10).
      // 141→139는 2026-09-03 `BookPlus`·`MessageSquarePlus` 제거분(운영실 '빠른 작업'이 §10 "같은 동작 두 곳 금지"로 사라지며 소비처 0).
      // 139→138: 랜딩 리팩토링으로 LayoutDashboard의 마지막 소비처를 제거.
      // 138→137은 2026-10-22 `Banknote` 제거분(0c631a51e가 콜&상담 폼의 '결제 금액' 칸을 걷으며 소비처 0).
      // 137→136은 2026-10-23 `Columns3` 제거분(시간표(개발중) 화면을 코드째 지우며 '기본뷰' 토글 소비처 0).
      expect(mapped.size).toBe(136);
    },
    // src/ 전건을 ts.createSourceFile로 파싱한다 — 단독 실행 14초라 15초는 여유가 없었고
    // 전 스위트 병렬(파일 증가 + CPU 경합)에서 실제로 터졌다. 파일 수는 계속 는다.
    60_000,
  );

  it("maps every compatibility name to a registered Aywa glyph", () => {
    const registered = new Set(AYWA_ICON_CATALOG.map((icon) => icon.name));

    for (const target of Object.values(AYWA_ICON_COMPAT_MAP)) {
      expect(registered.has(target)).toBe(true);
    }
  });

  it("does not register or map botanical metaphors", () => {
    const registered = AYWA_ICON_CATALOG.map((icon) => icon.name);
    const compatTargets = Object.values(AYWA_ICON_COMPAT_MAP);
    const menuTargets = Object.values(MENU_ICON);

    expect(registered.filter((name) => FORBIDDEN_NATURE_ICONS.has(name))).toEqual([]);
    expect(compatTargets.filter((name) => FORBIDDEN_NATURE_ICONS.has(name))).toEqual([]);
    expect(menuTargets.filter((name) => FORBIDDEN_NATURE_ICONS.has(name))).toEqual([]);
  });

  it(
    "has no visible emoji or text glyph standing in for an icon",
    () => {
      expect(visibleLegacyIconGlyphs()).toEqual([]);
    },
    60_000, // 위와 같은 전건 파싱 — 기본 5초로는 전 스위트 병렬에서 터진다
  );

  it("keeps inline SVG limited to reviewed charts and decoration", () => {
    expect(inlineSvgFiles()).toEqual([...APPROVED_INLINE_SVG].sort());
  });

  it(
    "has no direct external icon imports or package dependency",
    () => {
      const packageJson = JSON.parse(
        fs.readFileSync(path.join(process.cwd(), "package.json"), "utf8"),
      ) as { dependencies?: Record<string, string> };

      expect(filesImporting("lucide-react")).toEqual([]);
      expect(packageJson.dependencies?.["lucide-react"]).toBeUndefined();
    },
    // 형제 둘과 같은 60초 — 여기만 15초로 남아 있어 전 스위트 병렬에서 이 파일이 빨갰다(2026-09-15).
    // src 파일이 3,000개가 넘어 단독 실행에서도 12초를 쓴다. 🔴 CLI `--testTimeout`은 이 인자를 못 이긴다.
    60_000,
  );
});
