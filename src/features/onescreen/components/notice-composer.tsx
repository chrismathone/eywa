"use client";

// 원스크린 학부모 공지 컴포저 — 선택 학생(카드=1명 seed) 또는 표에서 넘어온 학생들에게 ClassNote 개별 보드로
// **독립 공지**를 발송(classnote_notices). 보고서와 별개 글이라 누적·공존. 게시는 연동 PC 워커가 순차 처리.
// Phase 1 = 일반 공지만(개인화 {{태그}}는 워커 per-target 지원 후 해제). 대기(미게시) 공지는 여기서 수정/삭제.
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { EyIcon } from "@/components/icons/eywa-icons";
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
import { NoticeAttachmentPicker } from "./notice-attachment-picker";
import type { NoticeAttachment } from "../notice-attachments";
import type { OneScreenStudent } from "../types";

const BODY = "border-line bg-card text-foreground rounded-lg border px-3 py-2 text-sm w-full resize-y";

/** 대상 후보 — '오늘 수업'(로스터)과 '내 담당 전체'(서버 조회)를 한 모양으로 다룬다. */
type Candidate = NoticeStudent;

/** 대상 범위 — 기본은 오늘(카드/표에서 넘어온 선택을 그대로 살림), '전체'는 요일과 무관한 담당 학생 전원. */
type Scope = "today" | "all";

/** classnote_notices.status → 한글 라벨 + 색(원문 노출 금지). */
function statusLabel(s: string): { label: string; cls: string } {
  switch (s) {
    case "queued":
      return { label: "발송 대기", cls: "text-text-dim" };
    case "processing":
      return { label: "게시 중", cls: "text-text-dim" };
    case "success":
      return { label: "게시 완료", cls: "text-green" };
    case "partial":
      return { label: "일부 게시", cls: "text-amber" };
    case "failed":
      return { label: "게시 실패", cls: "text-danger" };
    case "revoke_requested":
      return { label: "게시취소 요청됨(연동 PC 처리 대기)", cls: "text-text-dim" };
    case "revoking":
      return { label: "게시취소 처리 중", cls: "text-text-dim" };
    case "edit_requested":
      return { label: "수정 요청됨(연동 PC 처리 대기)", cls: "text-text-dim" };
    case "editing":
      return { label: "수정 처리 중", cls: "text-text-dim" };
    case "revoked":
      return { label: "게시취소됨(회수)", cls: "text-danger" };
    case "revoke_partial":
      return { label: "일부 회수", cls: "text-amber" };
    default:
      return { label: s, cls: "text-text-faint" };
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
  const [confirmSend, setConfirmSend] = useState(false);
  const [rows, setRows] = useState<OnescreenNoticeRow[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editBody, setEditBody] = useState("");
  const [scope, setScope] = useState<Scope>("today");
  const [allStudents, setAllStudents] = useState<Candidate[] | null>(null); // 담당 전체(한 번 받아 캐시)
  // 관리자뷰는 담당 반 개념이 없어 실제로 학원 전체가 담긴다 — 라벨이 거짓말하지 않게 서버가 알려준 범위를 쓴다.
  const [allLabel, setAllLabel] = useState("내 담당 전체");
  const [loadingAll, setLoadingAll] = useState(false);
  const [atts, setAtts] = useState<NoticeAttachment[]>([]); // 전원 공통 이미지
  const [uploading, setUploading] = useState(false);
  // seed 초기 선택은 useState 초기화로만 반영 — 진입 시 부모가 key로 remount해 새 seed를 적용(effect 동기 setState 회피).

  async function refreshHistory() {
    const res = await listMyOnescreenNotices();
    if (res.ok && res.rows) setRows(res.rows);
  }
  // 최초 1회 이력 로드 — setState는 await 뒤(가드) async IIFE로(effect 동기 setState 금지 규칙).
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const res = await listMyOnescreenNotices();
      if (!cancelled && res.ok && res.rows) setRows(res.rows);
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
      toast.error(res.error ?? "담당 학생을 불러오지 못했습니다");
      setScope("today");
      return;
    }
    if (res.scope === "tenant") setAllLabel("학원 전체");
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
        individualBody: individual[s.id]?.trim() || undefined,
      }));
  }

  async function doSend(test: boolean) {
    if (!body.trim()) {
      toast.error("공통 내용을 입력하세요");
      return;
    }
    const targets = test ? [] : buildTargets();
    if (!test && targets.length === 0) {
      toast.error("대상 학생을 선택하세요");
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
    if (!res.ok) {
      toast.error(res.error ?? "발송에 실패했습니다");
      return;
    }
    if (res.dryRun) {
      toast.message(
        `실제 발송이 꺼져 있어 전송하지 않았습니다 — 대상 ${res.queued ?? 0}명(원장 설정에서 'ClassNote 실제 발송'을 켜야 전송).`,
      );
      return;
    }
    const skip = res.skipped?.length ?? 0;
    (res.queued ? toast.success : toast.message)(
      `${res.queued ?? 0}명 발송 대기(연동 PC가 순차 게시)${skip ? ` · 제외 ${skip}명(발송과목 아님/동명이인)` : ""}`,
    );
    if (!test) {
      setBody("");
      setChecked(new Set());
      setIndividual({});
      setShowIndividual(false);
      setAtts([]);
      void refreshHistory();
      onSent?.();
    } else {
      void refreshHistory();
    }
  }

  // 대기건=editQueuedNotice(발송 전 본문 교체), 게시건=editPostedNotice(연동 PC가 게시글 PATCH). 상태로 라우팅.
  async function saveEdit(row: OnescreenNoticeRow) {
    const posted = row.status !== "queued";
    const res = posted ? await editPostedNotice(row.id, editBody) : await editQueuedNotice(row.id, editBody);
    if (!res.ok) {
      toast.error(res.error ?? "수정에 실패했습니다");
      if (res.reason === "already_sent") void refreshHistory();
      return;
    }
    toast.success(posted ? "게시 공지 수정을 요청했습니다 — 연동 PC가 게시글에 반영합니다" : "공지를 수정했습니다");
    setEditingId(null);
    void refreshHistory();
  }

  async function del(id: string) {
    if (!window.confirm("이 대기 공지를 삭제할까요? (게시 전이라 학부모에게 가지 않습니다)")) return;
    const res = await deleteQueuedNotice(id);
    if (!res.ok) {
      toast.error(res.error ?? "삭제에 실패했습니다");
      if (res.reason === "already_sent") void refreshHistory();
      return;
    }
    toast.success("대기 공지를 삭제했습니다");
    void refreshHistory();
  }

  async function revoke(id: string) {
    if (!window.confirm("게시된 공지를 학부모 게시판에서 삭제(회수)할까요? 연동 PC가 순차 처리합니다.")) return;
    const res = await cancelOnescreenNotice(id);
    if (!res.ok) {
      toast.error(res.error ?? "게시취소에 실패했습니다");
      return;
    }
    toast.success("게시취소를 요청했습니다 — 연동 PC가 처리하면 게시판에서 삭제됩니다");
    void refreshHistory();
  }

  const selectedCount = candidates.filter((s) => checked.has(s.id)).length;
  const indivCount = candidates.filter((s) => checked.has(s.id) && (individual[s.id] ?? "").trim()).length;

  return (
    <div className="grid items-stretch gap-4 lg:grid-cols-[300px_1fr]">
      {/* 대상 선택 — 데스크톱에선 우측(작성+이력)이 길어지면 함께 늘어 목록 내부 스크롤(높이 균형), 모바일은 520px 캡. */}
      <div className="lg:relative lg:min-h-[320px]">
        <div className="bg-card border-line shadow-card flex max-h-[520px] flex-col rounded-2xl border lg:absolute lg:inset-0 lg:max-h-none">
          <div className="border-line space-y-1.5 border-b px-3 py-2">
            <p className="text-foreground text-sm font-bold">
              대상 학생 <span className="text-primary">{selectedCount}</span>
            </p>
            {/* 범위 — 오늘 수업(로스터) vs 내 담당 전체. 요일과 무관한 공지(휴강 안내 등)는 '전체'로. */}
            <div className="border-line inline-flex rounded-full border p-0.5 text-xs">
              {(
                [
                  { key: "today", label: "오늘 수업" },
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
                {scope === "all" ? `${allLabel} 재원생` : "보이는 반의 재원생"} · 발송 과목(수학 등)만 실제 게시
              </p>
              {candidates.length > 0 ? (
                <button
                  type="button"
                  onClick={toggleAll}
                  className="text-primary shrink-0 text-xs font-medium hover:underline"
                >
                  {allChecked ? "전체 해제" : `전체 선택 ${candidates.length}`}
                </button>
              ) : null}
            </div>
          </div>
          <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto p-1.5">
            {loadingAll ? (
              <p className="text-text-faint p-2 text-xs">담당 학생을 불러오는 중…</p>
            ) : candidates.length === 0 ? (
              <p className="text-text-faint p-2 text-xs">
                {scope === "all" ? "담당 반의 재원생이 없습니다." : "표시할 학생이 없습니다."}
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
      <div className="space-y-4">
        <section className="bg-card border-line shadow-card space-y-3 rounded-2xl border px-4 py-3">
          <div>
            <h2 className="text-foreground text-base font-bold">학부모 공지</h2>
            <p className="text-text-faint text-xs">
              선택 학생 학부모의 ClassNote 보드에 공지를 게시합니다 · 수업 보고서와 별개 글로 누적됩니다
            </p>
          </div>
          {!sendEnabled ? (
            <p className="border-line bg-bg-soft text-text-dim rounded-md border px-3 py-2 text-xs">
              현재 <b>실제 발송이 꺼져</b> 있어 전송되지 않습니다(dry-run). 학부모에게 보내려면 원장 설정의 <b>ClassNote 실제 발송</b>을 켜세요.
            </p>
          ) : null}
          <div>
            <p className="text-text-dim mb-1 text-xs font-medium">공통 내용 (선택 학생 모두에게)</p>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={5}
              placeholder="예: 안녕하세요 어머님, 다음 주 월요일은 휴강입니다. 교재 p.29까지 풀어 오세요!"
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
                <span>학생별 개별 내용 추가 (선택){indivCount ? ` · ${indivCount}명 입력함` : ""}</span>
                <span className="text-text-faint inline-flex items-center gap-0.5">
                  {showIndividual ? "접기" : "펼치기"}
                  <EyIcon name={showIndividual ? "chevronUp" : "chevronDown"} size={12} />
                </span>
              </button>
              {showIndividual ? (
                <div className="border-line max-h-[280px] space-y-2 overflow-y-auto border-t p-2">
                  <p className="text-text-faint px-1 text-xs">
                    입력한 학생은 <b>공통 내용 뒤에</b> 이 내용이 덧붙어 발송됩니다. 비우면 공통 내용만 나갑니다.
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
                          placeholder="이 학생에게만 덧붙일 내용(선택)"
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

          {confirmSend ? (
            <div className="border-primary/40 bg-primary/5 flex flex-wrap items-center gap-2 rounded-md border px-3 py-2">
              <span className="text-foreground text-xs">
                {scope === "all" ? `${allLabel} ` : ""}<b>{selectedCount}명</b>
                {indivCount ? ` (개별 내용 ${indivCount}명)` : ""}
                {atts.length ? ` · 이미지 ${atts.length}장` : ""}의 학부모에게 공지를 발송할까요?
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
              <Button
                size="sm"
                disabled={busy || !body.trim() || selectedCount === 0}
                onClick={() => setConfirmSend(true)}
              >
                ClassNote 공지 발송 {selectedCount > 0 ? `(${selectedCount}명)` : ""}
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
            </div>
          )}
        </section>

        {/* 내가 보낸 공지 이력 — 대기건은 수정/삭제 */}
        <section className="bg-card border-line shadow-card rounded-2xl border px-4 py-3">
          <p className="text-foreground mb-2 text-sm font-bold">내가 보낸 공지</p>
          {rows.length === 0 ? (
            <p className="text-text-faint text-xs">아직 보낸 공지가 없습니다.</p>
          ) : (
            <ul className="divide-line divide-y">
              {rows.map((r) => {
                const st = statusLabel(r.status);
                const editing = editingId === r.id;
                return (
                  <li key={r.id} className="py-2">
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
                          <p className="text-foreground line-clamp-2 text-xs whitespace-pre-wrap">{r.body}</p>
                        )}
                        <p className="text-text-faint mt-0.5 text-xs">
                          <span className={st.cls}>{st.label}</span> · 대상 {r.targetCount}명
                        </p>
                        {/* 게시된 리포트 — **학생 이름**으로 링크(원장 요청: #1 #2로는 누구 글인지 알 수 없음).
                            많으면 앞 8명만 이름으로, 나머지는 수만 표시. */}
                        {r.reportLinks.length ? (
                          <p className="text-text-faint mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs">
                            <span>게시글 {r.reportLinks.length}개:</span>
                            {r.reportLinks.slice(0, 8).map((l, i) =>
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
                            {r.reportLinks.length > 8 ? <span>외 {r.reportLinks.length - 8}명</span> : null}
                          </p>
                        ) : null}
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        {/* 수정 = 대기건(발송 전 교체) + 게시건(게시글 PATCH). 삭제 = 대기건만. 게시취소 = 게시건. */}
                        {(r.status === "queued" || r.canRevoke) && !editing ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              setEditingId(r.id);
                              setEditBody(r.body);
                            }}
                            title={r.status === "queued" ? "발송 전 내용 수정" : "게시된 글의 내용을 바로 수정"}
                          >
                            수정
                          </Button>
                        ) : null}
                        {r.status === "queued" && !editing ? (
                          <Button size="sm" variant="ghost" onClick={() => del(r.id)}>
                            삭제
                          </Button>
                        ) : null}
                        {r.canRevoke && !editing ? (
                          <Button size="sm" variant="ghost" onClick={() => revoke(r.id)} title="학부모 게시판에서 이 공지 글을 삭제(회수)">
                            게시취소
                          </Button>
                        ) : null}
                        {editing ? (
                          <>
                            <Button size="sm" onClick={() => saveEdit(r)}>
                              저장
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => setEditingId(null)}>
                              취소
                            </Button>
                          </>
                        ) : null}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
