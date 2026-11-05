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
import type { MentStyleView } from "@/features/onescreen/server/ment-style-actions";
import { MentStyleCard } from "./ment-style-card";
import { writeLockedNote, writeLockedPlaceholder } from "@/lib/write-lock";

export function AiMentSection({ initial, styles, canEdit = true }: { initial: PromptRow[]; styles?: MentStyleView; canEdit?: boolean }) {
  const [reports, setReports] = useState<TestReportOption[]>([]);
  useEffect(() => {
    void getRecentReportsForTest().then((r) => {
      if (r.ok && r.reports) setReports(r.reports);
    });
  }, []);

  return (
    <div className="space-y-4">
      <div className="bg-card border-line text-text-dim rounded-md border p-4 text-sm leading-relaxed">
        학부모 멘트·학습 추세의 <b className="text-foreground">프롬프트를 학원에 맞게 편집</b>할 수 있습니다. 저장하면
        이 학원의 모든 자동작성에 <b className="text-foreground">즉시 적용</b>됩니다(재배포 불필요). 프롬프트에{" "}
        <code className="text-primary">{"{{facts}}"}</code>·<code className="text-primary">{"{{historySummary}}"}</code>{" "}
        같은 자리표시자를 지우면 입력이 반영되지 않아 저장이 거부됩니다. 언제든 <b className="text-foreground">기본값 복원</b>
        으로 되돌릴 수 있어요.
      </div>
      {/* 강사 말투(0262a) — 프롬프트보다 위: 원장이 "왜 선생님마다 결이 다른가"를 여기서 먼저 본다. */}
      {/* 🔴 읽기 권한(canEdit=false — 저장·테스트 액션과 같은 `canWriteTenant(ai_ment)`, lesson-reports/page.tsx)이면
          저장·불러오기·복원·테스트·지금 갱신 단추를 **그리지 않는다**(원장 2026-11-05). 글상자는 잠근다. */}
      {!canEdit ? <p className="text-text-faint text-xs">{writeLockedNote("ai_ment")}</p> : null}
      {styles ? <MentStyleCard initial={styles} canEdit={canEdit} /> : null}
      {initial.map((p) => (
        <PromptEditor key={p.type} row={p} reports={reports} canEdit={canEdit} />
      ))}
    </div>
  );
}

function PromptEditor({ row, reports, canEdit }: { row: PromptRow; reports: TestReportOption[]; canEdit: boolean }) {
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
    if (res.ok && res.usedDefault) {
      // 기본값과 같은 글은 사용자 지정으로 굳히지 않는다 — 기본값이 나중에 나아지면 그대로 따라간다(서버 savePrompt).
      setCustom(false);
      setHistory(null);
      toast.success("기본값과 같아 따로 저장하지 않았습니다 — 기본값을 그대로 씁니다");
    } else if (res.ok) {
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
    <section className="bg-card border-line shadow-card rounded-2xl border px-5 py-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="text-foreground text-sm font-bold">
          {row.label}
          <span
            className={`ml-2 rounded-pill px-2 py-0.5 text-xs font-bold ${
              custom ? "bg-primary/10 text-primary" : "text-text-faint border-line border"
            }`}
          >
            {custom ? "사용자 지정" : "기본값"}
          </span>
          {/* ⚠️ 모드에 따라 실제로 안 쓰이는 프롬프트가 있다 — 화면이 밝히지 않으면 원장이 정성껏 고쳐도
              아무 일도 안 일어난다(저장은 되는데 아무도 안 읽는 상태를 직접 만들게 됨). */}
          {row.inUse ? null : (
            <span className="bg-amber/15 text-amber rounded-pill ml-1.5 px-2 py-0.5 text-xs font-bold">
              현재 미사용
            </span>
          )}
        </h2>
        <button type="button" onClick={toggleHistory} className="text-text-dim hover:text-foreground text-xs underline">
          {loadingHistory ? "불러오는 중…" : history ? "이력 닫기" : "버전 이력"}
        </button>
      </div>

      <textarea
        disabled={!canEdit}
        placeholder={canEdit ? undefined : writeLockedPlaceholder("ai_ment")}
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={12}
        className={`border-line focus:border-primary scrollbar-thin w-full resize-y rounded-md border bg-background px-3 py-2 font-mono text-xs leading-relaxed outline-none disabled:opacity-70 ${
          missingPlaceholder ? "border-danger" : ""
        }`}
      />
      {row.inUse ? null : (
        <p className="bg-amber/10 text-amber mt-1.5 rounded-md px-3 py-2 text-xs leading-relaxed break-keep">
          지금 이 학원의 공지 모드에서는 <b>이 프롬프트가 쓰이지 않습니다</b> — 고쳐서 저장해도 자동작성 결과는
          바뀌지 않습니다.{" "}
          {row.type === "comment"
            ? "단일 멘트는 ‘학원 기본(A)’ 모드에서만 쓰입니다."
            : "2문단(P1·P2)은 ‘2문단 B’ 모드에서만 쓰입니다."}{" "}
          모드는 <b>보고서 설정 → AI 멘트 공지 모드</b>(또는 선생님 화면 상단 토글)에서 바꿉니다.
        </p>
      )}
      <p className={`mt-1 text-xs ${missingPlaceholder ? "text-danger" : "text-text-faint"}`}>
        필수 자리표시자 <code className="font-mono">{placeholder}</code> — 이 자리에 실제 입력이 채워집니다.
        {missingPlaceholder ? " (현재 빠져 있어 저장할 수 없습니다)" : ""}
      </p>

      {canEdit ? (
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={onSave} disabled={!canEdit || saving || missingPlaceholder}>
          {saving ? "저장 중…" : "저장"}
        </Button>
        <Button size="sm" variant="outline" onClick={() => setText(DEFAULT_PROMPTS[row.type])} disabled={!canEdit || isDefault}>
          기본값 불러오기
        </Button>
        {custom ? (
          <Button size="sm" variant="ghost" onClick={onReset} disabled={!canEdit}>
            기본값 복원(저장)
          </Button>
        ) : null}
      </div>
      ) : null}

      {/* 실데이터 미리보기 — 저장 없이 편집 중 프롬프트로 생성해 결과만 확인. 테스트 액션도 쓰기 권한이라 읽기 권한엔 세우지 않는다. */}
      {canEdit ? (
      <div className="border-line mt-3 rounded-md border p-3">
        <p className="text-text-faint mb-1.5 text-xs font-bold">실데이터로 테스트</p>
        <p className="text-text-faint mb-1.5 text-xs break-keep">
          고른 보고서를 실제 자동작성과 같은 재료(특이사항·선생님 말투)·같은 모델로 다시 써 봅니다. 저장·발송하지 않습니다.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={testReport}
            onChange={(e) => setTestReport(e.target.value)}
            className="border-line bg-card focus:border-primary h-8 min-w-0 flex-1 rounded-sm border px-2 text-xs outline-none"
          >
            <option value="">보고서 선택…</option>
            {reports.map((r) => (
              <option key={r.id} value={r.id}>
                {r.label}
              </option>
            ))}
          </select>
          <Button size="sm" variant="outline" onClick={onTest} disabled={!canEdit || testing || !testReport}>
            {testing ? "생성 중…" : "테스트 실행"}
          </Button>
        </div>
        {output != null ? (
          <p className="text-foreground bg-bg-soft mt-2 rounded-md px-3 py-2 text-sm leading-relaxed whitespace-pre-wrap">
            {output}
          </p>
        ) : null}
      </div>
      ) : null}

      {history ? (
        <div className="border-line mt-3 rounded-md border p-3">
          <p className="text-text-faint mb-1.5 text-xs font-bold">버전 이력 (최근 {history.length})</p>
          {history.length === 0 ? (
            <p className="text-text-faint text-xs">저장된 버전이 없습니다(기본값 사용 중).</p>
          ) : (
            <ul className="divide-line divide-y">
              {history.map((v) => (
                <li key={v.id} className="flex items-start justify-between gap-3 py-2">
                  <div className="min-w-0">
                    <p className="text-text-dim text-xs">
                      {new Date(v.createdAt).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })}
                      {v.isActive ? <span className="text-primary ml-1 font-bold">· 현재 사용 중</span> : null}
                    </p>
                    <p className="text-text-faint mt-0.5 truncate text-xs">{v.text.slice(0, 80)}…</p>
                  </div>
                  {canEdit ? (
                    <button
                      type="button"
                      onClick={() => setText(v.text)}
                      className="border-line text-text-dim hover:bg-bg-soft shrink-0 rounded-sm border px-2 py-1 text-xs font-bold"
                    >
                      이 버전 불러오기
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </section>
  );
}
