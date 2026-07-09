"use client";

// 학원 운영 > AI 멘트 — 학부모 멘트·학습 추세 프롬프트를 원장이 런타임 편집·테스트(edutrix AISettingsView 이식).
// 저장은 append-only 버전(활성 비활성화 후 새 활성). 저장 즉시 이 학원의 모든 자동작성에 적용(재배포 불필요).
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { DEFAULT_PROMPTS, REQUIRED_PLACEHOLDER } from "@/features/onescreen/prompt-defaults";
import {
  getPromptHistory,
  getRecentReportsForTest,
  resetPrompt,
  savePrompt,
  testPrompt,
  type PromptRow,
  type PromptVersion,
  type TestReportOption,
} from "@/features/onescreen/server/prompt-actions";

export function AiMentSection({ initial }: { initial: PromptRow[] }) {
  const [reports, setReports] = useState<TestReportOption[]>([]);
  useEffect(() => {
    void getRecentReportsForTest().then((r) => {
      if (r.ok && r.reports) setReports(r.reports);
    });
  }, []);

  return (
    <div className="space-y-4">
      <div className="bg-card border-line text-text-dim rounded-md border p-4 text-[13px] leading-relaxed">
        학부모 멘트·학습 추세의 <b className="text-foreground">프롬프트를 학원에 맞게 편집</b>할 수 있습니다. 저장하면
        이 학원의 모든 자동작성에 <b className="text-foreground">즉시 적용</b>됩니다(재배포 불필요). 프롬프트에{" "}
        <code className="text-primary">{"{{facts}}"}</code>·<code className="text-primary">{"{{historySummary}}"}</code>{" "}
        같은 자리표시자를 지우면 입력이 반영되지 않아 저장이 거부됩니다. 언제든 <b className="text-foreground">기본값 복원</b>
        으로 되돌릴 수 있어요.
      </div>
      {initial.map((p) => (
        <PromptEditor key={p.type} row={p} reports={reports} />
      ))}
    </div>
  );
}

function PromptEditor({ row, reports }: { row: PromptRow; reports: TestReportOption[] }) {
  const [text, setText] = useState(row.text);
  const [custom, setCustom] = useState(row.isCustom);
  const [saving, setSaving] = useState(false);
  const [testReport, setTestReport] = useState("");
  const [testing, setTesting] = useState(false);
  const [output, setOutput] = useState<string | null>(null);
  const [history, setHistory] = useState<PromptVersion[] | null>(null);
  const [loadingHistory, setLoadingHistory] = useState(false);

  const placeholder = REQUIRED_PLACEHOLDER[row.type];
  const missingPlaceholder = !text.includes(placeholder);
  const isDefault = text.trim() === DEFAULT_PROMPTS[row.type].trim();

  async function onSave() {
    if (missingPlaceholder) {
      toast.error(`프롬프트에 ${placeholder} 자리표시자가 필요합니다`);
      return;
    }
    setSaving(true);
    const res = await savePrompt(row.type, text);
    setSaving(false);
    if (res.ok) {
      setCustom(true);
      toast.success("저장했습니다 — 이제 이 프롬프트로 생성됩니다");
      setHistory(null); // 이력 갱신 유도(다음에 열 때 재조회)
    } else toast.error(res.error ?? "저장에 실패했습니다");
  }

  async function onReset() {
    const res = await resetPrompt(row.type);
    if (res.ok) {
      setText(DEFAULT_PROMPTS[row.type]);
      setCustom(false);
      setHistory(null);
      toast.success("기본값으로 복원했습니다");
    } else toast.error(res.error ?? "복원에 실패했습니다");
  }

  async function onTest() {
    if (!testReport) {
      toast.error("테스트할 보고서를 선택하세요");
      return;
    }
    setTesting(true);
    setOutput(null);
    const res = await testPrompt(row.type, text, testReport);
    setTesting(false);
    if (res.ok) setOutput(res.output ?? "");
    else toast.error(res.error ?? "테스트에 실패했습니다");
  }

  async function toggleHistory() {
    if (history) {
      setHistory(null);
      return;
    }
    setLoadingHistory(true);
    const res = await getPromptHistory(row.type);
    setLoadingHistory(false);
    if (res.ok) setHistory(res.versions ?? []);
    else toast.error(res.error ?? "이력 조회에 실패했습니다");
  }

  return (
    <section className="bg-card border-line shadow-card rounded-lg border px-5 py-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="text-foreground text-[14px] font-semibold">
          {row.label}
          <span
            className={`ml-2 rounded-pill px-2 py-0.5 text-[11px] font-semibold ${
              custom ? "bg-primary/10 text-primary" : "text-text-faint border-line border"
            }`}
          >
            {custom ? "사용자 지정" : "기본값"}
          </span>
        </h2>
        <button type="button" onClick={toggleHistory} className="text-text-dim hover:text-foreground text-[12px] underline">
          {loadingHistory ? "불러오는 중…" : history ? "이력 닫기" : "버전 이력"}
        </button>
      </div>

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={12}
        className={`border-line focus:border-primary scrollbar-thin w-full resize-y rounded-md border bg-background px-3 py-2 font-mono text-[12px] leading-relaxed outline-none ${
          missingPlaceholder ? "border-danger" : ""
        }`}
      />
      <p className={`mt-1 text-[11px] ${missingPlaceholder ? "text-danger" : "text-text-faint"}`}>
        필수 자리표시자 <code className="font-mono">{placeholder}</code> — 이 자리에 실제 입력이 채워집니다.
        {missingPlaceholder ? " (현재 빠져 있어 저장할 수 없습니다)" : ""}
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={onSave} disabled={saving || missingPlaceholder}>
          {saving ? "저장 중…" : "저장"}
        </Button>
        <Button size="sm" variant="outline" onClick={() => setText(DEFAULT_PROMPTS[row.type])} disabled={isDefault}>
          기본값 불러오기
        </Button>
        {custom ? (
          <Button size="sm" variant="ghost" onClick={onReset}>
            기본값 복원(저장)
          </Button>
        ) : null}
      </div>

      {/* 실데이터 미리보기 — 저장 없이 편집 중 프롬프트로 생성해 결과만 확인. */}
      <div className="border-line mt-3 rounded-md border p-3">
        <p className="text-text-faint mb-1.5 text-[12px] font-semibold">실데이터로 테스트</p>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={testReport}
            onChange={(e) => setTestReport(e.target.value)}
            className="border-line bg-card focus:border-primary h-8 min-w-0 flex-1 rounded-sm border px-2 text-[12px] outline-none"
          >
            <option value="">보고서 선택…</option>
            {reports.map((r) => (
              <option key={r.id} value={r.id}>
                {r.label}
              </option>
            ))}
          </select>
          <Button size="sm" variant="outline" onClick={onTest} disabled={testing || !testReport}>
            {testing ? "생성 중…" : "테스트 실행"}
          </Button>
        </div>
        {output != null ? (
          <p className="text-foreground bg-bg-soft mt-2 rounded-md px-3 py-2 text-[13px] leading-relaxed whitespace-pre-wrap">
            {output}
          </p>
        ) : null}
      </div>

      {history ? (
        <div className="border-line mt-3 rounded-md border p-3">
          <p className="text-text-faint mb-1.5 text-[12px] font-semibold">버전 이력 (최근 {history.length})</p>
          {history.length === 0 ? (
            <p className="text-text-faint text-[12px]">저장된 버전이 없습니다(기본값 사용 중).</p>
          ) : (
            <ul className="divide-line divide-y">
              {history.map((v) => (
                <li key={v.id} className="flex items-start justify-between gap-3 py-2">
                  <div className="min-w-0">
                    <p className="text-text-dim text-[11px]">
                      {new Date(v.createdAt).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })}
                      {v.isActive ? <span className="text-primary ml-1 font-semibold">· 현재 사용 중</span> : null}
                    </p>
                    <p className="text-text-faint mt-0.5 truncate text-[11px]">{v.text.slice(0, 80)}…</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setText(v.text)}
                    className="border-line text-text-dim hover:bg-bg-soft shrink-0 rounded-sm border px-2 py-1 text-[11px] font-semibold"
                  >
                    이 버전 불러오기
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </section>
  );
}
