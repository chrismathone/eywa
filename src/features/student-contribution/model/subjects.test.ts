import { expect, it } from "vitest";
import { contributionSubjectOf } from "./subjects";
import { contributionLessonNames, contributionSubjectEvidence } from "./subject-evidence";
const subjects = [{ key: "math", label: "수학" }, { key: "english", label: "영어" }];
const staff = [{ names: ["김선생"], subjects: ["math"] }, { names: ["신선생(Gina)"], subjects: ["english"] }];
const names = ["서술형 특강 (중등)", "내신 추가수업 토", "영어 수학 합반"].map(name => ({ name, weight: 1 }));
const input = { names, subjects, staff, classes: [] };
it("수업명에 과목이 없어도 동일 수업의 과거 강사와 담당 과목으로 판정한다", () => {
  const evidence = contributionSubjectEvidence({ ...input, teachers: [
    { class_name: "서술형 특강 (중등)", teacher_name: "신선생(Gina)" },
    { class_name: "내신 추가(토) 추가수업(내신 추가수업 토)", teacher_name: "김선생" },
  ] });
  const resolve = contributionSubjectOf({ ...input, evidence });
  expect(resolve({ name: "서술형 특강 (중등)" })).toBe("english");
  expect(resolve({ name: "내신 추가수업 토" })).toBe("math");
  expect(resolve({ name: "미확인 다른 특강" })).toBeNull();
});
it("동명이인 강사·복수 강사·이동 기록·합반을 한 과목으로 몰지 않는다", () => {
  const conflictStaff = [...staff, { names: ["김선생"], subjects: ["english"] }];
  const evidence = contributionSubjectEvidence({ ...input, staff: conflictStaff, teachers: [
    { class_name: "내신 추가수업 토", teacher_name: "김선생" },
    { class_name: "서술형 특강 (중등)", teacher_name: "신선생(Gina)김선생" },
    { class_name: "다른 수업 → 내신 추가수업 토", teacher_name: "김선생" },
  ] });
  expect(evidence).toEqual([]);
  expect(contributionSubjectOf({ ...input, evidence: [{ name: "영어 수학 합반", subject: "math", basis: "class", reference: "반" }] })({ name: "영어 수학 합반" })).toBeNull();
});
it("같은 수업명의 강사 근거가 두 과목으로 갈리면 미확인으로 남긴다", () => {
  const evidence = contributionSubjectEvidence({ ...input, teachers: [
    { class_name: "내신 추가수업 토", teacher_name: "김선생" }, { class_name: "내신 추가수업 토", teacher_name: "신선생(Gina)" },
  ] });
  expect(contributionSubjectOf({ ...input, evidence })({ name: "내신 추가수업 토" })).toBeNull();
});
it("학습 근거는 서로 다른 수업명과 청구 줄 수로 센다", () => {
  expect(contributionLessonNames([], [{ item_name: "수학반" }, { item_name: "수학반" }, { item_name: "영어반" }]))
    .toEqual([{ name: "수학반", weight: 2 }, { name: "영어반", weight: 1 }]);
});
it("직원의 별도 영문명으로 과거 담당 강사를 찾는다", () => {
  const staff = [{ names: ["신선생", "Gina"], subjects: ["english"] }];
  const evidence = contributionSubjectEvidence({ ...input, staff, teachers: [{ class_name: "내신 추가수업 토", teacher_name: "Gina" }] });
  expect(contributionSubjectOf({ ...input, staff, evidence })({ name: "내신 추가수업 토" })).toBe("english");
});
it("퇴직한 강사도 서로 다른 명시 과목 수업 두 개로 담당 과목을 확인한다", () => {
  const teachers = [
    { class_name: "서술형 특강 (중등)", teacher_name: "박과거" },
    { class_name: "중등 영어 A", teacher_name: "박과거" },
    { class_name: "고등 영어 B", teacher_name: "박과거" },
  ];
  const resolve = (rows: typeof teachers) => contributionSubjectOf({ ...input, evidence: contributionSubjectEvidence({ ...input, teachers: rows }) })({ name: "서술형 특강 (중등)" });
  expect(resolve(teachers)).toBe("english");
  expect(resolve(teachers.slice(0, 2))).toBeNull();
  expect(resolve([...teachers, { class_name: "수학 A", teacher_name: "박과거" }])).toBeNull();
});
it("현재 강사 과목과 과거 명시 수업이 충돌하면 과거 특강을 덮어쓰지 않는다", () => {
  const evidence = contributionSubjectEvidence({ ...input, teachers: [
    { class_name: "서술형 특강 (중등)", teacher_name: "김선생" },
    { class_name: "영어 기초", teacher_name: "김선생" },
  ] });
  expect(evidence.filter(e => e.name === "서술형 특강 (중등)")).toEqual([]);
});
it("과목 이름이 아닌 단어를 제외하고 영문 과목의 대소문자를 통일한다", () => {
  const resolve = contributionSubjectOf({ ...input, names: [], staff: [], subjects: [
    ...subjects, { key: "korean", label: "국어" }, { key: "science", label: "과학" },
  ] });
  for (const name of ["중국어 기초", "외국어", "한국어", "과학고 준비", "수학여행"]) expect(resolve({ name })).toBeNull();
  const latin = contributionSubjectOf({ ...input, names: [], staff: [], subjects: [{ key: "english", label: "English" }] });
  expect(latin({ name: "ENGLISH A" })).toBe("english");
  expect(latin({ name: "notenglishword" })).toBeNull();
});
it("중국어가 실제 설정 과목이면 국어와 혼동하지 않고 그 과목을 인정한다", () => {
  const config = { ...input, names: [], staff: [], subjects: [
    ...subjects, { key: "korean", label: "국어" }, { key: "chinese", label: "중국어" },
  ] };
  expect(contributionSubjectOf(config)({ name: "중국어 A" })).toBe("chinese");
  expect(contributionSubjectOf(config)({ name: "중국어 및 국어 합반" })).toBeNull();
  const specific = { ...config, subjects: [...config.subjects.filter(s => s.key !== "chinese"), { key: "chinese", label: "중국어(심화)" }] };
  expect(contributionSubjectOf(specific)({ name: "중국어(심화) A" })).toBe("chinese");
  expect(contributionSubjectOf(specific)({ name: "중국어 A" })).toBeNull();
});
it("같은 과목 묶음 안의 심화 과목도 명시된 설정 키를 유지한다", () => {
  const config = { ...input, subjects: [...subjects, { key: "advanced", label: "수학(심화)" }] };
  const teachers = [
    { class_name: "서술형 특강 (중등)", teacher_name: "박과거(Ann)" },
    { class_name: "수학(심화) A", teacher_name: "박과거" },
    { class_name: "수학(심화) B", teacher_name: "박과거" },
  ];
  const evidence = contributionSubjectEvidence({ ...config, teachers });
  const resolve = contributionSubjectOf({ ...config, evidence });
  expect(resolve({ name: "수학(심화) A" })).toBe("advanced");
  expect(resolve({ name: "서술형 특강 (중등)" })).toBe("advanced");
  expect(resolve({ name: "영어 수학(심화) 합반" })).toBeNull();
  expect(resolve({ name: "수학(심화) 및 수학 합반" })).toBeNull();
  const conflicting = contributionSubjectEvidence({ ...config, teachers: [...teachers, { class_name: "수학 A", teacher_name: "박과거" }] });
  expect(contributionSubjectOf({ ...config, evidence: conflicting })({ name: "서술형 특강 (중등)" })).toBeNull();
});
