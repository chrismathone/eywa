import "server-only";
import { getTenantSettings } from "@/features/owner/server/queries";
import { buildSubjectMaps, subjectLabelRecord } from "@/features/owner/subjects";
import {
  CLASS_REASON_LABEL,
  candidateKey,
  resolveConsultationClass,
  type ClassReason,
  type ClassSource,
} from "../class-mapping";
import { loadClassCandidatesRpc } from "./class-support";

/** `name` = 반 이름(감사로그·표시), `label` = 선택지 글자(반 이름 + 과목). */
export type ClassOption = { id: string; name: string; label: string };

export type ClassOptionsResult =
  | { supported: false }
  | {
      supported: true;
      /** 그날 그 학생이 수강 중인 반(폼 선택지). '미매핑'은 폼이 따로 붙인다. */
      options: ClassOption[];
      /** 자동 판정 — 반이 하나로 좁혀지면 그 반, 아니면 null + 이유. */
      auto: { classId: string | null; reason: ClassReason; reasonLabel: string };
    };

/**
 * (학생, 상담일, 상담사, 과목) → 그날의 반 선택지 + 자동 판정. 폼 미리보기와 저장이 **같은 함수**를 탄다.
 * @param date KST 날짜(YYYY-MM-DD)
 */
export async function classOptionsFor(input: {
  studentId: string;
  date: string;
  counselorId: string | null;
  subject: string | null;
}): Promise<ClassOptionsResult> {
  if (!input.studentId || !/^\d{4}-\d{2}-\d{2}$/.test(input.date)) {
    return { supported: true, options: [], auto: { classId: null, reason: "no_enrollment", reasonLabel: CLASS_REASON_LABEL.no_enrollment } };
  }
  const [candidates, settings] = await Promise.all([
    loadClassCandidatesRpc([{ studentId: input.studentId, date: input.date }]),
    getTenantSettings(),
  ]);
  if (!candidates) return { supported: false };
  const list = candidates.get(candidateKey(input.studentId, input.date)) ?? [];
  const subjects = buildSubjectMaps(settings.operations.subjects);
  const judged = resolveConsultationClass({
    counselorId: input.counselorId,
    subject: input.subject,
    labels: subjectLabelRecord(settings.operations.subjects),
    candidates: list,
  });
  const seen = new Set<string>();
  const options: ClassOption[] = [];
  for (const c of list) {
    if (seen.has(c.classId)) continue;
    seen.add(c.classId);
    // 과목은 학원설정 라벨로(운영 enum 하드코딩 금지) — 반 이름만으로 과목이 안 보이는 반이 있다.
    const subjectLabel = c.subject ? subjects.labelOf(c.subject) : null;
    const name = c.className ?? "이름 없는 반";
    options.push({ id: c.classId, name, label: subjectLabel ? `${name} (${subjectLabel})` : name });
  }
  options.sort((a, b) => a.label.localeCompare(b.label, "ko"));
  return { supported: true, options, auto: { ...judged, reasonLabel: CLASS_REASON_LABEL[judged.reason] } };
}

export type ClassDecision =
  | { supported: false }
  | { supported: true; classId: string | null; className: string | null; source: ClassSource; reason: ClassReason | null }
  | { supported: true; error: string };

/**
 * 저장할 반 — 폼이 보낸 선택(`classPick`)을 서버가 다시 검증한다.
 *   · manual: 사람이 고른 반(빈 값 = '미매핑'). 🔴 고른 반은 **그날 그 학생의 수강 반**이어야 한다 — 요청을 직접 보내
 *     아무 반(다른 학원 반 포함)이나 붙이는 길을 막는다(FK는 존재만 본다, #77).
 *   · 그 밖(auto·빈 값): 서버가 판정한다 — 클라가 보낸 자동값을 믿지 않는다(화면을 연 사이 수강이 바뀌었을 수 있다).
 */
export async function decideClassForSave(input: {
  studentId: string;
  date: string | null;
  counselorId: string | null;
  subject: string | null;
  pick: string | null;
  pickedClassId: string | null;
}): Promise<ClassDecision> {
  const found = await classOptionsFor({
    studentId: input.studentId,
    date: input.date ?? "",
    counselorId: input.counselorId,
    subject: input.subject,
  });
  if (!found.supported) return { supported: false };
  if (input.pick === "manual") {
    if (!input.pickedClassId) return { supported: true, classId: null, className: null, source: "manual", reason: null };
    const picked = found.options.find((o) => o.id === input.pickedClassId);
    if (!picked) {
      return { supported: true, error: "고른 반이 그날 이 학생의 수강 반이 아닙니다 — 반을 다시 골라 주세요" };
    }
    return { supported: true, classId: picked.id, className: picked.name, source: "manual", reason: null };
  }
  const auto = found.auto.classId ? found.options.find((o) => o.id === found.auto.classId) : undefined;
  return { supported: true, classId: found.auto.classId, className: auto?.name ?? null, source: "auto", reason: found.auto.reason };
}
