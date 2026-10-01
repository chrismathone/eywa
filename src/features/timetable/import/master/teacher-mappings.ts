import { norm } from "../match";
import { resolveTeacher } from "../structure/match";
import type { ParsedTeacherBlock } from "../structure/types";
import {
  canonicalSlotTeacherLabel,
  specialSlotLabel,
} from "../../lib/teacher-label";
import type { MasterContext, MasterPlan } from "./types";

export function buildTeacherMappings(
  blocks: ParsedTeacherBlock[],
  teachers: MasterContext["teachers"],
  bindings: Record<string, string> = {},
): MasterPlan["teacherMappings"] {
  const grouped = new Map<string, ParsedTeacherBlock[]>();
  for (const b of blocks)
    if (b.name.trim() && !b.reserve && !specialSlotLabel(b.name))
      grouped.set(b.name, [...(grouped.get(b.name) ?? []), b]);
  return [...grouped].map(([sheetName, rows]) => {
    const explicit = Object.hasOwn(bindings, sheetName);
    const named = resolveTeacher(
      canonicalSlotTeacherLabel(sheetName) ?? sheetName,
      teachers,
    );
    const headerMatches = teachers.filter(
      (t) =>
        /[가-힣]/.test(t.displayName) &&
        rows.some((r) =>
          r.header
            .split(/\s+/)
            .some((word) => norm(word) === norm(t.displayName)),
        ),
    );
    const suggestion = headerMatches.length === 1 ? headerMatches[0] : null;
    const disagreement =
      headerMatches.length > 1 ||
      (suggestion && named.ref && suggestion.id !== named.ref.id);
    const teacher = explicit
      ? teachers.find((t) => t.id === bindings[sheetName])
      : disagreement
        ? null
        : (named.ref ?? suggestion);
    return {
      sheetName,
      header: [...new Set(rows.map((r) => r.header))].join(" / "),
      teacherId: teacher?.id ?? null,
      suggestedId: suggestion?.id ?? null,
      suggestedName: suggestion?.displayName ?? null,
      method: explicit
        ? "manual"
        : !teacher
          ? "unmapped"
          : named.ref
            ? "name"
            : "header",
      manualReason: teacher
        ? null
        : disagreement
          ? "원본의 영어 이름과 한글 이름이 서로 다른 계정을 가리키거나 한글 이름의 후보가 여러 명입니다."
          : "활성 강사 계정을 자동으로 확정하지 못했습니다. 담당자를 직접 선택해 주세요.",
    };
  });
}
