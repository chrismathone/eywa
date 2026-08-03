"use client";

// 반 단위 대량 발송 — 반을 골라 그 반 재원생 각자에게 **같은 내용**의 리포트 카드를 일괄 발송(반 공지의 리포트-카드 버전).
// 발송 안전가드(dry-run·과목·동명이인·이미작성 제외)는 서버 액션(sendBulkAdminReports)이 학생별로 최종 강제 — 여기선 안내·확인만.
import { useState } from "react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { kstToday } from "@/lib/date-kst";
import { Button } from "@/components/ui/button";
import { useSubjectMaps } from "@/features/owner/operations-context";
import { generateReportComment } from "@/features/onescreen/server/actions";
import type { NoticeClassOption } from "@/features/report-admin/server/notice-actions";
import { sendBulkAdminReports } from "@/features/report-admin/server/compose-actions";
import { REPORT_OPTOUT_LABEL } from "@/features/classes/report-optout";

const INPUT = "border-border bg-card text-foreground rounded-lg border px-2.5 py-1.5 text-sm w-full";
const LABEL = "text-text-dim text-[11px] font-medium";

export function BulkComposeFace({
  classes: allClasses,
  sendEnabled,
}: {
  classes: NoticeClassOption[];
  sendEnabled: boolean;
}) {
  // 🔴 직접 발송 = 리포트 카드(수업보고서)라 '수업보고서 미발송' 반(0174a)은 **목록에서 뺀다**.
  //    반 공지 탭(notice-face)은 같은 배열을 받지만 **거르지 않는다** — 공지는 계속 보낼 수 있다.
  //    (서버 sendBulkAdminReports도 같은 조건으로 재검증한다 — 화면만 숨기면 게이트가 아니다, #77.)
  const classes = allClasses.filter((c) => !c.reportOptout);
  const router = useRouter();
  const subjects = useSubjectMaps();
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [reportDate, setReportDate] = useState(kstToday()); // 보고서 날짜(기본 오늘) — 카드 표시일·ClassNote 게시일
  const [teacherName, setTeacherName] = useState("");
  const [textbook, setTextbook] = useState("");
  const [progress, setProgress] = useState("");
  const [homeworkToday, setHomeworkToday] = useState("");
  const [makeup, setMakeup] = useState(false);
  const [body, setBody] = useState("");
  const [trend, setTrend] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmSend, setConfirmSend] = useState(false);

  const selectedCount = classes.filter((c) => checked.has(c.id)).reduce((a, c) => a + c.studentCount, 0);
  // AI 자동작성 기준 과목 = 선택 반 중 첫 반의 과목(대량은 학생 무관 공용 초안).
  const firstSubjectKey = classes.find((c) => checked.has(c.id))?.subject ?? null;

  const toggle = (id: string) =>
    setChecked((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      setConfirmSend(false);
      return n;
    });

  async function autoWrite() {
    if (!progress.trim() && !homeworkToday.trim()) {
      toast.error("진도나 과제를 입력한 뒤 자동작성할 수 있습니다");
      return;
    }
    setAiBusy(true);
    const res = await generateReportComment({
      studentName: "학생",
      subject: firstSubjectKey ? subjects.labelOf(firstSubjectKey) : "수업",
      progress: progress.trim(),
      dailyTest: "",
      checkTest: "",
      attitude: "",
      homework: "",
      homeworkToday: homeworkToday.trim(),
      textbook: textbook.trim(),
      specialNote: "",
    });
    setAiBusy(false);
    if (res.ok && res.comment) {
      setBody(res.comment);
      toast.success("AI가 공용 본문을 작성했습니다 — 검토 후 발송하세요");
    } else {
      toast.message(res.error ?? "AI 생성에 실패했습니다 — 직접 작성하세요");
    }
  }

  function tryOpenConfirm() {
    if (checked.size === 0) {
      toast.error("발송할 반을 먼저 선택하세요");
      return;
    }
    if (!body.trim()) {
      toast.error("학부모 보고서 본문을 작성한 뒤 발송하세요");
      return;
    }
    setConfirmSend(true);
  }

  async function doSend(test: boolean) {
    if (!body.trim()) {
      toast.error("본문을 작성한 뒤 발송하세요");
      return;
    }
    setBusy(true);
    const res = await sendBulkAdminReports({
      classIds: [...checked],
      reportDate, // 보고서 날짜(기본 오늘) — 서버가 미래는 오늘로 클램프
      teacherName: teacherName.trim() || undefined,
      textbook: textbook.trim() || undefined,
      makeup,
      homeworkToday: homeworkToday.trim() || undefined,
      progress: progress.trim() || undefined,
      notes: body.trim(),
      trendNote: trend.trim() || undefined,
      test,
    });
    setBusy(false);
    setConfirmSend(false);
    if (!res.ok) {
      toast.error(res.error ?? "발송에 실패했습니다");
      return;
    }
    if (res.dryRun) {
      toast.message(
        `실제 발송이 꺼져 있어 전송하지 않았습니다 — 대상 ${res.wouldSend ?? 0}명 (원장 설정에서 'ClassNote 실제 발송'을 켜야 전송).`,
      );
      return;
    }
    const parts = [`${res.queued ?? 0}명 발송 대기(연동 PC가 순차 게시)`];
    if (res.conflicts) parts.push(`동명이인 제외 ${res.conflicts}명`);
    if (res.skippedExisting) parts.push(`${reportDate === kstToday() ? "오늘" : "해당 날짜"} 보고서 이미 있어 제외 ${res.skippedExisting}명`);
    if (res.absent) parts.push(`결석 기록이라 제외 ${res.absent}건`);
    if (res.tooOld) parts.push(`발송기한(전 달 1일) 지나 제외 ${res.tooOld}건`);
    if (res.subjectOff) parts.push(`발송 과목 아님 ${res.subjectOff}건`);
    // 목록에서 이미 빠져 있어 평소엔 0이지만, 화면 밖 경로로 실려 온 반은 서버가 걸러 사유를 밝힌다(#77).
    if (res.optoutSkipped) parts.push(`${REPORT_OPTOUT_LABEL} 반 제외 ${res.optoutSkipped}개`);
    if (res.overflow) parts.push(`상한 초과 ${res.overflow}건 제외`);
    (res.queued ? toast.success : toast.message)(parts.join(" · "));
    if (!test) {
      setChecked(new Set()); // 같은 반 재클릭 오발송 방지 — 내용은 남겨 다른 반에 이어 보낼 수 있게 유지.
      router.refresh(); // 상단 발송 큐 카드 갱신
    }
  }

  return (
    <section className="bg-card border-line shadow-card space-y-4 rounded-2xl border px-5 py-4">
      <div>
        <h2 className="text-foreground text-[15px] font-bold">반 단위 대량 발송</h2>
        <p className="text-text-faint text-[12px]">
          선택한 반의 재원생 각자에게 <b>같은 내용</b>의 리포트 카드를 발송합니다 · 점수·태도는 학생별이라 대량에선 제외(진도·본문 위주) ·
          오늘 이미 보고서가 있는 학생은 자동 제외
        </p>
      </div>

      {!sendEnabled ? (
        <p className="border-line bg-bg-soft text-text-dim rounded-md border px-3 py-2 text-[12px]">
          현재 <b>실제 발송이 꺼져</b> 있어 발송되지 않습니다(dry-run). 학부모에게 전송하려면 원장 설정의 <b>ClassNote 실제 발송</b>을 켜야 합니다.
        </p>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
        {/* 반 선택 */}
        <div className="border-line max-h-[420px] overflow-y-auto rounded-md border p-2">
          {classes.length === 0 ? (
            <p className="text-text-faint p-2 text-[12px]">발송 허용 과목의 활성 반이 없습니다.</p>
          ) : (
            classes.map((c) => (
              <label key={c.id} className="hover:bg-bg-soft flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-[13px]">
                <input type="checkbox" checked={checked.has(c.id)} onChange={() => toggle(c.id)} />
                <span className="text-foreground min-w-0 flex-1 truncate">{c.name}</span>
                {c.subject ? <span className="text-text-faint text-[11px]">{subjects.labelOf(c.subject)}</span> : null}
                <span className="text-text-faint text-[11px]">{c.studentCount}명</span>
              </label>
            ))
          )}
        </div>

        {/* 공유 입력 필드 */}
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <div className={LABEL}>보고서 날짜</div>
              <input
                type="date"
                value={reportDate}
                max={kstToday()}
                onChange={(e) => setReportDate(e.target.value || kstToday())}
                className={INPUT}
              />
              {reportDate !== kstToday() ? (
                <p className="text-amber mt-0.5 text-[11px]">과거 날짜로 발송 — 카드·ClassNote 게시일이 이 날짜</p>
              ) : null}
            </div>
            <div>
              <div className={LABEL}>표시 강사명(선택)</div>
              <input value={teacherName} onChange={(e) => setTeacherName(e.target.value)} placeholder="비우면 각 반 담당 강사" className={INPUT} />
            </div>
            <div className="sm:col-span-2">
              <div className={LABEL}>교재</div>
              <input value={textbook} onChange={(e) => setTextbook(e.target.value)} placeholder="교재명" className={INPUT} />
            </div>
            <div className="sm:col-span-2">
              <div className={LABEL}>오늘 진도</div>
              <input value={progress} onChange={(e) => setProgress(e.target.value)} placeholder="예: 수학 1-2 · p.44" className={INPUT} />
            </div>
            <div className="sm:col-span-2">
              <div className={LABEL}>오늘 과제</div>
              <div className="flex items-center gap-2">
                <input value={homeworkToday} onChange={(e) => setHomeworkToday(e.target.value)} placeholder="예: 워크북 p.20~22" className={INPUT} />
                <label className="text-text-dim inline-flex shrink-0 items-center gap-1 text-[12px]">
                  <input type="checkbox" checked={makeup} onChange={(e) => setMakeup(e.target.checked)} /> 보강
                </label>
              </div>
            </div>
          </div>

          <div>
            <div className="mb-1 flex items-center justify-between">
              <div className={LABEL}>학부모 보고서 본문(공용)</div>
              <Button size="sm" variant="outline" onClick={autoWrite} disabled={aiBusy}>
                {aiBusy ? "작성 중…" : "AI 자동 작성"}
              </Button>
            </div>
            <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={5} placeholder="선택한 반 학생 전원에게 같은 본문으로 발송됩니다" className={`${INPUT} resize-y`} />
          </div>
          <div>
            <div className={LABEL}>학습 추세(선택)</div>
            <textarea value={trend} onChange={(e) => setTrend(e.target.value)} rows={2} placeholder="종합 추세 코멘트(선택)" className={`${INPUT} resize-y`} />
          </div>

          {/* 액션 */}
          {confirmSend ? (
            <div className="border-primary/40 bg-primary/5 flex flex-wrap items-center gap-2 rounded-md border px-3 py-2">
              <span className="text-foreground text-[12px]">
                선택한 <b>{checked.size}개 반</b>의 재원생 <b>{selectedCount}명</b>에게 같은 리포트 카드를 발송할까요?
                {!sendEnabled ? " (실제 발송 OFF — 전송 안 됨)" : ""}
              </span>
              <Button size="sm" onClick={() => doSend(false)} disabled={busy}>
                {busy ? "발송 중…" : "발송 확인"}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirmSend(false)} disabled={busy}>
                취소
              </Button>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" onClick={tryOpenConfirm} disabled={busy}>
                ClassNote 발송 {selectedCount > 0 ? `(${selectedCount}명)` : ""}
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={busy || !body.trim()}
                onClick={() => doSend(true)}
                title="실 학부모에게 가지 않는 테스트 학생(학원이)에게만 발송해 봅니다"
              >
                테스트 발송(학원이)
              </Button>
              <span className="text-text-faint text-[12px]">발송 전 내용을 한 번 더 확인하세요 — 게시 후 회수는 발송 이력에서 요청</span>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
