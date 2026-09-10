// '시트 반영'(export) ↔ '시트에서 가져오기'(import) 강사 라벨 **왕복 대칭** 구조 가드.
//
// 🔴 왜 있는가(2026-09-10 원장 제보 *"왜 변경점이 이렇게 많지? 하나도 없어야 정상 아닌가"*):
// 시트 반영 직후 곧바로 가져오기를 열었더니 **변경 199건**이 떴다. 실측 결과 199건 전부가
// "강사만 다름"이었고, 방·종료시각은 한 건도 안 어긋났다. 원인은 축 하나 —
//   · export: 강사 밴드에 `resolveTeacherLabel`을 통과한 **표기 이름**(`Jane`→`추민아`)을 쓴다.
//   · import: DB의 **원문 라벨**(`Jane`)과 시트 글자를 그대로 비교했다.
// 두 값은 같은 사람인데 문자열이 달라, 아무도 안 건드린 슬롯이 전건 '변경'이 된다.
// (적용했으면 199칸이 마감·재삽입되고 `slot_teacher_label` 원문이 전부 한글 이름으로 덮였을 것 —
//  원문 보존은 teacher-label.ts 📌 규약이다.)
//
// ⚠️ export 쪽 규약을 바꾸려거든(시트에 닉네임을 다시 쓰기로 한다든지) **이 파일부터 다시 읽을 것** —
//    한쪽만 고치면 같은 증상이 반대 방향으로 돌아온다.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (p: string) => readFileSync(join(root, p), "utf-8");

const QUERIES = "src/features/timetable/server/queries.ts";
const STRUCTURE = "src/features/timetable/server/structure-import-actions.ts";
const DIFF = "src/features/timetable/import/structure/diff.ts";
const MODEL = "src/features/timetable/lib/teacher-grid-model.ts";

describe("export — 시트 강사 밴드는 해석된 표기 이름이다", () => {
  it("슬롯 라벨이 resolveTeacherLabel을 통과해 나간다", () => {
    // 이 줄이 곧 "시트엔 한글 이름이 적힌다"의 근거다. 바뀌면 아래 import 대칭도 함께 손봐야 한다.
    expect(read(QUERIES)).toMatch(/slotTeacherLabel: resolveTeacherLabel\(/);
  });

  it("강사 열 이름 = slotTeacherLabel ?? teacherName (teacherOf 단일 소스)", () => {
    expect(read(MODEL)).toMatch(/export function teacherOf[\s\S]{0,160}s\.slotTeacherLabel \?\? s\.teacherName/);
  });
});

describe("import — 기존 라벨을 같은 해석기로 한 번 더 읽는다", () => {
  it("loadStructureContext가 라벨맵을 받아 slotTeacherDisplay를 채운다", () => {
    const s = read(STRUCTURE);
    expect(s).toMatch(/getTeacherLabelMap\(\)/);
    expect(s).toMatch(/slotTeacherDisplay: resolveTeacherLabel\(s\.slot_teacher_label, labelMap\)/);
    // 🔴 원문은 그대로 둔다 — 저장·시트 동기의 원본이라 덮으면 안 된다(teacher-label.ts 📌).
    expect(s).toMatch(/slotTeacherLabel: s\.slot_teacher_label/);
  });

  it("diff가 원문과 해석값을 **둘 다** 본다", () => {
    const d = read(DIFF);
    expect(d).toMatch(/tNames\.includes\(e\.slotTeacherLabel\)/);
    expect(d).toMatch(/e\.slotTeacherDisplay != null && tNames\.includes\(e\.slotTeacherDisplay\)/);
  });

  it("비교는 OR — 원문 비교가 남아 있어야 라벨맵이 비었을 때 종전대로 폴백한다", () => {
    const m = read(DIFF).match(/const teacherSame =[\s\S]{0,320}?;/);
    expect(m).not.toBeNull();
    // 라벨 null(FK 상속) 보수 처리 + 원문 일치 + 해석값 일치 = 세 갈래를 `||`로 잇는다.
    expect(m![0]).toContain("e.slotTeacherLabel == null");
    expect(m![0].match(/\|\|/g) ?? []).toHaveLength(2);
  });
});
