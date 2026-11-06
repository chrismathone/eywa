import { readFileSync, readdirSync, statSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

// '다른 강사 뷰' = 그 사람(#154 · 원장 2026-11-06 "추천방식으로 승인") — 연결 탐색 · 약속·인계의 빈틈 수리를 잠근다.
// ① 담당·본인 판정과 기록 명의 = 보는 강사(teacherView) ③ 읽기 강사뷰는 대상 강사의 담당(scoped)을 읽기(readonly)로 누른다 →
// `=== "scoped"`로 읽기를 좁히던 자리는 지워진 범위(readonlyViewErasedScope)를 함께 본다(isScopedRead).
const perm = vi.hoisted(() => ({ level: "full" as string, erased: false }));
vi.mock("@/lib/auth/perm-matrix", () => ({
  accessLevelTenant: async () => perm.level,
  readonlyViewErasedScope: async () => perm.erased,
}));

import { isScopedRead } from "./shared";
import { transitionCare, type CareActor, type CareContent } from "@/features/student-care/model";

const read = (p: string) => readFileSync(p, "utf8");
/** 폴더 아래(하위 포함) 코드 파일 — 시험 파일 제외. */
const codeFiles = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => {
    const p = `${dir}/${f}`;
    if (statSync(p).isDirectory()) return codeFiles(p);
    return /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f) ? [p] : [];
  });
/** 주석을 뗀 코드(줄 주석 · 블록 주석) — 주석 속 글자로 검사를 통과·실패하지 않게. */
const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
/** 'scoped'와의 비교(== · === · != · !== · 양쪽 순서 · 줄바꿈 포함). */
const SCOPED_CMP = /(?:[=!]==?\s*["'`]scoped["'`])|(?:["'`]scoped["'`]\s*[=!]==?)/g;
/** 허용 = 판정 한 곳(isScopedRead 본문) · 약속 학생 범위(지워진 범위를 같은 식에서 함께 — 학생 상세 read-scope와 같은 조건). 파일마다 정확한 수. */
const ALLOWED: Record<string, number> = { "src/features/explore/server/shared.ts": 1, "src/features/student-care/server/student-scope.ts": 1 };
const SCANNED = ["src/features/explore/server", "src/features/student-care/server", "src/app/api/explore", "src/app/(shell)/explore"];

describe("isScopedRead — '담당만' 읽기(읽기 강사뷰가 지운 담당 범위까지)", () => {
  beforeEach(() => {
    perm.level = "full";
    perm.erased = false;
  });
  it.each([
    ["scoped", false, true],
    ["readonly", true, true], // 읽기 강사뷰 — 대상 강사의 담당이 읽기로 눌린 자리
    ["readonly", false, false], // 원래 읽기(열람) 권한 — 전체를 본다
    ["full", false, false],
    ["none", false, false],
  ] as const)("%s · 지워진 범위 %s → %s", async (level, erased, want) => {
    perm.level = level;
    perm.erased = erased;
    expect(await isScopedRead("teacher", "classes")).toBe(want);
  });
});

describe("배선 — 연결 탐색 · 약속·인계가 같은 판정·신원을 지난다", () => {
  it("연결 탐색 · 약속·인계(서버 · 라우트 · 페이지) 전 파일에 맨 'scoped' 읽기 판정이 없다 — isScopedRead 한 곳 + 약속 학생 범위 한 줄만", () => {
    for (const file of SCANNED.flatMap(codeFiles)) {
      const code = stripComments(read(file));
      const hits = code.match(SCOPED_CMP) ?? [];
      expect(hits.length, `${file}: ${hits.join(" | ")}`).toBe(ALLOWED[file] ?? 0);
    }
    // 허용된 두 곳도 지워진 범위를 함께 본다(그 식 안에서).
    expect(stripComments(read("src/features/explore/server/shared.ts"))).toMatch(/level === "scoped" \|\| \(level === "readonly" && \(await readonlyViewErasedScope\(menu\)\)\)/);
    expect(stripComments(read("src/features/student-care/server/student-scope.ts"))).toMatch(/level !== "scoped" && !\(level === "readonly" && \(await readonlyViewErasedScope\("students"\)\)\)/);
    for (const f of ["class", "room", "search", "teacher", "student"]) expect(read(`src/features/explore/server/${f}.ts`), f).toContain("isScopedRead(");
  });
  it("강사 중심의 '본인' = 보는 강사(실제 계정 id와 견주지 않는다) · 검색 라우트 신원도 보는 강사", () => {
    const teacher = read("src/features/explore/server/teacher.ts");
    expect(teacher).toContain("getCurrentUser({ teacherView: true })");
    expect(teacher).toMatch(/me\?\.id !== id/);
    expect(teacher).not.toMatch(/user\.id !== id/);
    expect(read("src/app/api/explore/search/route.ts")).toContain("getCurrentUser({ teacherView: true })");
  });
  it("원생 중심 흐름 분석 — 원생상담 담당(읽기 강사뷰 포함)에겐 열지 않는다", () => {
    expect(read("src/features/explore/server/student.ts")).toMatch(/flowAllowed = \(consultLevel === "full" \|\| consultLevel === "readonly"\) && !consultScoped/);
  });
  it("약속·인계 — 신원 = 보는 강사 · '다른 강사 뷰' 표시(proxy) · 저장은 읽기 강사뷰 거절 먼저 · 학생 범위는 지워진 담당까지", () => {
    const access = read("src/features/student-care/server/access.ts");
    expect(access).toContain("getCurrentUser({ teacherView: true })");
    expect(access).not.toMatch(/getCurrentUser\(\)/);
    expect(access).toMatch(/proxy: viewing !== null/);
    expect(read("src/features/student-care/server/actions.ts")).toMatch(/const blocked = await readonlyTeacherViewError\(\);\s+if \(blocked\) return/);
    expect(read("src/features/student-care/components/care-card.tsx")).toContain("!view.actor.proxy");
    expect(read("src/features/student-care/server/student-scope.ts")).toContain('readonlyViewErasedScope("students")');
  });
});

describe("약속 인수 확인 = 담당자 본인 확인 — '다른 강사 뷰'에서는 대신 하지 않는다(전자결재 서명과 같은 결)", () => {
  const owner = "00000000-0000-4000-8000-000000000002";
  const at = "2026-11-06T09:00:00.000Z";
  const content: CareContent = { need: "오답을 봐 달라", promise: "주 1회 오답 확인", criterion: "오답 노트 확인", dueOn: "2026-11-20", ownerId: owner, subject: "수학", sourceId: null };
  const created = () => transitionCare(null, { kind: "create", content }, { id: "00000000-0000-4000-8000-000000000001", canManage: true, canContribute: true, proxy: false }, at);
  it("담당자 본인(강사뷰 아님)은 인수 확인 · 같은 담당자 명의라도 강사뷰(proxy)면 거절", () => {
    const self: CareActor = { id: owner, canManage: false, canContribute: true, proxy: false };
    expect(transitionCare(created(), { kind: "acknowledge" }, self, at).acknowledged?.by).toBe(owner);
    expect(() => transitionCare(created(), { kind: "acknowledge" }, { ...self, proxy: true }, at)).toThrow("강사뷰에서는 대신 확인하지 않습니다");
  });
});
