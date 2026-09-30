"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  listMasterSheetTabs,
  previewMasterSheet,
  applyMasterSheet,
  type MasterFailure,
} from "@/features/timetable/server/master-sheet-actions";
import type {
  MasterInput,
  MasterPreview,
  MasterIssue,
} from "@/features/timetable/import/master/types";
import type { MasterTab } from "@/features/timetable/server/master-sheet-source";
import { DAY_LABEL_KO } from "@/features/classes/overlap";

const field =
  "border-line bg-card w-full rounded-md border px-3 py-2 text-sm disabled:opacity-60";
const actionLabel = {
  create: "추가",
  update: "변경",
  remove: "마감",
  keep: "유지",
};
const emptyBindings = {
  classBindings: {},
  teacherBindings: {},
  closeClassIds: [],
};
export function MasterSheetForm({
  today,
  defaultSource,
}: {
  today: string;
  defaultSource: string;
}) {
  const [input, setInput] = useState<MasterInput>({
    source: defaultSource,
    teacherTab: "",
    rosterTab: "",
    effectiveDate: today,
    maxColumn: defaultSource ? "EU" : "",
    classBindings: {},
  });
  const [tabs, setTabs] = useState<MasterTab[]>([]);
  const [title, setTitle] = useState("");
  const [preview, setPreview] = useState<MasterPreview | null>(null);
  const [dirty, setDirty] = useState(true);
  const [checks, setChecks] = useState<string[]>([]);
  const [failure, setFailure] = useState<MasterFailure | null>(null);
  const [success, setSuccess] = useState<
    (Awaited<ReturnType<typeof applyMasterSheet>> & { ok: true }) | null
  >(null);
  const [pending, start] = useTransition();
  const [stage, setStage] = useState("");
  const change = (patch: Partial<MasterInput>) => {
    setInput((v) => ({ ...v, ...patch }));
    setDirty(true);
    setChecks([]);
    setSuccess(null);
    setFailure(null);
  };
  function loadTabs() {
    setStage("탭 불러오는 중");
    start(async () => {
      try {
        const r = await listMasterSheetTabs(input.source);
        if (!r.ok) {
          setFailure(r);
          return;
        }
        setTabs(r.tabs);
        setTitle(r.title);
        setPreview(null);
        setFailure(null);
        const month = Number(input.effectiveDate.slice(5, 7));
        const pick = (word: string) =>
          r.tabs.find(
            (t) =>
              !t.hidden &&
              t.title.includes(word) &&
              t.title.includes(`(${month}월)`),
          )?.title ?? "";
        change({
          teacherTab: pick("강사별"),
          rosterTab: pick("통합"),
          ...emptyBindings,
        });
      } catch {
        setFailure({
          ok: false,
          stage: "탭 불러오기",
          error:
            "응답을 받지 못했습니다. 연결 상태를 확인하고 다시 시도해 주세요.",
        });
      }
    });
  }
  function inspect() {
    setStage("시트와 에이와 규칙 검사 중");
    start(async () => {
      try {
        const r = await previewMasterSheet(input);
        setChecks([]);
        setSuccess(null);
        if (!r.ok) {
          setFailure(r);
          setDirty(true);
          return;
        }
        setPreview(r.preview);
        setDirty(false);
        setFailure(null);
      } catch {
        setFailure({
          ok: false,
          stage: "미리보기",
          error: "응답을 받지 못했습니다. 다시 검사해 주세요.",
        });
        setDirty(true);
      }
    });
  }
  function apply() {
    if (!preview || dirty) return;
    setStage("최신 내용 재검사 후 적용 중");
    start(async () => {
      try {
        const r = await applyMasterSheet(input, preview.hash, checks);
        if (!r.ok) {
          setFailure(r);
          setChecks([]);
          if (r.preview) {
            setPreview(r.preview);
            setDirty(false);
          } else setDirty(true);
          return;
        }
        setSuccess(r);
        setFailure(null);
        setDirty(true);
        setChecks([]);
      } catch {
        setFailure({
          ok: false,
          stage: "적용 결과 확인",
          error:
            "응답이 끊겨 적용 결과를 확인하지 못했습니다. 시간표를 확인한 뒤 다시 검사해 주세요. 같은 적용 버튼을 반복해서 누르지 마세요.",
        });
        setDirty(true);
      }
    });
  }
  const errors = preview?.issues.filter((i) => i.severity === "error") ?? [];
  const confirmations =
    preview?.issues.filter((i) => i.severity === "confirm") ?? [];
  const warnings =
    preview?.issues.filter((i) => i.severity === "warning") ?? [];
  const canApply =
    !!preview &&
    !dirty &&
    !errors.length &&
    confirmations.every((i) => checks.includes(i.key)) &&
    !success;
  const sourceHref = (issue: MasterIssue) => {
    if (!preview || !issue.tab) return null;
    const gid =
      issue.tab === preview.source.teacherTab
        ? preview.source.teacherGid
        : preview.source.rosterGid;
    return `https://docs.google.com/spreadsheets/d/${preview.source.spreadsheetId}/edit#gid=${gid}${issue.cell ? `&range=${encodeURIComponent(issue.cell)}` : ""}`;
  };
  function issueRow(i: MasterIssue) {
    const source = sourceHref(i);
    return (
      <li key={i.key} className="border-line border-t py-3 first:border-t-0">
        <div className="flex gap-3">
          {i.severity === "confirm" ? (
            <input
              type="checkbox"
              aria-label={`${i.target} 확인`}
              checked={checks.includes(i.key)}
              disabled={pending || dirty}
              onChange={(e) =>
                setChecks((v) =>
                  e.target.checked
                    ? [...v, i.key]
                    : v.filter((k) => k !== i.key),
                )
              }
              className="mt-1 size-4 shrink-0"
            />
          ) : null}
          <div className="min-w-0">
            <p className="text-sm font-medium">{i.target}</p>
            <p className="mt-1 text-sm">{i.reason}</p>
            <p className="mt-1 text-sm text-text-dim">{i.fix}</p>
            <div className="mt-2 flex flex-wrap gap-4 text-xs text-primary">
              {source ? (
                <a
                  href={source}
                  target="_blank"
                  rel="noreferrer"
                  className="underline"
                >
                  {i.tab}
                  {i.cell ? ` · ${i.cell}` : ""} 열기
                </a>
              ) : null}
              {i.href ? (
                <Link href={i.href} target="_blank" className="underline">
                  에이와에서 수정
                </Link>
              ) : null}
            </div>
          </div>
        </div>
      </li>
    );
  }
  return (
    <div className="space-y-6">
      <section
        aria-label="시트와 적용일"
        className="border-line space-y-4 rounded-lg border p-4"
      >
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <label className="min-w-0 flex-1 space-y-1 text-sm">
            구글 시트 주소
            <input
              value={input.source}
              onChange={(e) => {
                change({
                  source: e.target.value,
                  teacherTab: "",
                  rosterTab: "",
                  ...emptyBindings,
                });
                setTabs([]);
                setPreview(null);
                setTitle("");
              }}
              disabled={pending}
              className={field}
            />
          </label>
          <Button onClick={loadTabs} disabled={pending || !input.source}>
            탭 불러오기
          </Button>
        </div>
        {title ? <p className="text-sm font-medium">{title}</p> : null}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {(
            [
              ["teacherTab", "강사별 시간표"],
              ["rosterTab", "통합 시간표 · 학생 명단"],
            ] as const
          ).map(([key, label]) => (
            <label key={key} className="space-y-1 text-sm">
              {label}
              <select
                className={field}
                value={input[key]}
                disabled={pending || !tabs.length}
                onChange={(e) => {
                  change({ [key]: e.target.value, ...emptyBindings });
                  setPreview(null);
                }}
              >
                <option value="">탭 선택</option>
                {tabs.map((t) => (
                  <option key={t.gid} value={t.title}>
                    {t.title}
                    {t.hidden ? " (숨김)" : ""}
                  </option>
                ))}
              </select>
            </label>
          ))}
          <label className="space-y-1 text-sm">
            적용일
            <input
              type="date"
              min={today}
              className={field}
              value={input.effectiveDate}
              disabled={pending}
              onChange={(e) => change({ effectiveDate: e.target.value })}
            />
          </label>
        </div>
        <details>
          <summary className="cursor-pointer text-sm text-text-dim">
            읽을 범위 설정
          </summary>
          <div className="mt-3 max-w-lg space-y-2">
            <label className="block text-sm">
              강사별 탭의 마지막 열
              <input
                className={`${field} mt-1 max-w-32`}
                placeholder="전체"
                value={input.maxColumn}
                disabled={pending}
                onChange={(e) =>
                  change({ maxColumn: e.target.value.toUpperCase() })
                }
              />
            </label>
            <p className="text-xs text-text-dim">
              이 시트의 EU 다음 열에는 지난 8월 LAB 배치가 남아 있습니다. 새
              달에 열 구성이 바뀌면 원본을 확인해 범위를 조정하세요.
            </p>
          </div>
        </details>
        <div className="flex flex-wrap items-center gap-3">
          <Button
            onClick={inspect}
            disabled={pending || !input.teacherTab || !input.rosterTab}
          >
            {preview ? "수정 내용 다시 검사" : "미리보기"}
          </Button>
          <p className="text-xs text-text-dim">
            {input.effectiveDate > today
              ? `${input.effectiveDate}부터 반영을 예약합니다.`
              : "오늘부터 반영합니다."}{" "}
            이전 날짜의 배치 이력을 보존합니다.
          </p>
        </div>
      </section>
      <div role="status" aria-live="polite" className="text-sm">
        {pending ? stage : null}
      </div>
      {failure ? (
        <div
          role="alert"
          className="border-destructive/40 bg-destructive/5 rounded-lg border p-4"
        >
          <p className="font-medium">{failure.stage}에서 중단되었습니다</p>
          <p className="mt-1 text-sm">{failure.error}</p>
          {failure.code ? (
            <p className="mt-2 text-xs text-text-dim">
              오류 코드 {failure.code}
            </p>
          ) : null}
        </div>
      ) : null}
      {success ? (
        <div
          role="status"
          className="border-primary/30 bg-primary/5 rounded-lg border p-4"
        >
          <p className="font-semibold">
            {success.result.scheduled
              ? `${success.result.effectiveDate} 반영을 예약했습니다.`
              : `${success.result.effectiveDate}부터 적용했습니다.`}
          </p>
          <p className="mt-1 text-sm">
            배치 마감 {success.result.closed}건 · 배치 추가{" "}
            {success.result.inserted}건 · 학생 이동 {success.result.moved}명 ·
            수강 추가 {success.result.added}건
          </p>
          <Link
            href={`/timetable?subject=english&week=${success.result.effectiveDate}`}
            className="mt-3 inline-block text-sm text-primary underline"
          >
            적용일 시간표 확인{success.result.scheduled ? " · 예약 취소" : ""}
          </Link>
        </div>
      ) : null}
      {preview ? (
        <>
          <section aria-label="검사 결과">
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="text-lg font-semibold">
                {dirty
                  ? "입력 변경 · 다시 검사 필요"
                  : errors.length
                    ? `적용 불가 ${errors.length}건`
                    : confirmations.some((i) => !checks.includes(i.key))
                      ? `확인 필요 ${confirmations.length}건`
                      : "적용 가능"}
              </h2>
              <span className="text-sm text-text-dim">
                수업 {preview.report.targetSchedules}개 · 연결된 반{" "}
                {
                  new Set(
                    preview.mappings.map((m) => m.classId).filter(Boolean),
                  ).size
                }
                개
              </span>
            </div>
            <p className="mt-2 text-sm text-text-dim">
              적용 불가 항목은 수정해야 합니다. 확인 항목은 에이와의 가져오기
              규칙에 따라 개별 확인 후 진행할 수 있습니다.
            </p>
            {errors.length ? (
              <ul
                className="mt-4 max-h-96 overflow-y-auto border-line rounded-lg border px-4"
                aria-label="적용 불가 항목"
              >
                {errors.map(issueRow)}
              </ul>
            ) : null}
            {confirmations.length ? (
              <div className="mt-5">
                <h3 className="text-sm font-semibold">확인 후 적용할 항목</h3>
                <ul
                  className="mt-2 max-h-96 overflow-y-auto border-line rounded-lg border px-4"
                  aria-label="개별 확인 항목"
                >
                  {confirmations.map(issueRow)}
                </ul>
              </div>
            ) : null}
            {warnings.length ? (
              <details className="mt-4">
                <summary className="cursor-pointer text-sm">
                  참고·기존 수강 유지 {warnings.length}건
                </summary>
                <ul>{warnings.map(issueRow)}</ul>
              </details>
            ) : null}
          </section>
          <nav
            aria-label="수정 항목 이동"
            className="flex flex-wrap gap-4 text-sm text-primary"
          >
            <a href="#class-bindings" className="underline">
              반 연결 수정
            </a>
            <a href="#teacher-bindings" className="underline">
              강사 연결 수정
            </a>
            {preview.omittedClasses.length ? (
              <a href="#omitted-classes" className="underline">
                시트에 없는 반 확인
              </a>
            ) : null}
          </nav>
          <section aria-label="반 연결" id="class-bindings">
            <h2 className="text-lg font-semibold">반 연결 · 이름 변경</h2>
            <p className="mt-1 text-sm text-text-dim">
              진급한 반은 기존 반을 선택하면 같은 반의 이름만 바뀝니다.
              수강·출결 이력이 이어집니다. 명단 일치는 추천 근거이며 직접 확인해
              선택해 주세요.
            </p>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-bg-soft">
                  <tr>
                    <th className="p-2">시트 반 이름</th>
                    <th className="p-2">연결할 에이와 반</th>
                    <th className="p-2">명단 비교</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.mappings.map((m) => (
                    <tr key={m.sheetName} className="border-line border-b">
                      <td className="p-2 font-medium">{m.sheetName}</td>
                      <td className="min-w-64 p-2">
                        <select
                          aria-label={`${m.sheetName} 반 연결`}
                          value={
                            input.classBindings[m.sheetName] ?? m.classId ?? ""
                          }
                          disabled={pending}
                          className={field}
                          onChange={(e) =>
                            change({
                              classBindings: {
                                ...input.classBindings,
                                [m.sheetName]: e.target.value,
                              },
                            })
                          }
                        >
                          <option value="">반을 선택해 주세요</option>
                          {preview.classes.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.name}
                              {c.name !== m.sheetName
                                ? ` → ${m.sheetName}`
                                : ""}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="p-2 text-text-dim">
                        {m.suggestedName
                          ? `${m.suggestedName} · ${m.evidence}`
                          : "이름 또는 학생 정보 확인"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
          <section aria-label="강사 연결" id="teacher-bindings">
            <h2 className="text-lg font-semibold">강사 연결</h2>
            <p className="mt-1 text-sm text-text-dim">
              시트의 영어 이름이 에이와와 다르면 실제 담당 강사를 선택하세요.
              원본이나 교직원 정보를 바꾸지 않고 이번 반영에 사용할 수 있습니다.
            </p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {preview.teacherMappings.map((m) => (
                <label key={m.sheetName} className="space-y-1 text-sm">
                  <span>{m.header}</span>
                  <select
                    className={field}
                    aria-label={`${m.sheetName} 강사 연결`}
                    disabled={pending}
                    value={
                      input.teacherBindings?.[m.sheetName] ?? m.teacherId ?? ""
                    }
                    onChange={(e) =>
                      change({
                        teacherBindings: {
                          ...input.teacherBindings,
                          [m.sheetName]: e.target.value,
                        },
                      })
                    }
                  >
                    <option value="">강사를 선택해 주세요</option>
                    {preview.teachers.map((t) => (
                      <option value={t.id} key={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                  {m.suggestedId && m.suggestedId !== m.teacherId ? (
                    <span className="text-xs text-text-dim">
                      원본의 한글 이름과 일치: {m.suggestedName}
                    </span>
                  ) : null}
                </label>
              ))}
            </div>
          </section>
          {preview.omittedClasses.length ? (
            <section aria-label="시트에 없는 반" id="omitted-classes">
              <h2 className="text-lg font-semibold">시트에 없는 반</h2>
              <p className="mt-1 text-sm text-text-dim">
                기본적으로 기존 배치를 유지합니다. 적용일부터 수업 배치를 마감할
                반만 선택하세요. 반 자체와 수강은 보존됩니다.
              </p>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {preview.omittedClasses.map((c) => (
                  <label key={c.id} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      disabled={pending}
                      checked={input.closeClassIds?.includes(c.id) ?? false}
                      onChange={(e) =>
                        change({
                          closeClassIds: e.target.checked
                            ? [...(input.closeClassIds ?? []), c.id]
                            : (input.closeClassIds ?? []).filter(
                                (id) => id !== c.id,
                              ),
                        })
                      }
                    />
                    {c.name} · {c.slots}개 배치 마감
                  </label>
                ))}
              </div>
            </section>
          ) : null}
          <section aria-label="변경 내역" className="space-y-3">
            <h2 className="text-lg font-semibold">변경 내역</h2>
            <details>
              <summary className="cursor-pointer text-sm">
                수업 배치: 추가 {preview.report.plan.create} · 변경{" "}
                {preview.report.plan.update} · 마감 {preview.report.plan.remove}{" "}
                · 유지 {preview.report.plan.keep}
              </summary>
              <div className="mt-2 max-h-96 overflow-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr>
                      {["처리", "반", "요일·시간", "강사", "강의실"].map(
                        (v) => (
                          <th className="p-2" key={v}>
                            {v}
                          </th>
                        ),
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {preview.report.planItems
                      .filter((p) => p.action !== "keep")
                      .map((p, i) => (
                        <tr key={i} className="border-line border-t">
                          <td className="p-2">{actionLabel[p.action]}</td>
                          <td className="p-2">{p.className}</td>
                          <td className="p-2">
                            {DAY_LABEL_KO[p.day]} {p.startTime}~{p.endTime}
                            {p.before && p.before.endTime !== p.endTime ? (
                              <p className="text-xs text-text-dim">
                                기존 종료 {p.before.endTime}
                              </p>
                            ) : null}
                          </td>
                          <td className="p-2">
                            {p.teacherNames.join(", ")}
                            {p.before ? (
                              <p className="text-xs text-text-dim">
                                기존{" "}
                                {p.before.teacherNames.join(", ") || "미지정"}
                              </p>
                            ) : null}
                          </td>
                          <td className="p-2">
                            {p.room ?? "미지정"}
                            {p.before ? (
                              <p className="text-xs text-text-dim">
                                기존 {p.before.room ?? "미지정"}
                              </p>
                            ) : null}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </details>
            <details>
              <summary className="cursor-pointer text-sm">
                학생 이동 {preview.roster.moves.length}명 · 수강 추가{" "}
                {preview.roster.adds.length}건 · 유지 {preview.roster.unchanged}
                건
              </summary>
              <ul className="mt-2 space-y-1 text-sm">
                {preview.roster.moves.map((m) => (
                  <li key={m.enrollmentId}>
                    {m.studentName}: {m.fromClassName} → {m.toClassName}
                  </li>
                ))}
                {preview.roster.adds.map((a) => (
                  <li key={`${a.studentId}:${a.classId}`}>
                    {a.studentName}: {a.className} 추가
                  </li>
                ))}
              </ul>
            </details>
            <details>
              <summary className="cursor-pointer text-sm">
                반 이름·담임·기본 강의실 {preview.classUpdates.length}건
              </summary>
              <ul className="mt-2 space-y-3 text-sm">
                {preview.classUpdates.map((u) => (
                  <li key={u.classId}>
                    <strong>
                      {u.prevClassName ??
                        preview.classes.find((c) => c.id === u.classId)?.name}
                    </strong>
                    {u.className ? (
                      <p>
                        반 이름: {u.prevClassName} → {u.className}
                      </p>
                    ) : null}
                    {u.teacherId ? (
                      <p>
                        담임:{" "}
                        {preview.teachers.find((t) => t.id === u.prevTeacherId)
                          ?.name ?? "미지정"}{" "}
                        →{" "}
                        {
                          preview.teachers.find((t) => t.id === u.teacherId)
                            ?.name
                        }
                      </p>
                    ) : null}
                    {u.classroomId ? (
                      <p>
                        기본 강의실:{" "}
                        {preview.classrooms.find(
                          (r) => r.id === u.prevClassroomId,
                        )?.name ?? "미지정"}{" "}
                        →{" "}
                        {
                          preview.classrooms.find((r) => r.id === u.classroomId)
                            ?.name
                        }
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>
            </details>
            <details>
              <summary className="cursor-pointer text-sm">
                강사 근무 블록 {preview.blocks.length}개 · 통합 시간표 그룹{" "}
                {preview.groups.length}줄
              </summary>
              <ul className="mt-2 space-y-1 text-sm">
                {preview.groups.map((g) => (
                  <li key={g.id}>
                    {g.title}:{" "}
                    {g.classIds
                      .map(
                        (id) =>
                          preview.mappings.find((m) => m.classId === id)
                            ?.sheetName,
                      )
                      .join(", ")}
                  </li>
                ))}
                {preview.blocks.map((b, i) => (
                  <li key={i}>
                    {b.teacherName} · {DAY_LABEL_KO[b.day]} {b.startTime}~
                    {b.endTime} · {b.label}
                  </li>
                ))}
              </ul>
            </details>
            <p className="text-xs text-text-dim">
              명단에서 빠진 학생은 자동 종료하지 않습니다. 휴원 상태와 분리등원
              요일은 이어받습니다.
            </p>
          </section>
          <div className="sticky-save-bar border-line bg-card sticky bottom-0 flex flex-wrap items-center justify-between gap-3 border-t py-4">
            <p className="text-sm">
              {dirty
                ? "수정 내용 다시 검사를 실행해 주세요."
                : errors.length
                  ? "적용 불가 항목을 수정해 주세요."
                  : !canApply
                    ? "확인 항목을 모두 체크해 주세요."
                    : `${input.effectiveDate}부터 반영할 준비가 되었습니다.`}
            </p>
            <div className="flex gap-2">
              <Button variant="outline" onClick={inspect} disabled={pending}>
                다시 검사
              </Button>
              <Button onClick={apply} disabled={pending || !canApply}>
                {input.effectiveDate > today ? "예약 적용" : "적용"}
              </Button>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
