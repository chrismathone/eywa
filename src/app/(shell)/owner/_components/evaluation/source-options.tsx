"use client";

import { useState } from "react";
import { KIND_LABEL } from "@/features/grades/unified/model";
import {
  SATISFACTION_AI_LABEL, satisfactionOptionsSchema, type GradesOptions, type SatisfactionOptions,
} from "@/features/teacher-portfolio/evaluation/options";
import { GRADE_KINDS } from "@/features/teacher-portfolio/model/source-types";
import { NumField } from "./scoring-editor";

/**
 * 성적 관리 · 학부모 만족도의 '세는 법'(원장 2026-10-13 *"가능한 모든것을 커스터마이징"*).
 * ⚠️ 무엇을 세는지를 바꾸는 칸이라 미리보기(저장된 수치에 점수 규칙만 얹는다)엔 안 보이고, 저장 뒤 다시 매긴 점수에 반영된다.
 */
const BOX = "space-y-2 rounded-lg border border-line-faint px-3 py-2.5";
const NOTE = "저장한 뒤 다시 매긴 점수에 반영됩니다(미리보기엔 보이지 않습니다).";
const clamp = (n: number | null, lo: number, hi: number, fallback: number) => Math.min(hi, Math.max(lo, n ?? fallback));

export function GradesOptionsEditor({ value, onChange, label }: { value: GradesOptions; onChange: (next: GradesOptions) => void; label: string }) {
  return (
    <fieldset className={BOX}>
      <legend className="px-1 text-sm font-medium">세는 법</legend>
      <p className="text-xs">시험 종류별 비중 — 일일테스트는 제출률, 월말평가는 응시율, 나머지는 평균 점수율을 낸 뒤 이 비중으로 가중 평균합니다. 0이면 그 종류는 세지 않습니다(입학·레벨 테스트는 늘 제외합니다).</p>
      <div className="flex flex-wrap gap-x-4 gap-y-2 text-sm">
        {GRADE_KINDS.map((k) => (
          <label key={k} className="flex items-center gap-1.5">
            {KIND_LABEL[k]}
            <NumField label={`${label} — ${KIND_LABEL[k]} 비중`} className="w-16" value={value.weights[k]}
              onChange={(n) => onChange({ weights: { ...value.weights, [k]: clamp(n, 0, 10, 0) } })} />
          </label>
        ))}
      </div>
      <p className="text-xs">{NOTE}</p>
    </fieldset>
  );
}

/** 한 줄에 문구 하나 · 점수는 뒤에 띄어 적는다(`환불 -2`). 점수를 안 적으면 기본 점수. */
const listText = (rows: { phrase: string; points: number }[]) => rows.map((r) => `${r.phrase} ${r.points > 0 ? "+" : ""}${r.points}`).join("\n");
function parseList(text: string, fallback: number) {
  return text.split("\n").map((line) => line.trim()).filter(Boolean).slice(0, 50).map((line) => {
    const m = /^(.+?)\s+([+-]?\d+(?:\.\d+)?)$/.exec(line);
    return m ? { phrase: m[1]!.trim().slice(0, 30), points: Math.max(-100, Math.min(100, Number(m[2]))) } : { phrase: line.slice(0, 30), points: fallback };
  });
}
const words = (text: string, max: number) => text.split("\n").map((w) => w.trim().slice(0, 30)).filter(Boolean).slice(0, max);

export function SatisfactionOptionsEditor({ value, onChange, label }: { value: SatisfactionOptions; onChange: (next: SatisfactionOptions) => void; label: string }) {
  // 글 칸은 입력하는 동안 그대로 두고 칸을 떠날 때 읽는다(치는 도중에 다시 쓰면 커서가 튄다).
  const [draft, setDraft] = useState({ positive: listText(value.positive), negative: listText(value.negative), ignore: value.ignore.join("\n"), hedges: value.hedges.join("\n") });
  const area = (key: keyof typeof draft, title: string, hint: string, commit: (text: string) => Partial<SatisfactionOptions>) => (
    <label className="block space-y-1 text-sm">
      <span className="font-medium">{title}</span> <small className="text-xs">{hint}</small>
      <textarea rows={4} className="border-line bg-card block w-full rounded-lg border px-3 py-2 text-sm" aria-label={`${label} — ${title}`} value={draft[key]}
        onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value }))} onBlur={(e) => onChange({ ...value, ...commit(e.target.value) })} />
    </label>
  );
  const ai = satisfactionOptionsSchema.shape.ai.options;
  return (
    <fieldset className={BOX}>
      <legend className="px-1 text-sm font-medium">세는 법</legend>
      <p className="text-xs">학부모 글(결석·지각 연락은 빼고)에서 문구를 찾습니다. 가점·감점 문구가 하나만 걸리면 바로 반영하고, 둘이 함께 걸리거나 감점 문구에 완곡어가 붙거나 문구 없이 긴 글은 확인 대기로 쌓습니다. 한 글은 가장 센 문구 하나로 셉니다.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        {area("positive", "가점 문구", "한 줄에 하나 · 뒤에 점수(예: 덕분 +1)", (t) => ({ positive: parseList(t, value.plusPoints) }))}
        {area("negative", "감점 문구", "한 줄에 하나 · 뒤에 점수(예: 환불 -2)", (t) => ({ negative: parseList(t, value.minusPoints) }))}
        {area("ignore", "무시 문구", "인사 — 지운 뒤에 문구를 찾습니다", (t) => ({ ignore: words(t, 50) }))}
        {area("hedges", "완곡어", "감점 문구와 함께 있으면 확인 대기", (t) => ({ hedges: words(t, 30) }))}
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
        <label className="flex items-center gap-1.5">문구 없이 이 글자 수 이상이면 애매
          <NumField label={`${label} — 긴 글 기준`} value={value.longChars} onChange={(n) => onChange({ ...value, longChars: Math.round(clamp(n, 10, 1000, 80)) })} />자</label>
        <label className="flex items-center gap-1.5">문구 없이 판정한 가점
          <NumField label={`${label} — 가점 기본 점수`} className="w-16" value={value.plusPoints} onChange={(n) => onChange({ ...value, plusPoints: clamp(n, -100, 100, 1) })} /></label>
        <label className="flex items-center gap-1.5">감점
          <NumField label={`${label} — 감점 기본 점수`} className="w-16" value={value.minusPoints} onChange={(n) => onChange({ ...value, minusPoints: clamp(n, -100, 100, -1) })} /></label>
      </div>
      <div className="space-y-1 text-sm">
        {ai.map((o) => (
          <label key={o} className="flex items-center gap-1.5">
            <input type="radio" className="size-4" name={`${label}-satisfaction-ai`} checked={value.ai === o} onChange={() => onChange({ ...value, ai: o })} />
            {SATISFACTION_AI_LABEL[o]}
          </label>
        ))}
      </div>
      <p className="text-xs">AI가 읽은 글도 바로 반영하지 않고 확인 대기에 쌓습니다(직원 포트폴리오 도구줄의 [만족도 관리]에서 반영·무시). {NOTE}</p>
    </fieldset>
  );
}
