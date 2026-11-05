"use client";

import { useSubjectMaps } from "@/features/owner/operations-context";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ClassnoteSyncNowButton } from "@/features/report-admin/components/classnote-sync-now-button";
import type { NoticeClassOption } from "@/features/report-admin/server/notice-actions";
import { listClassWideNotices, sendClassWideNotice } from "@/features/report-admin/server/class-notice-actions";
import {
  CLASS_NOTICE_BODY_MAX,
  CLASS_NOTICE_TITLE_MAX,
  classNoticeStatusLabel,
  type ClassNoticeRow,
} from "@/features/report-admin/class-notice";
import { NoticeAttachmentPicker } from "@/features/onescreen/components/notice-attachment-picker";
import type { NoticeAttachment } from "@/features/onescreen/notice-attachments";
import { writeLockedNote, writeLockedPlaceholder } from "@/lib/write-lock";

const fmt = (iso: string) =>
  new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));

/**
 * **반 단체 공지** — ClassNote 반 보드에 공지 1건(원장 2026-09-29 *"반 공지 혹은 원생 개별 공지로 구분"*).
 * 고를 수 있는 반 = ClassNote 반 보드 연결(0302a)이 있는 반뿐. 보내기 전 워커가 **보드 원아 = 그 반 재원생**을 대조해,
 * 반을 옮긴 학생이 보드에 남아 있으면 그 반은 보내지 않는다(반 공지는 보드에 남은 원아 전원에게 간다).
 * 테스트 발송 = `[수학] 테스트반`(학원* 원아만).
 * `canSend` = 수업보고서 쓰기(page.tsx의 `canSendReports`) — 읽기 권한이면 반 선택·제목·본문은 비활성 + 권한 안내,
 * 발송 단추는 그리지 않는다(원장 2026-11-05). ⚠️ 서버 `sendClassWideNotice`는 강사 신분(effectiveTeacherId)이면 이 판정 없이도
 * 받는다 — 화면이 그보다 좁은 것은 이번 변경 전부터다(전에도 canSend가 없으면 보내기가 비활성이었다).
 */
export function ClassNoticePanel({
  classes,
  boardClassIds,
  initial,
  canSend,
}: {
  classes: NoticeClassOption[];
  boardClassIds: string[];
  initial: ClassNoticeRow[];
  canSend: boolean;
}) {
  const subjects = useSubjectMaps();
  const [search, setSearch] = useState("");
  const withBoard = new Set(boardClassIds);
  const options = classes.filter((c) => withBoard.has(c.id)).sort((a, b) => a.name.localeCompare(b.name, "ko"));
  const visible = options.filter((c) => `${c.name} ${subjects.labelOf(c.subject ?? "")}`.toLocaleLowerCase("ko").includes(search.trim().toLocaleLowerCase("ko")));
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [rows, setRows] = useState<ClassNoticeRow[]>(initial);
  // 그 반 학부모 모두가 보는 이미지(선택) — 원생 개별 공지와 같은 업로드 부품(규칙이 두 벌로 갈라지지 않게).
  const [atts, setAtts] = useState<NoticeAttachment[]>([]);
  const [uploading, setUploading] = useState(false);

  const toggle = (id: string) =>
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  async function refresh() {
    const res = await listClassWideNotices();
    if (res.ok && res.rows) setRows(res.rows);
  }

  async function send(test: boolean) {
    if (!test && !window.confirm(`선택한 ${checked.size}개 반의 ClassNote 반에 공지를 1건씩 올립니다. 반에 있는 학부모 모두가 봅니다. 보낼까요?`))
      return;
    setBusy(true);
    const res = await sendClassWideNotice({ classIds: [...checked], title, body, test, ...(atts.length ? { attachments: atts } : {}) });
    setBusy(false);
    if (res.ok && res.dryRun) {
      toast.message("dry-run — '보고서 설정' 탭에서 'ClassNote 실제 발송'을 켜야 큐에 올라갑니다");
      return;
    }
    if (!res.ok) {
      toast.error(res.error ?? "반 단체 공지 요청에 실패했습니다");
      return;
    }
    const skipped = res.skipped?.length ? ` · 제외 ${res.skipped.join(", ")}` : "";
    toast.success(`${test ? "테스트반" : `${res.queued ?? 0}개 반`} 발송 대기(발송 PC가 순차 게시)${skipped}`);
    if (!test) {
      setChecked(new Set());
      setTitle("");
      setBody("");
      setAtts([]);
    }
    void refresh();
  }

  // 이미지가 올라가는 중에는 보내지 않는다 — 올리던 이미지가 빠진 채 나간다.
  const ready = !!title.trim() && !!body.trim() && canSend && !busy && !uploading;
  return (
    <div className="space-y-6">
      <section className="bg-card border-line shadow-card rounded-2xl border px-5 py-4">
        <div className="mb-3">
          <h2 className="text-foreground text-base font-bold">반 단체 공지</h2>
          <p className="text-text-faint text-xs">
            고른 반의 ClassNote 반에 공지가 1건씩 올라갑니다 · 반에 있는 학부모 모두가 봅니다 · 반을 옮긴 학생이
            반에 남아 있으면 그 반은 보내지 않습니다
          </p>
        </div>
        {/* 새로 만든 반은 반 보드가 연결된 뒤에야 여기 뜬다 — 새벽 동기화를 기다리지 않고 지금 맞춘다(0313a). */}
        <ClassnoteSyncNowButton source="class_notice" className="mb-2" />
        <input aria-label="반 단체 공지 반·과목 검색" placeholder="반·과목 검색" value={search}
          onChange={(e) => setSearch(e.target.value)} className="border-line mb-2 w-full max-w-sm rounded border px-3 py-1.5 text-sm" />
        <p className="text-text-dim mb-2 text-xs">선택 {checked.size}반 · 현재 목록 밖 {[...checked].filter((id) => !visible.some((c) => c.id === id)).length}반</p>
        {visible.length === 0 ? (
          <p className="text-text-faint text-sm">{options.length === 0 ? "ClassNote 반 연결이 있는 반이 없습니다." : "조건에 맞는 반이 없습니다."}</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {visible.map((c) => {
              const on = checked.has(c.id);
              return (
                <button
                  key={c.id}
                  type="button"
                  aria-pressed={on}
                  disabled={!canSend}
                  onClick={() => toggle(c.id)}
                  className={`rounded-full border px-3 py-1 text-sm transition disabled:cursor-not-allowed disabled:opacity-60 ${
                    on ? "border-primary bg-primary/10 text-primary font-bold" : "border-line text-text-dim hover:bg-bg-soft"
                  }`}
                >
                  {c.name}
                  <span className="text-text-faint ml-1 text-xs">{c.studentCount}명</span>
                </button>
              );
            })}
          </div>
        )}
        <div className="mt-4 flex flex-col gap-2">
          <input
            value={title}
            maxLength={CLASS_NOTICE_TITLE_MAX}
            onChange={(e) => setTitle(e.target.value)}
            disabled={!canSend}
            placeholder={canSend ? "제목" : writeLockedPlaceholder("lesson_reports")}
            className="border-line focus:border-primary rounded-md border bg-white px-3 py-2 text-sm outline-none disabled:cursor-not-allowed disabled:opacity-60"
          />
          <textarea
            value={body}
            maxLength={CLASS_NOTICE_BODY_MAX}
            onChange={(e) => setBody(e.target.value)}
            rows={6}
            disabled={!canSend}
            placeholder={canSend ? "공지 내용" : writeLockedPlaceholder("lesson_reports")}
            className="border-line focus:border-primary rounded-md border bg-white px-3 py-2 text-sm outline-none disabled:cursor-not-allowed disabled:opacity-60"
          />
        </div>
        {canSend ? (
          <div className="mt-3">
            <NoticeAttachmentPicker
              attachments={atts}
              onChange={setAtts}
              uploading={uploading}
              onUploadingChange={setUploading}
              disabled={busy}
              label="이미지 첨부 (그 반 학부모 모두에게)"
            />
          </div>
        ) : null}
        {/* 발송 단추는 쓰기 권한자만 — 읽기 권한엔 비활성 단추 대신 안내 한 줄. */}
        {canSend ? (
          <div className="mt-3 flex justify-end gap-2">
            <Button type="button" variant="outline" disabled={!ready} onClick={() => send(true)}>
              테스트 발송(테스트반)
            </Button>
            <Button type="button" disabled={!ready || checked.size === 0} onClick={() => send(false)}>
              {checked.size ? `${checked.size}개 반에 보내기${atts.length ? ` · 이미지 ${atts.length}` : ""}` : "반을 고르세요"}
            </Button>
          </div>
        ) : (
          <p className="text-text-faint mt-3 text-xs">{writeLockedNote("lesson_reports")}</p>
        )}
      </section>

      <section className="bg-card border-line shadow-card rounded-2xl border px-5 py-4">
        <h3 className="text-foreground mb-2 text-sm font-bold">최근 반 단체 공지</h3>
        {rows.length === 0 ? (
          <p className="text-text-faint text-sm">아직 없습니다.</p>
        ) : (
          <ul className="divide-line divide-y">
            {rows.map((r) => (
              <li key={r.id} className="py-2 text-sm">
                <div className="flex items-center gap-2">
                  <span className="text-foreground font-bold">{r.title}</span>
                  <span className="text-text-dim text-xs">{classNoticeStatusLabel(r.status)}</span>
                  <span className="text-text-faint ml-auto text-xs">{fmt(r.createdAt)}</span>
                </div>
                <p className="text-text-dim text-xs">
                  {r.classNames.join(", ")}
                  {r.imageCount ? ` · 이미지 ${r.imageCount}장` : ""}
                </p>
                {r.failures.map((f) => (
                  <p key={f} className="text-danger text-xs">
                    {f}
                  </p>
                ))}
                {r.error ? <p className="text-danger text-xs">{r.error}</p> : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
