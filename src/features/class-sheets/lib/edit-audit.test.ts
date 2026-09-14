import { describe, expect, it } from "vitest";
import {
  AUDIT_VALUE_MAX,
  auditValueChanged,
  clipAuditValue,
  GOAL_FIELD_LABEL,
  MARK_EDIT_FIELDS,
  markEditTouches,
  markFieldLabel,
  MEMO_KEY_RE,
  memoKeyLabel,
  mpCellLabel,
  mpStructuralChange,
  parseSheetEdits,
  SHEET_EDIT_BATCH_MAX,
  sheetEditCellId,
  type SheetEditCell,
} from "./edit-audit";

// 원장 결정(2026-09-14): 강사 시트 자동저장의 감사로그 = **칸 입력을 마칠 때 한 줄**.
const SID = "3f0b6a2e-1c2d-4e5f-8a9b-0c1d2e3f4a5b";

describe("변동 판정 — 바뀌었을 때만 한 줄", () => {
  it("앞뒤 공백·빈칸↔행 없음은 같은 뜻이다(0줄) — 저장 codec과 같은 정규화", () => {
    expect(auditValueChanged(" PL 7 ", "PL 7")).toBe(false);
    expect(auditValueChanged("", null)).toBe(false);
    expect(auditValueChanged(null, "   ")).toBe(false);
    expect(auditValueChanged(undefined, null)).toBe(false);
  });

  it("뜻이 달라지면 1줄", () => {
    expect(auditValueChanged(null, "PL 7")).toBe(true);
    expect(auditValueChanged("PL 7", null)).toBe(true);
    expect(auditValueChanged("PL 7", "PL 8")).toBe(true);
  });
});

describe("값 자르기 — 감사로그 행은 내용 사본이 아니다", () => {
  it("상한을 넘으면 글자 단위로 잘라 말줄임을 붙인다", () => {
    const clipped = clipAuditValue("가".repeat(AUDIT_VALUE_MAX + 5))!;
    expect(Array.from(clipped)).toHaveLength(AUDIT_VALUE_MAX + 1);
    expect(clipped.endsWith("…")).toBe(true);
  });

  it("🔴 이모지가 반쪽으로 잘리지 않는다(외톨이 서로게이트 없음)", () => {
    const clipped = clipAuditValue("😀".repeat(AUDIT_VALUE_MAX + 1))!;
    expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(clipped)).toBe(false);
  });

  it("짧은 값은 그대로(앞뒤 공백만 걷는다) · 빈 값은 null", () => {
    expect(clipAuditValue("  p.32 ")).toBe("p.32");
    expect(clipAuditValue("")).toBeNull();
    expect(clipAuditValue(null)).toBeNull();
  });
});

describe("요청 모양 검증 — 서버는 클라가 보낸 칸을 믿지 않는다", () => {
  const goal = {
    kind: "goal",
    scope: "week",
    periodStart: "2026-09-14",
    role: "homeroom",
    skillArea: "reading",
    field: "textbook",
  };
  const mark = { kind: "mark", studentId: SID, date: "2026-09-14", slotStart: "17:20:00", field: "progressNote" };

  it("다섯 종류가 통과하고, 모르는 키는 버리고, 교시는 HH:MM으로 굳힌다", () => {
    const out = parseSheetEdits([
      { cell: { ...goal, extra: "섞인 값" }, before: null },
      { cell: mark, before: "PL 6" },
      { cell: { kind: "memo", weekStart: "2026-09-14", memoKey: "panel" }, before: "" },
      { cell: { kind: "monthMemo", month: "2026-09" }, before: null },
      { cell: { kind: "mpCell", date: "2026-09-15", colKind: "footer" }, before: null },
    ]);
    expect(out).not.toBeNull();
    expect(out).toHaveLength(5);
    expect(out![0]!.cell).toEqual(goal);
    expect(out![1]!.cell).toMatchObject({ slotStart: "17:20" });
    expect(out![1]!.before).toBe("PL 6");
  });

  it.each<[string, unknown]>([
    ["배열이 아님", { cell: goal, before: null }],
    ["빈 배열", []],
    ["상한 초과", Array.from({ length: SHEET_EDIT_BATCH_MAX + 1 }, () => ({ cell: goal, before: null }))],
    ["before가 숫자", [{ cell: goal, before: 3 }]],
    ["before 누락", [{ cell: goal }]],
    ["모르는 종류", [{ cell: { kind: "plan", lineId: "x" }, before: null }]],
    ["MP 휴강 표식은 칸이 아니다", [{ cell: { kind: "mpCell", date: "2026-09-15", colKind: "off" }, before: null }]],
    ["메모 위치키 틀림", [{ cell: { kind: "memo", weekStart: "2026-09-14", memoKey: "anything" }, before: null }]],
    ["날짜 모양 틀림", [{ cell: { ...mark, date: "2026-9-14" }, before: null }]],
    ["학생 id가 uuid 아님", [{ cell: { ...mark, studentId: "stu-1" }, before: null }]],
    ["학생 기록 칸 이름 틀림", [{ cell: { ...mark, field: "units" }, before: null }]],
    ["영역 키 모양 틀림", [{ cell: { ...goal, skillArea: "Read ing!" }, before: null }]],
    ["목표 칸 이름 틀림", [{ cell: { ...goal, field: "note" }, before: null }]],
    ["달 모양 틀림", [{ cell: { kind: "monthMemo", month: "2026-9" }, before: null }]],
  ])("거절(통째로): %s", (_label, raw) => {
    expect(parseSheetEdits(raw)).toBeNull();
  });

  it("같은 칸이 두 번 오면 **첫 값만**(먼저 잡힌 값이 편집 시작 값)", () => {
    const out = parseSheetEdits([
      { cell: mark, before: "처음" },
      { cell: { ...mark, slotStart: "17:20" }, before: "나중" },
    ]);
    expect(out).toHaveLength(1);
    expect(out![0]!.before).toBe("처음");
  });

  it("메모 위치키는 저장 액션과 같은 규약(주·패널·날짜·교시)", () => {
    for (const k of ["week", "panel", "day:2026-09-14", "slot:2026-09-14:17:20"]) expect(MEMO_KEY_RE.test(k)).toBe(true);
    expect(MEMO_KEY_RE.test("slot:2026-09-14")).toBe(false);
  });
});

describe("학생 기록 저장이 실제로 바꾸는 칸", () => {
  const prev = { status: "좋음", progressNote: "PL 6", score: "18/20", listeningLevel: null, memorizedWords: null };

  it("바뀐 칸만, 그 칸의 직전 값과 함께", () => {
    expect(markEditTouches(prev, { status: "좋음", progressNote: "PL 7" })).toEqual([
      { field: "progressNote", before: "PL 6" },
    ]);
  });

  it("🔴 이번 저장이 안 싣는 칸은 건드린 것이 아니다(시험 점수는 그대로 남는다)", () => {
    expect(markEditTouches(prev, { status: "좋음", progressNote: "PL 6", listeningLevel: "4" })).toEqual([
      { field: "listeningLevel", before: null },
    ]);
  });

  it("기록이 없던 칸에 처음 적으면 직전 값은 null", () => {
    expect(markEditTouches(null, { status: "보통", progressNote: null })).toEqual([{ field: "status", before: null }]);
  });
});

describe("감사로그 화면용 라벨 — raw 키를 내보내지 않는다", () => {
  it("학생 기록 칸 다섯 개가 전부 한글 이름을 가진다", () => {
    for (const f of MARK_EDIT_FIELDS) {
      expect(markFieldLabel(f), f).toMatch(/[가-힣]/);
      expect(markFieldLabel(f)).not.toBe("기록");
    }
    expect(markFieldLabel("progressNote")).toBe("특이사항");
    expect(GOAL_FIELD_LABEL.targetProgress).toBe("목표 진도");
  });

  it("메모 위치키 → 이름", () => {
    expect(memoKeyLabel("panel")).toBe("주간 메모");
    expect(memoKeyLabel("day:2026-09-14")).toBe("2026-09-14 메모");
    expect(memoKeyLabel("slot:2026-09-14:17:20")).toBe("2026-09-14 17:20 메모");
  });

  it("MP 칸 이름 — 값 칸은 원본 문서 표기, 문서 아래 한 덩어리는 '하단 문구'", () => {
    expect(mpCellLabel("in_class")).toBe("In-class");
    expect(mpCellLabel("footer")).toBe("하단 문구");
  });

  it("칸 이름(id)은 칸마다 다르다 — 같은 행의 두 칸이 한 칸으로 뭉치지 않게", () => {
    const a: SheetEditCell = { kind: "mark", studentId: SID, date: "2026-09-14", slotStart: "17:20", field: "status" };
    const b: SheetEditCell = { ...a, field: "progressNote" };
    expect(sheetEditCellId(a)).not.toBe(sheetEditCellId(b));
  });
});

describe("MP 토글 — 의도가 패치와 맞을 때만 한 줄", () => {
  it("e-book 열 세우기(빈 칸 여러 날) → 날짜 범위·일수", () => {
    const patches = ["2026-09-22", "2026-09-01", "2026-09-08"].map((date) => ({ date, colKind: "ebook", body: "" }));
    expect(mpStructuralChange({ kind: "ebookColumn", show: true }, patches)).toEqual({
      change: "ebookColumn",
      show: true,
      days: 3,
      from: "2026-09-01",
      to: "2026-09-22",
    });
  });

  it("휴강 표시 — 칸 하나(off)", () => {
    expect(
      mpStructuralChange({ kind: "dayOff", off: true }, [{ date: "2026-09-25", colKind: "off", body: "off" }]),
    ).toEqual({ change: "dayOff", date: "2026-09-25", off: true });
  });

  it.each<[string, Parameters<typeof mpStructuralChange>[0], Parameters<typeof mpStructuralChange>[1]]>([
    ["의도 없음(칸 글쓰기)", undefined, [{ date: "2026-09-01", colKind: "ebook", body: "" }]],
    ["열 세우기인데 글이 들어 있다", { kind: "ebookColumn", show: true }, [{ date: "2026-09-01", colKind: "ebook", body: "p.3" }]],
    ["열 내리기인데 빈 칸을 만든다", { kind: "ebookColumn", show: false }, [{ date: "2026-09-01", colKind: "ebook", body: "" }]],
    ["휴강인데 다른 칸", { kind: "dayOff", off: true }, [{ date: "2026-09-01", colKind: "test", body: "off" }]],
    ["패치 없음", { kind: "dayOff", off: true }, []],
  ])("기록 없음: %s", (_label, intent, patches) => {
    expect(mpStructuralChange(intent, patches)).toBeNull();
  });
});
