// 🔴 1인 보드 배정 금지 가드 — 원장 2026-11-04 *"앞으로 1인보드에 배정 시키지마 절대"*(AywaSync 1.0.14).
// `(수학)이름`·`(영어)이름` 1인 보드를 만들거나 원아를 넣는 길이 다시 생기지 않게 잠근다.
// - 1인 보드 준비(옛 classnote-provision-core.mjs — 매일 05시 + 지금 동기화)와 수동 도구 둘은 지웠다.
// - ClassNote에 보드를 만들거나(createBoard) 원아를 넣는(enrollChild) 호출은 반 보드 적용 한 곳뿐이고,
//   그곳도 1인 보드 꼴 이름이면 건너뛴다(isPersonalBoardName).
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { emptyBoardNoticeNote, isPersonalBoardName, noBoardNoticeNote, noBoardReason } from "./board-safety.mjs";
import { humanizeClassnoteError } from "../../src/features/report-admin/classnote-error.ts";

const ROOT = process.cwd();
const DIR = join(ROOT, "scripts/_classnote");

/** scripts/ 아래 코드 파일(시험 파일 제외) — node_modules는 건너뛴다. */
function codeFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...codeFiles(p));
    else if (/\.(mjs|cjs|js|ts)$/.test(name) && !/\.test\./.test(name)) out.push(p);
  }
  return out;
}
const files = codeFiles(join(ROOT, "scripts"));
const rel = (p) => relative(ROOT, p).replace(/\\/g, "/");

describe("🔴 1인 보드 배정 금지(원장 2026-11-04)", () => {
  it("1인 보드 준비 모듈·수동 도구는 없고, 아무도 부르지 않는다", () => {
    for (const f of ["classnote-provision-core.mjs", "provision-classnote-boards.mjs", "assign-classnote-students.mjs"])
      expect(existsSync(join(DIR, f)), f).toBe(false);
    const callers = files.filter((p) => /provisionDailyOnce|classnote-provision-core|provision-classnote-boards|assign-classnote-students/.test(readFileSync(p, "utf8")));
    expect(callers.map(rel)).toEqual([]);
  });

  it("ClassNote 보드 만들기·원아 넣기를 부르는 곳은 반 보드 적용 한 곳뿐이다(별칭 import 금지 · 그 안에서도 한 번씩)", () => {
    const CALL = /(?<!function )\b(createBoard|enrollChild)\(/;
    const callers = files.filter((p) => CALL.test(readFileSync(p, "utf8"))).map(rel);
    expect(callers).toEqual(["scripts/_classnote/math-class-boards-apply.mjs"]);
    // 다른 이름으로 들여와 부르는 우회(`import { enrollChild as x }`)
    const aliased = files.filter((p) => /\b(createBoard|enrollChild)\s+as\b/.test(readFileSync(p, "utf8"))).map(rel);
    expect(aliased).toEqual([]);
    const apply = readFileSync(join(DIR, "math-class-boards-apply.mjs"), "utf8");
    expect(apply.match(/\bcreateBoard\(/g)?.length).toBe(1);
    expect(apply.match(/\benrollChild\(/g)?.length).toBe(1);
  });

  it("원아 넣기 주소(POST …/enrollments/)와 '반 추가하기' 화면 조작은 정의 파일(classnote-admin-core.mjs) 한 곳에만 있다", () => {
    // 주석 줄은 뺀다(설명은 자유) — 코드 줄의 문자열만 본다.
    const codeLines = (src) => src.split(/\r?\n/).filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l));
    const ENDPOINT = /(["'`])(?:\/api)?\/v1\/enrollments\/\1/;
    const ADD_BUTTON = /(["'`])반\s*추가하기\1/;
    for (const re of [ENDPOINT, ADD_BUTTON]) {
      const hits = files.filter((p) => codeLines(readFileSync(p, "utf8")).some((l) => re.test(l))).map(rel);
      expect(hits, String(re)).toEqual(["scripts/_classnote/classnote-admin-core.mjs"]);
    }
  });

  it("반 보드 적용은 1인 보드 꼴 이름이면 만들기·이름 바꾸기·원아 넣기 전에 그 반을 건너뛴다", () => {
    const src = readFileSync(join(DIR, "math-class-boards-apply.mjs"), "utf8");
    const guard = src.indexOf("if (isPersonalBoardName(p.className) || isPersonalBoardName(linkedName))");
    expect(guard).toBeGreaterThan(0);
    for (const call of ["await createBoard(page, p.className)", "await enrollChild(page, c.id, boardId)", 'p.board.action === "create"'])
      expect(guard, call).toBeLessThan(src.indexOf(call));
  });

  it("1인 보드 꼴 이름 판정", () => {
    expect(isPersonalBoardName("(수학)홍길동")).toBe(true);
    expect(isPersonalBoardName(" (영어) 홍길동")).toBe(true);
    expect(isPersonalBoardName("(수학)최성효T")).toBe(true);
    expect(isPersonalBoardName("초등M 개별 BS1L")).toBe(false);
    expect(isPersonalBoardName("[수학] 테스트반")).toBe(false);
    expect(isPersonalBoardName("[EIE] Let's Talk 6 (월수목 14:20~16:20)")).toBe(false);
    expect(isPersonalBoardName(null)).toBe(false);
  });
});

describe("🔴 실패 사유 문구가 벨 힌트에 걸려 '1인 보드를 만들거나 채우라'고 안내하지 않는다(재리뷰 2026-11-04)", () => {
  // 벨 힌트 = SQL `classnote_failure_hint`(보고서·공지 실패 트리거 공용)의 **마지막 정의**에서 ilike 말을 그대로 읽는다.
  const migrations = join(ROOT, "supabase/migrations");
  const sqlFiles = readdirSync(migrations).filter((f) => /^s\d_.*\.sql$/.test(f)).sort();
  const defs = sqlFiles.flatMap((f) => readFileSync(join(migrations, f), "utf8").split("create or replace function public.classnote_failure_hint(").slice(1));
  const last = defs.at(-1) ?? "";
  const words = [...last.slice(0, last.indexOf("$$;")).matchAll(/ilike '%([^%']+)%'/g)].map((m) => m[1]);
  const texts = [
    noBoardReason("(영어)홍길동"), noBoardReason("(수학)홍길동"), noBoardReason("중등M 중1 BS3E"),
    noBoardNoticeNote("(영어)홍길동"), noBoardNoticeNote("(수학)홍길동"),
    emptyBoardNoticeNote("(영어)홍길동"), emptyBoardNoticeNote("(수학)홍길동"),
  ];
  it("힌트 말을 읽어 왔다(보드 없음·프로비저닝·미가입 등)", () => {
    expect(words).toEqual(expect.arrayContaining(["보드 없음", "프로비저닝", "미가입", "학생 없음", "보드 미배정", "배정 필요"]));
  });
  it("새 사유 문구는 힌트 말을 하나도 담지 않는다 → 벨·앱이 원문을 그대로 보인다", () => {
    for (const t of texts) {
      for (const w of words) expect(t.toLowerCase(), `${t} ⊃ ${w}`).not.toContain(w.toLowerCase());
      expect(humanizeClassnoteError(t)).toBe(t);
    }
  });
});
