"use client";

// 반 공지 — aywa 반에서 학생을 골라 각 학생의 ClassNote 개별 보드로 같은 내용을 일괄 발송.
// 반 구조는 aywa(여기)에 살고 ClassNote 1인 1반은 배달 레일(Edutrix NoticeWriteModal 패턴 계승).
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useStateDraft } from "@/components/forms/use-state-draft";
import { DraftBanner } from "@/components/forms/draft-banner";
import { EyIcon } from "@/components/icons/aywa-icons";
import { schoolGradeLabel } from "@/lib/format/school-grade";
import { useSubjectMaps } from "@/features/owner/operations-context";
import { listClassNotices, sendClassNotice, previewClassNotice, type NoticeClassOption, type NoticeRow } from "@/features/report-admin/server/notice-actions";
import { cancelOnescreenNotice, editPostedNotice } from "@/features/onescreen/server/notice-actions";
import { NoticeAttachmentPicker } from "@/features/onescreen/components/notice-attachment-picker";
import { humanizeClassnoteError } from "@/features/report-admin/classnote-error";
import { noticeFailures } from "@/features/report-admin/notice-failures";
import type { NoticeAttachment } from "@/features/onescreen/notice-attachments";
import { DragScrollArea } from "@/components/ui/drag-scroll-area";
import { writeLockedPlaceholder } from "@/lib/write-lock";
import { ToolbarSegment, ToolbarSegmentItem } from "@/components/toolbar";
import type { ClassNoticeRow } from "@/features/report-admin/class-notice";
import { NoticePreviewDialog, type NoticeReview } from "./notice-preview-dialog";
import { ClassNoticePanel } from "./class-notice-panel";

// 공지 상태 한글 라벨(raw 코드 UI 노출 금지) — 워커 처리 상태와 동기.
const STATUS_LABEL: Record<string, { label: string; cls: string }> = {
  queued: { label: "발송 대기", cls: "text-text-dim" },
  processing: { label: "처리 중", cls: "text-text-dim" },
  success: { label: "발송 완료", cls: "text-green" },
  partial: { label: "일부 실패", cls: "text-amber" },
  failed: { label: "발송 실패", cls: "text-danger" },
  // 🔴 회수·수정 상태가 빠져 있어 회수한 공지 7건이 전부 **"기타"**로 떨어져 있었다(무슨 일이 있었는지
  //    화면이 말해주지 않는다). 워커가 쓰는 상태값 전부를 한글로 덮는다 — raw 코드 UI 노출 금지 규약.
  revoke_requested: { label: "회수 대기", cls: "text-text-dim" },
  revoking: { label: "회수 중", cls: "text-text-dim" },
  revoked: { label: "회수됨", cls: "text-text-dim" },
  revoke_partial: { label: "회수 일부 실패", cls: "text-danger" },
  edit_requested: { label: "수정 대기", cls: "text-text-dim" },
  editing: { label: "수정 중", cls: "text-text-dim" },
};

function fmtKst(iso: string): string {
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}

/**
 * 반 공지 탭 — **원생 개별 공지**(학생마다 1:1 알림장, 아래 EachNoticeFace)와 **반 단체 공지**(ClassNote 반에 공지 1건,
 * ClassNoticePanel)를 고른다(원장 2026-09-29 *"반 공지 혹은 원생 개별 공지로 구분"*). 반 단체 공지 재료가 없으면(0304a 전)
 * 지금과 똑같이 원생 개별 공지만 보인다.
 */
export function NoticeFace({
  classes,
  initial,
  canSend,
  classWide,
}: {
  classes: NoticeClassOption[];
  initial: NoticeRow[];
  canSend: boolean;
  classWide?: { rows: ClassNoticeRow[]; boardClassIds: string[] };
}) {
  const [mode, setMode] = useState<"each" | "class">("each");
  if (!classWide) return <EachNoticeFace classes={classes} initial={initial} canSend={canSend} />;
  return (
    <div className="space-y-4">
      <ToolbarSegment label="공지 방식">
        <ToolbarSegmentItem active={mode === "each"} onClick={() => setMode("each")}>
          원생 개별 공지
        </ToolbarSegmentItem>
        <ToolbarSegmentItem active={mode === "class"} onClick={() => setMode("class")}>
          반 단체 공지
        </ToolbarSegmentItem>
      </ToolbarSegment>
      {mode === "each" ? (
        <EachNoticeFace classes={classes} initial={initial} canSend={canSend} />
      ) : (
        <ClassNoticePanel classes={classes} boardClassIds={classWide.boardClassIds} initial={classWide.rows} canSend={canSend} />
      )}
    </div>
  );
}

function EachNoticeFace({
  classes,
  initial,
  canSend,
}: {
  classes: NoticeClassOption[];
  initial: NoticeRow[];
  canSend: boolean;
}) {
  const subjects = useSubjectMaps();
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [selectedOnly, setSelectedOnly] = useState(false);
  const [review, setReview] = useState<NoticeReview | null>(null);
  const visibleClasses = classes.filter((c) => (!selectedOnly || checked.has(c.id))
    && `${c.name} ${subjects.labelOf(c.subject ?? "")}`.toLocaleLowerCase("ko").includes(search.trim().toLocaleLowerCase("ko")));
  const hiddenCheckedCount = [...checked].filter((id) => !visibleClasses.some((c) => c.id === id)).length;
  const [body, setBody] = useState(""); // 공통 내용
  const [individual, setIndividual] = useState<Record<string, string>>({}); // studentId → 개별 내용(공통 뒤 덧붙임)
  const [showIndividual, setShowIndividual] = useState(false);
  const [busy, setBusy] = useState(false);
  const [rows, setRows] = useState<NoticeRow[]>(initial);
  const [atts, setAtts] = useState<NoticeAttachment[]>([]); // 전원 공통 이미지
  const [uploading, setUploading] = useState(false);
  // 발송 이력의 게시취소·제자리 수정(F1) — 원스크린 발송자와 **같은 서버 액션**(같은 큐·같은 워커). 새 발송 경로 없음.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editBody, setEditBody] = useState("");
  const [rowBusy, setRowBusy] = useState<string | null>(null);

  // 선택 반들의 재원생 합집합(학생이 두 반에 걸치면 1회) — 개별 내용 입력 박스의 소스이자 실제 대상 수.
  const selectedStudents = (() => {
    const seen = new Map<string, { id: string; name: string; grade: string | null; className: string }>();
    for (const c of classes) {
      if (!checked.has(c.id)) continue;
      for (const s of c.students) if (!seen.has(s.id)) seen.set(s.id, { ...s, className: c.name });
    }
    return [...seen.values()];
  })();
  const selectedCount = selectedStudents.length;
  const indivCount = selectedStudents.filter((s) => (individual[s.id] ?? "").trim()).length;

  const toggle = (id: string) =>
    setChecked((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  // 로컬 초안 자동저장 — 공통·개별 공지 내용을 새로고침/창닫기에서 지킨다(실발송 성공 시 삭제).
  // 첨부(atts)는 업로드 참조라 초안 대상 아님(복구 시 참조 유효성 보장 불가 — 다시 첨부).
  const draftSnapshot = useMemo(
    () => ({ checkedIds: [...checked], body, individual, showIndividual }),
    [checked, body, individual, showIndividual],
  );
  const localDraft = useStateDraft({
    scope: "class-notice",
    snapshot: draftSnapshot,
    hasContent: (s) => s.body.trim() !== "" || Object.values(s.individual).some((t) => t.trim() !== ""),
  });

  function restoreNoticeDraft() {
    const d = localDraft.restore();
    if (!d) return;
    setChecked(new Set(d.checkedIds.filter((id) => classes.some((c) => c.id === id))));
    setBody(d.body);
    setIndividual(d.individual);
    setShowIndividual(d.showIndividual);
  }

  // 전체 선택/해제 — 반 목록 전부(=발송 가능한 모든 재원생). 학원 전체 공지를 반마다 클릭하지 않게.
  const allChecked = visibleClasses.length > 0 && visibleClasses.every((c) => checked.has(c.id));
  const toggleAll = () => setChecked((previous) => {
    const next = new Set(previous);
    for (const c of visibleClasses) { if (allChecked) next.delete(c.id); else next.add(c.id); }
    return next;
  });

  async function refresh() {
    const res = await listClassNotices();
    if (res.ok) setRows(res.rows ?? []);
  }

  async function revokeRow(r: NoticeRow) {
    const again = r.status === "revoke_partial";
    const msg = again
      ? "회수하지 못하고 남은 게시글을 다시 삭제 요청합니다. 계속할까요?"
      : `학부모 알림장에 게시된 이 공지(${r.reportLinks.filter((l) => !l.revoked).length}건)를 삭제 요청합니다. 되돌릴 수 없습니다. 계속할까요?`;
    if (!window.confirm(msg)) return;
    setRowBusy(r.id);
    const res = await cancelOnescreenNotice(r.id);
    setRowBusy(null);
    if (!res.ok) {
      toast.error(res.error ?? "게시취소 요청에 실패했습니다");
      return;
    }
    toast.success("게시취소를 요청했습니다 — 발송 PC가 순서대로 삭제합니다");
    refresh();
  }

  async function saveRowEdit(r: NoticeRow) {
    const live = r.reportLinks.filter((l) => !l.revoked).length;
    if (
      !window.confirm(
        `학부모 알림장에 게시된 ${live}건의 내용을 새 내용으로 바꿉니다. 학생별로 덧붙였던 개별 내용은 사라지고 모두 같은 내용이 됩니다. 계속할까요?`,
      )
    )
      return;
    setRowBusy(r.id);
    const res = await editPostedNotice(r.id, editBody);
    setRowBusy(null);
    if (!res.ok) {
      toast.error(res.error ?? "수정 요청에 실패했습니다");
      return;
    }
    toast.success("수정을 요청했습니다 — 발송 PC가 게시글 내용을 바꿉니다");
    setEditingId(null);
    refresh();
  }

  async function doSend(test: boolean, confirmed?: NoticeReview) {
    // 개별 내용은 현재 선택된 학생 것만 추림(반 해제 후 남은 잔여 입력 제외).
    const indiv: Record<string, string> = {};
    for (const s of selectedStudents) {
      const t = (individual[s.id] ?? "").trim();
      if (t) indiv[s.id] = t;
    }
    setBusy(true);
    const input = confirmed?.input ?? { classIds: [...checked], body, individual: indiv, test,
      ...(atts.length ? { attachments: atts } : {}) };
    if (!test && !confirmed) {
      try {
        const result = await previewClassNotice(input);
        if (result.ok) setReview({ input, preview: result.preview });
        else toast.error(result.error);
      } catch { toast.error("발송 대상을 확인하지 못했습니다. 다시 시도하세요"); }
      finally { setBusy(false); }
      return;
    }
    let res: Awaited<ReturnType<typeof sendClassNotice>>;
    try {
      res = await sendClassNotice({ ...input, test, previewFingerprint: confirmed?.preview.fingerprint });
    } catch {
      // 응답 유실은 큐 적재 실패를 뜻하지 않는다. 같은 확인 창에서 재시도해 중복 발송하지 않게 닫는다.
      setReview(null);
      toast.error("공지 발송 요청을 확인하지 못했습니다. 다시 보내기 전에 발송 이력을 확인하세요");
      try { await refresh(); }
      catch { toast.error("발송 이력을 불러오지 못했습니다. 화면을 새로고침해 확인하세요"); }
      finally { setBusy(false); }
      return;
    }
    setReview(null);
    setBusy(false);
    if (res.ok && res.dryRun) {
      toast.message("dry-run — '보고서 설정' 탭에서 'ClassNote 실제 발송'을 켜야 큐에 올라갑니다");
      return;
    }
    if (!res.ok) {
      toast.error(res.error ?? "공지 발송 요청에 실패했습니다");
      return;
    }
    const parts = [`${res.queued ?? 0}건 발송 대기(발송 PC가 순차 게시)`];
    if (!test && indivCount) parts.push(`개별 내용 ${indivCount}명`);
    const collisions = (res.skipped ?? []).filter((s) => s.reason === "name_collision");
    if (collisions.length) parts.push(`동명이인 제외 ${collisions.length}명(${collisions.map((s) => s.name).join(", ")})`);
    // 수학 반 보드 경로 — 받을 반 보드가 없는 학생은 빠진다(1인 보드로 되돌리지 않는다). 누가 빠졌는지 그대로 알린다.
    const noBoard = (res.skipped ?? []).filter((s) => s.reason === "no_class_board" || s.reason === "not_my_class");
    if (noBoard.length) parts.push(`반 보드 없음 제외 ${noBoard.length}명(${noBoard.map((s) => s.name).join(", ")})`);
    // 수업 시작 전·휴원(대기) 중 — ClassNote로 보내지 않는다(원장 2026-11-05). 누가 빠졌는지 그대로 알린다.
    const notAttending = (res.skipped ?? []).filter((s) => s.reason === "not_started" || s.reason === "on_hold");
    if (notAttending.length) parts.push(`수업 시작 전·휴원 제외 ${notAttending.length}명(${notAttending.map((s) => s.name).join(", ")})`);
    toast.success(parts.join(" · "));
    if (!test) {
      setBody("");
      setChecked(new Set());
      setIndividual({});
      setShowIndividual(false);
      setAtts([]);
      localDraft.clear();
    }
    refresh();
  }

  return (
    <div className="space-y-6">
      <section className="bg-card border-line shadow-card rounded-2xl border px-5 py-4">
        <fieldset disabled={busy} className="min-w-0 border-0 p-0">
        {localDraft.draftSavedAt ? (
          <div className="mb-3">
            <DraftBanner
              savedAt={localDraft.draftSavedAt}
              onRestore={restoreNoticeDraft}
              onDiscard={localDraft.discard}
            />
          </div>
        ) : null}
        <div className="mb-3">
          <h2 className="text-foreground text-base font-bold">반 공지 발송</h2>
          <p className="text-text-faint text-xs">
            선택한 반의 재원생 각자의 ClassNote 알림장으로 같은 내용이 발송됩니다(수학은 그 반 보드에서 학생마다 따로) · 학부모 미가입 학생은 수신 불가
          </p>
        </div>

        <div className="grid items-stretch gap-4 lg:grid-cols-[280px_1fr]">
          {/* 반 선택 — 데스크톱에선 우측(공통+개별)이 길어지면 함께 늘어 내부 스크롤(높이 균형), 모바일은 360px 캡. */}
          <div className="lg:relative lg:min-h-[240px]">
            <div className="border-line flex max-h-[360px] flex-col overflow-y-auto rounded-md border p-2 lg:absolute lg:inset-0 lg:max-h-none">
              {canSend && classes.length > 0 ? (
                <div className="border-line mb-1 flex items-center justify-between gap-2 border-b px-2 pb-1.5">
                  <span className="text-text-faint text-xs">
                    반 {classes.length}
                    {selectedCount ? ` · 대상 ${selectedCount}명` : ""}
                  </span>
                  <button
                    type="button"
                    onClick={toggleAll}
                    className="text-primary shrink-0 text-xs font-medium hover:underline"
                  >
                    {allChecked ? "보이는 반 해제" : "보이는 반 선택"}
                  </button>
                </div>
              ) : null}
              <input aria-label="공지 대상 반·과목 검색" placeholder="반·과목 검색" value={search}
                onChange={(e) => setSearch(e.target.value)} className="border-line mb-2 w-full rounded border px-2 py-1 text-sm" />
              <label className="mb-2 flex items-center gap-1 text-xs"><input type="checkbox" checked={selectedOnly} onChange={(e) => setSelectedOnly(e.target.checked)} />선택 반만 보기</label>
              <p className="text-text-dim mb-1 text-xs">선택 {checked.size}반{hiddenCheckedCount ? ` · 현재 목록 밖 ${hiddenCheckedCount}반 포함` : ""}</p>
              {visibleClasses.length === 0 ? (
                <p className="text-text-faint p-2 text-xs">{classes.length === 0 ? "발송 허용 과목의 활성 반이 없습니다." : "조건에 맞는 반이 없습니다."}</p>
              ) : (
                visibleClasses.map((c) => (
                  <label key={c.id} className="hover:bg-bg-soft flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm">
                    <input type="checkbox" checked={checked.has(c.id)} onChange={() => toggle(c.id)} disabled={!canSend} />
                    <span className="text-foreground min-w-0 flex-1 truncate">{c.name}</span>
                    {c.subject ? <span className="text-text-faint text-xs">{subjects.labelOf(c.subject)}</span> : null}
                    <span className="text-text-faint text-xs">{c.studentCount}명</span>
                  </label>
                ))
              )}
            </div>
          </div>

          {/* 공통 본문 + 개별 내용 + 발송 */}
          <div className="flex flex-col gap-2">
            <div>
              <p className="text-text-dim mb-1 text-xs font-medium">공통 내용 (선택 반 재원생 모두에게)</p>
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                disabled={!canSend}
                // 읽기 권한이면 예시 대신 권한 안내(원장 2026-11-05 — 비활성 칸이 왜 막혔는지 말한다).
                placeholder={canSend ? "공지 내용 (예: 다음 주 월요일은 학원 휴원입니다.)" : writeLockedPlaceholder("lesson_reports")}
                className="border-line bg-card focus:border-primary min-h-[180px] w-full flex-1 resize-y rounded-lg border p-3 text-sm outline-none disabled:cursor-not-allowed disabled:opacity-60"
              />
            </div>

            {/* 학생별 개별 내용 — 선택 학생 2명+일 때. 입력한 학생만 공통 뒤에 그 내용이 덧붙어 발송(없으면 공통 그대로). */}
            {canSend && selectedCount >= 2 ? (
              <div className="border-line rounded-md border">
                <button
                  type="button"
                  onClick={() => setShowIndividual((v) => !v)}
                  className="text-text-dim hover:bg-bg-soft flex w-full items-center justify-between px-3 py-2 text-xs font-medium"
                >
                  <span>학생별 개별 내용 추가 (선택){indivCount ? ` · ${indivCount}명 입력함` : ""}</span>
                  <span className="text-text-faint inline-flex items-center gap-0.5">
                    {showIndividual ? "접기" : "펼치기"}
                    <EyIcon name={showIndividual ? "chevronUp" : "chevronDown"} size={12} />
                  </span>
                </button>
                {showIndividual ? (
                  <div className="border-line max-h-[300px] space-y-2 overflow-y-auto border-t p-2">
                    <p className="text-text-faint px-1 text-xs">
                      입력한 학생은 <b>공통 내용 뒤에</b> 이 내용이 덧붙어 발송됩니다. 비우면 공통 내용만 나갑니다.
                    </p>
                    {selectedStudents.map((s) => (
                      <div key={s.id} className="flex items-start gap-2">
                        <span className="w-24 shrink-0 pt-1.5" title={`${s.name} · ${s.className}`}>
                          <span className="text-foreground block truncate text-xs">{s.name}</span>
                          <span className="text-text-faint block truncate text-xs">
                            {schoolGradeLabel(null, s.grade)} · {s.className}
                          </span>
                        </span>
                        <textarea
                          value={individual[s.id] ?? ""}
                          onChange={(e) => setIndividual((prev) => ({ ...prev, [s.id]: e.target.value }))}
                          rows={2}
                          placeholder="이 학생에게만 덧붙일 내용(선택)"
                          className="border-line bg-card focus:border-primary w-full resize-y rounded-md border px-2 py-1.5 text-xs outline-none"
                        />
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}

            {/* 공통 이미지 첨부 — 강사 원스크린 공지와 같은 컴포넌트(업로드 규칙 단일 소스). */}
            {canSend ? (
              <NoticeAttachmentPicker
                attachments={atts}
                onChange={setAtts}
                uploading={uploading}
                onUploadingChange={setUploading}
                label="이미지 첨부 (선택 반 재원생 모두에게)"
              />
            ) : null}

            {canSend ? (
              <div className="flex flex-wrap items-center gap-2">
                <Button size="sm" disabled={busy || uploading || !body.trim() || checked.size === 0} onClick={() => doSend(false)}>
                  발송 {selectedCount > 0 ? `(${selectedCount}명${indivCount ? ` · 개별 ${indivCount}` : ""})` : ""}
                  {atts.length ? ` · 이미지 ${atts.length}` : ""}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy || uploading || !body.trim()}
                  onClick={() => doSend(true)}
                  title="실 학부모에게 가지 않는 테스트 학생(학원이)의 알림장으로만 발송해 봅니다"
                >
                  테스트 발송(선택 반 제외 · 학원이)
                </Button>
                <span className="text-text-faint text-xs">발송 전 내용을 한 번 더 확인하세요 — 게시 후 회수·수정은 아래 발송 이력에서 요청</span>
              </div>
            ) : (
              <p className="text-text-faint text-xs">공지 발송 권한이 없습니다(열람 전용).</p>
            )}
          </div>
        </div>
        </fieldset>
      </section>

      {review ? <NoticePreviewDialog review={review} busy={busy} onClose={() => { if (!busy) setReview(null); }} onConfirm={() => doSend(false, review)} /> : null}
      {/* 발송 이력 */}
      <section className="bg-card border-line shadow-card rounded-2xl border px-5 py-4">
        <h2 className="text-foreground mb-3 text-base font-bold">공지 발송 이력</h2>
        {rows.length === 0 ? (
          <p className="text-text-faint text-sm">아직 발송한 공지가 없습니다.</p>
        ) : (
          <DragScrollArea className="border-line rounded-md border">
            <table className="w-full min-w-[560px] text-left text-xs">
              <thead>
                <tr className="border-line text-text-faint border-b">
                  <th className="px-3 py-2 font-bold">발송 시각</th>
                  <th className="px-3 py-2 font-bold">내용</th>
                  <th className="px-3 py-2 font-bold">대상</th>
                  <th className="px-3 py-2 font-bold">상태</th>
                  {canSend ? <th className="px-3 py-2 font-bold">관리</th> : null}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const st = STATUS_LABEL[r.status] ?? { label: "기타", cls: "text-text-dim" };
                  // 🔴 `!x.ok`로 세지 말 것 — 수정·회수한 공지는 `ok` 키 자체가 없어 전건 실패로 뒤집힌다
                  //    (08-25 "발송 완료 · 실패 7 · 사유 없음"). 판정은 0144a 트리거와 같은 단일 규약.
                  const failNotes = noticeFailures(r.results);
                  return (
                    <tr key={r.id} className="border-line border-b last:border-b-0">
                      <td className="text-text-dim px-3 py-2 whitespace-nowrap">{fmtKst(r.createdAt)}</td>
                      <td className="text-foreground max-w-[320px] truncate px-3 py-2" title={r.body}>
                        {editingId === r.id ? (
                          <textarea
                            value={editBody}
                            onChange={(e) => setEditBody(e.target.value)}
                            aria-label="공지 새 내용"
                            className="border-line bg-card focus:border-primary min-h-[96px] w-full min-w-[240px] resize-y rounded-md border p-2 text-xs whitespace-pre-wrap outline-none"
                          />
                        ) : (
                          r.body
                        )}
                      </td>
                      <td className="text-text-dim px-3 py-2">
                        {r.targetCount}명
                        {/* 게시된 글은 **학생 이름**으로 링크 — 번호로는 누구 글인지 알 수 없다. 많으면 앞 6명만. */}
                        {r.reportLinks.length ? (
                          <span className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs">
                            {r.reportLinks.slice(0, 6).map((l, i) =>
                              l.url ? (
                                <a
                                  key={i}
                                  href={l.url}
                                  target="_blank"
                                  rel="noreferrer"
                                  title={l.revoked ? `${l.name} — 회수됨` : l.name}
                                  className={`underline ${l.revoked ? "text-text-faint line-through" : "text-primary"}`}
                                >
                                  {l.name}
                                </a>
                              ) : (
                                <span key={i} className="text-text-faint" title="주소를 못 찾아 링크 없음">
                                  {l.name}
                                </span>
                              ),
                            )}
                            {r.reportLinks.length > 6 ? (
                              <span className="text-text-faint">외 {r.reportLinks.length - 6}명</span>
                            ) : null}
                          </span>
                        ) : null}
                      </td>
                      <td className="px-3 py-2">
                        <span className={`text-xs font-bold ${st.cls}`}>{st.label}</span>
                        {failNotes.length ? (
                          <span
                            className="text-text-faint ml-1.5 text-xs"
                            // 사유는 워커/상류 원문이라 그대로 두면 "해당 학생 없음"처럼 조치를 알 수 없다 —
                            // 알림(0144a)·발송 콘솔과 **같은 해석**을 쓴다.
                            title={failNotes
                              .map((f) => `${f.studentName}: ${humanizeClassnoteError(f.note) ?? "사유 없음"}`)
                              .join("\n")}
                          >
                            실패 {failNotes.length}
                          </span>
                        ) : null}
                        {/* 🔴 **공지 단위 사유**(교차 확인 이상·회수 실패 N건 등)는 타깃별 실패가 있든 없든 **항상** 보인다 —
                            예전엔 실패가 하나라도 있으면 가려졌고 흐린 글자였다(교차 확인 이상이 '일부 실패' 뒤에 숨는다).
                            ⚠️ 여기 그대로 나가므로 워커가 쓰는 `error`는 **한글 요약**을 유지할 것(raw 기술 원문 UI 노출 금지 규약). */}
                        {r.error ? (
                          <span className="text-danger mt-0.5 block text-xs break-keep" title={r.error}>
                            {r.error}
                          </span>
                        ) : null}
                      </td>
                      {canSend ? (
                        <td className="px-3 py-2 whitespace-nowrap">
                          {editingId === r.id ? (
                            <span className="flex items-center gap-1">
                              <Button
                                size="sm"
                                disabled={rowBusy === r.id || !editBody.trim()}
                                onClick={() => saveRowEdit(r)}
                              >
                                저장
                              </Button>
                              <Button size="sm" variant="ghost" onClick={() => setEditingId(null)}>
                                취소
                              </Button>
                            </span>
                          ) : (
                            <span className="flex items-center gap-1">
                              {r.canEdit ? (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  disabled={rowBusy === r.id}
                                  title="게시된 알림장 글의 내용을 새 내용으로 바꿉니다(발송 PC가 처리)"
                                  onClick={() => {
                                    setEditingId(r.id);
                                    setEditBody(r.body);
                                  }}
                                >
                                  수정
                                </Button>
                              ) : null}
                              {r.canRevoke ? (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  disabled={rowBusy === r.id}
                                  title="학부모 알림장에 게시된 글을 삭제합니다(발송 PC가 처리)"
                                  onClick={() => revokeRow(r)}
                                >
                                  {r.status === "revoke_partial" ? "남은 글 다시 회수" : "게시취소"}
                                </Button>
                              ) : null}
                            </span>
                          )}
                        </td>
                      ) : null}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </DragScrollArea>
        )}
      </section>
    </div>
  );
}
