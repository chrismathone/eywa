"use client";

/**
 * 오늘 보드의 **계획 편집기** — 주간 시트와 *같은 기계*를 그대로 쓴다(원장 지시 2026-08-07
 * "오늘 입력 가능한 건 오늘 여기서 바로 입력해서 동기화").
 *
 * 🔑 새로 만든 게 아니라 **재사용**이다. 세 가지가 주간 시트와 한 벌로 묶인다:
 *  ① **저널**(`useSheetDoc` → IndexedDB) — *"창이 갑자기 닫혀도 입력한 부분이 남는다"*. 미전송 패치가
 *     로컬에 먼저 적히고, 다음에 열면 복구 후보로 뜬다.
 *  ② **CAS 저장**(`useSheetSaveStore` → `flushSheetPatches`) — 내가 본 값(expected)을 함께 보내
 *     남이 먼저 고쳤으면 덮지 않고 **충돌로 세운다**(자동 덮어쓰기 금지).
 *  ③ **presence**(`ecs:{classId}:{week}`) — 주간 시트와 **같은 scope**라, 누가 주간 시트에서 이 반을
 *     열고 있으면 여기서도 "수정 중"이 뜬다(반대도 마찬가지). scope를 새로 만들면 두 화면이 서로를 못 본다.
 *
 * ⚠️ 줄 추가·삭제·시기 이동은 여기 없다 — 오늘 칸은 **이미 있는 줄을 채우는 자리**다. 구조 변경은
 *    주간 시트에서(같은 화면에 두 개의 구조 편집 경로를 두면 line_no 정합을 두 곳에서 지켜야 한다).
 */
import { useSheetFeedback } from "@/features/teacher-view/lang-context";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { skillAreaColorOf, skillAreaLabelOf } from "@/features/owner/skill-areas";
import { SUBJECT_BORDER, SUBJECT_SOFT } from "@/features/owner/subjects";
import type { SkillAreaSetting } from "@/features/owner/settings-types";
import { useEditPresence, useEditingOthers } from "@/features/presence/edit-presence";
import { dedupeEditors } from "@/features/presence/presence-state";
import { flushSheetPatches, setSlotShouting } from "../server/actions";
import { buildSaveKey } from "../lib/save-keys";
import { ecsPresenceScope } from "../lib/presence-scope";
import type { PlanPatchField } from "../lib/plan-codec";
import { TodayCopySlot } from "./today-copy-slot";
import { useSheetLang, useSheetT, useSheetTf } from "@/features/teacher-view/lang-context";
import { useTextbookOptions } from "@/features/textbooks/textbook-options-context";
import { roomNameFor } from "@/features/teacher-view/room-name";
import { useSheetDoc } from "./use-sheet-doc";
import { useSheetEditAudit } from "./use-sheet-edit-audit";
import {
  useCellState,
  useFlushOnUnmount,
  useSheetSaveStore,
  type SheetSaveStore,
} from "./use-sheet-saves";
import type { TodaySlot } from "../server/today";
import type { CarryPatch } from "../lib/carry-marks";
import { writeLockedPlaceholder } from "@/lib/write-lock";

// 입력칸 테두리 = line-strong(18%) — 헤어라인 9%는 흰 카드 위에서 칸 경계가 안 보인다(주간 시트와 동일).
const cellCls =
  "border-line-strong text-foreground bg-card w-full rounded-lg border px-1.5 py-1 text-sm outline-none focus:border-primary disabled:opacity-60";

/** CAS 입력 한 칸 — 충돌이 서면 그 칸만 멈추고 "서버값/내 값"을 묻는다(주간 시트 `CasInput`과 동일 계약). */
function CasInput({
  store,
  lineId,
  field,
  fallback,
  canEdit,
  ariaLabel,
  placeholder,
  listId,
  onCommit,
}: {
  store: SheetSaveStore;
  lineId: string;
  field: PlanPatchField;
  fallback: string | null;
  canEdit: boolean;
  ariaLabel: string;
  placeholder?: string;
  /** `<datalist>` id — 교재 칸만 준다(없으면 속성을 아예 안 단다). */
  listId?: string | null;
  /** 칸을 떠날 때 그 시점 값으로 한 번 불린다 — 교재 칸이 페이지/시간을 채우는 자리. */
  onCommit?: (value: string) => void;
}) {
  const saveKey = buildSaveKey(lineId, field);
  const t = useSheetT();
  const cell = useCellState(store, saveKey);
  const value = cell ? (cell.value ?? "") : (fallback ?? "");
  if (cell?.conflict) {
    return (
      <div className="border-danger bg-danger/5 space-y-1 rounded-lg border px-1.5 py-1">
        <p className="text-danger text-xs leading-tight">
          {t("cell.conflict.server")} <b>{cell.conflict.serverValue ?? t("cell.conflict.empty")}</b>
        </p>
        <p className="text-text-dim truncate text-xs">
          {t("cell.conflict.mine")} {value || t("cell.conflict.empty")}
        </p>
        <div className="flex gap-1">
          <button
            type="button"
            className="border-line-strong text-foreground cursor-pointer rounded-full border px-1.5 text-xs"
            onClick={() => store.resolveConflict(saveKey, "server")}
          >
            {t("cell.conflict.useServer")}
          </button>
          <button
            type="button"
            className="border-danger text-danger cursor-pointer rounded-full border px-1.5 text-xs font-medium"
            onClick={() => store.resolveConflict(saveKey, "mine")}
          >
            {t("cell.conflict.useMine")}
          </button>
        </div>
      </div>
    );
  }
  return (
    <input
      className={cellCls}
      value={value}
      disabled={!canEdit}
      aria-label={ariaLabel}
      // 읽기 권한이면 '교재'·'진도'처럼 쓰기를 권하는 자리 표시 글을 걷고 툴팁으로 안내한다 — 줄마다 칸이
      // 네 개라 문구를 칸마다 박지 않는다(화면 한 줄 = ecs/page.tsx 오늘 면). 원장 2026-11-05 읽기 권한 규칙.
      placeholder={canEdit ? placeholder : undefined}
      title={canEdit ? undefined : writeLockedPlaceholder("ecs")}
      list={listId ?? undefined}
      onChange={(e) => store.edit(lineId, field, e.target.value)}
      onBlur={onCommit ? (e) => onCommit(e.target.value) : undefined}
    />
  );
}

/**
 * 교재 칸 — 제안 목록(교재목록 마스터, 0266a) + 고르면 **빈** 페이지/시간 칸만 채운다.
 *
 * 🔴 주간 시트 `PlanRow`와 **같은 규약**이다(그쪽 주석이 정본): 이미 적힌 값은 안 덮고, 구분은 자동으로
 *    바꾸지 않는다. 오늘 면이 계획 표를 따로 구현하고 있어 같은 동작을 여기 한 번 더 붙인다 —
 *    한쪽만 고치면 같은 칸이 화면마다 다르게 군다.
 * ⚠️ 줄마다 훅을 쓰므로 **컴포넌트로 떼어 낸다**(map 안에서 훅을 부를 수 없다).
 */
function BookCasInput({
  store,
  lineId,
  fallback,
  pageRangeFallback,
  canEdit,
  ariaLabel,
  placeholder,
}: {
  store: SheetSaveStore;
  lineId: string;
  fallback: string | null;
  pageRangeFallback: string | null;
  canEdit: boolean;
  ariaLabel: string;
  placeholder?: string;
}) {
  const { options, listId } = useTextbookOptions();
  const pageCell = useCellState(store, buildSaveKey(lineId, "page_range"));
  const pageValue = pageCell ? (pageCell.value ?? "") : (pageRangeFallback ?? "");
  const onCommit = useCallback(
    (raw: string) => {
      if (!canEdit) return;
      if (pageValue.trim() !== "") return; // 이미 적힌 칸은 그대로
      const typed = raw.trim().toLowerCase();
      if (!typed) return;
      const hit = options.find((o) => o.title.trim().toLowerCase() === typed);
      const pageTime = hit?.pageTime?.trim();
      if (!pageTime) return;
      store.edit(lineId, "page_range", pageTime);
    },
    [canEdit, pageValue, options, store, lineId],
  );
  return (
    <CasInput
      store={store}
      lineId={lineId}
      field="textbook"
      fallback={fallback}
      canEdit={canEdit}
      ariaLabel={ariaLabel}
      placeholder={placeholder}
      listId={listId}
      onCommit={onCommit}
    />
  );
}

/** 영역(구분) 알약 — **색은 학원설정이 단일 소스**(주간 시트 계획 표·패널과 같은 색). */
function AreaChip({
  store,
  lineId,
  fallback,
  skillAreas,
}: {
  store: SheetSaveStore;
  lineId: string;
  fallback: string | null;
  skillAreas: SkillAreaSetting[];
}) {
  const cell = useCellState(store, buildSaveKey(lineId, "skill_area"));
  const key = cell?.value ?? fallback ?? "";
  const { label } = skillAreaLabelOf(skillAreas, key);
  const tone = skillAreaColorOf(skillAreas, key);
  return (
    <span
      className={`inline-grid shrink-0 rounded-full border px-2 py-0.5 text-center text-xs font-bold ${SUBJECT_BORDER[tone]} ${SUBJECT_SOFT[tone]}`}
    >
      {/* 폭 맞춤판 — 설정된 모든 영역 라벨을 같은 격자 칸에 **투명하게 겹쳐** 두면 칩 폭이 가장 긴
          라벨로 확정된다. 모든 칩이 같은 판을 깔므로 줄마다 칩 폭이 같아지고, 뒤따르는 교재·페이지·
          진도·과제 칸의 왼쪽 끝이 줄 사이에서 맞는다(원장 2026-08-18 "라벨 크기 일정하게").
          라벨은 학원설정이라 고정 px로 못 박으면 긴 라벨이 잘린다 — 판이 설정을 따라 늘어난다. */}
      {skillAreas.map((a) => (
        <span key={a.key} aria-hidden className="invisible col-start-1 row-start-1 whitespace-nowrap">
          {a.label}
        </span>
      ))}
      <span className="col-start-1 row-start-1 whitespace-nowrap">{label}</span>
    </span>
  );
}

export function TodayPlanEditor({
  classId,
  className,
  weekMonday,
  date,
  slots,
  skillAreas,
  canEdit,
  userId,
  tenantId,
  onCarried,
  isEie = false,
  initialShouting,
}: {
  classId: string;
  className: string;
  weekMonday: string;
  /** 보드가 보는 날짜 — '내용 복사'의 대상 날짜(주차가 아니라 그 날 계획 행이다). */
  date: string;
  slots: TodaySlot[];
  skillAreas: SkillAreaSetting[];
  canEdit: boolean;
  userId: string;
  tenantId: string;
  /** JJ 이어받기로 채워진 학생 칸 — 보드가 마크 상태에 머지한다(TodayCopySlot 각주 참조). */
  onCarried?: (slotStart: string, patches: CarryPatch[]) => void;
  /** EiE 반인가 — Shouting 체크(0230a)를 그리는 조건(원장 2026-08-27, 인재원 영어는 안 쓴다). */
  isEie?: boolean;
  /** 오늘 이미 체크된 교시 시각 — 서버 스냅샷(주간 시트와 같은 표). */
  initialShouting?: readonly string[];
}) {
  const feedback = useSheetFeedback();
  const t = useSheetT();
  const tf = useSheetTf();
  const lang = useSheetLang();
  // Shouting 체크는 **이 컴포넌트가 소유**한다(반+날짜+교시가 앵커라 보드까지 올릴 이유가 없다).
  // 낙관 반영 후 실패하면 되돌리고 이유를 띄운다 — 주간 시트와 같은 처방.
  // ⚠️ 인자 이름은 `hm`(HH:MM) — 위 번역 함수 `t`를 가리지 않게(그림자 이름은 읽는 사람을 헷갈리게 한다).
  const [shouting, setShouting] = useState<Record<string, boolean>>(() =>
    Object.fromEntries((initialShouting ?? []).map((hm) => [hm, true])),
  );
  const toggleShouting = (slotStart: string, next: boolean) => {
    setShouting((prev) => ({ ...prev, [slotStart]: next }));
    void setSlotShouting({ classId, date, slotStart, value: next }).then((r) => {
      if (!r.ok) {
        setShouting((prev) => ({ ...prev, [slotStart]: !next }));
        toast.error(feedback(r.error));
      }
    });
  };
  // ① 저널 — 창이 닫혀도 미전송 입력이 IndexedDB에 남는다. 주간 시트와 **같은 문서 키**(반+주차).
  const doc = useSheetDoc({ tenantId, userId, classId, week: weekMonday });
  const send = useCallback((patches: Parameters<typeof flushSheetPatches>[1]) => flushSheetPatches(classId, patches), [classId]);
  // ② CAS 저장 큐(디바운스 + 충돌 감지).
  const store = useSheetSaveStore(send, doc.journal, canEdit);
  useFlushOnUnmount(store);
  // 계획 칸 감사로그 — 칸을 떠날 때 한 줄(원장 결정 2026-09-14). 기록 전에 이 저장 큐를 비운다.
  const audit = useSheetEditAudit({ enabled: canEdit, flush: () => store.flush() });
  useEffect(() => {
    store.setCallbacks({
      onError: (m) => toast.error(feedback(m)),
      onGone: () => toast.info(t("plan.editor.gone")),
      // 칸 입력마다 편집 전 값 — 감사로그가 칸마다 첫 값만 잡는다.
      onEdit: (lineId, field, before) => audit.touch(classId, { kind: "plan", lineId, field }, before),
    });
  }, [store, audit, classId, t, feedback]);
  // canonical 시드 — 서버가 준 값이 CAS의 expected가 된다(이게 없으면 첫 저장이 무조건 충돌).
  useEffect(() => {
    for (const slot of slots) {
      for (const l of slot.lines) {
        store.seed(l.id, "textbook", l.textbook);
        store.seed(l.id, "page_range", l.pageRange);
        store.seed(l.id, "progress", l.progress);
        store.seed(l.id, "homework", l.homework);
        store.seed(l.id, "skill_area", l.skillArea);
      }
    }
  }, [slots, store]);

  // ③ presence — 주간 시트와 **같은 scope**라 두 화면이 서로를 본다(팀티칭은 정상이라 중립 톤).
  const scope = ecsPresenceScope(classId, weekMonday);
  useEditPresence(scope, canEdit);
  const others = dedupeEditors(useEditingOthers(scope));

  return (
    // onBlur = 계획 칸 감사로그의 "칸을 떠났다" 신호(자손에서 올라온다 — use-sheet-edit-audit.ts).
    <div className="min-w-0" onBlur={audit.onBlur}>
      <p className="editorial-eyebrow mb-1.5">{t("plan.editor.title")}</p>

      {others.length > 0 ? (
        // 락이 아니라 **알림**이다 — 팀티칭에서 두 사람이 같은 반을 보는 건 정상이고, 진짜 덮어쓰기는
        // 위 CAS가 막는다. 그래서 danger가 아니라 앰버 톤(원스크린 동시열림 경고와 같은 서식).
        <div className="border-amber/40 bg-amber/5 text-amber mb-2 flex flex-wrap items-center gap-x-1.5 rounded-md border px-2.5 py-1.5 text-xs">
          <span className="font-bold">
            {tf("plan.editor.presence", {
              names:
                others.map((e) => e.userName).filter(Boolean).join(", ") ||
                t("plan.editor.presenceOther"),
            })}
          </span>
          <span>{t("plan.editor.presenceHint")}</span>
        </div>
      ) : null}

      {slots.map((slot) => (
        <div key={slot.slotStart} className="border-line mb-2 border-b pb-2 last:mb-0 last:border-b-0 last:pb-0">
          <p className="text-text-dim mb-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs font-bold">
            <span>
              {slot.periodLabel ?? slot.slotStart}
              {slot.roomLabel ? (
                <span className="font-medium"> · {roomNameFor(slot.roomLabel, lang)}</span>
              ) : null}
            </span>
            {/* 줄이 이미 있어도 '내용 복사'를 준다 — 0209a는 덮어쓰기 없이 **빈 칸만** 채우므로, 교재만
                적혀 있고 진도·과제가 빈 흔한 상태에서 이 버튼이 가장 쓸모 있다(원장 2026-08-14).
                줄이 없을 때는 아래 빈 상태 블록이 같은 버튼을 안내 문구와 함께 낸다(중복 방지). */}
            {canEdit && slot.lines.length > 0 ? (
              <TodayCopySlot
                classId={classId}
                date={date}
                slotStart={slot.slotStart}
                store={store}
                onCarried={onCarried}
              />
            ) : null}
            {/* Shouting 체크 — **EiE 반만**. 교시 줄 오른쪽 끝(주간 시트 교시 카드와 같은 자리·같은 표). */}
            {isEie ? (
              <label
                className={`ml-auto flex shrink-0 items-center gap-1 ${canEdit ? "cursor-pointer" : "cursor-default opacity-60"}`}
                title={t("plan.shouting.title")}
              >
                <input
                  type="checkbox"
                  className="accent-primary size-3.5 shrink-0"
                  checked={!!shouting[slot.slotStart]}
                  disabled={!canEdit}
                  onChange={(e) => toggleShouting(slot.slotStart, e.target.checked)}
                />
                <span className={shouting[slot.slotStart] ? "text-primary" : "text-text-dim"}>
                  {t("landing.col.shouting")}
                </span>
              </label>
            ) : null}
          </p>
          {slot.lines.length === 0 ? (
            // 줄 자체가 없으면 여기서 새로 만들 수 없다(구조 변경은 주간 시트) — 대신 **내용 복사**
            // (주간 시트와 같은 RPC)가 한 클릭 지름길이다. 그 외 구조 편집은 여전히 주간 시트로.
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              {/* ⚠️ 읽기 전용 사용자에겐 지시문을 붙이지 않는다 — 권한상 할 수 없는 행동("주간 시트에서
                  추가하세요")을 시키는 거짓 안내가 된다(적대 리뷰 2026-08-11). */}
              <p className="text-text-faint text-sm">
                {t("plan.editor.noLines")}
                {canEdit ? " —" : ""}
              </p>
              {canEdit ? (
                <TodayCopySlot
                classId={classId}
                date={date}
                slotStart={slot.slotStart}
                store={store}
                onCarried={onCarried}
              />
              ) : null}
              {canEdit ? (
                <span className="text-text-faint text-xs">{t("plan.editor.addElsewhere")}</span>
              ) : null}
            </div>
          ) : (
            slot.lines.map((l) => (
              <div key={l.id} className="mb-1 flex flex-wrap items-start gap-1.5 last:mb-0">
                <AreaChip store={store} lineId={l.id} fallback={l.skillArea} skillAreas={skillAreas} />
                <span className="min-w-[7rem] flex-1">
                  <BookCasInput store={store} lineId={l.id} fallback={l.textbook} pageRangeFallback={l.pageRange} canEdit={canEdit} ariaLabel={tf("plan.editor.cellAria", { class: className, field: t("plan.col.book") })} placeholder={t("plan.col.book")} />
                </span>
                <span className="min-w-[5rem] flex-1">
                  <CasInput store={store} lineId={l.id} field="page_range" fallback={l.pageRange} canEdit={canEdit} ariaLabel={tf("plan.editor.cellAria", { class: className, field: t("plan.col.pageTime") })} placeholder={t("plan.col.pageTime")} />
                </span>
                <span className="min-w-[7rem] flex-1">
                  <CasInput store={store} lineId={l.id} field="progress" fallback={l.progress} canEdit={canEdit} ariaLabel={tf("plan.editor.cellAria", { class: className, field: t("plan.col.progress") })} placeholder={t("plan.col.progress")} />
                </span>
                <span className="min-w-[7rem] flex-1">
                  <CasInput store={store} lineId={l.id} field="homework" fallback={l.homework} canEdit={canEdit} ariaLabel={tf("plan.editor.cellAria", { class: className, field: t("plan.col.homework") })} placeholder={t("plan.col.homework")} />
                </span>
              </div>
            ))
          )}
        </div>
      ))}
    </div>
  );
}
