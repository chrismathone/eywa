import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { MENT_STYLE_DIRECTIVE_HEAD } from "./ment-style-prompt";

/**
 * 강사 말투 프로파일(0262a) **배선 가드** — 코퍼스(0214a)는 3주째 쌓였는데 읽는 곳이 0이었다(2026-09-12 점검).
 * 다시 그 상태로 돌아가지 않게, 소비처 셋(자동작성 프롬프트 · 주간 cron · 선생님 안내문)과 감사로그 등록을 텍스트로 잠근다.
 * ⚠️ 서버 파일은 `server-only`라 import 대신 소스를 읽는다(actions-registry.test.ts와 같은 방식).
 */
const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), "utf8");

describe("자동작성이 강사 말투를 읽는다", () => {
  const src = read("src/features/onescreen/server/actions.ts");
  it("generateReportComment가 프로파일을 읽어 멘트 섹션(모드 A·B 전부)에 붙인다", () => {
    const start = src.indexOf("export async function generateReportComment(");
    const end = src.indexOf("\nexport async function", start + 1);
    const body = src.slice(start, end);
    expect(body).toContain("loadTeacherMentStyle(");
    expect(body).toContain("mentStyleDirective(");
    // 호출 = 모드 A 한 곳 + 모드 B P1·P2 두 곳(정의 `= (body` 는 `withTeacherStyle(`에 안 걸린다)
    expect(body.match(/withTeacherStyle\(/g)?.length).toBeGreaterThanOrEqual(3);
    // 프로파일 주인은 화면의 강사(겸직 강사뷰 포함) — 로그인 계정으로만 고르면 겸직이 관리자 계정 프로파일을 찾는다
    expect(body).toContain("effectiveTeacherId()");
    // 스코프가 없으면(관리자 뷰 = 사무실 대리작성) 프로파일을 읽지 않는다 — 다른 강사 이름으로 나가는 보고서에 사무실 말투가 붙지 않게
    expect(body).toMatch(/teacherId \? loadTeacherMentStyle\(/);
  });
  it("사무실 대리작성(직접 작성·일괄 작성)은 teacherStyle:false를 넘긴다 — 남의 이름으로 나가는 보고서에 호출자 말투 금지", () => {
    for (const f of ["src/app/(shell)/lesson-reports/_components/compose-face.tsx", "src/app/(shell)/lesson-reports/_components/bulk-compose-face.tsx"]) {
      const src = read(f);
      expect(src, f).toContain("generateReportComment(");
      expect(src, f).toContain("{ teacherStyle: false }");
    }
  });
  it("지침 머리가 프롬프트에 실리는 글자 그대로다", () => {
    expect(MENT_STYLE_DIRECTIVE_HEAD).toBe("[이 선생님의 말투 — 따라 쓰기]");
  });
});

describe("주기적 갱신 — cron이 등록돼 있고 같은 빌드 함수를 부른다", () => {
  it("vercel.json에 주간 스케줄", () => {
    const cfg = JSON.parse(read("vercel.json")) as { crons: { path: string; schedule: string }[] };
    const entry = cfg.crons.find((c) => c.path === "/api/cron/ment-style-rebuild");
    expect(entry).toBeTruthy();
    // 일요일 11:00 UTC = 20:00 KST — 월요일 수업 전
    expect(entry?.schedule).toBe("0 11 * * 0");
  });
  it("라우트가 rebuildTenantMentStyles를 부르고 감사로그를 남긴다", () => {
    const src = read("src/app/api/cron/ment-style-rebuild/route.ts");
    expect(src).toContain("rebuildTenantMentStyles(");
    expect(src).toMatch(/budgetMs\b/); // 시간 예산 없이 직렬로 돌리면 폴백 주간에 뒤 강사·감사로그가 사라진다
    expect(src).toContain("logActionAs(");
    expect(src).toContain('action: "ment_style_rebuild"');
    expect(src).toContain("CRON_SECRET");
  });
  it("[지금 갱신]도 같은 함수 + 감사로그", () => {
    const src = read("src/features/onescreen/server/ment-style-actions.ts");
    expect(src).toContain("rebuildTenantMentStyles(");
    expect(src).toContain('action: "ment_style_rebuild"');
  });
});

describe("선생님에게 보이는 안내(원장 2026-09-12)", () => {
  const TAIL = "직접 쓰거나 고친 멘트는 선생님 말투로 자동작성에 반영됩니다";
  const i18n = read("src/features/teacher-view/i18n.ts");
  // 그 키의 항목만(다음 항목 `},`까지) — 이웃 키(mentPh ↔ mentPhVoice)가 섞이면 판정이 뒤집힌다.
  const block = (key: string) => {
    const i = i18n.indexOf(`"${key}"`);
    expect(i, `${key} 없음`).toBeGreaterThan(-1);
    const end = i18n.indexOf("},", i);
    return i18n.slice(i, end > i ? end : i + 500);
  };
  it("프로파일을 읽는 칸(표 모드 A 말투용·모드 B 둘째 문단·카드 모드)은 '반영된다'를 말한다", () => {
    for (const key of ["os.row.mentPhVoice", "os.row.ment2Ph", "os.card.para2Ph", "os.card.mentPh"]) expect(block(key)).toContain(TAIL);
  });
  it("영어 행(템플릿 모드 — 프로파일을 읽지 않는다)의 자리표시자는 그 말을 하지 않는다", () => {
    expect(block("os.row.mentPh")).not.toContain(TAIL);
    expect(block("os.card.mentPhTemplate")).not.toContain(TAIL);
    // 표 모드는 같은 textarea라 행 판정으로 가른다
    expect(read("src/features/onescreen/components/grid-row.tsx")).toContain('isEnglishRow ? t("os.row.mentPh") : t("os.row.mentPhVoice")');
  });
});

describe("감사로그 등록", () => {
  it("액션 키·대상 라벨·시스템 행위자 라벨", () => {
    expect(read("src/features/audit/server/log.ts")).toContain("ment_style_rebuild:");
    const d = read("src/features/audit/describe.ts");
    expect(d).toContain('ment_style: "강사 말투"');
    expect(d).toContain('"ment-style-rebuild"');
    expect(d).toContain('case "ment_style_rebuild"');
  });
});
