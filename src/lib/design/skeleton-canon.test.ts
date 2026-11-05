import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const APP = join(process.cwd(), "src", "app");

/**
 * 스켈레톤 원문 + 그것이 직접 import한 **로컬 스켈레톤 부품**(경로에 `skeleton`이 든 파일) 원문 — 화면 전용 스켈레톤 부품
 * (`VideoLedgerSkeleton` 등)이 툴바를 대신 그리는 loading.tsx도 같은 기준으로 본다(skeleton-pairs 가드와 같은 범위).
 */
function withSkeletonParts(file: string): string {
  const src = readFileSync(file, "utf8");
  const parts = [src];
  for (const m of src.matchAll(/from\s+"(\.{1,2}\/[^"]*skeleton[^"]*|@\/[^"]*skeleton[^"]*)"/gi)) {
    const spec = m[1];
    const base = spec.startsWith("@/") ? join(process.cwd(), "src", spec.slice(2)) : resolve(dirname(file), spec);
    for (const f of [`${base}.tsx`, join(base, "index.tsx")]) if (existsSync(f)) parts.push(readFileSync(f, "utf8"));
  }
  return parts.join("\n");
}

function loadingFiles(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) loadingFiles(p, out);
    else if (e.name === "loading.tsx") out.push(p);
  }
  return out;
}

/**
 * 스켈레톤(`loading.tsx`)은 **대응 실표면과 같은 모양**이어야 한다(design-conventions "스켈레톤 = 실표면 동일").
 * 어긋나면 데이터가 도착하는 순간 레이아웃이 튀어 **스켈레톤이 없느니만 못하다**.
 *
 * 🔴 실제로 그렇게 썩었다(2026-09-07 검수): v5가 컨트롤 높이를 32→26px로 내리고(control-scale) ECS·MCS 상단 바의
 *    카드 껍데기를 걷었는데(2026-09-01), 스켈레톤 아홉이 옛 모양(h-8 · `bg-card` 툴바 띠 · 알약 7개짜리 면 탭 ·
 *    수납 '최근 6개월 칩 줄')을 그대로 그리고 있었다. 치수를 손으로 적으면 실표면이 바뀔 때 같이 안 바뀐다.
 */
const files = loadingFiles(APP);
const rel = (p: string) => p.slice(process.cwd().length + 1);
const NL = String.fromCharCode(10);

describe("스켈레톤 캐논 — loading.tsx는 실표면과 같은 치수를 가리킨다", () => {
  it("스켈레톤이 하나라도 있다(스캐너가 빈 목록을 통과하지 않게)", () => {
    expect(files.length).toBeGreaterThan(15);
  });

  it("툴바·상단 바·면 탭을 그리는 스켈레톤은 컨트롤 높이를 **변수**로 가리킨다(또는 그 변수를 쓰는 공용 스켈레톤 부품)", () => {
    // 공용 부품(2026-11-05) = `ToolbarSkeletonItem`(toolbar.tsx) · `FaceTabsSkeleton`(face-tabs-skeleton.tsx) · `PeriodNavSkeleton`
    // (period-nav-skeleton.tsx) · `SheetClassPickerSkeleton`·`SheetFaceSwitchSkeleton`(class-sheets sheet-chrome-skeleton.tsx) — 모두
    // 실물과 같은 상수로 `--control-h`를 쓴다.
    // JSX로 **실제로 그린** 것만 센다 — 주석·import 줄에 이름만 있어도 통과하던 구멍(2026-11-05 재리뷰).
    const SHARED = /<(ToolbarSkeletonItem|FaceTabsSkeleton|PeriodNavSkeleton|SheetClassPickerSkeleton|SheetFaceSwitchSkeleton)[\s/>]/;
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      if (!/툴바|상단 바|면 탭/.test(src)) continue;
      const all = withSkeletonParts(f);
      expect(all.includes("--control-h") || SHARED.test(all), rel(f)).toBe(true);
    }
  });

  it("툴바 자리에 **고정 px 높이**를 적지 않는다(실표면이 바뀌면 같이 안 바뀐다)", () => {
    // ⚠️ `h-8`을 통째로 금지하지는 않는다 — 스켈레톤의 **표 행**은 실제로 32px 근처라 그 값이 맞다
    //    (재고관리 자산 표: td `px-2 py-1.5`). 금지 대상은 "툴바 줄에 손으로 적은 px"이다:
    //    옛 스켈레톤들이 상단 바를 `h-[34px]`·`h-[38px]`·`h-[46px]` 띠로 그려 둬서, v5가 컨트롤을
    //    26px로 내렸을 때 셋 다 옛 높이로 남았다(2026-09-07 검수).
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      if (!/툴바|상단 바|면 탭/.test(src)) continue;
      const lines = src.split(NL);
      for (const [i, line] of lines.entries()) {
        if (!/animate-pulse/.test(line)) continue;
        // 툴바 자리인가 = 그 줄이나 바로 위 주석이 툴바를 가리키는가(본문 카드 h-[220px] 등은 대상 아님).
        const ctx = lines.slice(Math.max(0, i - 6), i + 1).join(" ");
        if (!/(툴바|상단 바|면 탭)/.test(ctx)) continue;
        expect(line, rel(f) + ":" + (i + 1)).not.toMatch(/h-\[\d+px\]/);
      }
    }
  });
});
