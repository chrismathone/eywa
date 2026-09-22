import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 구조 가드 — JJ실 '누적 암기 단어수' 자동 채우기(원장 2026-09-21)와 'SRS 성적' 탭.
 *
 * 지키는 것 넷:
 *  · 자동(크론)과 수동(버튼)이 **같은 함수**로 적는다 — 두 길이 다른 숫자를 적으면 안 된다.
 *  · **사람이 적은 값을 덮지 않는다** — 그 칸엔 시험 점수·메모가 실제로 섞여 있다(실측).
 *  · 짝(ijw_student_id)으로만 맞춘다 — 인재원이 지점별로 갈려 이름으로 맞추면 남의 학생이 붙는다.
 *  · SRS 탭은 짝이 걸린 학생에게만, 강제 URL도 되돌린다([[#77]]).
 */

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), "utf-8");

const CORE = "src/features/ijw/server/memorized-words.ts";
const CRON = "src/app/api/cron/ijw-memorized-words/route.ts";
const MANUAL = "src/features/attendance/seat/server/memorized-actions.ts";

describe("누적 암기 단어수 자동 채우기", () => {
  it("🔴 자동(크론)과 수동(버튼)이 같은 함수를 부른다 — 규칙을 각자 구현하지 않는다", () => {
    for (const p of [CRON, MANUAL]) {
      const src = read(p);
      expect(src).toContain("fillMemorizedWords");
      // 무엇을 적을지·덮을지·어떻게 맞출지를 여기서 다시 정하지 않는다(그 판단은 core 한 곳).
      expect(src).not.toContain("longTermWords");
      expect(src).not.toContain("class_sheet_student_marks");
    }
  });

  it("🔴 사람이 적어 둔 값은 덮지 않는다 — 빈 칸만, 그것도 DB에서 다시 읽어 가린다", () => {
    const core = read(CORE);
    expect(core).toContain('.select("class_id, student_id, slot_start, memorized_words")');
    expect(core.replace(/\s+/g, " ")).toContain("const pending = targets.filter((t) => !written.has(");
  });

  it("장기기억(longTermWords)을 적는다 — 본 단어·새 단어가 아니다", () => {
    const core = read(CORE);
    expect(core).toContain("s.longTermWords");
    expect(core).not.toContain("s.seenWords");
    expect(core).not.toContain("s.newWords");
  });

  it("🔴 짝(ijw_student_id)으로만 맞춘다 — 이름으로 맞추지 않는다(지점마다 같은 이름이 있다)", () => {
    const core = read(CORE);
    expect(core).toContain("ijw_student_id");
    expect(core).not.toMatch(/\.eq\("name"/);
  });

  it("인재원은 한 번만 부른다(학생마다 부르지 않는다)", () => {
    const core = read(CORE);
    expect(core.match(/ijwGet\(/g)?.length ?? 0).toBe(1);
    expect(core).toContain("IJW_PATHS.studySummary()");
  });

  it("🔵 비로그인 PIN 화면에서는 수동 가져오기를 열지 않는다(그 문은 찍는 데까지다)", () => {
    const manual = read(MANUAL);
    expect(manual).toContain("gateSeatWrite");
    expect(manual).toContain('gated.via === "pin"');
    // 명단은 서버가 다시 읽는다 — 클라가 보낸 학생 목록을 믿으면 명단 밖 칸이 생긴다.
    expect(manual).toContain("getSeatDay");
  });

  it("충돌 축은 한 곳에서 온다 — 이 칸을 쓰는 문이 셋이라 갈리면 같은 칸이 두 행이 된다", () => {
    expect(read("src/features/attendance/seat/jj-fields.ts")).toContain("JJ_MARK_ON_CONFLICT");
    expect(read(CORE)).toContain("JJ_MARK_ON_CONFLICT");
    expect(read("src/features/attendance/seat/server/mark-actions.ts")).toContain("JJ_MARK_ON_CONFLICT");
  });

  it("크론이 vercel.json에 등록돼 있다 — 안 그러면 '자동'이 영영 안 돈다", () => {
    expect(read("vercel.json")).toContain("/api/cron/ijw-memorized-words");
  });

  it("감사로그 키가 등록돼 있다(영문 키가 화면에 새지 않게)", () => {
    expect(read("src/features/audit/server/log.ts")).toContain("seat_jj_memorized_pull:");
    expect(read("src/features/audit/describe.ts")).toContain('case "seat_jj_memorized_pull"');
  });
});

describe("SRS 성적 탭", () => {
  it("성적 탭에서 JJ 구역을 뺐다 — 두 탭이 같은 구역을 그리지 않는다", () => {
    expect(read("src/app/(shell)/students/[id]/_tabs/grades-tab.tsx")).not.toContain("StudentJjSection");
    expect(read("src/app/(shell)/students/[id]/_tabs/srs-tab.tsx")).toContain("StudentJjSection");
  });

  it("🔴 짝이 없으면 탭을 안 그리고 강제 URL(?tab=srs)도 개요로 되돌린다([[#77]])", () => {
    const page = read("src/app/(shell)/students/[id]/page.tsx");
    expect(page).toContain("hasIjwLink");
    expect(page.replace(/\s+/g, " ")).toContain('requestedTab === "srs" && !showSrs ? "overview"');
    expect(read("src/app/(shell)/students/[id]/_components/tabs-nav.tsx")).toContain(
      't.key !== "srs" || showSrs',
    );
  });

  it("기간 칩이 이 탭으로 돌아온다 — 성적 탭으로 튕기면 그 구역이 사라진다", () => {
    expect(read("src/app/(shell)/students/[id]/_components/jj-section.tsx")).toContain("?tab=srs");
  });
});
