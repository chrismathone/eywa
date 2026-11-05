"use client";

import { useActionState, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { Loader2, Pencil, Trash2 } from "@/components/icons/aywa-icon-compat";
import { Button } from "@/components/ui/button";
import {
  createNoticePopup,
  updateNoticePopup,
  deleteNoticePopup,
  regenerateNoticeTranslation,
  toggleNoticePopupActive,
  type NoticePopupActionState,
} from "@/features/notices/server/actions";
import {
  POPUP_AUDIENCES,
  AUDIENCE_LABEL,
  POPUP_POSITIONS,
  POSITION_LABEL,
  type PopupAudience,
  type PopupPosition,
} from "@/features/notices/audience";
import { issueBrandingUploadTicket } from "@/features/owner/server/actions";
import { uploadToTicket } from "@/lib/storage/upload-to-ticket";
import type { AdminPopup } from "@/features/notices/server/queries";
import { MenuMentionEditor } from "@/components/editor/menu-mention-editor";
import { kstDateTimeLocal, kstShortStamp } from "@/lib/date-kst";
import { writeLockedNote } from "@/lib/write-lock";

const INPUT = "border-border bg-card text-foreground min-w-0 w-full rounded-md border px-2.5 py-1.5 text-sm";
const LABEL = "text-text-dim text-xs font-medium";

/**
 * ISO → datetime-local 입력값("YYYY-MM-DDTHH:mm", **KST**). 빈 값은 "".
 * 🔴 런타임 로컬 게터로 풀지 말 것 — 서버 렌더(UTC)와 브라우저가 9시간 다른 값을 박는다. 저장은 같은 벽시계를
 *    KST로 읽는다(actions.ts `kstLocalToIso`) — 이 둘이 짝이라 고치지 않고 다시 저장해도 시각이 그대로다.
 */
function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : kstDateTimeLocal(d);
}

/**
 * 목록의 노출 기간 한 줄 — 시각이 화면에 안 보이면 저장이 어긋나도 아무도 모른다(2026-10-14: 9시간 늦게 저장된 공지가
 * 목록엔 그냥 '켜짐'으로 보였다). 상태는 지금 시각으로 판정(예약·노출 중·종료) — 꺼 둔 공지는 켜고 끄기 칩이 말한다.
 */
function periodLine(p: AdminPopup, now: number): string {
  const from = p.startsAt ? kstShortStamp(p.startsAt) : null;
  const to = p.endsAt ? kstShortStamp(p.endsAt) : null;
  const range = from || to ? `${from ?? "바로"} ~ ${to ?? "계속"}` : "기간 없음";
  if (!p.isActive) return range;
  const starts = p.startsAt ? new Date(p.startsAt).getTime() : null;
  const ends = p.endsAt ? new Date(p.endsAt).getTime() : null;
  const state = starts !== null && starts > now ? "예약" : ends !== null && ends < now ? "종료" : "노출 중";
  return `${range} · ${state}`;
}

function SubmitBtn({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? <Loader2 className="size-4 animate-spin" /> : null}
      {label}
    </Button>
  );
}

/**
 * **[영문]** — 이 공지의 영문 번역 상태 + 만들기 버튼(0249a). 원장 2026-09-03 *"공지사항도 영어로"*.
 *
 * 🔑 기존 공지는 저장 시점이 지나 캐시가 없다 → **사람이 누르는 명시 트리거**가 여기다
 *    (페이지 로드에서 자동 생성하지 않는 이유 = 팝업은 창마다 도는 경로, B6).
 * ⚠️ 상태가 넷이라 색·문구를 갈라 적는다 — `없음`/`옛 원문`(있지만 안 쓴다)/`영문 있음`/`건너뜀`.
 *    🔴 `건너뜀`은 실패가 아니라 **일부러 안 보낸 것**(민감정보)이라 사유를 함께 보인다.
 */
function EnglishForm({
  id,
  status,
  skipReason,
}: {
  id: string;
  status: "none" | "stale" | "ready" | "skipped";
  skipReason: string | null;
}) {
  const [state, action, pending] = useActionState(regenerateNoticeTranslation, undefined);
  const label = pending
    ? "만드는 중…"
    : status === "ready"
      ? "영문 있음"
      : status === "stale"
        ? "옛 원문"
        : status === "skipped"
          ? "건너뜀"
          : "영문 만들기";
  const tone =
    status === "ready"
      ? "bg-success-soft text-success"
      : status === "stale"
        ? "bg-amber-soft text-amber"
        : status === "skipped"
          ? "bg-bg-soft text-text-faint"
          : "bg-bg-soft text-text-dim hover:bg-line-strong/20";
  return (
    <form action={action} className="flex items-center gap-1">
      <input type="hidden" name="id" value={id} />
      <button
        type="submit"
        disabled={pending}
        // 이미 있어도 다시 누를 수 있다(원문을 고친 뒤 '옛 원문'을 최신으로 만드는 길).
        title={
          state?.error ??
          skipReason ??
          "원어민 강사에게 보일 영문을 만듭니다. 학생·반 이름 등 고유명사는 번역하지 않습니다."
        }
        className={`rounded-full px-2 py-0.5 text-xs font-bold transition disabled:cursor-wait disabled:opacity-60 ${tone}`}
      >
        {label}
      </button>
      {/* 실패·건너뜀 사유는 **화면에 적는다** — 툴팁만 두면 모바일에서 없는 것과 같다. */}
      {state?.error ? <span className="text-danger max-w-40 text-xs break-keep">{state.error}</span> : null}
    </form>
  );
}

function ToggleForm({ id, isActive }: { id: string; isActive: boolean }) {
  const [, action] = useActionState(toggleNoticePopupActive, undefined);
  return (
    <form action={action}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="isActive" value={isActive ? "false" : "true"} />
      <button
        type="submit"
        className={`rounded-full px-2 py-0.5 text-xs font-bold transition ${
          isActive
            ? "bg-primary-soft text-primary hover:bg-primary-soft/70"
            : "bg-bg-soft text-text-faint hover:bg-line-strong/20"
        }`}
      >
        {isActive ? "노출 중" : "꺼짐"}
      </button>
    </form>
  );
}

function DeleteForm({ id }: { id: string }) {
  const [, action] = useActionState(deleteNoticePopup, undefined);
  const [confirm, setConfirm] = useState(false);
  if (!confirm) {
    return (
      <button
        type="button"
        onClick={() => setConfirm(true)}
        aria-label="삭제"
        className="text-text-dim hover:text-danger inline-flex items-center transition"
      >
        <Trash2 className="size-3.5" />
      </button>
    );
  }
  return (
    <form action={action} className="flex items-center gap-1">
      <input type="hidden" name="id" value={id} />
      <button type="submit" className="text-danger text-xs font-bold">
        삭제
      </button>
      <button type="button" onClick={() => setConfirm(false)} className="text-text-faint text-xs">
        취소
      </button>
    </form>
  );
}

/** 팝업 이미지 업로드(branding 슬롯 재사용, owner 쓰기 권한 — master + 위임 admin/manager). value=저장 경로/URL. */
function PopupImageField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setErr(null);
    if (!file.type.startsWith("image/")) return setErr("이미지 파일만 업로드할 수 있습니다");
    if (file.size > 5 * 1024 * 1024) return setErr("파일이 너무 큽니다 (최대 5MB)");
    setBusy(true);
    try {
      const ext = file.name.split(".").pop()?.toLowerCase() || "png";
      const fd = new FormData();
      fd.set("slot", "popup");
      fd.set("ext", ext);
      fd.set("contentType", file.type);
      fd.set("size", String(file.size));
      const tk = await issueBrandingUploadTicket(undefined, fd);
      if (tk?.error || !tk?.ticket) return setErr(tk?.error ?? "업로드 준비 실패");
      await uploadToTicket(tk.ticket, file);
      onChange(tk.ticket.path);
      setPreview(URL.createObjectURL(file));
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "업로드 실패");
    } finally {
      setBusy(false);
    }
  }

  const previewSrc = preview || (value.startsWith("http") ? value : null);
  return (
    <div className="flex flex-col gap-1.5">
      <span className={LABEL}>이미지 (선택)</span>
      <input type="hidden" name="imageUrl" value={value} />
      <div className="flex items-center gap-3">
        <div className="border-line bg-bg-soft flex h-14 w-20 shrink-0 items-center justify-center overflow-hidden rounded border">
          {previewSrc ? (
            // eslint-disable-next-line @next/next/no-img-element -- objectURL/외부 미리보기
            <img src={previewSrc} alt="" className="h-full w-full object-contain" />
          ) : value ? (
            <span className="text-text-faint text-xs">업로드됨</span>
          ) : (
            <span className="text-text-faint text-xs">없음</span>
          )}
        </div>
        <label className="border-line text-text-dim hover:text-foreground hover:bg-bg-soft inline-flex cursor-pointer items-center rounded-md border px-2.5 py-1 text-xs transition">
          <input type="file" accept="image/*" hidden onChange={onFile} disabled={busy} />
          {busy ? "업로드 중…" : "이미지 업로드"}
        </label>
        {value ? (
          <button type="button" onClick={() => { onChange(""); setPreview(null); }} className="text-text-faint hover:text-danger text-xs">
            제거
          </button>
        ) : null}
      </div>
      {err ? <p className="text-danger text-xs">{err}</p> : null}
    </div>
  );
}

/** 읽기 권한에서 영문 상태를 단추 대신 글로 — 상태 문구는 단추와 같다. */
const EN_STATUS_LABEL: Record<AdminPopup["enStatus"], string> = { none: "영문 없음", stale: "옛 원문", ready: "영문 있음", skipped: "건너뜀" };

export function PopupsManager({ items, canWrite = true }: { items: AdminPopup[]; canWrite?: boolean }) {
  const [editing, setEditing] = useState<AdminPopup | null>(null);
  const [imageUrl, setImageUrl] = useState("");
  const [formKey, setFormKey] = useState(0);
  // 목록의 예약·노출 중·종료 판정 기준 = 이 화면을 연 시각(오래 열어 두면 새로고침해야 바뀐다). 서버 렌더와 몇 초 차이는 suppressHydrationWarning.
  const [now] = useState(() => Date.now());
  const formRef = useRef<HTMLFormElement>(null);

  const [state, action] = useActionState<NoticePopupActionState, FormData>(
    async (prev, formData) => {
      const run = editing ? updateNoticePopup : createNoticePopup;
      const res = await run(prev, formData);
      if (res?.ok) {
        setEditing(null);
        setImageUrl("");
        setFormKey((k) => k + 1);
      }
      return res;
    },
    undefined,
  );

  const startNew = () => { setEditing(null); setImageUrl(""); setFormKey((k) => k + 1); };
  const startEdit = (p: AdminPopup) => { setEditing(p); setImageUrl(p.imageUrl ?? ""); setFormKey((k) => k + 1); };
  const e = editing;

  return (
    <div className={`grid min-w-0 grid-cols-1 gap-6 lg:items-start [&>section]:min-w-0 ${canWrite ? "lg:grid-cols-2" : ""}`}>
      {/* 🔴 작성/수정 폼 — 읽기 권한이면 **그리지 않는다**(비활성 양식을 남기면 '새 팝업 공지'를 쓸 수 있는 것처럼 읽힌다). */}
      {canWrite ? (
      <section className="bg-card border-line shadow-card rounded-2xl border p-5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-foreground text-sm font-bold">{e ? "팝업 수정" : "새 팝업 공지"}</h2>
          {e ? (
            <Button type="button" variant="ghost" size="sm" onClick={startNew}>
              새로 작성
            </Button>
          ) : null}
        </div>

        <form key={formKey} ref={formRef} action={action} className="space-y-3">
          {e ? <input type="hidden" name="id" value={e.id} /> : null}

          <div className="flex flex-col gap-1.5">
            <span className={LABEL}>제목 *</span>
            <input name="title" required defaultValue={e?.title ?? ""} placeholder="예: 여름방학 특강 안내" className={INPUT} />
          </div>

          <div className="flex flex-col gap-1.5">
            <span className={LABEL}>본문</span>
            <MenuMentionEditor name="body" defaultValue={e?.body ?? ""} ariaLabel="팝업 공지 본문" placeholder="공지 내용 (이미지만 쓰면 비워도 됩니다). @로 메뉴를 선택하세요." />
          </div>

          <PopupImageField value={imageUrl} onChange={setImageUrl} />

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <span className={LABEL}>링크 URL</span>
              <input name="linkUrl" type="url" defaultValue={e?.linkUrl ?? ""} placeholder="https://…" className={INPUT} />
            </div>
            <div className="flex flex-col gap-1.5">
              <span className={LABEL}>링크 버튼 라벨</span>
              <input name="linkLabel" defaultValue={e?.linkLabel ?? ""} placeholder="자세히 보기" className={INPUT} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <span className={LABEL}>대상</span>
              <select name="audience" defaultValue={e?.audience ?? "all"} className={INPUT}>
                {POPUP_AUDIENCES.map((a) => (
                  <option key={a} value={a}>{AUDIENCE_LABEL[a as PopupAudience]}</option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <span className={LABEL}>위치</span>
              <select name="position" defaultValue={e?.position ?? "cascade"} className={INPUT}>
                {POPUP_POSITIONS.map((p) => (
                  <option key={p} value={p}>{POSITION_LABEL[p as PopupPosition]}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <span className={LABEL}>폭 (px, 280–720)</span>
              <input name="width" type="number" min={280} max={720} defaultValue={e?.width ?? 380} className={INPUT} />
            </div>
            <div className="flex flex-col gap-1.5">
              <span className={LABEL}>우선순위 (클수록 먼저)</span>
              <input name="priority" type="number" min={0} max={999} defaultValue={e?.priority ?? 0} className={INPUT} />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="flex min-w-0 flex-col gap-1.5">
              <span className={LABEL}>노출 시작 (선택)</span>
              <input name="startsAt" type="datetime-local" defaultValue={toLocalInput(e?.startsAt ?? null)} className={INPUT} />
            </div>
            <div className="flex min-w-0 flex-col gap-1.5">
              <span className={LABEL}>노출 종료 (선택)</span>
              <input name="endsAt" type="datetime-local" defaultValue={toLocalInput(e?.endsAt ?? null)} className={INPUT} />
            </div>
          </div>

          <label className="text-foreground flex items-center gap-2 text-sm">
            <input type="checkbox" name="isActive" defaultChecked={e ? e.isActive : true} />
            노출 활성화 (체크 해제 시 표시 안 함)
          </label>

          {state?.error ? <p className="text-danger text-sm">{state.error}</p> : null}
          <div className="flex justify-end">
            <SubmitBtn label={e ? "수정 저장" : "팝업 생성"} />
          </div>
        </form>
      </section>
      ) : null}

      {/* 목록 */}
      <section className="bg-card border-line shadow-card rounded-2xl border p-5">
        <p className="micro mb-3">등록된 팝업 ({items.length})</p>
        {canWrite ? null : <p className="text-text-faint mb-3 text-xs">{writeLockedNote("popup_settings")}</p>}
        {items.length === 0 ? (
          <p className="text-text-faint py-6 text-center text-sm">아직 팝업 공지가 없습니다</p>
        ) : (
          <ul className="divide-line divide-y">
            {items.map((p) => (
              <li key={p.id} className="flex flex-col items-start justify-between gap-3 py-3 sm:flex-row">
                <div className="flex min-w-0 max-w-full items-start gap-2.5">
                  {p.imageSrc ? (
                    // eslint-disable-next-line @next/next/no-img-element -- signed/외부 썸네일
                    <img src={p.imageSrc} alt="" className="border-line h-10 w-14 shrink-0 rounded border object-cover" />
                  ) : null}
                  <div className="min-w-0">
                    <p className="text-foreground truncate text-sm font-bold">{p.title}</p>
                    <p className="text-text-faint mt-0.5 text-xs">
                      {AUDIENCE_LABEL[p.audience as PopupAudience] ?? p.audience} · {POSITION_LABEL[p.position as PopupPosition] ?? p.position} · 우선 {p.priority}
                    </p>
                    <p className="text-text-faint mt-0.5 text-xs" suppressHydrationWarning>
                      {periodLine(p, now)}
                    </p>
                  </div>
                </div>
                {canWrite ? (
                  <div className="flex max-w-full shrink-0 flex-wrap items-center gap-2.5 pt-0.5">
                    <EnglishForm id={p.id} status={p.enStatus} skipReason={p.enSkipReason} />
                    <ToggleForm id={p.id} isActive={p.isActive} />
                    <button type="button" onClick={() => startEdit(p)} aria-label="수정" className="text-text-dim hover:text-foreground inline-flex items-center transition">
                      <Pencil className="size-3.5" />
                    </button>
                    <DeleteForm id={p.id} />
                  </div>
                ) : (
                  // 읽기 권한 — 노출 여부·영문 상태는 글로만(누르는 칩이 아니다).
                  <div className="text-text-faint flex max-w-full shrink-0 flex-wrap items-center gap-2.5 pt-0.5 text-xs">
                    <span>{EN_STATUS_LABEL[p.enStatus]}</span>
                    <span className={p.isActive ? "text-primary font-bold" : undefined}>{p.isActive ? "노출 중" : "꺼짐"}</span>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
