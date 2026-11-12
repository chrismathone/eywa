"use client";

// 직접 작성·발송 — 관리자가 임의 학생을 골라 수업보고서를 작성해 ClassNote로 발송(강사 원스크린과 동일 포맷·레일).
// 발송 안전가드(dry-run·과목·동명이인·too_old)는 서버 액션(saveAndQueueAdminReport)이 최종 강제 — 여기선 안내·확인만.
import { HomeworkRateInput } from "@/features/onescreen/components/homework-rate-input";
import { homeworkRateClause } from "@/features/onescreen/homework-rate";
import { formatTestScore } from "@/features/onescreen/report-comment";
import { normalizeHomeworkPages } from "@/features/onescreen/homework-pages";
import { ATTITUDE, attitudeClause } from "@/features/onescreen/attitude";
import { useEffect, useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { useStateDraft } from "@/components/forms/use-state-draft";
import { DraftBanner } from "@/components/forms/draft-banner";
import { kstToday } from "@/lib/date-kst";
import { Button } from "@/components/ui/button";
import { EyIcon } from "@/components/icons/aywa-icons";
import { SearchableSelect, type ComboOption } from "@/components/ui/searchable-select";
import { generateReportComment } from "@/features/onescreen/server/actions";
import { ReportAttachments } from "@/features/onescreen/components/report-attachments";
import { computeClientMentSource } from "@/features/onescreen/ment-source";
import type { ReportCommentInput } from "@/features/onescreen/report-comment";
import {
  getAdminComposeContext,
  getAdminSendClassOptions,
  saveAdminReport,
  saveAndQueueAdminReport,
  type AdminComposeSubject,
  type AdminSaveReportInput,
} from "@/features/report-admin/server/compose-actions";
import { SendClassPicker, type SendClassOption } from "./send-class-picker";
import { defaultComposeSubject } from "@/features/report-admin/compose-default-subject";


const INPUT = "border-border bg-card text-foreground rounded-lg border px-2.5 py-1.5 text-sm w-full";
const LABEL = "text-text-dim text-xs font-medium";

export type ComposeStudent = { id: string; name: string; school: string | null; grade: string | null };

// 발송 결과(status) → 학부모/관리자용 한글 안내. raw enum 노출 금지(status-labels 원칙).
const SEND_MESSAGE: Record<string, { kind: "success" | "info" | "warn"; text: string }> = {
  // "곧 전송" 단정 금지 — 발송 허용 시간대(원장 설정) 밖이면 창 진입까지 대기하므로 시점을 약속하지 않는다(리뷰 확정).
  queued: { kind: "success", text: "발송 대기열에 올렸습니다 — 연동 PC가 자동으로 전송합니다(발송 허용 시간대 설정 시 그 시간에)." },
  dry_run: { kind: "info", text: "저장했습니다. 현재 실제 발송이 꺼져 있어 전송은 대기 상태입니다(원장 설정에서 켜야 전송)." },
  subject_off: { kind: "warn", text: "저장했지만 이 과목은 발송 대상이 아니라 전송하지 않았습니다(원장 설정의 발송 과목 확인)." },
  name_conflict: { kind: "warn", text: "동명이인이 있어 자동 발송을 막았습니다. 학생 구분 이름(classnote_name) 지정 후 다시 시도하세요." },
  absent: { kind: "warn", text: "저장했지만 그날 결석으로 기록된 학생이라 전송하지 않았습니다(출석부 확인)." },
  too_old: { kind: "warn", text: "저장했지만 너무 오래된 보고서라 전송하지 않았습니다." },
  revoked: { kind: "warn", text: "취소된 공유 링크입니다 — 재발급 후 발송하세요." },
  processing: { kind: "info", text: "이미 발송 처리 중인 보고서입니다." },
  // 이미 학부모에게 나간 글 — 다시 보내지 않는다. 저장 여부는 적지 않는다(보통은 저장 전에 걸러지고, 드물게 저장 뒤에 걸러진다).
  already_sent: { kind: "warn", text: "이미 발송된 보고서라 다시 보내지 않았습니다 — 학부모가 받은 글은 그대로입니다." },
};

export function ComposeFace({
  students,
  sendEnabled,
  showDailyTest = true,
  showCheckTest = true,
  showAttachments = true,
}: {
  students: ComposeStudent[];
  sendEnabled: boolean;
  showDailyTest?: boolean; // 일일테스트 사용(보고서 '표시 항목' 설정) — off면 입력칸 숨김
  showCheckTest?: boolean; // 확인테스트 사용 — off면 입력칸 숨김
  showAttachments?: boolean; // 사진/파일 첨부 표시 — off면 첨부해도 학부모/ClassNote에 안 실림(경고 표시)
}) {
  const router = useRouter();
  const [studentId, setStudentId] = useState("");
  const [ctx, setCtx] = useState<{
    student: { id: string; name: string; classnoteName: string | null };
    subjects: AdminComposeSubject[]; // 수강 과목
    sendableSubjects: AdminComposeSubject[]; // 발송가능 과목(수강 무관 폴백)
    nameCollision: boolean;
  } | null>(null);
  const [ctxPending, startCtx] = useTransition();

  const [reportDate, setReportDate] = useState(kstToday()); // 보고서 날짜(기본 오늘) — 카드 표시일·ClassNote 게시일
  const [subject, setSubject] = useState("");
  const [teacherName, setTeacherName] = useState("");
  const [progress, setProgress] = useState("");
  const [textbook, setTextbook] = useState("");
  const [makeup, setMakeup] = useState(false);
  const [dScore, setDScore] = useState("");
  const [dMax, setDMax] = useState("");
  const [cScore, setCScore] = useState("");
  const [cMax, setCMax] = useState("");
  const [attitude, setAttitude] = useState("");
  const [homework, setHomework] = useState("");
  const [homeworkToday, setHomeworkToday] = useState("");
  const [note, setNote] = useState("");
  const [body, setBody] = useState("");
  // 자동작성이 본문 칸에 마지막으로 넣은 텍스트(0214a 스냅샷) — 저장 시 body와 비교해 작성 방식 판정.
  const [autoBody, setAutoBody] = useState("");
  const [trend, setTrend] = useState("");
  // 자동작성이 추세 칸에 마지막으로 넣은 글 — '달라진 것 없음'이면 칸이 이 글 그대로일 때만 비운다(손으로 쓴 추세는 지킨다).
  //   로컬 초안에도 실어 복원 뒤에도 가른다(재리뷰 2026-10-16).
  const [autoTrend, setAutoTrend] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmSend, setConfirmSend] = useState(false);
  // 보낼 반(원장 2026-09-30) — 학생·과목·날짜·표시 강사가 정해지면 서버에 묻는다(반별 발송일 때만 화면에 뜬다).
  const [sendOpt, setSendOpt] = useState<SendClassOption | null>(null);
  const [sendOptPending, setSendOptPending] = useState(false);
  const [sendClassId, setSendClassId] = useState("");
  useEffect(() => {
    if (!studentId || !subject) return;
    let cancelled = false;
    const t = setTimeout(() => {
      setSendOptPending(true);
      void getAdminSendClassOptions({ studentId, reportDate, subject, teacherName: teacherName.trim() || undefined, makeup })
        .then((res) => {
          if (cancelled) return;
          const opt: SendClassOption | null = res.ok
            ? {
                applies: !!res.applies,
                needed: !!res.needed,
                reportClassName: res.reportClassName ?? null,
                candidates: res.candidates ?? [],
                defaultId: res.defaultId ?? null,
                blockedReason: res.blockedReason ?? null,
                requestable: !!res.requestable,
                viaMakeup: !!res.viaMakeup,
                deliveryOnly: !!res.deliveryOnly,
                makeupClassName: res.makeupClassName ?? null,
              }
            : null;
          setSendOpt(opt);
          // 기본값 = 메인 수업, 후보가 하나면 그 반(보이게 둔다).
          setSendClassId(opt?.needed ? (opt.defaultId ?? (opt.candidates.length === 1 ? opt.candidates[0]!.id : "")) : "");
        })
        .finally(() => {
          if (!cancelled) setSendOptPending(false);
        });
    }, 300); // 표시 강사명 타이핑마다 묻지 않게
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [studentId, subject, reportDate, teacherName, makeup]);
  // 반별 발송인데 보낼 반이 필요하면 — 고르지 않았거나 고를 반이 없으면 발송을 막는다(서버가 최종 게이트).
  // 🔴 막힌 까닭이 '배정 중·새 반·학부모 가입 대기'면 잠그지 않는다 — 발송을 눌러야 서버가 막으면서 그 반·학생의 동기화를 요청한다.
  const sendClassBlocked = !!sendOpt?.applies && sendOpt.needed && !sendOpt.requestable && (!sendOpt.candidates.length || !sendClassId);

  // 로컬 초안 자동저장 — 길게 쓴 본문·진도·특이사항을 새로고침/창닫기에서 지킨다(저장·발송 성공 시 삭제).
  // 학생 id·이름도 스냅샷에 담는다(리뷰 지적) — 본문은 그 학생 이야기라, 복구가 학생 선택까지 같이
  // 되돌리지 않으면 다른 학생 앞으로 어제 본문이 발송될 수 있다. 과목·강사는 pickStudent가 다시 채운다.
  const draftSnapshot = useMemo(
    () => ({
      studentId,
      studentName: ctx?.student.name ?? "",
      reportDate, progress, textbook, makeup, dScore, dMax, cScore, cMax, attitude, homework, homeworkToday, note, body, autoBody, trend, autoTrend,
    }),
    [studentId, ctx, reportDate, progress, textbook, makeup, dScore, dMax, cScore, cMax, attitude, homework, homeworkToday, note, body, autoBody, trend, autoTrend],
  );
  const localDraft = useStateDraft({
    scope: "report-compose",
    snapshot: draftSnapshot,
    hasContent: (s) =>
      s.progress.trim() !== "" || s.homeworkToday.trim() !== "" || s.note.trim() !== "" ||
      s.body.trim() !== "" || s.trend.trim() !== "",
  });

  function restoreComposeDraft() {
    const d = localDraft.restore();
    if (!d) return;
    // 학생까지 함께 복원 — 입력칸은 ctx가 있어야 보이므로 학생 재선택(서버 컨텍스트 재조회)이 먼저다.
    // 학생이 그 사이 사라졌으면(퇴원 등) pickStudent가 토스트로 알리고 입력칸은 열리지 않는다.
    if (d.studentId) pickStudent(d.studentId);
    setReportDate(d.reportDate || kstToday());
    setProgress(d.progress);
    setTextbook(d.textbook);
    setMakeup(d.makeup);
    // 설정에서 끈 테스트 칸의 점수는 복원하지 않는다 — 숨은 칸의 값이 buildInput으로 새는 것 방지.
    if (showDailyTest) {
      setDScore(d.dScore);
      setDMax(d.dMax);
    }
    if (showCheckTest) {
      setCScore(d.cScore);
      setCMax(d.cMax);
    }
    setAttitude(d.attitude);
    setHomework(d.homework);
    setHomeworkToday(d.homeworkToday);
    setNote(d.note);
    setBody(d.body);
    setAutoBody(d.autoBody);
    setTrend(d.trend);
    setAutoTrend(d.autoTrend ?? "");
  }

  const studentOptions: ComboOption[] = students.map((s) => ({
    value: s.id,
    label: s.name,
    hint: [s.school, s.grade].filter(Boolean).join(" · ") || undefined,
  }));
  // 선택 과목 메타 — 수강 과목 + 발송가능 폴백 둘 다에서 찾는다.
  const curSubject = ctx ? [...ctx.subjects, ...ctx.sendableSubjects].find((s) => s.key === subject) ?? null : null;
  // 과목 옵션 = 수강 중인 발송가능 과목이 있으면 그걸(담당 강사 표시), 없으면 학원 발송과목(폴백)으로.
  const hasEnrolledSendable = !!ctx && ctx.subjects.some((s) => s.sendable);
  const subjectOptions: AdminComposeSubject[] = ctx ? (hasEnrolledSendable ? ctx.subjects : ctx.sendableSubjects) : [];
  const noSendableSubject = !!ctx && subjectOptions.length === 0; // 학원설정에 발송 과목 자체가 없음

  function pickStudent(id: string) {
    setStudentId(id);
    setCtx(null);
    setSubject("");
    setTeacherName(""); // 과목을 못 정한 학생(두 과목 수강)에서 직전 학생의 강사명이 칸에 남지 않게 — 과목을 고르면 다시 채운다
    setSendOpt(null);
    setSendClassId("");
    setConfirmSend(false);
    if (!id) return;
    startCtx(async () => {
      const res = await getAdminComposeContext(id);
      if (!res.ok || !res.student) {
        toast.error(res.error ?? "학생 정보를 불러오지 못했습니다");
        return;
      }
      const fallback = res.sendableSubjects ?? [];
      setCtx({ student: res.student, subjects: res.subjects ?? [], sendableSubjects: fallback, nameCollision: !!res.nameCollision });
      // 자동 선택은 **고를 것이 하나뿐일 때만** — 두 과목을 다 듣는 학생을 '첫 번째 과목'으로 잡으면 수학 보고서가
      // 영어 알림장으로 나간다(교재 발송에서 실제로 난 사고와 같은 모양, compose-default-subject.ts).
      const first = defaultComposeSubject(res.subjects ?? [], fallback);
      if (first) {
        setSubject(first.key);
        setTeacherName(first.teacherName ?? "");
      }
    });
  }

  function pickSubject(s: AdminComposeSubject) {
    setSubject(s.key);
    setTeacherName(s.teacherName ?? "");
    setConfirmSend(false);
  }

  // 표기는 원스크린과 **같은 순수함수**(report-comment.ts) — 여기서 문자열을 따로 만들면 같은 학원에서
  // 화면마다 다른 문장이 학부모에게 나간다. 만점 미입력분만 옛 표기("?문제 중")로 남긴다.
  function testStr(score: string, max: string): string {
    if (!score.trim()) return "";
    const n = Number(score.trim());
    const m = Number(max.trim());
    if (!Number.isFinite(n) || !Number.isFinite(m) || !max.trim()) return `${max.trim() || "?"}문제 중 ${score.trim()}개 맞음`;
    return formatTestScore(n, m);
  }
  // 저장되는 시험 칸(exam_info) 표기 — 추세 재료도 이 표기여야 한다(이력과 만점 묶음을 맞춘다, trend-comment.ts scaleKey).
  function examInfoStr(): string {
    return [
      dScore.trim() && dMax.trim() ? `일일 ${dScore.trim()}/${dMax.trim()}` : "",
      cScore.trim() && cMax.trim() ? `확인 ${cScore.trim()}/${cMax.trim()}` : "",
    ]
      .filter(Boolean)
      .join(", ");
  }
  function buildInput(): AdminSaveReportInput {
    const dailyTest = testStr(dScore, dMax);
    const checkTest = testStr(cScore, cMax);
    const examInfo = examInfoStr();
    return {
      studentId,
      reportDate, // 보고서 날짜(빈값 없음 — 기본 오늘) — 서버가 미래는 오늘로 클램프
      subject,
      teacherName: teacherName.trim() || undefined,
      textbook: textbook.trim() || undefined,
      makeup,
      homeworkToday: normalizeHomeworkPages(homeworkToday.trim()) || undefined,
      progress: progress.trim(),
      examInfo,
      homeworkScore: homework,
      notes: body.trim(),
      dailyTest,
      checkTest,
      attitude: attitude || undefined,
      trendNote: trend.trim() || undefined,
      // 멘트 작성 방식(0214a) — 자동작성 스냅샷과 비교(서버가 기존 라벨과 합쳐 최종 확정).
      mentSource: computeClientMentSource(body, autoBody),
      // 보낼 반(원장 2026-09-30) — 반별 발송에서 보고서 반에 반 보드가 없을 때만. 서버가 후보 안인지 다시 확인한다.
      classnoteClassId: sendOpt?.applies && sendOpt.needed && !sendOpt.deliveryOnly && sendClassId ? sendClassId : null,
      deliveryClassId: sendOpt?.applies && sendOpt.needed && sendOpt.deliveryOnly && sendClassId ? sendClassId : null,
    };
  }

  async function autoWrite() {
    if (!ctx || !curSubject) return;
    setAiBusy(true);
    const input: ReportCommentInput = {
      studentName: ctx.student.name,
      subject: curSubject.label,
      progress: progress.trim(),
      dailyTest: testStr(dScore, dMax),
      checkTest: testStr(cScore, cMax),
      attitude,
      homework,
      homeworkToday: normalizeHomeworkPages(homeworkToday.trim()),
      textbook: textbook.trim(),
      specialNote: note.trim(),
    };
    const res = await generateReportComment(
      input,
      {
        studentId,
        subject,
        todayExamInfo: examInfoStr(), // 저장 표기("일일 4/5") — 화면 문장 표기를 넘기면 이력과 만점 묶음이 갈린다
        todayHomework: homework,
        date: reportDate, // 보고서 날짜 — 과거 날짜면 추세를 그 날짜 기준으로(이후 채점 이력 있으면 추세 생략)
        // 반을 모르는 화면 — 저장과 같은 규칙(보강 여부와 무관하게 resolveReportClassId)으로 서버가 반을 정해 시험은 그 반 기록만
        // (원장 2026-10-15). 정규 수업이 없는 날이면 반을 못 정해 종전대로 둔다.
        resolveClass: { teacherName: teacherName.trim() || null },
      },
      // 대리작성 — 다른 강사 이름으로 나가는 보고서라 호출자(사무실·겸직 관리자)의 말투 프로파일(0262a)을 붙이지 않는다.
      { teacherStyle: false },
    );
    setAiBusy(false);
    if (res.ok && res.comment) {
      setBody(res.comment);
      setAutoBody(res.comment); // 작성 방식 스냅샷(0214a)
      if (res.trend) {
        setTrend(res.trend);
        setAutoTrend(res.trend);
      } else if (res.trendDropped) setTrend(""); // 만들었지만 검사에 걸려 버렸다 — 예전 초안이 나가지 않게
      // 달라진 게 없다 — 칸이 지난 자동작성 글 그대로일 때만 비운다(손으로 쓴 추세는 지킨다, 적대적 재리뷰 2026-10-16).
      else if (res.trendQuiet && trend === autoTrend) setTrend("");
      toast.success("AI가 본문을 작성했습니다 — 검토 후 발송하세요");
    } else {
      // 폴백: 사실 기반 간단 문장(빈 본문 방지). 템플릿도 "자동이 넣은 텍스트"다(0214a 스냅샷 동일 취급).
      const parts = [
        progress.trim() ? `오늘 ${curSubject.label} ${progress.trim()} 진행했습니다.` : "",
        attitude ? `수업 태도는 ${attitudeClause(attitude)}.` : "",
        homework ? `지난 과제는 ${homeworkRateClause(homework)}.` : "",
      ].filter(Boolean);
      const fallback = parts.join(" ") || `오늘 ${curSubject.label} 수업을 진행했습니다.`;
      setBody(fallback);
      setAutoBody(fallback);
      toast.message("AI 생성에 실패해 기본 문구를 넣었습니다 — 직접 수정하세요");
    }
  }

  // 발송 확인창 열기 전 검증 — 막히면 조용히 넘어가지 않고 이유를 토스트로 알린다.
  function tryOpenConfirm() {
    if (!studentId) return;
    if (!subject) {
      toast.error(
        noSendableSubject
          ? "발송 가능한 과목이 없습니다 — 원장 설정 > 수업보고서 > 발송 과목(수학·영어)을 먼저 지정하세요"
          : "발송할 과목을 먼저 선택하세요",
      );
      return;
    }
    if (!body.trim()) {
      toast.error("학부모 보고서 본문을 작성한 뒤 발송하세요");
      return;
    }
    if (sendClassBlocked) {
      toast.error(sendOpt?.candidates.length ? "보낼 반을 먼저 고르세요" : (sendOpt?.blockedReason ?? "보낼 반이 없어 발송할 수 없습니다"));
      return;
    }
    setConfirmSend(true);
  }

  async function doSave() {
    if (!studentId) return;
    if (!subject) {
      toast.error(noSendableSubject ? "발송 가능한 과목이 없어 저장할 수 없습니다" : "저장할 과목을 선택하세요");
      return;
    }
    setBusy(true);
    const res = await saveAdminReport(buildInput());
    setBusy(false);
    if (res.ok) {
      localDraft.clear();
      toast.success("저장했습니다 (발송 안 함)");
    } else toast.error(res.error ?? "저장에 실패했습니다");
  }

  // 첨부 전 보고서 행 보장 — 현재 폼으로 저장(멱등 upsert). attachments 컬럼은 안 건드려 기존 첨부 보존.
  async function ensureSavedForAttach(): Promise<boolean> {
    if (!studentId || !subject) {
      toast.error("학생과 과목을 먼저 선택하세요");
      return false;
    }
    const res = await saveAdminReport(buildInput());
    if (!res.ok) {
      toast.error(res.error ?? "보고서 저장에 실패했습니다");
      return false;
    }
    localDraft.clear();
    return true;
  }

  async function doSend() {
    if (!body.trim()) {
      toast.error("본문을 작성한 뒤 발송하세요");
      return;
    }
    setBusy(true);
    const res = await saveAndQueueAdminReport(buildInput());
    setBusy(false);
    setConfirmSend(false);
    if (!res.ok) {
      // 서버가 보낼 반을 다시 물으면(후보가 바뀜 등) 목록을 새로 채운다 — 저장은 이미 됐다.
      if (res.status === "needs_class" && res.candidates?.length && sendOpt) {
        setSendOpt({
          ...sendOpt,
          needed: true,
          viaMakeup: false,
          candidates: res.candidates,
          defaultId: res.defaultClassId ?? null,
          makeupClassName: res.makeupClassName ?? null,
          deliveryOnly: !!res.deliveryOnly,
          blockedReason: null,
          requestable: false, // 이제 반을 골라야 한다 — 잠금 해제 값이 남아 반 없이 열리지 않게
        });
        setSendClassId(res.defaultClassId && res.candidates.some((c) => c.id === res.defaultClassId) ? res.defaultClassId : "");
      }
      toast.error(res.error ?? "발송에 실패했습니다");
      return;
    }
    localDraft.clear();
    const msg = res.status ? SEND_MESSAGE[res.status] : undefined;
    if (msg?.kind === "success") toast.success(msg.text);
    else if (msg?.kind === "warn") toast.warning(msg.text);
    else toast.message(msg?.text ?? "처리했습니다");
    router.refresh(); // 상단 발송 큐 카드 갱신
  }

  return (
    <section className="bg-card border-line shadow-card space-y-4 rounded-2xl border px-5 py-4">
      <DraftBanner
        savedAt={localDraft.draftSavedAt}
        onRestore={restoreComposeDraft}
        onDiscard={localDraft.discard}
      />
      <div>
        <h2 className="text-foreground text-base font-bold">직접 작성·발송</h2>
        <p className="text-text-faint text-xs">
          학생을 선택해 수업보고서를 작성하고 ClassNote로 발송합니다(강사 원스크린과 동일 형식). 담당 반이 아니어도 발송할 수 있어요.
        </p>
      </div>

      {!sendEnabled ? (
        <p className="border-line bg-bg-soft text-text-dim rounded-md border px-3 py-2 text-xs">
          현재 <b>실제 발송이 꺼져</b> 있어 저장만 됩니다(dry-run). 학부모에게 전송하려면 원장 설정의 <b>ClassNote 실제 발송</b>을 켜야 합니다.
        </p>
      ) : null}

      {/* 학생 + 보고서 날짜 선택 */}
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1 sm:max-w-sm">
          <div className={LABEL}>학생</div>
          <SearchableSelect
            options={studentOptions}
            value={studentId}
            onValueChange={pickStudent}
            placeholder="학생 선택…"
            searchPlaceholder="이름 검색…"
            ariaLabel="학생 선택"
          />
        </div>
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
            <p className="text-amber mt-0.5 text-xs">과거 날짜로 발송 — 카드·ClassNote 게시일이 이 날짜가 됩니다</p>
          ) : null}
        </div>
      </div>

      {ctxPending ? <p className="text-text-faint text-xs">학생 정보를 불러오는 중…</p> : null}

      {ctx ? (
        <div className="space-y-4">
          {ctx.nameCollision ? (
            <p className="border-amber/40 bg-amber/10 text-amber flex items-start gap-1.5 rounded-md border px-3 py-2 text-xs">
              <EyIcon name="alert" size={14} className="mt-0.5 shrink-0" />
              <span>같은 이름의 학생이 또 있어 <b>자동 발송이 차단</b>됩니다(오발송 방지). 학생 구분 이름(classnote_name)을 지정한 뒤 발송하세요.</span>
            </p>
          ) : null}

          {/* 과목 */}
          <div>
            <div className={LABEL}>과목</div>
            {noSendableSubject ? (
              <p className="border-amber/40 bg-amber/10 text-amber rounded-md border px-3 py-2 text-xs">
                발송 가능한 과목이 없습니다 — 원장 설정 &gt; 수업보고서 &gt; <b>발송 과목</b>(수학·영어)을 먼저 지정해야 발송할 수 있어요.
              </p>
            ) : (
              <>
                {!hasEnrolledSendable ? (
                  <p className="text-text-dim mb-1.5 text-xs">
                    이 학생은 발송 과목(수학·영어)에 <b>수강 중이 아니에요</b> — 아래에서 골라 직접 발송할 수 있어요.
                  </p>
                ) : null}
                <div className="flex flex-wrap gap-1.5">
                  {subjectOptions.map((s) => (
                    <button
                      key={s.key}
                      type="button"
                      onClick={() => pickSubject(s)}
                      className={`rounded-full border px-3 py-1 text-xs ${
                        subject === s.key ? "border-primary bg-primary/10 text-primary font-bold" : "border-line text-text-dim"
                      }`}
                      title={s.sendable ? undefined : "발송 대상 과목이 아닙니다(저장만 됩니다)"}
                    >
                      {s.label}
                      {!s.sendable ? " · 발송불가" : ""}
                    </button>
                  ))}
                </div>
              </>
            )}
            {/* 반별 발송이면 1인 보드 이름 대신 보낼 반을 보여 준다(원장 2026-09-30). */}
            {curSubject?.board && !sendOpt?.applies ? (
              <p className="text-text-faint mt-1 text-xs">
                발송 보드: <b className="text-text-dim">{curSubject.board}</b>
              </p>
            ) : null}
            {subject ? (
              <div className="mt-1.5">
                <SendClassPicker option={sendOpt} pending={sendOptPending} value={sendClassId} onChange={setSendClassId} />
              </div>
            ) : null}
          </div>

          {/* 표시 강사명 + 진도/교재 */}
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <div className={LABEL}>표시 강사명</div>
              <input value={teacherName} onChange={(e) => setTeacherName(e.target.value)} placeholder="담당 강사" className={INPUT} />
            </div>
            <div>
              <div className={LABEL}>교재</div>
              <input value={textbook} onChange={(e) => setTextbook(e.target.value)} placeholder="교재명" className={INPUT} />
            </div>
            <div className="sm:col-span-2">
              <div className={LABEL}>오늘 진도</div>
              <input value={progress} onChange={(e) => setProgress(e.target.value)} placeholder="예: 수학 1-2 · p.44" className={INPUT} />
            </div>
          </div>

          {/* 점수 — 보고서 '표시 항목'에서 끈 테스트는 입력칸도 숨긴다(원스크린과 동일 게이팅). */}
          {showDailyTest || showCheckTest ? (
            <div className="grid gap-3 sm:grid-cols-2">
              {showDailyTest ? (
                <div>
                  <div className={LABEL}>일일 테스트 (점수 / 만점)</div>
                  <div className="flex items-center gap-1.5">
                    <input value={dScore} onChange={(e) => setDScore(e.target.value)} placeholder="점수" inputMode="numeric" className={INPUT} />
                    <span className="text-text-faint">/</span>
                    <input value={dMax} onChange={(e) => setDMax(e.target.value)} placeholder="만점" inputMode="numeric" className={INPUT} />
                  </div>
                </div>
              ) : null}
              {showCheckTest ? (
                <div>
                  <div className={LABEL}>확인 테스트 (점수 / 만점)</div>
                  <div className="flex items-center gap-1.5">
                    <input value={cScore} onChange={(e) => setCScore(e.target.value)} placeholder="점수" inputMode="numeric" className={INPUT} />
                    <span className="text-text-faint">/</span>
                    <input value={cMax} onChange={(e) => setCMax(e.target.value)} placeholder="만점" inputMode="numeric" className={INPUT} />
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}

          {/* 태도 / 과제 */}
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <div className={LABEL}>수업 태도</div>
              <div className="flex flex-wrap gap-1.5">
                {ATTITUDE.map((a) => (
                  <button key={a} type="button" onClick={() => setAttitude(attitude === a ? "" : a)} className={`rounded-full border px-2.5 py-1 text-xs ${attitude === a ? "border-primary bg-primary/10 text-primary font-bold" : "border-line text-text-dim"}`}>
                    {a}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <div className={LABEL}>과제 수행률</div>
              <div className="flex flex-wrap items-center gap-2">
                <HomeworkRateInput value={homework} onChange={setHomework} label="과제 수행률" size="lg" />
                <label className="text-text-dim ml-1 inline-flex items-center gap-1 text-xs">
                  <input type="checkbox" checked={makeup} onChange={(e) => setMakeup(e.target.checked)} /> 보강
                </label>
              </div>
            </div>
            <div className="sm:col-span-2">
              <div className={LABEL}>오늘 과제</div>
              <input value={homeworkToday} onChange={(e) => setHomeworkToday(e.target.value)} placeholder="예: 워크북 p.20~22" className={INPUT} />
            </div>
            <div className="sm:col-span-2">
              <div className={LABEL}>특이사항(메모)</div>
              <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="AI 본문 작성에 참고됩니다" className={INPUT} />
            </div>
          </div>

          {/* 본문 */}
          <div>
            <div className="mb-1 flex items-center justify-between">
              <div className={LABEL}>학부모 보고서 본문</div>
              <Button size="sm" variant="outline" onClick={autoWrite} disabled={aiBusy || !subject}>
                {aiBusy ? "작성 중…" : "AI 자동 작성"}
              </Button>
            </div>
            <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={5} placeholder="학부모에게 보낼 보고서 본문" className={`${INPUT} resize-y`} />
          </div>
          <div>
            <div className={LABEL}>학습 추세(선택)</div>
            <textarea value={trend} onChange={(e) => setTrend(e.target.value)} rows={2} placeholder="종합 추세 코멘트(선택)" className={`${INPUT} resize-y`} />
          </div>

          {/* 사진/파일 첨부 — 저장된 행에만(첫 첨부 시 자동 저장). /r·ClassNote에 함께 실림. 과목 선택 시 노출. */}
          {subject ? (
            <div>
              <div className={`${LABEL} mb-1`}>사진/파일 첨부</div>
              <ReportAttachments
                studentId={studentId}
                subject={subject}
                reportDate={reportDate}
                hiddenFromParents={!showAttachments}
                ensureSaved={ensureSavedForAttach}
                onChanged={() => router.refresh()}
              />
            </div>
          ) : null}

          {/* 액션 */}
          {confirmSend ? (
            <div className="border-primary/40 bg-primary/5 flex flex-wrap items-center gap-2 rounded-md border px-3 py-2">
              <span className="text-foreground text-xs">
                <b>{ctx.student.name}</b>
                {sendOpt?.applies
                  ? <> · 반 <b>{sendOpt.needed && !sendOpt.requestable ? (sendOpt.candidates.find((c) => c.id === sendClassId)?.name ?? "—") : (sendOpt.reportClassName ?? "보고서의 반")}</b></>
                  : curSubject?.board ? <> · 보드 <b>{curSubject.board}</b></> : null} 에게 발송할까요?
                {!sendEnabled ? " (실제 발송 OFF — 저장만 됨)" : ""}
              </span>
              <Button size="sm" onClick={doSend} disabled={busy}>
                {busy ? "발송 중…" : "발송 확인"}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirmSend(false)} disabled={busy}>
                취소
              </Button>
            </div>
          ) : (
            <div className="space-y-1.5">
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" onClick={doSave} disabled={busy}>
                  저장만
                </Button>
                <Button size="sm" onClick={tryOpenConfirm} disabled={busy || sendClassBlocked}>
                  ClassNote 발송
                </Button>
              </div>
              {!subject ? (
                <p className="text-amber text-xs">
                  {noSendableSubject
                    ? "발송 가능한 과목이 없어 발송할 수 없습니다 — 원장 설정에서 발송 과목을 지정하세요."
                    : "발송할 과목을 먼저 선택하세요."}
                </p>
              ) : null}
            </div>
          )}
        </div>
      ) : null}
    </section>
  );
}
