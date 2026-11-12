import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { MENT_STYLE_DIRECTIVE_HEAD } from "./ment-style-prompt";
// 원스크린 화면 + 옮겨 낸 훅(P3-O)을 한 덩어리로 읽는다 — 화면에서 코드를 옮겨도 같은 단언이 선다.
import { readOnescreenScreen } from "./components/onescreen-screen-source.test-util";

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
    // 조립은 미리보기와 같은 공용 함수(ment-assembly.ts, 2026-10-16) — 운영이 말투·어조를 그 함수에 넘긴다
    expect(body).toMatch(/mentSections\(\{[\s\S]*styleBlock,[\s\S]*toneBlock,/);
    // 호출 = 모드 A 한 곳 + 모드 B P1·P2 두 곳(정의 `= (body` 는 `withTeacherStyle(`에 안 걸린다)
    const assembly = read("src/features/onescreen/ment-assembly.ts");
    expect(assembly.match(/withTeacherStyle\(/g)?.length).toBeGreaterThanOrEqual(3);
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
  it("학습 추세 섹션엔 어조만 붙인다(mentStyleToneDirective) — 표현까지 붙이면 추세 금지에 걸린다(2026-10-16)", () => {
    const start = src.indexOf("export async function generateReportComment(");
    const end = src.indexOf("\nexport async function", start + 1);
    const body = src.slice(start, end);
    expect(body).toContain("mentStyleToneDirective(");
    expect(read("src/features/onescreen/ment-assembly.ts")).toMatch(/type: "trend", field: "trend", body: a\.toneBlock \?/);
  });
  it("지침 머리가 프롬프트에 실리는 글자 그대로다", () => {
    expect(MENT_STYLE_DIRECTIVE_HEAD).toBe("[이 선생님의 말투 — 따라 쓰기]");
  });
});

// 2026-10-16 원장 "한계를 수정할 수 있을까" — 무엇을 고쳤는지 배우려면 자동작성 원문이 남아야 한다(0370a).
describe("자동작성 원문(0370a) — 저장이 남기고 빌드가 읽는다", () => {
  it("화면은 '자동작성 후 수정'일 때만 원문을 싣는다(영어 제외)", () => {
    const src = readOnescreenScreen();
    expect(src).toMatch(/mentSource === "auto_edited" && su\?\.subjectKey !== "english" && autoSnap && !existing\?\.autoDraftTemplate \? \{ mentAutoDraft: autoSnap \}/);
    // AI 실패 폴백 템플릿은 원문이 아니다 — 표시가 붙는다
    expect(src).toContain("autoDraftTemplate: true");
  });
  it("저장 액션은 최종 작성 방식이 'auto_edited'일 때 응답 뒤(after)에 기록한다 — 저장을 늦추지 않는다", () => {
    const src = read("src/features/onescreen/server/actions.ts");
    expect(src).toContain('import { after } from "next/server";');
    expect(src).toMatch(/mentSourceFinal === "auto_edited" && input\.mentSource === "auto_edited" && aiDraft/);
    expect(src).toContain("after(() => recordMentAiDraft(");
  });
  it("'달라진 것 없음'이라도 손으로 쓴 추세는 지우지 않는다 — 칸이 지난 자동작성 글 그대로일 때만 비운다(원스크린·사무실 작성)", () => {
    const os = readOnescreenScreen();
    expect(os).toContain('res.ok && res.trendQuiet && (r.trendDraft ?? "") === (r.trendAutoDraft ?? "")');
    const cf = read("src/app/(shell)/lesson-reports/_components/compose-face.tsx");
    expect(cf).toContain("res.trendQuiet && trend === autoTrend");
    // 스냅샷은 새로고침을 넘어야 한다 — 원스크린은 세션에 싣고 로스터가 복원, 사무실 작성은 로컬 초안에(재리뷰 2026-10-16)
    expect(os).toContain("trendAutoDraft: r[su.name]!.trendAutoDraft");
    expect(read("src/features/onescreen/server/roster.ts")).toContain("su.trendAutoDraft = entry.trendAutoDraft");
    expect(cf).toContain('setAutoTrend(d.autoTrend ?? "")');
  });
  it("AI 원문이 아닌 글(폴백 템플릿·지난 회차 복사)은 원문으로 싣지 않는다 — 표시는 세션을 넘는다", () => {
    const os = readOnescreenScreen();
    expect(os).toContain("autoDraft: p.comment, autoDraftTemplate: true");
    expect(os).toContain("...(r?.[su.name]?.autoDraftTemplate ? { autoDraftTemplate: true } : {})");
    expect(read("src/features/onescreen/server/roster.ts")).toContain("if (entry?.autoDraftTemplate === true) su.autoDraftTemplate = true;");
  });
  it("프로파일 빌드가 수정 표본의 원문을 읽는다", () => {
    const src = read("src/features/onescreen/server/ment-style-build.ts");
    expect(src).toContain("loadMentAiDrafts(admin, tenantId, edited.map((r) => r.id))");
  });
  it("표가 없으면(0370a 미적용) 기록·조회 모두 조용히 건너뛴다(#95)", () => {
    const src = read("src/features/onescreen/server/ment-draft-db.ts");
    expect(src).toContain("isMentDraftTableMissingError(error)");
    expect(src).toContain("isMentDraftTableMissingError({ message })");
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
