"use client";

import { Fragment, useState } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { EyIcon } from "@/components/icons/eywa-icons";
import { displayLessons } from "../curriculum";
import { subjectTone, toneSoftClass, toneSolidClass } from "../data";
import { buildGridRows, isReportEligible } from "../grid";
import type { OneScreenStudent } from "../types";
import { classnoteBadge, type SubjectReport } from "./report-card";
import { ProgressSelector } from "./progress-selector";

function clamp(n: number, max: number) {
  return Math.max(0, Math.min(max, n));
}

const NONE = "__none__"; // Base UI Select는 빈 문자열 값을 안 좋아함 → 미입력 sentinel.

/** 과목 진도 입력이 커리큘럼(math)인지. 미지정은 math로 간주(progress-card와 동일 규칙). */
const isMathSubject = (key: string | undefined) => (key ?? "math") === "math";

/** "2026-07-10" → "07/10". 이전 회차 참고행 날짜. */
function shortDate(ymd: string): string {
  const [, m, d] = ymd.split("-");
  return m && d ? `${m}/${d}` : ymd;
}

/** 진도 셀 — math면 다중 차시 ProgressSelector(edutrix 진도선택창), 그 외는 자유 텍스트. */
function GridProgressCell({
  student,
  subjectIndex,
  onProgress,
  onStudyGrade,
}: {
  student: OneScreenStudent;
  subjectIndex: number;
  onProgress: (studentId: string, subjectIndex: number, today: string) => void;
  onStudyGrade: (studentId: string, grade: string) => void;
}) {
  const su = student.subjects[subjectIndex];
  if (!su) return null;
  if (!isMathSubject(su.subjectKey)) {
    return (
      <input
        type="text"
        value={su.today}
        onChange={(e) => onProgress(student.id, subjectIndex, e.target.value)}
        placeholder="오늘 진도 (예: Unit 8 · p.90)"
        aria-label={`${student.name} ${su.name} 오늘 진도`}
        className="border-line bg-card focus:border-primary h-8 w-full rounded-sm border px-2 text-[12px] outline-none"
      />
    );
  }
  return (
    <ProgressSelector
      value={su.today}
      onChange={(joined) => onProgress(student.id, subjectIndex, joined)}
      studyGrade={student.studyGrade ?? student.grade}
      onStudyGrade={(g) => onStudyGrade(student.id, g)}
      studentGrade={student.grade}
      prev={su.prev}
      ariaLabel={`${student.name} ${su.name} 오늘 진도`}
    />
  );
}

/** 점수 셀 — 맞은 개수 입력 + /만점. allowMax면 만점(/N)도 편집 가능(학원 설정). */
function ScoreInput({
  value,
  max,
  onChange,
  label,
  allowMax,
  onMax,
}: {
  value: number | null;
  max: number;
  onChange: (v: number | null) => void;
  label: string;
  allowMax?: boolean;
  onMax?: (v: number) => void;
}) {
  return (
    <div className="flex items-center justify-center gap-0.5">
      <input
        inputMode="numeric"
        value={value == null ? "" : String(value)}
        aria-label={label}
        onChange={(e) => {
          const raw = e.target.value.replace(/[^0-9]/g, "");
          onChange(raw === "" ? null : clamp(parseInt(raw, 10) || 0, max));
        }}
        className="border-line focus:border-primary tabular h-8 w-10 rounded-sm border bg-background px-1 text-center text-[13px] font-bold outline-none"
      />
      <span className="text-text-faint tabular text-[11px]">/</span>
      {allowMax && onMax ? (
        <input
          inputMode="numeric"
          value={String(max)}
          aria-label={`${label} 문항수`}
          title="문항수(만점)"
          onChange={(e) => {
            const n = parseInt(e.target.value.replace(/[^0-9]/g, ""), 10);
            if (!Number.isNaN(n) && n > 0) onMax(n);
          }}
          className="border-line focus:border-primary tabular h-8 w-8 rounded-sm border bg-background px-0.5 text-center text-[11px] outline-none"
        />
      ) : (
        <span className="text-text-faint tabular text-[11px]">{max}</span>
      )}
    </div>
  );
}

const TH = "text-text-faint px-2 py-2 text-left text-[11px] font-semibold whitespace-nowrap";
const TD = "border-line border-t px-2 py-1.5 align-top";
const PREV_TD = "border-line/60 px-2 py-1 align-top text-[11px] text-text-faint";

/** 이전 회차 참고행(edutrix식) — 편집행 위, 같은 열에 지난 보고서를 읽기전용으로 정렬. 테스트 열은 표시설정에 맞춰 정렬. */
function PrevRow({
  subject,
  dailyEnabled,
  checkEnabled,
}: {
  subject: OneScreenStudent["subjects"][number];
  dailyEnabled: boolean;
  checkEnabled: boolean;
}) {
  const p = subject.prevReport;
  if (!p) return null;
  const prog = displayLessons(p.progress) || p.progress || "—";
  const testCols = (dailyEnabled ? 1 : 0) + (checkEnabled ? 1 : 0);
  return (
    <tr className="bg-bg-soft/40">
      <td className={`${PREV_TD} text-center`} aria-hidden>
        <EyIcon name="chevronUp" size={13} className="text-text-faint/70" />
      </td>
      <td className={PREV_TD}>
        <span className="whitespace-nowrap">이전 {shortDate(p.date)}</span>
      </td>
      <td className={PREV_TD}>
        <span className="line-clamp-3 whitespace-pre-line">{prog}</span>
      </td>
      {testCols > 0 ? (
        <td className={`${PREV_TD} text-center`} colSpan={testCols}>
          {p.examInfo || "—"}
        </td>
      ) : null}
      <td className={PREV_TD}>{p.attitude || "—"}</td>
      <td className={PREV_TD}>{p.homeworkScore || "—"}</td>
      <td className={PREV_TD}>
        <span className="line-clamp-2">{p.textbook || "—"}</span>
        {p.homeworkToday ? (
          <span className="text-text-faint/80 mt-0.5 block line-clamp-2">과제 {p.homeworkToday}</span>
        ) : null}
      </td>
      <td className={PREV_TD}>
        <span className="line-clamp-2">{p.note || "—"}</span>
      </td>
      <td className={PREV_TD} />
    </tr>
  );
}

/**
 * 선생님 원스크린 — 표(스프레드시트) 대량작성 뷰.
 * 카드 뷰와 **같은 state·저장로직**을 공유(핸들러는 studentId 파라미터 버전). 행 = (학생 × 과목).
 * 반 전체 진도·점수·태도·과제·교재명을 한 표에서 입력 → 일괄 저장 / 일괄 ClassNote 발송.
 */
export function OneScreenGrid({
  students,
  reports,
  attitudes,
  homeworks,
  onProgress,
  onStudyGrade,
  onScore,
  onAttitude,
  onHomework,
  onTextbook,
  onHomeworkToday,
  onDraft,
  onTrend,
  onNote,
  onSendRow,
  onSaveAll,
  onSendAll,
  allowTestMax,
  dailyEnabled = true,
  checkEnabled = true,
  onMax,
  onMakeup,
  onAutoWrite,
  onAutoWriteAll,
  onOpenCard,
  onClassNotice,
  genKey,
  bulkGen,
}: {
  students: OneScreenStudent[]; // 현재 필터(반)로 보이는 학생만
  reports: Record<string, Record<string, SubjectReport>>; // studentId → 과목명 → 발송상태
  attitudes: readonly string[];
  homeworks: readonly string[];
  onProgress: (studentId: string, subjectIndex: number, today: string) => void;
  onStudyGrade: (studentId: string, grade: string) => void;
  onScore: (studentId: string, which: "daily" | "check", v: number | null) => void;
  onAttitude: (studentId: string, a: string | null) => void;
  onHomework: (studentId: string, h: string) => void;
  onTextbook: (studentId: string, subjectName: string, text: string) => void;
  onHomeworkToday: (studentId: string, subjectName: string, text: string) => void; // 오늘 과제(0096a)
  onDraft: (studentId: string, subjectName: string, text: string) => void; // 학부모 문구(멘트) 편집
  onTrend: (studentId: string, subjectName: string, text: string) => void; // 학습 추세(종합분석) 편집(4a)
  onNote: (studentId: string, text: string) => void; // 특이사항(강사 메모) 편집 — AI 멘트 입력(4c). 학생별.
  onSendRow: (student: OneScreenStudent, subjectName: string) => void;
  onSaveAll: (keys?: string[]) => void; // keys(선택 행) 있으면 그 행만, 없으면 전체
  onSendAll: (keys?: string[]) => void;
  allowTestMax: boolean; // 강사 문항수 변경 허용(학원 설정)
  dailyEnabled?: boolean; // 일일테스트 사용(off면 일일 열 숨김)
  checkEnabled?: boolean; // 확인테스트 사용(off면 확인 열 숨김)
  onMax: (studentId: string, which: "daily" | "check", v: number) => void;
  onMakeup: (studentId: string, subjectName: string) => void; // 보강 토글
  onAutoWrite: (student: OneScreenStudent, subjectName: string) => void; // 행별 AI 멘트 자동작성
  onAutoWriteAll: (keys?: string[]) => void; // 선택(또는 전체) 행 자동작성
  onOpenCard: (studentId: string) => void; // 그 학생을 카드 뷰로 열기(본문·첨부·링크 편집)
  onClassNotice?: (keys?: string[]) => void; // 선택(없으면 표시 전체) 학생 학부모 공지 — 진도 무관
  genKey?: string | null; // 자동작성 중인 행 키(studentId::과목)
  bulkGen?: boolean; // 전체 자동작성 진행중
}) {
  const rows = buildGridRows(students);
  const eligibleRows = rows.filter((r) => isReportEligible(r.subject));
  const eligible = eligibleRows.length;
  // 행 선택(체크) — 일괄 작업 대상. **표시된 모든 행**을 선택 가능(진도 유무 무관).
  // 실제 처리는 client의 selectRows가 발송가능(진도 입력) 행만 걸러내므로, 진도 없는 행은 안전히 건너뜀.
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [showPrev, setShowPrev] = useState(true); // 이전 회차 참고행 토글(기본 켜짐)
  const selectedKeys = rows.filter((r) => checked.has(r.key)).map((r) => r.key);
  const selectedEligible = eligibleRows.filter((r) => checked.has(r.key)).length; // 실제 처리될 수(발송가능)
  const hasPrev = rows.some((r) => r.subject.prevReport); // 참고행 데이터가 있을 때만 토글 노출
  const allChecked = rows.length > 0 && selectedKeys.length === rows.length;
  const toggleRow = (k: string) =>
    setChecked((prev) => {
      const n = new Set(prev);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });
  const toggleAll = () =>
    setChecked((prev) => {
      const n = new Set(prev);
      if (allChecked) rows.forEach((r) => n.delete(r.key));
      else rows.forEach((r) => n.add(r.key));
      return n;
    });

  if (rows.length === 0) {
    return (
      <div className="bg-card border-line shadow-card text-text-faint flex items-center justify-center rounded-md border p-10 text-sm">
        표시할 학생이 없습니다
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {/* 일괄 바 — 선택은 표시 전체, 처리는 발송가능 행만(client selectRows). */}
      <div className="bg-card border-line shadow-card flex flex-wrap items-center gap-2 rounded-md border px-4 py-2.5">
        <span className="text-text-dim text-[12px]">
          표시 <span className="text-foreground font-bold">{rows.length}</span> · 발송가능{" "}
          <span className="text-foreground font-bold">{eligible}</span>
          {selectedKeys.length ? (
            <>
              {" "}
              · 선택 <span className="text-primary font-bold">{selectedKeys.length}</span>
              {selectedKeys.length > selectedEligible ? (
                <span className="text-text-faint"> (발송가능 {selectedEligible})</span>
              ) : null}
            </>
          ) : null}
        </span>
        {hasPrev ? (
          <label className="text-text-dim ml-1 flex cursor-pointer items-center gap-1 text-[12px]">
            <input
              type="checkbox"
              checked={showPrev}
              onChange={() => setShowPrev((v) => !v)}
              className="accent-primary size-3.5"
            />
            이전 회차 참고
          </label>
        ) : null}
        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          {onClassNotice ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onClassNotice(selectedKeys)}
              title="선택(없으면 표시 전체) 학생 학부모에게 공지 발송 — 진도와 무관"
            >
              {selectedKeys.length ? `선택 ${selectedKeys.length} 공지` : "반 전체 공지"}
            </Button>
          ) : null}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onAutoWriteAll(selectedKeys)}
            disabled={eligible === 0 || bulkGen}
          >
            {bulkGen
              ? "자동작성 중…"
              : selectedKeys.length
                ? `선택 ${selectedEligible} 자동작성`
                : "전체 자동작성"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => onSaveAll(selectedKeys)}
            disabled={eligible === 0 || bulkGen}
          >
            {selectedKeys.length ? `선택 ${selectedEligible} 저장` : "일괄 저장"}
          </Button>
          <Button size="sm" onClick={() => onSendAll(selectedKeys)} disabled={eligible === 0 || bulkGen}>
            {selectedKeys.length ? `선택 ${selectedEligible} 발송` : "ClassNote 일괄 발송"}
          </Button>
        </div>
      </div>

      <div className="bg-card border-line shadow-card overflow-x-auto rounded-md border">
        {/* table-fixed + colgroup 고정 폭 — 헤더/본문 열 정렬 결정적, 표는 내용 폭(좌측 정렬)이라 진도가 남는 폭을 독식하지 않음. */}
        <table className="w-full min-w-[1240px] table-fixed border-collapse text-[12px]">
          <colgroup>
            <col className="w-[34px]" /> {/* 선택 */}
            <col className="w-[128px]" /> {/* 학생·반 */}
            <col className="w-[200px]" /> {/* 진도 */}
            {dailyEnabled ? <col className="w-[88px]" /> : null} {/* 일일 */}
            {checkEnabled ? <col className="w-[88px]" /> : null} {/* 확인 */}
            <col className="w-[96px]" /> {/* 태도 */}
            <col className="w-[96px]" /> {/* 과제 */}
            <col className="w-[140px]" /> {/* 교재명 · 보강 */}
            <col /> {/* 학부모 문구(멘트) — 남는 폭 흡수(우측 공간 활용) */}
            <col className="w-[132px]" /> {/* 자동작성 · 카드 · 발송 */}
          </colgroup>
          <thead>
            <tr className="bg-bg-soft">
              <th className={`${TH} text-center`}>
                <input
                  type="checkbox"
                  checked={allChecked}
                  onChange={toggleAll}
                  aria-label="표시 행 전체 선택"
                  className="accent-primary size-3.5 align-middle"
                />
              </th>
              <th className={TH}>학생 · 반</th>
              <th className={TH}>진도(오늘)</th>
              {dailyEnabled ? <th className={`${TH} text-center`}>일일</th> : null}
              {checkEnabled ? <th className={`${TH} text-center`}>확인</th> : null}
              <th className={TH}>태도</th>
              <th className={TH}>과제</th>
              <th className={TH}>교재명 · 보강</th>
              <th className={TH}>학부모 문구</th>
              <th className={TH}>발송 · 편집</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ student, subject, subjectIndex, key }) => {
              const { tone } = subjectTone(subject.name);
              const rep = reports[student.id]?.[subject.name];
              const badge = classnoteBadge(rep?.classnoteStatus);
              const att = student.attendance;
              const genRowBusy = genKey === key; // 이 행 자동작성 중
              const hasDraft = !!rep?.draft?.trim(); // 학부모 멘트(draft) 준비됨 — 발송 시 사용
              const canWrite = isReportEligible(subject); // 진도 입력됨 = 자동작성/발송 가능
              return (
                <Fragment key={key}>
                {showPrev ? <PrevRow subject={subject} dailyEnabled={dailyEnabled} checkEnabled={checkEnabled} /> : null}
                <tr className="hover:bg-bg-soft/50">
                  <td className={`${TD} text-center`}>
                    <input
                      type="checkbox"
                      checked={checked.has(key)}
                      onChange={() => toggleRow(key)}
                      aria-label={`${student.name} ${subject.name} 선택`}
                      className="accent-primary size-3.5 align-middle"
                    />
                  </td>
                  <td className={TD}>
                    <div className="flex items-center gap-1.5">
                      <span className={`size-1.5 shrink-0 rounded-full ${toneSolidClass(tone)}`} aria-hidden />
                      <span className="text-foreground font-semibold">{student.name}</span>
                      {student.isMakeup ? (
                        <span className="bg-amber-soft text-amber shrink-0 rounded-pill px-1 py-px text-[9px] font-bold">
                          보강
                        </span>
                      ) : null}
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-1">
                      <span className={`rounded-pill px-1.5 py-px text-[10px] font-semibold ${toneSoftClass(tone)}`}>
                        {subject.name}
                      </span>
                      <span className="text-text-faint text-[10px]">{student.tag}</span>
                      {att !== "출석" ? (
                        <span
                          className={`rounded-pill px-1.5 py-px text-[10px] font-semibold ${
                            att === "지각" ? "bg-amber-soft text-amber" : "bg-danger text-white"
                          }`}
                        >
                          {att}
                        </span>
                      ) : null}
                    </div>
                  </td>
                  <td className={TD}>
                    <GridProgressCell
                      student={student}
                      subjectIndex={subjectIndex}
                      onProgress={onProgress}
                      onStudyGrade={onStudyGrade}
                    />
                  </td>
                  {dailyEnabled ? (
                    <td className={`${TD} text-center`}>
                      <ScoreInput
                        value={student.tests.daily.score}
                        max={student.tests.daily.max}
                        onChange={(v) => onScore(student.id, "daily", v)}
                        label={`${student.name} 일일테스트`}
                        allowMax={allowTestMax}
                        onMax={(v) => onMax(student.id, "daily", v)}
                      />
                    </td>
                  ) : null}
                  {checkEnabled ? (
                    <td className={`${TD} text-center`}>
                      <ScoreInput
                        value={student.tests.check.score}
                        max={student.tests.check.max}
                        onChange={(v) => onScore(student.id, "check", v)}
                        label={`${student.name} 확인테스트`}
                        allowMax={allowTestMax}
                        onMax={(v) => onMax(student.id, "check", v)}
                      />
                    </td>
                  ) : null}
                  <td className={TD}>
                    <Select
                      value={student.attitude ?? NONE}
                      onValueChange={(v) => onAttitude(student.id, v === NONE ? null : (v as string))}
                    >
                      <SelectTrigger size="sm" className="min-w-[92px]" aria-label={`${student.name} 태도`}>
                        <SelectValue>{(v) => (v === NONE ? "—" : (v as string))}</SelectValue>
                      </SelectTrigger>
                      <SelectContent alignItemWithTrigger={false}>
                        <SelectItem value={NONE}>—</SelectItem>
                        {attitudes.map((a) => (
                          <SelectItem key={a} value={a}>
                            {a}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </td>
                  <td className={TD}>
                    <Select
                      value={student.homework || NONE}
                      onValueChange={(v) => onHomework(student.id, v === NONE ? "" : (v as string))}
                    >
                      <SelectTrigger size="sm" className="min-w-[92px]" aria-label={`${student.name} 과제`}>
                        <SelectValue>{(v) => (v === NONE ? "—" : (v as string))}</SelectValue>
                      </SelectTrigger>
                      <SelectContent alignItemWithTrigger={false}>
                        <SelectItem value={NONE}>—</SelectItem>
                        {homeworks.map((h) => (
                          <SelectItem key={h} value={h}>
                            {h}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </td>
                  <td className={TD}>
                    <div className="flex flex-col gap-1">
                      <input
                        type="text"
                        value={subject.textbook ?? ""}
                        onChange={(e) => onTextbook(student.id, subject.name, e.target.value)}
                        placeholder="교재명"
                        aria-label={`${student.name} ${subject.name} 교재명`}
                        className="border-line bg-card focus:border-primary h-8 w-full rounded-sm border px-2 text-[12px] outline-none"
                      />
                      {/* 오늘 과제(숙제 내용) — 0096a. 과제 셀렉트(수행 상태)와 별개, AI 멘트·학부모 카드 재료. */}
                      <input
                        type="text"
                        value={subject.homeworkToday ?? ""}
                        onChange={(e) => onHomeworkToday(student.id, subject.name, e.target.value)}
                        placeholder="오늘 과제 (예: 개념편 p10~16)"
                        aria-label={`${student.name} ${subject.name} 오늘 과제`}
                        className="border-line bg-card focus:border-primary h-8 w-full rounded-sm border px-2 text-[12px] outline-none"
                      />
                      <label className="text-text-dim flex w-fit cursor-pointer items-center gap-1 text-[11px]">
                        <input
                          type="checkbox"
                          checked={!!subject.makeup}
                          onChange={() => onMakeup(student.id, subject.name)}
                          className="accent-primary size-3.5"
                          aria-label={`${student.name} ${subject.name} 보강`}
                        />
                        보강
                      </label>
                    </div>
                  </td>
                  <td className={TD}>
                    {/* 특이사항(입력) + 학부모 문구(멘트) + 학습 추세 — 자동작성이 특이사항을 문장으로 풀어 씀. 우측 남는 폭 활용. */}
                    <div className="flex flex-col gap-1">
                      <textarea
                        value={student.note ?? ""}
                        onChange={(e) => onNote(student.id, e.target.value)}
                        placeholder="특이사항(메모) · 예: 조퇴함 / 개념 어려워함"
                        aria-label={`${student.name} 특이사항`}
                        className="border-amber/40 focus:border-primary scrollbar-thin h-[40px] w-full resize-none rounded-sm border bg-amber-soft/30 px-2 py-1 text-[11px] leading-snug outline-none"
                      />
                      <textarea
                        value={rep?.draft ?? ""}
                        onChange={(e) => onDraft(student.id, subject.name, e.target.value)}
                        placeholder={genRowBusy ? "자동작성 중…" : "'자동작성'으로 생성 · 직접 편집·확인 후 발송"}
                        aria-label={`${student.name} ${subject.name} 학부모 문구`}
                        className="border-line focus:border-primary scrollbar-thin h-[72px] w-full resize-none rounded-sm border bg-background px-2 py-1 text-[11px] leading-snug outline-none"
                      />
                      <textarea
                        value={rep?.trendDraft ?? ""}
                        onChange={(e) => onTrend(student.id, subject.name, e.target.value)}
                        placeholder="학습 추세(종합분석) · 기록 적으면 비어 있음"
                        aria-label={`${student.name} ${subject.name} 학습 추세`}
                        className="border-line focus:border-primary scrollbar-thin h-[48px] w-full resize-none rounded-sm border bg-bg-soft px-2 py-1 text-[11px] leading-snug outline-none"
                      />
                    </div>
                  </td>
                  <td className={TD}>
                    <div className="flex flex-col items-stretch gap-1">
                      <div className="flex gap-1">
                        <button
                          type="button"
                          onClick={() => onAutoWrite(student, subject.name)}
                          disabled={genRowBusy || bulkGen || !canWrite}
                          title={canWrite ? "AI 학부모 멘트 자동작성 (발송 문구)" : "오늘 진도를 먼저 입력하세요"}
                          className={`border-line hover:bg-bg-soft flex-1 rounded-sm border px-1 py-1 text-[11px] font-semibold disabled:opacity-50 ${
                            hasDraft ? "text-primary" : "text-text-dim"
                          }`}
                        >
                          {genRowBusy ? (
                            "…"
                          ) : hasDraft ? (
                            <span className="inline-flex items-center justify-center gap-0.5">
                              <EyIcon name="check" size={11} /> 멘트
                            </span>
                          ) : (
                            "자동작성"
                          )}
                        </button>
                        <button
                          type="button"
                          onClick={() => onOpenCard(student.id)}
                          title="카드로 열어 본문·첨부·링크 편집"
                          className="border-line text-text-dim hover:bg-bg-soft shrink-0 rounded-sm border px-1.5 py-1 text-[11px] font-semibold"
                        >
                          카드
                        </button>
                      </div>
                      <Button size="sm" variant="outline" disabled={!canWrite} onClick={() => onSendRow(student, subject.name)}>
                        발송
                      </Button>
                      {badge ? (
                        <span className={`text-center text-[10px] font-semibold ${badge.cls}`}>{badge.label}</span>
                      ) : null}
                    </div>
                  </td>
                </tr>
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
