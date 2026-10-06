import { describe, expect, it } from "vitest";
import { DEFAULT_PERIODS_CONFIG } from "@/features/timetable/lib/periods";
import { buildMathGridPreview, slotTimeText, type PreviewContext } from "./build-preview";
import type { DeltaSlot, GridDelta } from "./types";

const PERIODS = { weekday: DEFAULT_PERIODS_CONFIG.weekday, weekend: DEFAULT_PERIODS_CONFIG.weekend };

const slot = (over: Partial<DeltaSlot>): DeltaSlot => ({
  teacher: "허주연",
  days: ["수"],
  periodIds: ["2-1", "2-2"],
  weekend: false,
  room: "본원202",
  ...over,
});

const ctx = (over: Partial<PreviewContext> = {}): PreviewContext => ({
  classes: [
    { id: "c-old", name: "초등M 개별 JJ2I", active: true },
    { id: "c-dead", name: "초등M 종강반", active: false },
  ],
  students: [
    { id: "s1", name: "박지호", school: "달성초", grade: "초6", status: "enrolled" },
    { id: "s2", name: "김하늘", school: "옥산초", grade: "초5", status: "enrolled" },
    { id: "s3", name: "김하늘", school: "칠성초", grade: "초4", status: "enrolled" },
  ],
  teacherNames: ["허주연"],
  roomNames: ["본원202"],
  enrolled: new Set(["s1:c-old"]),
  periods: PERIODS,
  ...over,
});

const delta = (over: Partial<GridDelta>): GridDelta => ({
  newClasses: [],
  placedClasses: [],
  moves: [],
  adds: [],
  removes: [],
  notes: [],
  warnings: [],
  stats: { classCells: 1, students: 1 },
  ...over,
});

describe("수학 격자 미리보기", () => {
  it("교시를 학원 교시표의 시각으로 바꿔 적는다", () => {
    expect(slotTimeText(slot({}), PERIODS)).toBe("16:20~18:10 (2교시)");
    expect(slotTimeText(slot({ periodIds: ["3-2"] }), PERIODS)).toBe("19:15~20:10 (3교시 뒤 시간)");
    expect(slotTimeText(slot({ periodIds: ["1-1", "1-2", "2-1"], weekend: true }), PERIODS)).toBe("09:00~12:00");
  });

  it("새 반은 강사·시각·강의실·학생과 함께 보이고, 모르는 이름은 표시한다", () => {
    const p = buildMathGridPreview(
      delta({
        newClasses: [
          {
            name: "초등M 종강반",
            slots: [slot({ teacher: "새선생", room: "별관9" })],
            students: [
              { studentId: "s1", text: "박지호/6달성초" },
              { studentId: null, text: "김하늘/4칠성초" }, // 글자 전체가 한 학생과 맞는다
              { studentId: null, text: "김하늘" }, // 이름만으로는 둘
              { studentId: null, text: "없는아이/1옥산초" },
            ],
          },
        ],
      }),
      ctx(),
      "수학 탭",
    );
    expect(p.newClasses[0]).toEqual({
      name: "초등M 종강반",
      slots: [{ teacher: "새선생", teacherKnown: false, when: "수 16:20~18:10 (2교시)", room: "별관9", roomKnown: false }],
      students: [
        { label: "박지호/6달성초", state: "ok" },
        { label: "김하늘/4칠성초", state: "ok" },
        { label: "김하늘", state: "ambiguous" },
        { label: "없는아이/1옥산초", state: "unknown" },
      ],
      clash: true, // 같은 이름의 종강 반이 이름을 쥐고 있다
    });
  });

  it("앱에서 이미 그렇게 돼 있는 변경은 걸러 내고 이유를 남긴다", () => {
    const from = { classId: "c-old", name: "초등M 개별 JJ2I" };
    const p = buildMathGridPreview(
      delta({
        moves: [{ student: { studentId: "s1", text: "박지호/6달성초" }, from, to: { classId: null, name: "새 반" } }],
        adds: [{ student: { studentId: "s1", text: "박지호/6달성초" }, to: from }], // 이미 그 반 수강 중
        removes: [{ student: { studentId: "s2", text: "김하늘/5옥산초" }, from }], // 그 반 수강이 없다
      }),
      ctx(),
      "수학 탭",
    );
    expect(p.moves).toEqual([{ student: "박지호/6달성초", from: "초등M 개별 JJ2I", to: "새 반", toNew: true }]);
    expect([p.adds, p.removes]).toEqual([[], []]);
    expect(p.notes).toEqual([
      '박지호/6달성초 — 이미 "초등M 개별 JJ2I" 수강 중이라 추가에서 뺐습니다.',
      '김하늘/5옥산초 — 이미 "초등M 개별 JJ2I"에서 빠져 있어 그대로 둡니다.',
    ]);
  });

  it("이동의 한쪽이 이미 끝났으면 남은 쪽만 보인다", () => {
    const p = buildMathGridPreview(
      delta({
        moves: [
          {
            student: { studentId: "s2", text: "김하늘/5옥산초" },
            from: { classId: "c-old", name: "초등M 개별 JJ2I" },
            to: { classId: null, name: "새 반" },
          },
        ],
      }),
      ctx(),
      "수학 탭",
    );
    expect(p.moves).toEqual([]);
    expect(p.adds).toEqual([{ student: "김하늘/5옥산초", to: "새 반", toNew: true, state: "ok" }]);
  });
});
