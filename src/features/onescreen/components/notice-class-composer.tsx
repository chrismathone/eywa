"use client";

// 원스크린 **반 공지** 작성부 — 고른 반의 ClassNote 반에 공지 1건(ClassNote 공지사항). 원장 2026-10-02:
// *"반 공지는 클래스노트의 공지사항을 활용하고 개인 공지는 수업보고서와 동일하게 일인발송으로"* ·
// *"공지 발송 모드에서 반인지 개별인지를 선택하는 토글 … 배선이 철저해야 오발송 일어나지 않음"*.
//
// 🔴 반 공지는 **그 반 학부모 모두**가 본다 — 학생마다 다른 내용(개별 내용·요청서 이미지)을 넣는 칸을 두지 않는다
//    (개인 내용은 '원생 개별 공지'로만 나간다). 고를 수 있는 반 = 서버가 준 목록뿐(담당 반 ∩ ClassNote 반 보드 연결).
//    서버가 같은 규칙으로 다시 확인하고(`sendClassWideNotice`), 워커가 보드 원아 = 그 반 재원생을 대조한 뒤에만 올린다.
// 이미지는 붙일 수 있다(원장 2026-10-03 *"반공지 이미지 가능하게"*) — 학생별이 아니라 **그 반 학부모 모두가 보는 공통 이미지**다.
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { loadMyClassWideNotice, sendClassWideNotice } from "@/features/report-admin/server/class-notice-actions";
import { CLASS_NOTICE_BODY_MAX, CLASS_NOTICE_TITLE_MAX, type ClassNoticeRow } from "@/features/report-admin/class-notice";
import { useSheetT, useSheetTf } from "@/features/teacher-view/lang-context";
import type { SheetDictKey } from "@/features/teacher-view/i18n";
import { NoticeHistory, NoticeHistoryItem } from "./notice-history";
import { NoticeAttachmentPicker } from "./notice-attachment-picker";
import type { NoticeAttachment } from "../notice-attachments";

const FIELD = "border-line bg-card text-foreground rounded-lg border px-3 py-2 text-sm w-full";

/** 반 공지 상태 → 사전 키(원문 노출 금지). 모르는 값은 '확인 필요'. */
function statusKey(s: string): SheetDictKey {
  switch (s) {
    case "queued":
      return "os.nc.st.queued";
    case "processing":
      return "os.nc.st.processing";
    case "success":
      return "os.nc.st.success";
    case "partial":
      return "os.nc.st.partial";
    case "failed":
      return "os.nc.st.failed";
    default:
      return "os.nc.st.other";
  }
}

export type ClassNoticeTarget = { id: string; name: string; studentCount: number };

/**
 * `classes`·`initialRows` = 부모(공지 화면)가 한 번 받아 내려 준다 — 반 공지를 쓸 수 있는지(토글을 보일지)와 같은 조회다.
 * 🔴 받을 반은 **미리 골라 두지 않는다** — 반 공지는 그 반 학부모 모두에게 가므로, 강사가 직접 누른 반에만 보낸다.
 */
export function NoticeClassComposer({
  classes,
  initialRows,
  sendEnabled,
}: {
  classes: ClassNoticeTarget[];
  initialRows: ClassNoticeRow[];
  sendEnabled: boolean;
}) {
  const t = useSheetT();
  const tf = useSheetTf();
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [rows, setRows] = useState<ClassNoticeRow[]>(initialRows);
  const [atts, setAtts] = useState<NoticeAttachment[]>([]); // 그 반 학부모 모두가 보는 이미지(선택)
  const [uploading, setUploading] = useState(false);

  const toggle = (id: string) =>
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // 🔴 보낼 반은 **지금 보이는 목록 안에서 고른 것만** — 목록에서 사라진 반(연결이 걷힌 반)의 선택이 남아 따라가지 않게.
  const picked = classes.filter((c) => checked.has(c.id));

  async function send(test: boolean) {
    if (!title.trim() || !body.trim()) {
      toast.error(t("os.nc.needText"));
      return;
    }
    if (!test && picked.length === 0) {
      toast.error(t("os.nc.needClass"));
      return;
    }
    if (!test && !window.confirm(tf("os.nc.confirm", { n: picked.length, names: picked.map((c) => c.name).join(", ") }))) return;
    setBusy(true);
    const res = await sendClassWideNotice({
      classIds: test ? [] : picked.map((c) => c.id),
      title: title.trim(),
      body: body.trim(),
      test,
      ...(atts.length ? { attachments: atts } : {}),
    });
    setBusy(false);
    if (!res.ok) {
      toast.error(res.error ?? t("os.nc.fail"));
      return;
    }
    if (res.dryRun) {
      toast.message(t("os.nc.dryRun"));
      return;
    }
    const skipped = res.skipped?.length ? tf("os.nc.skipped", { names: res.skipped.join(", ") }) : "";
    toast.success((test ? t("os.nc.queuedTest") : tf("os.nc.queued", { n: res.queued ?? 0 })) + skipped);
    if (!test) {
      setChecked(new Set());
      setTitle("");
      setBody("");
      setAtts([]);
    }
    const again = await loadMyClassWideNotice();
    if (again.ok && again.rows) setRows(again.rows);
  }

  // 이미지가 올라가는 중에는 보내지 않는다 — 올리던 이미지가 빠진 채 나간다.
  const ready = !!title.trim() && !!body.trim() && !busy && !uploading;
  return (
    <div className="space-y-4">
      <section className="bg-card border-line shadow-card space-y-3 rounded-2xl border px-4 py-3">
        <div>
          <h2 className="text-foreground text-base font-bold">{t("os.nc.heading")}</h2>
          <p className="text-text-faint text-xs break-keep">{t("os.nc.hint")}</p>
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
          <p className="text-text-dim mb-1 text-xs font-medium">
            {t("os.nc.classes")} <span className="text-primary">{picked.length}</span>
          </p>
          {classes.length === 0 ? (
            <p className="text-text-faint text-sm">{t("os.nc.empty")}</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {classes.map((c) => {
                const on = checked.has(c.id);
                return (
                  <button
                    key={c.id}
                    type="button"
                    aria-pressed={on}
                    onClick={() => toggle(c.id)}
                    className={`rounded-full border px-3 py-1 text-sm transition ${
                      on ? "border-primary bg-primary/10 text-primary font-bold" : "border-line text-text-dim hover:bg-bg-soft"
                    }`}
                  >
                    {c.name}
                    <span className="text-text-faint ml-1 text-xs">{tf("os.nc.count", { n: c.studentCount })}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
        <input
          value={title}
          maxLength={CLASS_NOTICE_TITLE_MAX}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={t("os.nc.title")}
          aria-label={t("os.nc.title")}
          className={FIELD}
        />
        <textarea
          value={body}
          maxLength={CLASS_NOTICE_BODY_MAX}
          onChange={(e) => setBody(e.target.value)}
          rows={6}
          placeholder={t("os.nc.body")}
          aria-label={t("os.nc.body")}
          className={`${FIELD} resize-y`}
        />
        <NoticeAttachmentPicker
          attachments={atts}
          onChange={setAtts}
          uploading={uploading}
          onUploadingChange={setUploading}
          disabled={busy}
          label={t("os.nc.attach")}
        />
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" disabled={!ready || picked.length === 0} onClick={() => send(false)}>
            {busy ? t("os.n.sending") : picked.length ? tf("os.nc.send", { n: picked.length }) : t("os.nc.sendNone")}
            {atts.length ? tf("os.na.count", { n: atts.length }) : ""}
          </Button>
          <Button size="sm" variant="outline" disabled={!ready} onClick={() => send(true)} title={t("os.nc.testTitle")}>
            {t("os.nc.test")}
          </Button>
        </div>
      </section>

      <NoticeHistory title={t("os.nc.history")} empty={t("os.nc.historyEmpty")} rows={rows}>
            {(r) => (
              <NoticeHistoryItem title={r.title} status={t(statusKey(r.status))}>
                <p className="text-text-dim text-xs break-keep">
                  {r.classNames.join(", ")}
                  {r.imageCount ? tf("os.nc.images", { n: r.imageCount }) : ""}
                </p>
                {r.failures.map((f) => (
                  <p key={f} className="text-danger text-xs">
                    {f}
                  </p>
                ))}
                {r.error ? <p className="text-danger text-xs">{r.error}</p> : null}
              </NoticeHistoryItem>
            )}
      </NoticeHistory>
    </div>
  );
}
