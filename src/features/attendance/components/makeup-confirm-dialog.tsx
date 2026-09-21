"use client";

/**
 * 보강 추가 확인 — **모든 보강 추가가 이 창을 거친다**(원장 2026-08-19: *"이름 검색하고 누르면 그냥
 * 추가되고 끝이야. 뭐 아무것도 안나와"* → 항상 묻도록. 원스크린·출석부·ECS 세 진입점 공용).
 *
 * 묻는 것 셋:
 *  ① **어느 결석분인가** — 그 학생의 실제 결석 기록에서 고른다. 🔴 후보는 수강 중인 반이 아니라 **출결
 *     기록**에서 뽑으므로 **반 이동 전 옛 반 결석도 고를 수 있다**(원장 *"이전 수업을 이월해 보강"*).
 *     결석과 무관한 추가 보강이면 '결석분 아님', 아직 결석 전이면 직접 날짜(선보강).
 *  ② **시수** — 🔴 1로 박지 않는다(수학은 0.5당 1시간이라 3시간 반의 1회는 1.5, 원장 2026-08-06).
 *  ③ **합침/분리** — 그날 정규 수업을 **골랐을 때만** 묻는다(합칠 보고서가 없으면 물어봐야 답이 없다 — 다른 반을 고르면 합침은 선택지가 아니다).
 *  ④ **어느 수업에 기록하나** — 수업 후보를 넘긴 화면(원스크린)은 **늘** 묻는다(원장 2026-09-21 *"보강을 항상 다른 수업을 고를 수
 *     있게 해야 따로 보강 행이 안생겨서 수납 분리가 쉬울듯"*). 오늘 정규 수업이 있으면 그 수업이 맨 앞이고, 고르면 ③을 묻는다.
 *     🔴 **드롭다운 하나**로 묻고(원장 같은 날 *"드랍다운으로 처리해 나열하지말고"* — 반이 열 개 넘게 칩으로 늘어서 창을 채웠다)
 *     🔴 **학생이 다니는 반만** 세운다(*"해당 학생의 소속 수업만 띄워"*, `hostChoicesFor`). 정규 수업 하나만 있으면 드롭다운 대신 그 값을 적는다.
 *     🔴 '반 없이'는 **자동으로 고르지 않는다**(하나뿐이어도 — 조용히 보강 반으로 떨어지면 출석부에 줄이 또 선다, 적대 리뷰 2026-09-21).
 *
 * ⚠️ 상태 초기화는 **부모의 조건부 렌더 + key**로 한다(effect에서 setState 금지 — React 19 룰, gotcha #25).
 */
import { useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import { SearchableSelect, type ComboOption } from "@/components/ui/searchable-select";
import type { MergeCandidate } from "@/features/onescreen/makeup-merge-plan";
import { absenceMemo, shortDate } from "@/features/onescreen/makeup-absence-link";
import {
  absenceOptionLabel,
  isWithinMakeupDeadline,
  makeupDeadlineMessage,
  type MakeupAbsenceList,
} from "../makeup-options";
import type { MakeupSlotOption } from "../makeup-slot";
import { HOST_NONE, hostChoicesFor, type MakeupHostClass } from "../makeup-host";

/**
 * 강사의 선택.
 * 🔴 `candidate`가 null이면 **정규 수업에 기록하지 않는 보강** — 그날 정규 수업이 없거나, 있어도 다른 반을 골랐다(`hostClassId`).
 *    시수를 얹을 반은 호출부가 아는 앵커(고른 반 · 보던 반 필터)다. 합침은 선택지가 아니다.
 */
export type MakeupConfirmChoice = {
  mode: "merge" | "separate";
  candidate: MergeCandidate | null;
  /** 이번 보강이 몇 시수인가 — 그 반 정규 1회와 같은 게 기본이고 강사가 고칠 수 있다. */
  addUnits: number;
  /** 며칠자 결석분인지(선택 — 추가 보강이면 없음). */
  absentDate?: string;
  /** 그 결석이 난 **반**(이월 보강이면 지금 반과 다르다). 미지정이면 시수 얹는 반과 같은 반. */
  absentClassId?: string;
  /**
   * 보강을 한 **교시**("HH:MM") — 교시 축 화면(ECS)에서만 온다. 없으면 "그날 전체"로 저장된다
   * (원스크린·반별 출석부의 축).
   */
  slotStart?: string;
  /**
   * 보강을 **기록할 수업(반)** — 창이 물었을 때만 온다(원장 2026-09-21 *"보강 추가시에 '수업'을 선택할 수 있어야겠어"*).
   * `null` = '반 없이'(보이지 않는 보강 반) · `undefined` = 묻지 않은 화면(호출부의 종전 앵커 그대로).
   */
  hostClassId?: string | null;
};

/**
 * 보강 시수 입력 파싱 — 쉼표 소수점("1,5")도 받는다(서버 parseSessionUnits와 같은 관용).
 * 0 이하·숫자 아님은 null(확인이 안 열린다) — 0시수 보강은 기록할 이유가 없고, 음수는 급여를 깎는다.
 */
function parseAddUnits(raw: string): number | null {
  // ⚠️ 서버(`parseSessionUnits`)와 **같은 관용**이어야 한다 — 여기서만 느슨하면 "1.25"·"30"이 확인을
  //    통과해 저장 단계에서 에러가 나고, 원스크린은 그 실패가 토스트로만 남아 반쪽 상태가 된다.
  const t = raw.trim().replace(",", ".");
  if (!/^\d{1,2}(\.\d)?$/.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) && n > 0 && n <= 20 ? n : null;
}

/** 직접 입력 모드 sentinel — 셀렉트 값과 섞이지 않게 빈 문자열 대신 명시 토큰을 쓴다. */
const PICK_NONE = "__none__";
const PICK_CUSTOM = "__custom__";
/** 수업 드롭다운에서 오늘 정규 수업을 가리키는 값의 머리 — 다른 반(반 id)·'반 없이'와 한 목록에 선다. */
const REGULAR_PREFIX = "regular:";

export function MakeupConfirmDialog({
  studentName,
  candidates,
  sentSubjects,
  makeupDate,
  absences,
  absenceLoading,
  slotOptions,
  defaultUnits,
  hostClasses,
  defaultHostClassId = null,
  pending = false,
  onConfirm,
  onCancel,
}: {
  studentName: string;
  /** 그날 그 학생의 정규 수업 행(합칠 수 있는 것만). 비어 있으면 '보강만' 모드. */
  candidates: readonly MergeCandidate[];
  /** 이미 발송된 정규 행 이름들 — 합치면 보강 내용이 안 실린다는 사실을 **고르기 전에** 알린다. */
  sentSubjects?: readonly string[];
  /** 보강을 실제로 한 날(=지금 보고 있는 날짜). 시수가 얹히는 날이자 결석일 선택의 상한. */
  makeupDate: string;
  /**
   * 그 학생의 결석 후보 한 벌(이전 반 포함). 비어 있으면 직접 입력만 남는다.
   * ⚠️ 배열이 아니라 **한 벌**을 받는다 — "0건"의 뜻이 둘(결석이 없다 ↔ 과목이 달라 뺐다)이라
   *    아래 안내가 이유를 밝힐 수 있어야 한다.
   */
  absences: MakeupAbsenceList;
  absenceLoading?: boolean;
  /**
   * 그 반 그날의 교시들 — **교시 축 화면(ECS)만** 넘긴다. 둘 이상이면 고르기 전엔 확인을 막는다
   * (영어는 하루 한 교시인 반이 없어서, 안 물으면 보강이 늘 첫 교시로 밀린다).
   */
  slotOptions?: readonly MakeupSlotOption[];
  /** 정규 수업이 없을 때의 시수 기본값(보통 1). */
  defaultUnits?: number;
  /**
   * 보강을 기록할 수업 후보 — **넘긴 화면만**(원스크린) 묻는다. 합칠 정규 수업(`candidates`)이 있어도 묻는다 — 그 수업이 맨 앞 선택지이고
   * 이 목록엔 그 학생의 오늘 정규 반이 빠져 있다(호출부 `hostChoicesOf`). `failed`면 묻지 않는다(정규 수업이 있으면 그 수업에,
   * 없으면 호출부가 보던 반 필터 기준으로 기록한다).
   */
  hostClasses?: {
    options: readonly MakeupHostClass[];
    loading?: boolean;
    failed?: boolean;
    /**
     * 그 학생이 오늘 이 선생님이 **담임인 반**에 **정규 칸이 있다**(합칠 수 없는 칸 포함 — 결석·다른 과목 등). 있으면 '반 없이'를 세우지 않는다:
     * 보고서 저장 훅이 "이 선생님이 그날 이미 찍은 학생"으로 보고 보강 반을 안 만들어 시수가 아무 데도 안 선다(적대 리뷰 2026-09-21).
     * ⚠️ 위임받은 반의 칸은 넣지 않는다 — 훅은 담임 축이라 그 칸을 못 보고 보강 반을 만든다(재리뷰 2026-09-21).
     */
    regularToday?: boolean;
  };
  /** 처음 고른 채로 여는 반(`defaultHostClassId` — 추측하지 않는다, null이면 고르기 전엔 확인이 막힌다). */
  defaultHostClassId?: string | null;
  pending?: boolean;
  onConfirm: (choice: MakeupConfirmChoice) => void;
  onCancel: () => void;
}) {
  const { options: absenceOptions, hiddenBySubject, subjectLabel } = absences;
  /**
   * 보강 기한(결석한 달의 다음 달 말일)을 거는 화면인가 — 서버가 강사뷰일 때만 `hiddenByDeadline`을 싣는다(원장 2026-09-18).
   * 🔑 판정을 여기서 다시 하지 않는다 — 서버가 세션으로 정한 값의 **유무**가 곧 답이다.
   */
  const deadlineOn = absences.hiddenByDeadline !== undefined;
  const hiddenByDeadline = absences.hiddenByDeadline ?? 0;
  /** 뺀 기한 초과 결석 — 조용히 사라지면 "결석이 없다"는 거짓이 된다(과목 필터와 같은 규약). */
  const deadlineNote =
    hiddenByDeadline > 0
      ? ` 보강 기한(결석한 달의 다음 달 말일)이 지난 결석 ${hiddenByDeadline}건은 뺐습니다.`
      : "";
  /** 과목 라벨이 없으면(설정에 없는 키) 이름 대신 "이 과목" — raw 키는 화면에 안 쓴다. */
  const subjectWord = subjectLabel ? `${subjectLabel} 과목` : "이 과목";
  const canMerge = candidates.length > 0;
  const [mode, setMode] = useState<"merge" | "separate">(canMerge ? "merge" : "separate");
  // 후보가 하나면 그것으로 확정, 둘 이상이면 고르기 전엔 비워 둔다(추측 금지).
  const [pick, setPick] = useState<string | null>(candidates.length === 1 ? (candidates[0]?.name ?? null) : null);
  /** 결석 후보 선택 — `PICK_NONE`(추가 보강) · `PICK_CUSTOM`(직접 날짜) · `classId|date`. */
  const [absencePick, setAbsencePick] = useState<string>(PICK_NONE);
  const [customDate, setCustomDate] = useState("");
  const [customNote, setCustomNote] = useState<string | null>(null);
  const [addUnitsRaw, setAddUnitsRaw] = useState("");
  // 교시가 하나뿐이면 고를 것이 없다 — 그때만 자동 확정한다(둘 이상은 추측하지 않는다).
  const [slotPick, setSlotPick] = useState<string | null>(
    slotOptions && slotOptions.length === 1 ? (slotOptions[0]?.start ?? null) : null,
  );
  /** 보강을 기록할 수업 — 강사가 고른 값이 이긴다. 목록이 늦게 와도 기본값은 매 렌더 부모 값으로 본다(effect setState 금지). */
  const [hostPick, setHostPick] = useState<string | null>(null);

  const chosen = candidates.find((c) => c.name === pick) ?? null;
  const hostFailed = !!hostClasses?.failed;
  /**
   * 수업을 묻는 화면인가 — 수업 후보를 넘긴 화면(원스크린)은 **늘** 묻는다(오늘 정규 수업이 있어도 — 위 ④).
   * 🔴 목록을 못 불러왔으면 **묻지 않는다** — `hostClassId`를 안 실어 호출부가 종전 앵커(정규 수업 또는 보던 반 필터)를 쓴다. '반 없이'로
   *    떨어뜨리면 필터를 켜고 추가한 보강까지 보강 반으로 가서 원장이 겪은 그 줄이 다시 선다(적대 리뷰 2026-09-21).
   */
  const asksHost = !!hostClasses && !hostFailed;
  // 🔴 학생이 다니는 반만(원스크린 `hostChoicesOf`와 같은 함수). 오늘 정규 수업의 반은 '오늘 정규' 항목으로만 선다 — 창이 열린 사이
  //    정규 줄이 바뀌어도 같은 반이 두 번 보이지 않게.
  const hostOptions = hostChoicesFor(hostClasses?.options ?? [], candidates.map((c) => c.classId));
  /** 다른 수업 목록을 아직 못 받았다 — 그동안 드롭다운엔 오늘 정규 수업만 선다('반 없이'도 목록이 온 뒤에). */
  const hostListLoading = !!hostClasses?.loading && hostOptions.length === 0;
  /**
   * '반 없이'를 세우는가 — 정규 수업(합칠 후보)이 없고, 오늘 이 선생님 반에 정규 칸도 없을 때만. 정규 칸이 있으면 보고서 저장 훅이
   * 보강 반을 안 만들어 시수가 아무 데도 안 선다(합칠 수 없는 결석 칸이어도 같다 — `regularToday`).
   */
  const allowNone = !canMerge && !hostClasses?.regularToday;
  /**
   * 기록할 곳이 하나도 없다 — 정규 칸은 있지만 합칠 수 없고(결석·다른 과목 등) 다른 소속 수업도 없다. 빈 드롭다운 대신 이유를 적고 막는다.
   * (예전엔 선생님의 다른 반을 고를 수 있었지만, 학생이 다니지 않는 반은 세우지 않는다 — 원장 2026-09-21.)
   */
  const noHostChoice = asksHost && !canMerge && !allowNone && !hostClasses?.loading && hostOptions.length === 0;
  // 🔴 고른 값은 **지금 후보 안에 있을 때만** 쓴다 — 창이 열린 사이 후보가 바뀌면(그 반에 정규 행이 생김) 사라진 반이 그대로 나간다.
  const inOptions = (v: string | null | undefined) => !!v && hostOptions.some((o) => o.classId === v);
  // 정규 수업을 골랐으면 다른 반 선택은 없다. 정규 수업이 있는 창의 처음 선택은 그 수업(`pick`)이라 반 필터 기본값은 정규 수업이 없을 때만 쓴다.
  // 🔴 '반 없이'도 정규 수업이 없을 때만 — 있으면 그 강사 반에 이 학생 칸이 이미 있어 보고서 저장 훅이 보강 반을 안 만든다(시수가 아무 데도 안 선다, 적대 리뷰 2026-09-21).
  const hostValue = chosen
    ? null
    : (hostPick === HOST_NONE && allowNone) || inOptions(hostPick)
      ? hostPick
      : !canMerge && inOptions(defaultHostClassId)
        ? defaultHostClassId!
        : null;
  const hostChosen = hostOptions.find((o) => o.classId === hostValue) ?? null;
  /**
   * 오늘 정규 수업 맥락인가 — 정규 수업을 골랐거나, 수업을 묻지 않는 화면(ECS·반별 출석부)에서 정규 수업이 있을 때. 이때만 합침/분리를 묻는다.
   * 다른 반을 고르면 합침은 선택지가 아니다 — 보강 보고서가 따로 나가고 시수는 그 반 칸에 선다.
   * 정규 수업이 둘이라 아직 아무것도 안 골랐으면 정규 쪽으로 둔다 — 분리로 두면 결석 선택란이 떴다가 정규 수업을 고르는 순간 사라져 화면이 튄다.
   */
  const regularContext = canMerge && (!!chosen || !asksHost || !hostValue);
  const effMode: "merge" | "separate" = regularContext ? mode : "separate";
  const chosenLabel = chosen ? (chosen.className ?? chosen.name) : "";
  const baseUnits = chosen?.attendanceUnits ?? defaultUnits ?? 1;
  // 고른 반이 바뀌면 기본값도 그 반 것을 따른다 — 강사가 직접 친 값이 있으면 그게 이긴다.
  const addUnits = addUnitsRaw.trim() ? parseAddUnits(addUnitsRaw) : baseUnits;

  const selectedOption =
    absencePick !== PICK_NONE && absencePick !== PICK_CUSTOM
      ? (absenceOptions.find((o) => `${o.classId}|${o.date}` === absencePick) ?? null)
      : null;
  const absentDate = selectedOption?.date ?? (absencePick === PICK_CUSTOM ? customDate : "");
  const absentClassId = selectedOption?.classId;
  /** 아직 오지 않은 결석을 미리 메우는 경우 — 문구가 달라진다(선보강). */
  const beforehand = !!absentDate && makeupDate < absentDate;
  // 합침을 골랐으면 결석분 연결은 의미가 없다(같은 날 한 칸에서 만난다) — 물어보지 않는다.
  const asksAbsence = effMode === "separate";
  /** '직접 입력'을 골라 놓고 날짜를 비운 상태 — 조용히 '추가 보강'이 되지 않게 막는다. */
  const customEmpty = asksAbsence && absencePick === PICK_CUSTOM && !customDate;
  /**
   * 직접 입력한 날짜가 보강 기한을 넘었다(강사뷰) — 🔴 입력 순간이 아니라 **매 렌더** 다시 본다: 목록이 늦게 와서
   * `deadlineOn`이 나중에 켜져도 먼저 넣은 날짜를 놓치지 않는다(재리뷰 2026-09-18). 서버 문도 같은 판정이다.
   */
  const customExpired =
    asksAbsence &&
    absencePick === PICK_CUSTOM &&
    deadlineOn &&
    !!customDate &&
    !isWithinMakeupDeadline(customDate, makeupDate);
  /**
   * 결석 목록을 불러오는 중에 '직접 입력'으로 확인하면 기한 판정 재료(`deadlineOn`)가 아직 없다 — 그대로 보내면 보강 칸은
   * 저장되고 결석분 연결만 서버에서 거절되는 **반쪽 저장**이 된다(재리뷰 2026-09-18). 목록이 올 때까지만 잠근다.
   */
  const customWaiting = asksAbsence && absencePick === PICK_CUSTOM && !!absenceLoading;
  /** 교시를 물어야 하는 화면인데 아직 안 골랐다 — 첫 교시로 조용히 밀어 넣지 않는다. */
  const slotUnpicked = !!slotOptions && slotOptions.length > 0 && !slotPick;
  // 정규 수업을 골랐으면 다른 반 목록은 기다리지 않는다(그 수업에 기록된다).
  // 정규 수업이 있으면 목록을 기다릴 이유가 없다(그 항목은 이미 고를 수 있다) — 요약은 '고르세요'로 둔다.
  const hostLoading = asksHost && !canMerge && !chosen && !!hostClasses?.loading && !hostPick;
  const hostUnpicked = asksHost && !chosen && !hostValue;
  /** 요약 문장의 '어디에 기록하나' — 수업을 물었으면 고른 반 이름을 밝힌다. */
  const recordWhere = !asksHost ? "출석부에 보강으로 기록합니다. " : hostChosen ? `출석부 ${hostChosen.className} 반에 보강으로 기록합니다. ` : "지금은 출결을 적지 않습니다(보고서를 저장할 때 반영). ";
  /** 분리(보강 보고서 따로) 요약의 앞머리 — 정규 수업이면 그 칸에 시수, 다른 반이면 그 반에 기록. */
  const separateLead = regularContext
    ? `보강 보고서를 따로 만듭니다 — 정규 1건 + 보강 1건, 모두 2건이 발송됩니다. ${chosen ? `보강 시수는 ${chosenLabel} 칸에 얹습니다. ` : ""}`
    : `${canMerge ? "오늘 정규 보고서와 따로 보강 보고서가 나갑니다. " : ""}${recordWhere}`;
  const blocked =
    (canMerge && !asksHost && !chosen) || addUnits === null || customEmpty || customExpired || customWaiting || slotUnpicked || hostLoading || hostUnpicked;
  /** 수업 드롭다운 한 벌 — 오늘 정규 수업 → 학생이 다니는 다른 반 → '반 없이'(정규 수업이 없을 때만). */
  const hostSelectOptions: ComboOption[] = [
    ...candidates.map((c) => ({ value: `${REGULAR_PREFIX}${c.name}`, label: c.className ?? c.name, hint: "오늘 정규" })),
    ...(hostListLoading
      ? []
      : [
          ...hostOptions.map((o) => ({ value: o.classId, label: o.className })),
          ...(allowNone ? [{ value: HOST_NONE, label: "반 없이", hint: "보강 반" }] : []),
        ]),
  ];
  const hostSelectValue = chosen ? `${REGULAR_PREFIX}${chosen.name}` : (hostValue ?? "");
  const hostSelected = hostSelectOptions.find((o) => o.value === hostSelectValue) ?? null;
  const hostSelectHint = hostSelected?.hint;
  /** 고를 것이 하나뿐이고 이미 그것이다(정규 수업 하나) — 한 줄짜리 목록을 여는 드롭다운 대신 값만 적는다. '반 없이'는 자동으로 안 고르니 여기 안 온다. */
  const hostFixed = hostSelectOptions.length === 1 && hostSelected ? hostSelected : null;
  const onHostSelect = (v: string) => {
    if (v.startsWith(REGULAR_PREFIX)) {
      setPick(v.slice(REGULAR_PREFIX.length));
      setHostPick(null);
    } else {
      setPick(null);
      setHostPick(v);
    }
  };

  // 🔴 **portal로 body에 붙인다** — ECS 오늘 보드는 카드가 `zoom` 래퍼(글씨 크게) 안이라, 그 안에서
  //    `position:fixed`를 쓰면 좌표가 배율만큼 곱해져 모달이 화면 밖으로 밀린다([[#98]] 사촌 함정).
  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center bg-black/40 p-4 sm:items-center"
      onClick={onCancel}
      role="presentation"
    >
      <div
        className="bg-background border-line max-h-[90vh] w-full max-w-md overflow-y-auto rounded-lg border p-5 shadow-lg"
        role="alertdialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-foreground mb-1.5 text-sm font-bold">
          {regularContext ? "정규 수업 발송건에 수업보고서를 합쳐서 발송하시겠습니까?" : "보강을 추가합니다"}
        </h2>
        <p className="text-text-dim text-sm leading-relaxed">
          {/* ⚠️ 구분자는 쉼표 — 행 이름 자체가 " · "를 품는다("수학 · 고1 특강"). */}
          {canMerge
            ? `${studentName} 학생은 오늘 ${candidates.map((c) => c.name).join(", ")} 정규 수업이 있습니다.`
            : `${studentName} 학생의 보강입니다 — 오늘 이 선생님의 정규 수업은 없습니다.`}
        </p>

        {/* ⓐ 어느 수업에 기록하나 — 수업 후보를 넘긴 화면(원스크린)은 늘 묻는다(원장 2026-09-21). 순서 = 오늘 정규 수업 → 학생이 다니는
            다른 반 → '반 없이'(선생님의 다른 반은 세우지 않는다). 학생이 다니는 반에 기록하면 출석부에 새 줄이 안 생긴다(수납 분리가 쉬워진다). '반 없이'는 지금
            출결을 안 적고, 보고서 저장 때 그 강사 반에 칸이 없으면 보이지 않는 '보강' 반에 선다(makeup-pool.ts — 칸이 이미 있으면 안 만든다).
            🔴 그래서 오늘 정규 수업이 있으면 '반 없이'를 세우지 않는다 — 그 정규 칸 때문에 보강 반이 안 생겨 시수가 아무 데도 안 선다. */}
        {asksHost ? (
          <div className="mt-4">
            <p className="text-text-faint mb-1.5 text-xs">어느 수업에 기록할까요?</p>
            {hostListLoading && !canMerge ? (
              // 고를 것이 하나도 없다 — 빈 목록이 열리는 드롭다운 대신 같은 모양의 상자에 사실만 적는다.
              <div aria-busy="true" className="border-line bg-bg-soft text-text-faint flex h-9 items-center rounded-lg border px-2 text-sm">
                수업 목록을 불러오는 중…
              </div>
            ) : noHostChoice ? (
              <div className="border-line bg-bg-soft text-text-faint flex min-h-9 items-center rounded-lg border px-2 py-1.5 text-sm leading-snug">
                기록할 수 있는 수업이 없습니다
              </div>
            ) : hostFixed ? (
              <div className="border-line bg-bg-soft text-foreground flex h-9 items-center justify-between gap-2 rounded-lg border px-2 text-sm">
                <span className="truncate">{hostFixed.label}</span>
                {hostFixed.hint ? <span className="text-text-faint shrink-0 text-xs">{hostFixed.hint}</span> : null}
              </div>
            ) : (
              // 트리거 모양은 아래 '며칠자 결석분' 칸과 같게 — 한 창에 드롭다운 두 벌이 다른 옷을 입지 않게.
              <SearchableSelect
                options={hostSelectOptions}
                value={hostSelectValue}
                onValueChange={onHostSelect}
                ariaLabel="보강 기록 수업"
                placeholder="수업을 고르세요"
                searchPlaceholder="반 이름 검색"
                triggerClassName="border-line bg-bg-soft text-foreground h-9 rounded-lg border px-2 text-sm"
                trailing={hostSelectHint ? <span className="text-text-faint text-xs">{hostSelectHint}</span> : null}
              />
            )}
            {hostListLoading && canMerge ? (
              <p className="text-text-faint mt-1.5 text-xs">다른 수업을 불러오는 중…</p>
            ) : null}
            {hostValue === HOST_NONE ? (
              <p className="text-text-faint mt-1.5 text-xs leading-snug">지금은 출결을 적지 않습니다. 보고서를 저장할 때 선생님 반에 이 학생 칸이 없으면 보이지 않는 &apos;보강&apos; 반에 기록됩니다.</p>
            ) : null}
          </div>
        ) : null}

        {hostClasses && !canMerge && hostFailed ? (
          <p className="text-amber mt-3 text-xs leading-snug">수업 목록을 불러오지 못해 보고 있던 반 필터 기준으로 기록합니다.</p>
        ) : null}

        {regularContext ? (
          <div className="mt-4 flex gap-1.5" role="radiogroup" aria-label="보강 보고서 처리 방식">
            {(
              [
                { v: "merge", label: "합침 (정규+보강)" },
                { v: "separate", label: "분리 (보강 따로)" },
              ] as const
            ).map((o) => (
              <button
                key={o.v}
                type="button"
                role="radio"
                aria-checked={mode === o.v}
                onClick={() => setMode(o.v)}
                className={
                  mode === o.v
                    ? "border-primary bg-primary-soft text-primary flex-1 rounded-lg border px-3 py-2 text-sm font-bold"
                    : "border-line text-text-dim hover:bg-bg-soft flex-1 rounded-lg border px-3 py-2 text-sm font-bold"
                }
              >
                {o.label}
              </button>
            ))}
          </div>
        ) : null}

        {/* 어느 수업의 보강인지 — 후보가 둘 이상일 때만(하나면 위 문장에 이미 있다).
            ⚠️ 합침·분리 둘 다 묻는다: 어느 쪽이든 그 반의 급여 귀속이 달라진다. */}
        {!asksHost && candidates.length > 1 ? (
          <div className="mt-3" role="radiogroup" aria-label="보강 수업 선택">
            <p className="text-text-faint mb-1.5 text-xs">어느 수업의 보강인가요?</p>
            <div className="flex flex-wrap gap-1.5">
              {candidates.map((c) => (
                <button
                  key={c.name}
                  type="button"
                  role="radio"
                  aria-checked={pick === c.name}
                  onClick={() => setPick(c.name)}
                  className={
                    pick === c.name
                      ? "border-primary bg-primary-soft text-primary rounded-lg border px-2.5 py-1.5 text-xs font-bold"
                      : "border-line text-text-dim hover:bg-bg-soft rounded-lg border px-2.5 py-1.5 text-xs font-bold"
                  }
                >
                  {c.name}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {/* ⓪ 어느 교시에 왔는가 — 교시 축 화면(ECS)만 묻는다. 영어는 하루 한 교시인 반이 없어서,
            안 물으면 저장이 "그날 전체"가 되고 주간 시트가 그 칸을 **첫 교시**에 붙인다. */}
        {slotOptions && slotOptions.length > 0 ? (
          <div className="mt-3" role="radiogroup" aria-label="보강 교시 선택">
            <p className="text-text-faint mb-1.5 text-xs">어느 교시에 왔나요?</p>
            <div className="flex flex-wrap gap-1.5">
              {slotOptions.map((o) => (
                <button
                  key={o.start}
                  type="button"
                  role="radio"
                  aria-checked={slotPick === o.start}
                  onClick={() => setSlotPick(o.start)}
                  className={
                    slotPick === o.start
                      ? "border-primary bg-primary-soft text-primary rounded-lg border px-2.5 py-1.5 text-xs font-bold"
                      : "border-line text-text-dim hover:bg-bg-soft rounded-lg border px-2.5 py-1.5 text-xs font-bold"
                  }
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {/* 교시를 물을 수 있는 화면인데 고를 교시가 하나도 없을 때 — 조용히 "그날 전체"로 넘어가지 않게 밝힌다.
            (그 반 그날이 전부 자리 교시인 경우가 여기다.) */}
        {slotOptions && slotOptions.length === 0 ? (
          <p className="text-text-faint mt-3 text-xs leading-snug">
            고를 교시가 없어 <b>그날 전체</b>로 기록됩니다.
          </p>
        ) : null}

        {/* ① 며칠자 결석분인가 — **목록에서 고른다**(반 이동 전 옛 반 결석 포함). */}
        {asksAbsence ? (
          <div className="mt-3">
            <label htmlFor="makeup-absence-pick" className="text-text-faint mb-1.5 block text-xs">
              며칠자 결석분 보강인가요?
            </label>
            <select
              id="makeup-absence-pick"
              value={absencePick}
              onChange={(e) => {
                setAbsencePick(e.target.value);
                setCustomNote(null);
              }}
              className="border-line bg-bg-soft focus:border-primary h-9 w-full rounded-lg border px-2 text-sm outline-none"
            >
              <option value={PICK_NONE}>결석분 아님 (추가 보강)</option>
              {absenceOptions.map((o) => (
                <option key={`${o.classId}|${o.date}`} value={`${o.classId}|${o.date}`}>
                  {absenceOptionLabel(o)}
                </option>
              ))}
              <option value={PICK_CUSTOM}>직접 입력 (아직 결석 전 · 목록에 없음)</option>
            </select>
            {/* 왜 이만큼인지 밝힌다 — 과목이 달라 뺀 후보가 있는데 그냥 "결석 기록이 없다"고 하면
                거짓이 된다(실측: 수학 보강에서 목록이 통째로 비는 학생 29명이 영어 결석만 갖고 있다).
                ⚠️ 문구는 **말한 만큼만** 참이어야 한다: ① 뺀 건수엔 이미 보강한 결석도 섞이므로 "메울 수 있는
                N건"이라고 하지 않는다 ② 미분류 과목 결석은 일부러 통과시키므로 "이 과목 결석만 보인다"고도
                하지 않는다(남은 목록이 한 과목이라고 단언할 수 없다). */}
            <p className="text-text-faint mt-1.5 text-xs leading-snug">
              {absenceLoading
                ? "결석 기록을 불러오는 중…"
                : absenceOptions.length === 0
                  ? hiddenBySubject > 0
                    ? `${subjectWord}에 메울 결석이 없습니다 — 다른 과목 결석 ${hiddenBySubject}건은 과목이 달라 뺐습니다.${deadlineNote}`
                    : hiddenByDeadline > 0
                      ? `메울 수 있는 결석이 없습니다 —${deadlineNote} 추가 보강이면 그대로 두세요.`
                      : "최근 1년 결석 기록이 없습니다 — 추가 보강이면 그대로 두세요."
                  : hiddenBySubject > 0
                    ? `과목이 다른 결석 ${hiddenBySubject}건은 뺐습니다(${subjectWord} 보강). 반을 옮겼어도 이전 반 결석이 함께 보입니다.${deadlineNote}`
                    : `반을 옮겼어도 이전 반 결석이 함께 보입니다(이월 보강).${deadlineNote}`}
            </p>
            {absencePick === PICK_CUSTOM ? (
              <div className="mt-2">
                <input
                  type="date"
                  value={customDate}
                  aria-label="결석 날짜 직접 입력"
                  onChange={(e) => {
                    const v = e.target.value;
                    // 보강한 날은 결석분이 될 수 없다(출석부가 한 칸) — 값을 받지 않고 갈 길을 알려 준다.
                    if (v && v === makeupDate) {
                      setCustomNote(
                        `${shortDate(makeupDate)}은 보강한 날이라 결석분으로 고를 수 없습니다 — 그날 한 추가 보강이면 '결석분 아님'을 고르세요.`,
                      );
                      return;
                    }
                    setCustomNote(null);
                    setCustomDate(v);
                  }}
                  className="border-line bg-bg-soft focus:border-primary h-8 rounded-lg border px-2 text-sm outline-none"
                />
                {customNote ? <p className="text-amber mt-1.5 text-xs leading-snug">{customNote}</p> : null}
                {customExpired ? (
                  <p className="text-amber mt-1.5 text-xs leading-snug">{makeupDeadlineMessage(customDate)}.</p>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}

        {/* ② 시수 — 🔴 1로 박지 않는다(0.5 = 1시간). */}
        <div className="mt-3">
          <label htmlFor="makeup-add-units" className="text-text-faint mb-1.5 block text-xs">
            이번 보강 시수
          </label>
          <div className="flex items-center gap-2">
            <input
              id="makeup-add-units"
              inputMode="decimal"
              value={addUnitsRaw}
              placeholder={String(baseUnits)}
              onChange={(e) => setAddUnitsRaw(e.target.value)}
              aria-invalid={addUnits === null}
              className="border-line bg-bg-soft focus:border-primary h-8 w-20 rounded-lg border px-2 text-sm outline-none"
            />
            <span className="text-text-faint text-xs">0.5 = 1시간 (수학 기준)</span>
          </div>
        </div>

        {/* 고른 대로 무슨 일이 벌어지는지 — 막힌 상태면 색을 바꾼다(흐린 회색 한 줄은 안 읽힌다). */}
        <p
          className={`mt-3 text-xs leading-relaxed ${blocked ? "text-amber font-medium" : "text-text-faint"}`}
        >
          {canMerge && !asksHost && !chosen
            ? "어느 수업의 보강인지 골라 주세요."
            : customEmpty
              ? "결석 날짜를 고르거나, 결석분이 아니면 '결석분 아님'을 고르세요."
            : customExpired
              ? "기한 안의 결석을 고르거나, 결석분이 아니면 '결석분 아님'을 고르세요."
            : customWaiting
              ? "결석 기록을 불러오는 중입니다 — 잠시 뒤 확인할 수 있습니다."
            : hostLoading
              ? "수업 목록을 불러오는 중입니다 — 잠시 뒤 확인할 수 있습니다."
            : noHostChoice
              ? "이 학생은 오늘 선생님 반에 정규 칸이 있지만 합칠 수 없는 상태(결석·다른 과목 등)이고, 보강을 기록할 다른 소속 수업도 없습니다 — 그 칸의 출결을 먼저 확인해 주세요."
            : hostUnpicked
              ? allowNone
                ? "보강을 기록할 수업을 고르세요(반과 무관한 보강이면 '반 없이')."
                : "보강을 기록할 수업을 고르세요."
            : addUnits === null
              ? "보강 시수는 0보다 큰 숫자로 적어 주세요(0.5 = 1시간)."
              : effMode === "merge" && chosen
                ? `${chosen.name} 보고서 1건에 합쳐 "(정규+보강)"으로 한 번만 발송합니다. 출석부 수업타임은 ${chosenLabel} 행에 ${chosen.attendanceUnits ?? 1} + 보강 ${addUnits} = ${(chosen.attendanceUnits ?? 1) + addUnits}.`
                : !absentDate
                  ? `${separateLead}결석분 연결은 없고(추가 보강), ${shortDate(makeupDate)} 보강 수업타임은 ${addUnits}.`
                  : `${separateLead}출석부는 ${shortDate(absentDate)}${selectedOption ? ` ${selectedOption.className}` : ""} 칸에 "${absenceMemo(makeupDate, absentDate)}" 메모만 붙고(결석 0은 그대로), ${shortDate(makeupDate)} 칸 보강 수업타임은 ${addUnits}.${beforehand ? " 아직 지나지 않은 날이라 그 칸에 출결 기록이 없으면 메모는 남지 않습니다." : ""}`}
        </p>
        {effMode === "merge" && chosen && (sentSubjects ?? []).includes(chosen.name) ? (
          <p className="text-amber mt-1.5 text-xs leading-relaxed">
            {`${chosen.name} 보고서는 이미 발송되어 보강 내용은 실리지 않습니다(수업타임만 올라갑니다). 보강 내용을 보내려면 ‘분리’를 고르세요.`}
          </p>
        ) : null}

        <div className="mt-5 flex items-center justify-end gap-2">
          <Button type="button" variant="outline" size="sm" onClick={onCancel} disabled={pending}>
            취소
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={blocked || pending}
            onClick={() =>
              addUnits !== null &&
              onConfirm({
                mode: effMode,
                candidate: chosen,
                addUnits,
                ...(effMode === "separate" && absentDate ? { absentDate } : {}),
                ...(effMode === "separate" && absentClassId ? { absentClassId } : {}),
                ...(slotPick ? { slotStart: slotPick } : {}),
                // 정규 수업을 골랐으면 싣지 않는다 — 호출부는 `candidate`로 그 수업에 기록한다(두 앵커가 갈리지 않게).
                ...(asksHost && !chosen ? { hostClassId: hostValue === HOST_NONE ? null : hostValue } : {}),
              })
            }
          >
            {pending ? "보강 저장 중…" : effMode === "merge" ? "합쳐서 발송" : regularContext ? "분리해서 발송" : "보강 추가"}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
