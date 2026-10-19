"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AnalysisError, DATASETS, DATASET_LABELS, FIELDS, MAX_FILE_BYTES, type AnalysisResult, type Dataset } from "../contract";
import { decodeCsv, parseCsv } from "../csv";
import { SAMPLE_CSV, canonicalMapping } from "../sample";
import { prepareCsv, suggestMapping } from "../prepare";
import { FileFields, type SelectedCsv } from "./file-fields";
import { AnalyticsResults, ValidationResults } from "./results";
import { AnalyticsDefinitions } from "./definitions";

type Selection = Partial<Record<Dataset, SelectedCsv>>;
export function AnalyticsPanel({ tenantId, today }: { tenantId: string; today: string }) {
  const [selected, setSelected] = useState<Selection>({});
  const [dates, setDates] = useState({ from: `${today.slice(0, 7)}-01`, to: today, asOf: today });
  const [encoding, setEncoding] = useState<"utf-8" | "euc-kr">("utf-8");
  const [confirmed, setConfirmed] = useState(false), [sample, setSample] = useState(false);
  const [result, setResult] = useState<AnalysisResult | null>(null), [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const generation = useRef(0), request = useRef<AbortController | null>(null);
  const fileVersions = useRef<Record<Dataset, number>>({ enrollments: 0, payments: 0, consultations: 0 });
  useEffect(() => () => { generation.current++; request.current?.abort(); }, []);
  function reset() {
    generation.current++; request.current?.abort(); setBusy(false); setSelected({}); setResult(null);
    setConfirmed(false); setSample(false); setRevision((n) => n + 1);
  }
  async function selectFile(dataset: Dataset, file?: File) {
    if (sample) reset(); // Never mix one real file with two remaining synthetic files.
    const current = generation.current, version = ++fileVersions.current[dataset];
    setResult(null); setConfirmed(false); setSample(false);
    setSelected((s) => ({ ...s, [dataset]: undefined }));
    if (!file) return;
    try {
      if (file.size > MAX_FILE_BYTES) throw new AnalysisError("파일 크기 제한 초과");
      const [headers] = parseCsv(decodeCsv(await file.arrayBuffer(), encoding));
      if (current !== generation.current || version !== fileVersions.current[dataset]) return;
      const mapping = suggestMapping(dataset, headers);
      setSelected((s) => ({ ...s, [dataset]: { file, headers, mapping } }));
    } catch {
      if (current === generation.current && version === fileVersions.current[dataset])
        setResult({ ok: false, error: `${DATASET_LABELS[dataset]} 파일을 읽을 수 없습니다. CSV 형식·512KB 제한·인코딩을 확인해 주세요.` });
    }
  }
  function loadSample() {
    reset(); setEncoding("utf-8"); setSample(true); setConfirmed(true);
    setDates({ from: "2026-09-01", to: "2026-09-30", asOf: "2026-09-30" });
    const mapping = canonicalMapping();
    setSelected(Object.fromEntries(DATASETS.map((d) => [d, { file: new File([SAMPLE_CSV[d]], `${d}.csv`, { type: "text/csv" }), headers: Object.keys(FIELDS[d]), mapping: mapping[d] }])));
  }
  async function analyze() {
    if (!ready || busy) return;
    setResult(null); setBusy(true);
    const current = ++generation.current;
    const controller = new AbortController(); request.current = controller;
    try {
      const form = new FormData();
      const mapping = canonicalMapping();
      for (const d of DATASETS) {
        const item = selected[d]!;
        const prepared = prepareCsv(decodeCsv(await item.file.arrayBuffer(), encoding), d, item.mapping);
        form.set(d, new File([prepared], `${d}.csv`, { type: "text/csv" }));
      }
      if (current !== generation.current) return;
      form.set("tenantId", tenantId);
      form.set("options", JSON.stringify({ ...dates, encoding: "utf-8", mapping, completeHistory: confirmed, sameTenant: confirmed }));
      const response = await fetch("/api/management-analytics", { method: "POST", body: form, signal: controller.signal, headers: { "X-Aywa-Analytics": "1" }, cache: "no-store" });
      const payload = await response.json() as AnalysisResult;
      if (current === generation.current) setResult(payload);
    } catch (error) {
      if (current === generation.current) setResult({ ok: false, error: error instanceof AnalysisError ? error.message : "분석에 연결하지 못했습니다. 로그인 상태를 확인하고 다시 시도해 주세요." });
    } finally { if (current === generation.current) setBusy(false); }
  }
  function downloadSample(d: Dataset) {
    const url = URL.createObjectURL(new Blob(["\uFEFF", SAMPLE_CSV[d]], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a"); a.href = url; a.download = `sample-${d}.csv`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const ready = confirmed && DATASETS.every((d) => selected[d] && Object.values(selected[d]!.mapping).every(Boolean));
  return <div className="space-y-4">
    <div className="flex flex-wrap items-center gap-2">
      <Button type="button" variant="outline" disabled={busy} onClick={loadSample}>가상 샘플 불러오기</Button>
      <Button type="button" variant="outline" onClick={reset}>자료 비우기</Button>
      <details><summary className="cursor-pointer text-sm">샘플 CSV 다운로드</summary><div className="flex flex-wrap gap-2 py-2">
        {DATASETS.map((d) => <Button key={d} type="button" variant="outline" onClick={() => downloadSample(d)}>{DATASET_LABELS[d]}</Button>)}
      </div></details>
    </div>
    <AnalyticsDefinitions />
    <form onSubmit={(e) => { e.preventDefault(); void analyze(); }} onChange={() => setResult(null)}>
      <fieldset disabled={busy} className="space-y-4">
        <legend className="sr-only">분석 자료와 조회 조건</legend>
        <div className="flex flex-wrap items-end gap-3">
          {([ ["from", "조회 시작일"], ["to", "조회 종료일"], ["asOf", "데이터 기준일"] ] as const).map(([key, label]) => <label key={key} className="space-y-1 text-sm"><span>{label}</span>
            <Input type="date" required aria-label={label} value={dates[key]} max={today} onChange={(e) => setDates((s) => ({ ...s, [key]: e.target.value }))} /></label>)}
          <label className="space-y-1 text-sm"><span>파일 인코딩</span><select aria-label="파일 인코딩" className="border-input bg-card h-8 rounded-lg border px-2 text-sm" value={encoding} onChange={(e) => { reset(); setEncoding(e.target.value as typeof encoding); }}>
            <option value="utf-8">UTF-8</option><option value="euc-kr">한글 Windows (EUC-KR)</option></select></label>
        </div>
        <p className="text-sm">기준일까지의 전체 이력 · 파일당 10,000행 / 512KB · 조회 최대 24개월</p>
        {sample ? <p className="rounded-lg bg-blue-soft p-3 text-sm">가상 샘플이 선택되었습니다. 실제 학원 실적이 아닙니다.</p> : null}
        {DATASETS.map((d) => <FileFields key={`${d}-${revision}`} dataset={d} selected={selected[d]} onFile={(file) => void selectFile(d, file)}
          onMapping={(field, header) => setSelected((s) => ({ ...s, [d]: { ...s[d]!, mapping: { ...s[d]!.mapping, [field]: header } } }))} />)}
        <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
          현재 지점의 기준일까지 전체 이력이며, 세 파일의 학생 식별자가 일치함을 확인했습니다. (샘플 사용 시 가상 자료 기준)</label>
        <Button type="submit" disabled={!ready || busy}>{busy ? "검증·집계 중…" : "검증하고 분석하기"}</Button>
      </fieldset>
    </form>
    <div aria-live="polite" aria-busy={busy}>{result ? result.ok ? <AnalyticsResults report={result.report} sample={sample} /> : <ValidationResults result={result} /> : null}</div>
  </div>;
}
