// 적용일·충돌 게이트가 **배선된 채로 남아 있는지** 지키는 구조 가드.
// 순수 규칙(effective-date.ts·conflicts.ts)은 각자 테스트가 있지만, 그 규칙을 아무도 안 부르면
// 화면은 날짜를 고르게 해 놓고 서버는 여전히 오늘로 적용한다 — 그게 이 파일이 막는 회귀다.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { readMigration } from "@/lib/db/migrations-corpus.mjs";
const root = process.cwd();
const read = (p: string) => readFileSync(join(root, p), "utf-8");
/** 주석을 걷어낸 코드만 — 규칙을 설명하는 주석이 그 규칙의 위반으로 잡히면 안 된다. */
const code = (p: string) =>
  read(p)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split(/\r?\n/)
    .filter((l) => !l.trim().startsWith("//"))
    .join("\n");

const STRUCTURE = "src/features/timetable/server/structure-import-actions.ts";
const ENROLL = "src/features/timetable/server/import-actions.ts";
const ENG_DIALOG = "src/app/(shell)/timetable/_components/english-import-dialog.tsx";
const MOVE_DIALOG = "src/app/(shell)/timetable/_components/import-dialog.tsx";
const TOOLBAR = "src/app/(shell)/timetable/_components/toolbar-actions.tsx";
const PAGE = "src/app/(shell)/timetable/page.tsx";

describe("서버 액션이 적용일을 실제로 쓴다", () => {
  it("구조 import — 미리보기·적용 둘 다 적용일을 서버에서 재검증한다", () => {
    const s = read(STRUCTURE);
    // 클라 값을 그대로 쓰지 않는다: 두 진입점(preview·apply)이 각각 순수 규칙을 통과시킨다.
    expect(s.match(/normalizeEffectiveDate\(effectiveDateRaw, kstToday\(\)\)/g)).toHaveLength(2);
    expect(s).toMatch(/computeFresh\(supabase, subject, eff\.date\)/);
  });

  it("구조 import — 컨텍스트를 '오늘'이 아니라 적용일 기준으로 읽는다", () => {
    const s = read(STRUCTURE);
    // 🔴 인자 없이 부르면 예약해 둔 미래 배치가 안 보여 같은 슬롯을 한 벌 더 넣는다.
    expect(s).toMatch(/loadStructureContext\(supabase, asOf\)/);
    expect(s).not.toMatch(/loadStructureContext\(supabase\)/);
  });

  it("구조 import — RPC p_today에 적용일이 들어간다", () => {
    const s = read(STRUCTURE);
    expect(s).toMatch(/const today = eff\.date;/);
    expect(s).toMatch(/apply_english_structure["'],\s*\{\s*p_payload: payload, p_today: today\s*\}/);
  });

  it("구조 import — 더 늦게 예약된 배치가 있으면 새 행을 그 전날로 닫는다", () => {
    const s = read(STRUCTURE);
    // 안 닫으면 그 예약일부터 옛/새 행이 둘 다 살아 같은 칸이 두 번 그려진다.
    expect(s).toMatch(/pendingLater/);
    expect(s).toMatch(/laterByKey\.get\(slotKey\(/);
    expect(s).toMatch(/shiftDays\(until, -1\)/);
    expect(s).toMatch(/validTo: boundValidTo\(p\)/);
    const sql = readMigration("0231a_apply_english_structure_effective_date.sql");
    expect(sql).toMatch(/p_today, nullif\(rec->>'validTo', ''\)::date/);
  });

  it("반이동 — 세 쓰기(이동·종료·추가)가 한 날짜를 쓴다", () => {
    const s = read(ENROLL);
    expect(s).toMatch(/async function applyDiff\([\s\S]*?effective: string,/);
    expect(s).toMatch(/const today = effective;/);
    // ⚠️ 안 넘기면 RPC 기본값 current_date(DB 시각)로 떨어져 KST 자정 근처에서 하루가 어긋난다.
    expect(s).toMatch(/p_effective_date: effective/);
    // 4번째 인자가 `eff.date`(서버 검증한 적용일)인 것이 이 가드의 핵심 — 뒤에 인자가 더 붙는 것은
    // 허용하되(감사로그 출처 등), 날짜 자리가 다른 값으로 바뀌면 여전히 걸린다.
    expect(s.match(/applyDiff\(user, supabase, fresh\.diff, eff\.date[,)]/g)).toHaveLength(2);
  });

  it("반이동 — 두 진입점 모두 적용일을 서버 검증한다", () => {
    const s = read(ENROLL);
    expect(s.match(/normalizeEffectiveDate\(effectiveDateRaw, kstToday\(\)\)/g)).toHaveLength(2);
  });
});

describe("충돌 확인 게이트 — 화면만이 아니라 서버가 막는다", () => {
  it("적용 액션이 확인 목록을 재계산해 대조한다", () => {
    const s = read(STRUCTURE);
    expect(s).toMatch(/acknowledgedConflicts\?: readonly string\[\]/);
    expect(s).toMatch(/conflictKeys\(conflictChecklist\(report\.conflicts\)\)/);
    // 불일치면 중단 — "확인했다"고 안 보내고 부르는 호출이 통과하면 안 된다([[#77]]).
    expect(s).toMatch(/staleConflicts/);
  });

  it("합반은 게이트에 안 걸린다 — conflictChecklist가 걸러 주는 구조를 유지", () => {
    const c = read("src/features/timetable/import/structure/conflicts.ts");
    expect(c).toMatch(/blocksApply[\s\S]{0,120}kind !== "merged"/);
    expect(c).toMatch(/conflictChecklist[\s\S]{0,200}c\.touched && blocksApply\(c\.kind\)/);
  });

  it("자리(LAB·JJ) 제외는 정본 판정을 쓴다 — 문자열을 새로 박지 않는다", () => {
    const c = read("src/features/timetable/import/structure/conflicts.ts");
    expect(c).toMatch(/from "@\/features\/timetable\/lib\/teacher-label"/);
    // 라벨 목록을 여기에 복사하면 별칭이 늘 때 조용히 갈린다.
    expect(c).not.toMatch(/\["lab"|'lab'|LAB_ALIASES/);
  });
});

describe("화면 배선 — 날짜 칸과 체크리스트가 붙어 있다", () => {
  it("두 가져오기 다이얼로그 모두 적용일 칸을 렌더한다", () => {
    for (const p of [ENG_DIALOG, MOVE_DIALOG]) {
      const s = read(p);
      expect(s, p).toMatch(/<EffectiveDateField\b/);
      expect(s, p).toMatch(/today: string;/);
    }
  });

  it("영어 다이얼로그 — 체크가 끝나야 적용 버튼이 열린다", () => {
    const s = read(ENG_DIALOG);
    expect(s).toMatch(/<ConflictChecklist\b/);
    expect(s).toMatch(/const ackDone = mustAck\.every\(\(c\) => checked\.has\(c\.key\)\)/);
    expect(s).toMatch(/disabled=\{!ackDone\}/);
    // 적용 호출에 확인 키를 실어 보낸다(안 실으면 서버가 거절한다).
    expect(s).toMatch(/applyStructureImport\(struct\.hash, subject, effective, \[\.\.\.checked\]\)/);
  });

  it("영어 다이얼로그 — 충돌 표시가 조용해지는 축은 '배치 변경 수'다", () => {
    // 🔴 `totalChanges`로 판정하면 "배치 0건 + 반이동 3건"일 때 무관한 경고가 그대로 선다
    //    (충돌은 오직 배치에서 나온다). 원장 2026-09-14 *"변경이 없는데 마치 오류인것처럼 호도되어보임"*.
    expect(read(ENG_DIALOG)).toMatch(/changed=\{structChanges > 0\}/);
    // 접기는 표시 층에서만 — 체크리스트(①)와 게이트는 그대로 남는다.
    const c = read("src/app/(shell)/timetable/_components/conflict-checklist.tsx");
    expect(c).toMatch(/conflictChecklist\(conflicts\)/);
    expect(c).toMatch(/const quiet = !changed;/);
  });

  it("영어 다이얼로그 — 적용일을 바꾸면 미리보기를 버린다(그 날짜로 다시 계산해야 한다)", () => {
    const s = read(ENG_DIALOG);
    expect(s).toMatch(/function changeEffective\(next: string\) \{[\s\S]{0,220}clearPreview\(\)/);
    expect(s).toMatch(/onChange=\{changeEffective\}/);
    // 체크는 미리보기에 매인다 — 목록이 바뀌었는데 체크가 남아 있으면 안 된다.
    expect(s).toMatch(/function clearPreview\(\) \{\s*setChecked\(new Set\(\)\);/);
  });

  it("오늘은 서버(KST)가 내려준다 — 클라에서 만들지 않는다", () => {
    // 브라우저 타임존이 다르면 '오늘'이 하루 어긋나 과거 적용이 되거나 오늘이 거절된다.
    expect(read(PAGE)).toMatch(/<TimetableToolbarActions[\s\S]{0,200}today=\{today\}/);
    expect(read(TOOLBAR).match(/today=\{today\}/g)).toHaveLength(3);
    for (const p of [ENG_DIALOG, MOVE_DIALOG, "src/app/(shell)/timetable/_components/effective-date-field.tsx"]) {
      expect(code(p), p).not.toMatch(/new Date\(\)/);
    }
    // 기본값도 prop에서 온다(클라가 자체 계산하면 위 검사를 통과하면서도 하루가 어긋난다).
    for (const p of [ENG_DIALOG, MOVE_DIALOG]) {
      expect(code(p), p).toMatch(/useState\(today\)/);
    }
  });
});
