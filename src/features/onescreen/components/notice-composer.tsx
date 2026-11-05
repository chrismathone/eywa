"use client";

// 원스크린 학부모 공지 컴포저 — 선택 학생(카드=1명 seed) 또는 표에서 넘어온 학생들에게 ClassNote 개별 보드로
// **독립 공지**를 발송(classnote_notices). 보고서와 별개 글이라 누적·공존. 게시는 연동 PC 워커가 순차 처리.
// 공통·개별 내용의 이름 태그는 서버에서 학생별로 치환한다. 대기(미게시) 공지는 여기서 수정/삭제.
//
// 🔴 공지 방식은 둘이다(원장 2026-10-02 *"반인지 개별인지를 선택하는 토글"*):
//    · 원생 개별 공지 = 학생마다 1:1 알림장(이 파일 — 수학은 반 보드의 그 학생 원아에게, 그 밖은 1인 보드).
//    · 반 공지 = ClassNote 공지사항으로 반에 1건(notice-class-composer.tsx — 그 반 학부모 모두가 본다).
//    두 방식은 **큐도 워커도 다르다**(classnote_notices / classnote_class_notices) — 한 화면에서 섞어 보내지 않는다.
//    반 공지를 보낼 수 있는 반(ClassNote 반 보드가 연결된 담당 반)이 없으면 토글 자체를 보이지 않는다.
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { EyIcon } from "@/components/icons/aywa-icons";
import { schoolGradeLabel } from "@/lib/format/school-grade";
import {
  sendOnescreenNotice,
  listMyOnescreenNotices,
  listMyNoticeStudents,
  editQueuedNotice,
  editPostedNotice,
  deleteQueuedNotice,
  cancelOnescreenNotice,
  type NoticeStudent,
  type OnescreenNoticeRow,
} from "../server/notice-actions";
import { NoticeHistory, NoticeHistoryItem } from "./notice-history";
import { NoticeAttachmentPicker } from "./notice-attachment-picker";
import { NOTICE_TAG_PARAMS, NoticeTemplateHelp } from "./notice-template-help";
import { hasNoticeTemplateTags } from "../notice-template";
import { NoticeClassComposer, type ClassNoticeTarget } from "./notice-class-composer";
import { loadMyClassWideNotice } from "@/features/report-admin/server/class-notice-actions";
import type { ClassNoticeRow } from "@/features/report-admin/class-notice";
import type { NoticeSkip } from "@/features/report-admin/notice-targets";

/** 제외 사유 → 사전 키(한·영 한 벌 — raw 코드 노출 금지). */
const SKIP_KEY: Record<NoticeSkip["reason"], SheetDictKey> = {
  subject_off: "os.n.skip.subject_off",
  name_collision: "os.n.skip.name_collision",
  no_name: "os.n.skip.no_name",
  no_class_board: "os.n.skip.no_class_board",
  not_my_class: "os.n.skip.not_my_class",
  not_started: "os.n.skip.not_started",
  on_hold: "os.n.skip.on_hold",
};
import type { NoticeAttachment } from "../notice-attachments";
import type { OneScreenStudent } from "../types";
import { useSheetT, useSheetTf } from "@/features/teacher-view/lang-context";
import type { SheetDictKey } from "@/features/teacher-view/i18n";

const BODY = "border-line bg-card text-foreground block rounded-lg border px-3 py-2 text-sm w-full resize-y";

/** 대상 후보 — '오늘 수업'(로스터)과 '내 담당 전체'(서버 조회)를 한 모양으로 다룬다. */
type Candidate = NoticeStudent;

/** 대상 범위 — 기본은 오늘(카드/표에서 넘어온 선택을 그대로 살림), '전체'는 요일과 무관한 담당 학생 전원. */
type Scope = "today" | "all";

/**
 * classnote_notices.status → **사전 키** + 색(원문 노출 금지).
 * 🔴 한·영 표를 두 벌로 나누지 않는다 — 상태가 늘 때 한쪽만 채워져 raw enum이 샌다.
 *    키를 그대로 그리면 화면에 `os.n.st.…`가 뜨므로 소비처가 반드시 `t()`를 지난다.
 */
function statusLabel(s: string): { key: SheetDictKey | null; raw: string; cls: string } {
  switch (s) {
    case "queued":
      return { key: "os.n.st.queued", raw: s, cls: "text-text-dim" };
    case "processing":
      return { key: "os.n.st.processing", raw: s, cls: "text-text-dim" };
    case "success":
      return { key: "os.n.st.success", raw: s, cls: "text-green" };
    case "partial":
      return { key: "os.n.st.partial", raw: s, cls: "text-amber" };
    case "failed":
      return { key: "os.n.st.failed", raw: s, cls: "text-danger" };
    case "revoke_requested":
      return { key: "os.n.st.revokeRequested", raw: s, cls: "text-text-dim" };
    case "revoking":
      return { key: "os.n.st.revoking", raw: s, cls: "text-text-dim" };
    case "edit_requested":
      return { key: "os.n.st.editRequested", raw: s, cls: "text-text-dim" };
    case "editing":
      return { key: "os.n.st.editing", raw: s, cls: "text-text-dim" };
    case "revoked":
      return { key: "os.n.st.revoked", raw: s, cls: "text-danger" };
    case "revoke_partial":
      return { key: "os.n.st.revokePartial", raw: s, cls: "text-amber" };
    default:
      return { key: null, raw: s, cls: "text-text-faint" };
  }
}

export function NoticeComposer({
  students,
  seedStudentIds,
  sendEnabled,
  onSent,
}: {
  students: OneScreenStudent[]; // 현재 반 필터로 보이는 학생(대상 후보)
  seedStudentIds: string[] | null; // 카드/표에서 넘어온 초기 선택(없으면 빈 선택)
  sendEnabled: boolean; // ClassNote 실제 발송 스위치(off면 dry-run 안내)
  onSent?: () => void;
}) {
  const [checked, setChecked] = useState<Set<string>>(() => new Set(seedStudentIds ?? []));
  const [body, setBody] = useState(""); // 공통 내용
  const [individual, setIndividual] = useState<Record<string, string>>({}); // studentId → 개별 내용(공통 뒤 덧붙임)
  const [showIndividual, setShowIndividual] = useState(false); // 개별 내용 섹션 펼침
  const [busy, setBusy] = useState(false);
  const t = useSheetT();
  const tf = useSheetTf();
  const [confirmSend, setConfirmSend] = useState(false);
  const [rows, setRows] = useState<OnescreenNoticeRow[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editBody, setEditBody] = useState("");
  const [scope, setScope] = useState<Scope>("today");
  const [allStudents, setAllStudents] = useState<Candidate[] | null>(null); // 담당 전체(한 번 받아 캐시)
  // 관리자뷰는 담당 반 개념이 없어 실제로 학원 전체가 담긴다 — 라벨이 거짓말하지 않게 서버가 알려준 범위를 쓴다.
  const [allLabel, setAllLabel] = useState(t("os.n.scopeMine"));
  const [loadingAll, setLoadingAll] = useState(false);
  const [atts, setAtts] = useState<NoticeAttachment[]>([]); // 전원 공통 이미지
  const [uploading, setUploading] = useState(false);
  // 공지 방식 — 기본은 원생 개별(지금까지의 화면). 반 공지 재료(보낼 수 있는 반)는 한 번 받아 두고, 반이 있을 때만 토글을 보인다.
  const [mode, setMode] = useState<"each" | "class">("each");
  // 마지막 발송에서 제외된 학생(누가·왜) — 토스트의 수만으로는 다시 보낼 수 없어 화면에 남긴다. 다음 발송 때 갈아 끼운다.
  const [lastSkipped, setLastSkipped] = useState<NoticeSkip[]>([]);
  const [classWide, setClassWide] = useState<{ classes: ClassNoticeTarget[]; rows: ClassNoticeRow[] } | null>(null);
  // seed 초기 선택은 useState 초기화로만 반영 — 진입 시 부모가 key로 remount해 새 seed를 적용(effect 동기 setState 회피).

  async function refreshHistory() {
    const res = await listMyOnescreenNotices();
    if (res.ok && res.rows) setRows(res.rows);
  }
  // 최초 1회 이력 로드 — setState는 await 뒤(가드) async IIFE로(effect 동기 setState 금지 규칙).
  useEffect(() => {
    let cancelled = false;
    // 이력을 먼저 그린다 — 반 공지 재료는 따로 받아(실패해도·늦어도) 이력 표시를 붙잡지 않는다.
    void (async () => {
      const res = await listMyOnescreenNotices();
      if (!cancelled && res.ok && res.rows) setRows(res.rows);
    })();
    void (async () => {
      const cw = await loadMyClassWideNotice().catch(() => null);
      if (!cancelled && cw?.ok && cw.classes?.length) setClassWide({ classes: cw.classes, rows: cw.rows ?? [] });
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // ⚠️ setChecked 업데이터는 순수해야 함 — setConfirmSend를 updater 안에서 부르면 React 19에서 토글이 먹통(선택 안 됨).
  const toggle = (id: string) => {
    setChecked((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
    setConfirmSend(false);
  };

  // 오늘 로스터 학생 → 후보 모양으로 정규화(과목 = 첫 과목, 보드 prefix 결정).
  const todayCandidates: Candidate[] = students.map((s) => ({
    id: s.id,
    name: s.name,
    grade: s.grade,
    className: s.className ?? "",
    subject: s.subjects[0]?.subjectKey ?? s.subjects[0]?.name ?? null,
    classId: s.classId,
  }));
  const candidates: Candidate[] = scope === "all" ? (allStudents ?? []) : todayCandidates;

  // 범위 전환 — '전체'는 서버에서 한 번 받아 캐시. 선택은 유지하되 후보에 없는 id는 발송에서 자동으로 빠진다.
  async function switchScope(next: Scope) {
    setScope(next);
    setConfirmSend(false);
    if (next !== "all" || allStudents || loadingAll) return;
    setLoadingAll(true);
    const res = await listMyNoticeStudents();
    setLoadingAll(false);
    if (!res.ok) {
      toast.error(res.error ?? t("os.n.loadFail"));
      setScope("today");
      return;
    }
    if (res.scope === "tenant") setAllLabel(t("os.n.scopeTenant"));
    setAllStudents(res.students ?? []);
  }

  // 전체 선택/해제 — **현재 보이는 후보에만** 적용(다른 범위에서 고른 선택을 조용히 날리지 않는다).
  const allChecked = candidates.length > 0 && candidates.every((c) => checked.has(c.id));
  function toggleAll() {
    setChecked((prev) => {
      const n = new Set(prev);
      for (const c of candidates) {
        if (allChecked) n.delete(c.id);
        else n.add(c.id);
      }
      return n;
    });
    setConfirmSend(false);
  }

  // 선택 학생 → (학생, 과목, 개별내용) — 과목이 보드 prefix 결정. 학생당 1건으로 보드 중복 방지.
  function buildTargets() {
    return candidates
      .filter((s) => checked.has(s.id))
      .map((s) => ({
        studentId: s.id,
        subject: s.subject,
        classId: s.classId ?? null,
        individualBody: individual[s.id]?.trim() || undefined,
      }));
  }

  async function doSend(test: boolean) {
    if (!body.trim()) {
      toast.error(t("os.n.needBody"));
      return;
    }
    const targets = test ? [] : buildTargets();
    if (!test && targets.length === 0) {
      toast.error(t("os.n.needTargets"));
      return;
    }
    setBusy(true);
    const res = await sendOnescreenNotice({
      body: body.trim(),
      students: targets,
      test,
      ...(atts.length ? { attachments: atts } : {}),
    });
    setBusy(false);
    setConfirmSend(false);
    // 제외된 학생은 성공·실패와 무관하게 남긴다("발송 가능한 학생이 없습니다"만 뜨면 왜인지 알 수 없다).
    setLastSkipped(res.skipped ?? []);
    if (!res.ok) {
      toast.error(res.error ?? t("os.n.sendFail"));
      return;
    }
    if (res.dryRun) {
      toast.message(
        tf("os.n.dryRun", { n: res.queued ?? 0 }),
      );
      return;
    }
    const skip = res.skipped?.length ?? 0;
    (res.queued ? toast.success : toast.message)(
      tf("os.n.queued", { n: res.queued ?? 0 }) + (skip ? tf("os.n.queuedSkip", { n: skip }) : ""),
    );
    if (!test) {
      setBody("");
      setChecked(new Set());
      setIndividual({});
      setShowIndividual(false);
      setAtts([]);
      void refreshHistory();
      // 🔴 제외된 학생이 있으면 부모에게 '끝났다'를 알리지 않는다 — 부모가 화면을 새로 그려(seed 초기화) 방금 띄운 제외 목록이 사라진다.
      if (!(res.skipped?.length)) onSent?.();
    } else {
      void refreshHistory();
    }
  }

  // 대기건=editQueuedNotice(발송 전 본문 교체), 게시건=editPostedNotice(연동 PC가 게시글 PATCH). 상태로 라우팅.
  async function saveEdit(row: OnescreenNoticeRow) {
    const posted = row.status !== "queued";
    const res = posted ? await editPostedNotice(row.id, editBody) : await editQueuedNotice(row.id, editBody);
    if (!res.ok) {
      toast.error(res.error ?? t("os.n.editFail"));
      if (res.reason === "already_sent") void refreshHistory();
      return;
    }
    toast.success(posted ? t("os.n.editedPosted") : t("os.n.edited"));
    setEditingId(null);
    void refreshHistory();
  }

  async function del(id: string) {
    if (!window.confirm(t("os.n.delConfirm"))) return;
    const res = await deleteQueuedNotice(id);
    if (!res.ok) {
      toast.error(res.error ?? t("os.n.delFail"));
      if (res.reason === "already_sent") void refreshHistory();
      return;
    }
    toast.success(t("os.n.deleted"));
    void refreshHistory();
  }

  async function revoke(id: string) {
    if (!window.confirm(t("os.n.revokeConfirm"))) return;
    const res = await cancelOnescreenNotice(id);
    if (!res.ok) {
      toast.error(res.error ?? t("os.n.revokeFail"));
      return;
    }
    toast.success(t("os.n.revoked"));
    void refreshHistory();
  }

  const selectedCount = candidates.filter((s) => checked.has(s.id)).length;
  const indivCount = candidates.filter((s) => checked.has(s.id) && (individual[s.id] ?? "").trim()).length;

  // 공지 방식 토글 — 반 공지를 보낼 수 있는 반이 있을 때만(없으면 지금까지처럼 원생 개별 공지 한 가지).
  const modeToggle = classWide ? (
    <div className="border-line inline-flex rounded-full border p-0.5 text-sm" role="group" aria-label={t("os.n.mode")}>
      {(
        [
          { key: "each", label: t("os.n.modeEach") },
          { key: "class", label: t("os.n.modeClass") },
        ] as const
      ).map((o) => (
        <button
          key={o.key}
          type="button"
          aria-pressed={mode === o.key}
          onClick={() => {
            setMode(o.key);
            setConfirmSend(false);
          }}
          className={`rounded-full px-3 py-1 font-medium ${mode === o.key ? "bg-primary text-white" : "text-text-dim hover:bg-bg-soft"}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  ) : null;

  return (
    <div className="space-y-3">
    {modeToggle}
    {/* 반 공지 — 방식만 바꿔도 쓰던 제목·내용이 사라지지 않게 늘 그려 두고 감춘다. 받을 반은 미리 골라 두지 않는다(강사가 직접 고른다). */}
    {classWide ? (
      <div hidden={mode !== "class"}>
        <NoticeClassComposer classes={classWide.classes} initialRows={classWide.rows} sendEnabled={sendEnabled} />
      </div>
    ) : null}
    <div className="grid items-stretch gap-4 lg:grid-cols-[300px_minmax(0,1fr)]" hidden={mode === "class" && !!classWide}>
      {/* 대상 선택 — 데스크톱에선 우측(작성+이력)이 길어지면 함께 늘어 목록 내부 스크롤(높이 균형), 모바일은 520px 캡. */}
      <div className="lg:relative lg:min-h-[320px]">
        <div className="bg-card border-line shadow-card flex max-h-[520px] flex-col rounded-2xl border lg:absolute lg:inset-0 lg:max-h-none">
          <div className="border-line space-y-1.5 border-b px-3 py-2">
            <p className="text-foreground text-sm font-bold">
              {t("os.n.targets")} <span className="text-primary">{selectedCount}</span>
            </p>
            {/* 범위 — 오늘 수업(로스터) vs 내 담당 전체. 요일과 무관한 공지(휴강 안내 등)는 '전체'로. */}
            <div className="border-line inline-flex rounded-full border p-0.5 text-xs">
              {(
                [
                  { key: "today", label: t("os.n.scopeToday") },
                  { key: "all", label: allLabel },
                ] as const
              ).map((o) => (
                <button
                  key={o.key}
                  type="button"
                  onClick={() => void switchScope(o.key)}
                  className={`rounded-full px-2.5 py-1 font-medium ${
                    scope === o.key ? "bg-primary text-white" : "text-text-dim hover:bg-bg-soft"
                  }`}
                >
                  {o.label}
                </button>
              ))}
            </div>
            <div className="flex items-center justify-between gap-2">
              <p className="text-text-faint text-xs">
                {scope === "all"
                  ? tf("os.n.poolAll", { label: allLabel })
                  : t("os.n.poolToday")}
                {t("os.n.poolTail")}
              </p>
              {candidates.length > 0 ? (
                <button
                  type="button"
                  onClick={toggleAll}
                  className="text-primary shrink-0 text-xs font-medium hover:underline"
                >
                  {allChecked ? t("os.n.clearAll") : tf("os.n.selectAll", { n: candidates.length })}
                </button>
              ) : null}
            </div>
          </div>
          <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto p-1.5">
            {loadingAll ? (
              <p className="text-text-faint p-2 text-xs">{t("os.n.loadingAll")}</p>
            ) : candidates.length === 0 ? (
              <p className="text-text-faint p-2 text-xs">
                {scope === "all" ? t("os.n.emptyAll") : t("os.n.emptyToday")}
              </p>
            ) : (
              candidates.map((s) => (
                <label
                  key={s.id}
                  className="hover:bg-bg-soft flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm"
                >
                  <input type="checkbox" checked={checked.has(s.id)} onChange={() => toggle(s.id)} />
                  <span className="text-foreground min-w-0 flex-1 truncate">{s.name}</span>
                  <span className="text-text-faint text-xs">{schoolGradeLabel(null, s.grade)}</span>
                  <span className="text-text-faint text-xs">{s.className}</span>
                </label>
              ))
            )}
          </div>
        </div>
      </div>

      {/* 작성 + 이력 */}
      <div className="min-w-0 space-y-3">
        <section className="bg-card border-line shadow-card space-y-2 rounded-2xl border px-4 py-3">
          <div>
            <h2 className="text-foreground text-base font-bold">{t("os.n.heading")}</h2>
            <p className="text-text-faint text-xs">
              {t("os.n.headingHint")}
            </p>
          </div>
          {!sendEnabled ? (
            <p className="border-line bg-bg-soft text-text-dim rounded-md border px-3 py-2 text-xs">
              {t("os.n.offA")}
              <b>{t("os.n.offB")}</b>
              {t("os.n.offC")}
              <b>{t("os.n.offD")}</b>
              {t("os.n.offE")}
            </p>
          ) : null}
          <div>
            <p className="text-text-dim mb-1 text-xs font-medium">{t("os.n.bodyLabel")}</p>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={3}
              placeholder={tf("os.n.bodyPh", NOTICE_TAG_PARAMS)}
              className={BODY}
            />
          </div>

          {/* 학생별 개별 내용 — 선택 2명+일 때. 입력한 학생만 공통 뒤에 그 내용이 덧붙어 발송(없으면 공통 그대로). */}
          {selectedCount >= 2 ? (
            <div className="border-line rounded-md border">
              <button
                type="button"
                onClick={() => setShowIndividual((v) => !v)}
                className="text-text-dim hover:bg-bg-soft flex w-full items-center justify-between px-3 py-2 text-xs font-medium"
              >
                <span>
                  {t("os.n.indiv")}
                  {indivCount ? tf("os.n.indivCount", { n: indivCount }) : ""}
                </span>
                <span className="text-text-faint inline-flex items-center gap-0.5">
                  {showIndividual ? t("os.n.collapse") : t("os.n.expand")}
                  <EyIcon name={showIndividual ? "chevronUp" : "chevronDown"} size={12} />
                </span>
              </button>
              {showIndividual ? (
                <div className="border-line max-h-[280px] space-y-2 overflow-y-auto border-t p-2">
                  <p className="text-text-faint px-1 text-xs">
                    {t("os.n.indivHintA")}
                    <b>{t("os.n.indivHintB")}</b>
                    {t("os.n.indivHintC")}
                  </p>
                  {candidates
                    .filter((s) => checked.has(s.id))
                    .map((s) => (
                      <div key={s.id} className="flex items-start gap-2">
                        <span className="text-foreground w-16 shrink-0 truncate pt-1.5 text-xs" title={s.name}>
                          {s.name}
                        </span>
                        <textarea
                          value={individual[s.id] ?? ""}
                          onChange={(e) => setIndividual((prev) => ({ ...prev, [s.id]: e.target.value }))}
                          rows={2}
                          placeholder={t("os.n.indivPh")}
                          className={`${BODY} text-xs`}
                        />
                      </div>
                    ))}
                </div>
              ) : null}
            </div>
          ) : null}
          {/* 공통 이미지 첨부 — 선택 학생 모두의 글에 같은 이미지가 붙는다(수업 보고서 첨부와 같은 레일).
              관리자 반 공지와 **같은 컴포넌트**를 쓴다(업로드 규칙이 두 벌로 갈라지지 않게). */}
          <NoticeAttachmentPicker
            attachments={atts}
            onChange={setAtts}
            uploading={uploading}
            onUploadingChange={setUploading}
          />
          <NoticeTemplateHelp />

          {lastSkipped.length ? (
            <div className="border-line rounded-md border px-3 py-2" role="status">
              <p className="text-danger text-xs font-medium">{tf("os.n.skip.title", { n: lastSkipped.length })}</p>
              <ul className="text-text-dim mt-1 space-y-0.5 text-xs">
                {lastSkipped.map((s, i) => (
                  <li key={`${s.name}-${s.reason}-${i}`} className="break-keep">
                    {s.name} — {t(SKIP_KEY[s.reason] ?? "os.n.skip.no_name")}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {confirmSend ? (
            <div className="border-primary/40 bg-primary/5 flex flex-wrap items-center gap-2 rounded-md border px-3 py-2">
              <span className="text-foreground text-xs">
                {scope === "all" ? `${allLabel} ` : ""}
                <b>{tf("os.n.confirmCount", { n: selectedCount })}</b>
                {indivCount ? tf("os.n.confirmIndiv", { n: indivCount }) : ""}
                {atts.length ? tf("os.n.confirmImages", { n: atts.length }) : ""}
                {t("os.n.confirmTail")}
                {!sendEnabled ? t("os.n.confirmOff") : ""}
              </span>
              <Button size="sm" onClick={() => doSend(false)} disabled={busy}>
                {busy ? t("os.n.sending") : t("os.n.confirmSend")}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirmSend(false)} disabled={busy}>
                {t("os.n.cancel")}
              </Button>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                disabled={busy || !body.trim() || selectedCount === 0}
                onClick={() => setConfirmSend(true)}
              >
                {t("os.n.send")} {selectedCount > 0 ? tf("os.n.sendCount", { n: selectedCount }) : ""}
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={busy || !body.trim()}
                onClick={() => doSend(true)}
                title={t("os.n.testTitle")}
              >
                {t("os.n.test")}
              </Button>
            </div>
          )}
        </section>

        {/* 내가 보낸 공지 이력 — 대기건은 수정/삭제 */}
        <NoticeHistory title={t("os.n.history")} empty={t("os.n.historyEmpty")} rows={rows}>
              {(r) => {
                const st = statusLabel(r.status);
                const editing = editingId === r.id;
                return (
                  <NoticeHistoryItem title={r.body} status={<span className={st.cls}>{st.key ? t(st.key) : st.raw}{tf("os.n.rowTargets", { n: r.targetCount })}</span>}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        {editing ? (
                          <textarea
                            value={editBody}
                            onChange={(e) => setEditBody(e.target.value)}
                            rows={3}
                            className={BODY}
                          />
                        ) : (
                          <p className="text-foreground text-xs whitespace-pre-wrap break-words">{r.body}</p>
                        )}
                        {/* 공지 단위 사유(교차 확인 이상·전 대상 실패·회수 실패 등) — 워커가 한글로 적는다. 상태 색과 무관하게 항상 보인다. */}
                        {r.error ? <p className="text-danger mt-0.5 text-xs break-keep">{r.error}</p> : null}
                        {r.canRevoke && hasNoticeTemplateTags(r.body) ? (
                          <p className="text-text-faint mt-1 text-xs">{t("os.n.tagPostedEdit")}</p>
                        ) : null}
                        {/* 게시된 리포트 — **학생 이름**으로 링크(원장 요청: #1 #2로는 누구 글인지 알 수 없음).
                            많으면 앞 8명만 이름으로, 나머지는 수만 표시. */}
                        {r.reportLinks.length ? (
                          <p className="text-text-faint mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs">
                            <span>{tf("os.n.links", { n: r.reportLinks.length })}</span>
                            {r.reportLinks.slice(0, 8).map((l, i) =>
                              l.url ? (
                                <a
                                  key={i}
                                  href={l.url}
                                  target="_blank"
                                  rel="noreferrer"
                                  title={l.revoked ? tf("os.n.linkRevoked", { name: l.name }) : l.name}
                                  className={`underline ${l.revoked ? "text-text-faint line-through" : "text-primary"}`}
                                >
                                  {l.name}
                                </a>
                              ) : (
                                <span key={i} className="text-text-faint" title={t("os.n.linkNone")}>
                                  {l.name}
                                </span>
                              ),
                            )}
                            {r.reportLinks.length > 8 ? (
                              <span>{tf("os.n.linkMore", { n: r.reportLinks.length - 8 })}</span>
                            ) : null}
                          </p>
                        ) : null}
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        {/* 수정 = 대기건(발송 전 교체) + 게시건(게시글 PATCH). 삭제 = 대기건만. 게시취소 = 게시건 + 회수 일부 실패(다시). */}
                        {(r.status === "queued" || r.canEdit) && !editing ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              setEditingId(r.id);
                              setEditBody(r.body);
                            }}
                            title={
                              r.status === "queued" ? t("os.n.editQueuedTitle") : t("os.n.editPostedTitle")
                            }
                          >
                            {t("os.n.edit")}
                          </Button>
                        ) : null}
                        {r.status === "queued" && !editing ? (
                          <Button size="sm" variant="ghost" onClick={() => del(r.id)}>
                            {t("os.n.delete")}
                          </Button>
                        ) : null}
                        {r.canRevoke && !editing ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => revoke(r.id)}
                            title={t("os.n.revokeTitle")}
                          >
                            {t("os.n.revoke")}
                          </Button>
                        ) : null}
                        {editing ? (
                          <>
                            <Button size="sm" onClick={() => saveEdit(r)}>
                              {t("os.n.save")}
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => setEditingId(null)}>
                              {t("os.n.cancel")}
                            </Button>
                          </>
                        ) : null}
                      </div>
                    </div>
                  </NoticeHistoryItem>
                );
              }}
        </NoticeHistory>
      </div>
    </div>
    </div>
  );
}
