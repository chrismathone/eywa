// 격자의 글자를 식별자로 — 반 이름 → 반, 학생 글자 → 학생. 순수(delta.ts의 재료).

import { norm } from "../match";
import { studentNameOf } from "./grid-text";
import type { DeltaClassRef, DeltaStudent, ParsedMeta } from "./types";

export interface KnownClass {
  id: string;
  name: string;
}

export interface ClassHit {
  /** 비교 키 — 아는 반이면 id, 처음 보는 이름이면 `new:<이름>`. */
  key: string;
  ref: DeltaClassRef;
}

export interface GridRefs {
  /** 반 이름 → 반. 이름이 둘 이상의 반을 가리키면 null(그 칸은 읽지 않는다). */
  classOf: (name: string) => ClassHit | null;
  /** `inRoster` = 그 반의 "시트가 알던 명단" — 같은 글자의 학생이 둘이면 그 반에 있던 쪽으로 읽는다. */
  studentOf: (text: string, inRoster?: (studentId: string) => boolean) => DeltaStudent;
  nameOfClass: (id: string) => string;
}

export function buildGridRefs(meta: ParsedMeta, classes: KnownClass[], warn: (text: string) => void): GridRefs {
  // 시트가 보낼 때 적어 둔 이름이 먼저다 — 그 뒤 앱에서 반 이름이 바뀌었어도 같은 반으로 읽는다.
  const idsByName = new Map<string, Set<string>>();
  const nameById = new Map<string, string>();
  const learn = (id: string, name: string) => {
    const key = norm(name);
    idsByName.set(key, (idsByName.get(key) ?? new Set()).add(id));
    if (!nameById.has(id)) nameById.set(id, name);
  };
  for (const [id, name] of meta.classNameById) learn(id, name);
  for (const c of classes) learn(c.id, c.name);

  const classOf = (name: string): ClassHit | null => {
    const ids = idsByName.get(norm(name));
    if (!ids) return { key: `new:${norm(name)}`, ref: { classId: null, name } };
    if (ids.size > 1) {
      warn(`"${name}" 이름의 반이 둘 이상이라 어느 반인지 정할 수 없습니다 — 이 칸은 읽지 않았습니다.`);
      return null;
    }
    const id = [...ids][0]!;
    return { key: id, ref: { classId: id, name: nameById.get(id) ?? name } };
  };

  // 글자 → 학생 id(시트가 알던 학생). 같은 글자가 두 학생을 가리키면 모른다고 본다.
  const idsByText = new Map<string, Set<string>>();
  const idsByStudentName = new Map<string, Set<string>>();
  for (const cell of meta.cells) {
    for (const s of cell.students) {
      idsByText.set(s.text, (idsByText.get(s.text) ?? new Set()).add(s.studentId));
      const name = norm(studentNameOf(s.text));
      idsByStudentName.set(name, (idsByStudentName.get(name) ?? new Set()).add(s.studentId));
    }
  }
  const only = (ids: Set<string> | undefined) => (ids?.size === 1 ? [...ids][0]! : null);
  const studentOf = (text: string, inRoster?: (studentId: string) => boolean): DeltaStudent => {
    const same = idsByText.get(text);
    const here = same && same.size > 1 && inRoster ? [...same].filter(inRoster) : [];
    const exact = only(same) ?? (here.length === 1 ? here[0]! : null);
    if (exact) return { studentId: exact, text };
    // 학교·학년 없이 이름만 적었으면 시트 안에서 그 이름이 한 명일 때만 그 학생으로 본다.
    // 🔴 학교가 붙어 있는데 글자가 다르면 이름으로 잇지 않는다 — 같은 이름의 다른 아이일 수 있다.
    const nameOnly = !text.includes("/") ? only(idsByStudentName.get(norm(text))) : null;
    return { studentId: nameOnly, text };
  };

  return { classOf, studentOf, nameOfClass: (id) => nameById.get(id) ?? "?" };
}
