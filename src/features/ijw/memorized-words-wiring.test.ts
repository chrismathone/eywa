import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 구조 가드 — JJ실 '누적 암기 단어수' 자동 채우기(원장 2026-09-21 · 2026-09-28)와 **SRS 탭**.
 *
 * 지키는 것 다섯:
 *  · 문 **셋**(크론 · 자리 출석부 버튼 · 영어 강사 시트 버튼)이 같은 함수로 적는다 — 셋이 다른 숫자를
 *    적으면 안 된다.
 *  · **사람이 쓴 글자는 덮지 않는다** — 숫자만 갱신하고 메모가 든 칸은 그대로(판정은 순수 모듈 한 곳).
 *  · 짝(ijw_student_id)으로만 맞춘다 — 인재원이 지점별로 갈려 이름으로 맞추면 남의 학생이 붙는다.
 *  · 시트 문은 **그 반·그 교시**만 건드리고, 적은 값을 화면 state에 옮긴다(refresh로는 안 바뀐다).
 *  · SRS 탭은 짝이 걸린 학생에게만, 강제 URL도 되돌린다([[#77]]).
 */

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), "utf-8");

const CORE = "src/features/ijw/server/memorized-words.ts";
const RULE = "src/features/ijw/memorized-cell.ts";
const CRON = "src/app/api/cron/ijw-memorized-words/route.ts";
const MANUAL = "src/features/attendance/seat/server/memorized-actions.ts";
const SHEET = "src/features/class-sheets/server/memorized-actions.ts";

describe("누적 암기 단어수 자동 채우기", () => {
  it("🔴 문 셋(크론·자리 버튼·시트 버튼)이 같은 함수를 부른다 — 규칙을 각자 구현하지 않는다", () => {
    for (const p of [CRON, MANUAL, SHEET]) {
      const src = read(p);
      expect(src, p).toContain("fillMemorizedWords");
      // 무엇을 적을지·덮을지·어떻게 맞출지를 여기서 다시 정하지 않는다(그 판단은 core 한 곳).
      // 🔴 **어느 지표를 적을지도 호출부가 고르지 않는다** — core 한 곳이 정한다.
      for (const metric of ["seenWords", "longTermWords", "newWords"]) {
        expect(src, `${p} · ${metric}`).not.toContain(metric);
      }
      expect(src, p).not.toContain("class_sheet_student_marks");
      // 🔴 모드(덮을지 말지)도 호출부가 고르지 않는다 — core가 날짜로 정한다.
      expect(src, p).not.toContain("memorizedFillMode");
    }
  });

  it("🔴 덮기 판정은 순수 모듈 한 곳 — core가 숫자 판정을 다시 짜지 않는다", () => {
    const core = read(CORE);
    // 지금 DB에 적힌 값을 **여기서 읽어** 가린다(화면이 넘긴 값을 믿지 않는다).
    expect(core).toContain('.select("class_id, student_id, slot_start, memorized_words")');
    expect(core).toContain("memorizedCellPlan");
    expect(core).toContain("memorizedFillMode");
    // `keep`은 쓰기 후보에 아예 안 든다 — 이 분기가 빠지면 메모가 든 칸이 payload로 흘러간다.
    expect(core.replace(/\s+/g, " ")).toContain('if (plan === "keep") kept += 1;');
    // 숫자 판정을 core에 복사해 두면 한쪽만 고쳐진다(정규식은 규칙 모듈에만 있어야 한다).
    expect(core).not.toContain("0-9");
  });

  it("🔴 숫자 판정 정규식은 규칙 모듈에만 있다 — 느슨해지면 사람 메모가 사라진다", () => {
    const rule = read(RULE);
    expect(rule).toContain("/^[0-9][0-9,]*$/");
    // 지난 날 칸은 그 날의 기록이라 갱신하지 않는다(오늘·앞날만 refresh).
    expect(rule.replace(/\s+/g, " ")).toContain('return date < today ? "fill" : "refresh";');
  });

  it("🔴 본 단어(seenWords) = '지금까지 학습한 단어 수'를 적는다 — 장기기억·새 단어가 아니다", () => {
    // 원장 2026-09-28: *"지금까지 학습한 단어수로 할꺼임"* — 기준 화면은 인재원 랭킹이고
    // 그 캡션이 "지금까지 학습한 단어 수"다. 2026-09-22의 장기기억 선택을 **원장이 뒤집었다**.
    // ⚠️ `newWords`는 기간 지표(`kpi` 안)라 애초에 대상이 아니다 — 넣으면 그 달치만 적힌다.
    const core = read(CORE);
    // 주석이 아니라 **실제로 읽는 줄**을 본다(설명에도 지표 이름이 나온다 — 설명을 결과로 오인하면 안 된다).
    expect(core).toContain("[s.ijwId, s.seenWords]");
    expect(core).not.toContain("[s.ijwId, s.longTermWords]");
    expect(core).not.toContain("[s.ijwId, s.newWords]");
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
    const log = read("src/features/audit/server/log.ts");
    const desc = read("src/features/audit/describe.ts");
    for (const key of ["seat_jj_memorized_pull", "ecs_memorized_pull"]) {
      expect(log, key).toContain(`${key}:`);
      expect(desc, key).toContain(`case "${key}"`);
    }
  });
});

describe("영어 강사 시트의 [SRS 단어수] 문", () => {
  it("🔴 게이트는 그 칸을 손으로 적을 때와 **같은 문**(ECS 쓰기) — 화면 조건은 게이트가 아니다([[#77]])", () => {
    const src = read(SHEET);
    expect(src).toContain('requireEcsClassAccess(input.classId, { write: true })');
  });

  it("🔴 명단은 서버가 다시 읽고 **그 반·그 교시**로 좁힌다 — 안 좁히면 남의 반 칸까지 쓴다", () => {
    const src = read(SHEET).replace(/\s+/g, " ");
    expect(src).toContain("getPublicSeatDay(tenantId");
    expect(src).toContain("slot.slice(0, 5) === input.slotStart");
    expect(src).toContain("c.classId === input.classId");
  });

  it("🔴 적은 값을 화면 state로 옮긴다 — 마크는 useState라 refresh로는 안 바뀐다", () => {
    // 서버가 무엇을 적었는지 돌려주고(`written`),
    expect(read(CORE)).toContain("written.push({ studentId: t.studentId");
    expect(read(SHEET)).toContain("written: res.written.map(");
    // 시트가 그걸 `marks`에 머지하고,
    const client = read("src/features/class-sheets/components/sheet-client.tsx");
    expect(client).toContain("const applyMemorizedWords = useCallback(");
    expect(client).toContain("memorizedWords: w.memorizedWords");
    // 버튼은 머지 손이 있을 때만 선다(없으면 "눌렀는데 칸이 그대로"가 된다).
    const block = read("src/features/class-sheets/components/period-block.tsx");
    expect(block).toContain("handlers.applyMemorizedWords");
    expect(block.replace(/\s+/g, " ")).toContain('form === "selfStudy" && canEdit && slot.scheduled');
  });

  it("문구는 사전을 탄다 — 원어민 강사도 여는 화면이다", () => {
    const chip = read("src/features/class-sheets/components/memorized-pull-chip.tsx");
    for (const key of ["roster.srs", "roster.srs.busy", "roster.srs.title", "roster.srs.done"]) {
      expect(chip, key).toContain(`"${key}"`);
    }
    // 🔴 한글 리터럴을 이 파일에 다시 적지 말 것(주석은 규칙을 설명하는 자리라 뺀다).
    const body = chip.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ 	]*\/\/.*$/gm, "");
    expect(body).not.toMatch(/[가-힣]/);
  });
});

describe("SRS 탭", () => {
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
