import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 회차 확정 **예정 시수 변경 신호** 배선 가드 — 원장 2026-09-17 *"회차 확정이 반스케줄 조정에 따라 같이 반영되나"*.
 *
 * 회차 확정 창의 예정 시수는 수강(기간·등원 요일·대기·반이동)·시간표 배치·반 운영 상태에서 **그 자리에서** 계산된다.
 * 다른 창에서 그것들을 바꾸면 열려 있는 회차 확정 창이 스스로 새로고침해야 하는데, 받는 쪽은 이미 있고
 * 보내는 쪽은 저장에 성공한 화면이 [`notifyTermPlansChanged`](./plan-change-signal.ts)를 불러야만 돈다.
 * 한 화면이 빠지면 그 화면에서 바꾼 것만 회차 확정 창에 **조용히** 안 뜬다 — 그래서 소스를 스캔해 잠근다.
 *
 *  ① 아래 서버 액션을 **부르는** 클라이언트 파일은 전부 `notifyTermPlansChanged(`를 부른다.
 *  ② 보내는 곳은 하나 — 청구 화면 밖에서 `billing:session-terms`를 직접 쏘지 않는다.
 *  ③ 신호 모듈을 서버 파일이 import하지 않는다(서버에서 부르면 아무 일도 안 일어난다).
 *
 * ⚠️ 새 수강·배치 쓰기 액션을 만들면 `PLAN_ACTIONS`에 이름을 더할 것 — 목록에 없는 액션은 이 가드가 못 본다.
 */
const SRC = path.join(process.cwd(), "src");
const read = (rel: string) => fs.readFileSync(path.join(SRC, rel), "utf8");
/** 주석만 지운다(`//`는 줄 주석으로 볼 수 있는 자리만 — `https://`의 슬래시는 남긴다). */
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");

const PLAN_ACTIONS = [
  // 수강
  "createEnrollment",
  "moveEnrollmentsBatch",
  "updateEnrollmentsAttendanceBatch",
  "updateEnrollmentDates",
  "deleteEnrollment",
  "rescheduleEnrollment",
  "cancelScheduledEnrollment",
  "convertConsultationToStudent",
  // 시간표 배치·가져오기
  "moveClassSlots",
  "applyTimetableImport",
  "applySheetImport",
  "applyStructureImport",
  "rollbackStructureImport",
  "cancelScheduledImport",
  // 반
  "updateClass",
  "archiveClass",
  "endClassTerm",
  "reopenClassTerm",
  // 학생 상태
  "changeStudentStatus",
  "endStudentEnrollments",
  "setStudentEnrollmentHolds",
  "holdSingleEnrollment",
  "endSingleEnrollment",
  "deleteStudent",
  "reactivateStudent",
  // 원생 수정 폼 — 상태를 퇴원·휴원·재원으로 바꾸면 수강을 닫거나 대기로 돌린다(적대적 리뷰 2026-09-17).
  "updateStudent",
  // 관리 도구(데이터 정리·중복 병합) — 수강 종료·학생 퇴원/삭제·수강 이전(원장 2026-09-17 *"관리 도구 화면도 배선해"*).
  "closeOrphanEnrollments",
  "bulkWithdrawStudents",
  "bulkDeleteStudents",
  "mergeStudents",
] as const;

/**
 * 성공을 알 수 없어 신호를 못 붙이는 파일 — **이유 필수**. 지금은 없다.
 * ⚠️ 여기 넣기 전에 액션 결과를 받는 자리를 먼저 찾을 것(대개 있다).
 */
const ALLOWLIST: Record<string, string> = {};

const EXCLUDED_DIRS = new Set(["node_modules", ".next"]);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (EXCLUDED_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

const rel = (full: string) => path.relative(SRC, full).split(path.sep).join("/");
const isClient = (text: string) => /^\s*(?:\/\/[^\n]*\n\s*|\/\*[\s\S]*?\*\/\s*)*["']use client["']/.test(text);
const isServer = (text: string) => /^\s*(?:\/\/[^\n]*\n\s*|\/\*[\s\S]*?\*\/\s*)*["']use server["']/.test(text);

/** 이 파일이 부르는(가져오거나 호출하거나 `useActionState`에 넘기는) 액션 이름. */
function calledActions(text: string): string[] {
  const code = strip(text);
  const imports = [...code.matchAll(/import\s*\{([^}]*)\}\s*from\s*["'][^"']+["']/g)]
    .flatMap((m) => m[1]!.split(","))
    .map((s) => s.trim().replace(/^type\s+/, "").split(/\s+as\s+/)[0]!.trim());
  return PLAN_ACTIONS.filter(
    (name) =>
      imports.includes(name) ||
      new RegExp(`\\b${name}\\s*\\(`).test(code) ||
      new RegExp(`useActionState(?:<[^>]*>)?\\(\\s*${name}\\b`).test(code),
  );
}

describe("회차 확정 예정 시수 변경 신호 배선", () => {
  it(
    "① 수강·배치·반·학생 상태를 바꾸는 액션을 부르는 클라이언트 파일은 전부 notifyTermPlansChanged를 부른다",
    () => {
      const files = walk(SRC);
      const callers: string[] = [];
      const missing: string[] = [];
      for (const full of files) {
        const text = fs.readFileSync(full, "utf8");
        if (!isClient(text)) continue;
        const actions = calledActions(text);
        if (actions.length === 0) continue;
        const r = rel(full);
        callers.push(r);
        if (ALLOWLIST[r]) continue;
        if (!strip(text).includes("notifyTermPlansChanged(")) missing.push(`${r} (${actions.join(", ")})`);
      }
      expect(missing, "저장 성공 뒤 notifyTermPlansChanged()를 부르세요").toEqual([]);

      // 스캐너가 조용히 아무것도 못 찾는 회귀를 막는다 — 알려진 호출부가 잡혀야 한다.
      expect(callers).toEqual(
        expect.arrayContaining([
          "components/enrollment-assign-dialog.tsx",
          "app/(shell)/timetable/_components/timetable-board.tsx",
          "app/(shell)/students/[id]/_components/status-dialog.tsx",
          "features/enrollments/components/editable-date-cell.tsx",
        ]),
      );
      // 죽은 허용 항목 금지 — 더는 액션을 안 부르는 파일이 목록에 남으면 지운다.
      for (const r of Object.keys(ALLOWLIST)) {
        expect(callers, `허용 목록의 ${r}는 더 이상 액션을 부르지 않습니다`).toContain(r);
        expect(ALLOWLIST[r]!.trim().length, `${r}의 이유를 적으세요`).toBeGreaterThan(0);
      }
    },
    60_000,
  );

  it("① 주석 속 이름은 호출로 치지 않는다(스캐너 자체 검사)", () => {
    expect(calledActions("// 서버 `createEnrollment`가 거절한다\nconst x = 1;")).toEqual([]);
    expect(calledActions('import { createEnrollment, type S } from "x";')).toEqual(["createEnrollment"]);
    expect(calledActions("const [s, a] = useActionState<S, FormData>(\n  archiveClass,\n  undefined);")).toEqual([
      "archiveClass",
    ]);
  });

  it("② editable-date-cell은 채널을 직접 쏘지 않고 공용 신호를 쓴다", () => {
    const text = strip(read("features/enrollments/components/editable-date-cell.tsx"));
    expect(text).not.toContain('publishRecordSaved("billing:session-terms")');
    expect(text).toContain("notifyTermPlansChanged(");
  });

  it(
    "② 청구 화면 밖에서는 billing:session-terms를 직접 쏘지 않는다(보내는 곳 = notifyTermPlansChanged 하나)",
    () => {
      const offenders = walk(SRC)
        .map(rel)
        .filter((r) => !r.startsWith("app/(shell)/billing/") && !r.startsWith("features/billing/"))
        .filter((r) => /publishRecordSaved\(\s*["']billing:session-terms["']/.test(strip(read(r))));
      expect(offenders).toEqual([]);
    },
    60_000,
  );

  it(
    "③ 서버 파일은 신호 모듈을 import하지 않는다",
    () => {
      const offenders = walk(SRC)
        .map(rel)
        .filter((r) => {
          const text = read(r);
          return isServer(text) && text.includes("session-terms/plan-change-signal");
        });
      expect(offenders).toEqual([]);
    },
    60_000,
  );
});
