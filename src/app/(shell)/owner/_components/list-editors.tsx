"use client";

// 배열형 설정(과목·직급·학년·교시·학기·공휴일) 편집기 — 행 추가/삭제 + 인라인 입력.
import { useId, useRef } from "react";
import periodStyles from "./period-list.module.css";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { GripVertical, Plus, X } from "@/components/icons/aywa-icon-compat";
import { SUBJECT_COLORS, SUBJECT_DEFAULT_VIEW_OPTIONS, type ConsultationTemplate, type HolidaySetting, type PeriodTimeRow, type ShuttleSetting, type SubjectSetting, type TermSetting } from "@/features/owner/settings-types";
import { SUBJECT_SOLID, KNOWN_SUBJECT_KEYS, counselByClassTeacher } from "@/features/owner/subjects";
import { SUBJECT_COLOR_LABEL } from "@/features/owner/subject-color-label";
import { WEEKDAY_GROUPING_OPTIONS } from "@/features/timetable/lib/weekday-groups";
import { STATE_RESERVED_COLORS } from "@/lib/design/semantic-color";
import { useLockedPlaceholder, useWriteLock } from "./write-lock-context";

const cellCls =
  "border-line text-foreground min-w-0 rounded-md border bg-transparent px-2.5 py-1.5 text-sm outline-none focus:border-primary";

// 🔴 읽기 권한(쓰기 잠금)이면 추가·삭제·순서 이동 단추를 **그리지 않는다** — 비활성으로 남기면 쓸 수 있는 것처럼 읽힌다
//    (원장 2026-11-05, `write-lock-context.tsx`). 입력칸은 폼의 fieldset이 잠그고 빈 칸 placeholder만 권한 안내로 바꾼다.
function AddButton({ onClick, label }: { onClick: () => void; label: string }) {
  if (useWriteLock().locked) return null;
  return (
    <button
      type="button"
      onClick={onClick}
      className="border-line text-text-dim hover:text-foreground hover:border-primary inline-flex items-center gap-1 rounded-md border border-dashed px-3 py-1.5 text-xs"
    >
      <Plus className="size-3.5" /> {label}
    </button>
  );
}

function RemoveButton({ onClick }: { onClick: () => void }) {
  if (useWriteLock().locked) return null;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="삭제"
      className="text-text-faint hover:text-danger shrink-0 rounded p-1"
    >
      <X className="size-4" />
    </button>
  );
}

export function StringListEditor({
  value,
  onChange,
  placeholder,
  addLabel,
  type = "text",
}: {
  value: string[];
  onChange: (v: string[]) => void;
  placeholder?: string;
  addLabel: string;
  type?: "text" | "date";
}) {
  const set = (i: number, v: string) => onChange(value.map((x, j) => (j === i ? v : x)));
  const ph = useLockedPlaceholder();
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {value.map((v, i) => (
          <div key={i} className="flex items-center gap-1">
            <input
              type={type}
              className={`${cellCls} ${type === "date" ? "w-[140px]" : "w-[110px]"}`}
              value={v}
              placeholder={ph(placeholder)}
              onChange={(e) => set(i, e.target.value)}
            />
            <RemoveButton onClick={() => onChange(value.filter((_, j) => j !== i))} />
          </div>
        ))}
      </div>
      <AddButton onClick={() => onChange([...value, ""])} label={addLabel} />
    </div>
  );
}

// 내부 ID(key) 정책 — 학원장은 key를 직접 관리하지 않는다(불편·실수 방지).
// key는 DB가 과목을 가리키는 불변 식별자라 한 번 정해지면 바꾸지 않는다(바꾸면 기존 데이터 연결이 끊김).
//  · 추가 시 임시 opaque key(subject_N) 부여 → 과목명 입력을 마치고 칸을 벗어나면(blur) 1회 확정.
//  · 확정 규칙: 흔한 과목명이면 표준 키(KNOWN_SUBJECT_KEYS: 수학→math·영어→english…)로, 없으면 subject_N 유지.
//    표준 키를 받으면 코드 특수동작(영어 10교시 등)을 상속. 확정 후엔 라벨을 바꿔도 key 불변(orphan 방지).
function nextSubjectKey(taken: Set<string>): string {
  let n = 1;
  while (taken.has(`subject_${n}`)) n += 1;
  return `subject_${n}`;
}

export function SubjectListEditor({
  value,
  onChange,
  onRemove,
  groupingChoices = WEEKDAY_GROUPING_OPTIONS,
}: {
  value: SubjectSetting[];
  onChange: (v: SubjectSetting[]) => void;
  // 삭제를 가로채는 콜백(과목 흡수 다이얼로그) — 미지정 시 기존처럼 행 즉시 제거.
  onRemove?: (index: number) => void;
  /** 기본 프리셋 + 학원이 만든 요일 병합. 없으면 기본 다섯 개. */
  groupingChoices?: { value: string; label: string }[];
}) {
  // 확정된 key 집합 — 최초 로드된(저장된) key + 이번 세션에서 blur로 확정된 key. 여기 든 key는 다신 안 바뀐다.
  const frozen = useRef<Set<string>>(new Set(value.map((s) => s.key).filter(Boolean)));
  const set = (i: number, patch: Partial<SubjectSetting>) =>
    onChange(value.map((x, j) => (j === i ? { ...x, ...patch } : x)));

  // 과목명 입력 종료(blur) 시 key 1회 확정. 이미 확정(frozen)된 행은 건드리지 않는다.
  const finalizeKey = (i: number) => {
    const row = value[i];
    if (frozen.current.has(row.key)) return;
    const label = row.label.trim();
    if (!label) return; // 이름 입력 전 — 다음 입력까지 보류
    const taken = new Set(value.filter((_, j) => j !== i).map((s) => s.key));
    const canon = KNOWN_SUBJECT_KEYS[label];
    const key = canon && !taken.has(canon) ? canon : taken.has(row.key) ? nextSubjectKey(taken) : row.key;
    frozen.current.add(key);
    if (key !== row.key) set(i, { key });
  };

  // 동일 과목명(라벨) 중복 — 다른 행과 같은 이름이면 경고. 저장은 스키마 superRefine가 거부(이중 방어).
  const isDuplicate = (i: number) => {
    const l = value[i].label.trim().toLowerCase();
    return !!l && value.some((o, j) => j !== i && o.label.trim().toLowerCase() === l);
  };
  const ph = useLockedPlaceholder();

  return (
    <div className="space-y-2">
      {/* 행 제목(열 헤더) */}
      {value.length > 0 ? (
        <div className="text-text-faint micro flex flex-wrap items-center gap-2 px-0.5">
          <span className="w-[110px]">과목명</span>
          <span className="w-[122px]">색</span>
          <span className="w-[220px]">시간표 요일 병합</span>
          <span className="w-[104px]">처음 보이는 뷰</span>
          <span className="w-[92px]">QR 접수 노출</span>
          <span className="w-[112px]" title="원생상담 의무 — 한 학생이 이 과목을 여러 선생님에게 들을 때 누가 상담하나">상담 의무</span>
          <span className="w-[70px]">내부 ID</span>
        </div>
      ) : null}
      {value.map((s, i) => {
        const dup = isDuplicate(i);
        return (
          <div key={i} className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              {/* 과목명(한글) — 학원장이 자유롭게 편집(바꿔도 데이터 안 깨짐). blur 시 key 확정. */}
              <input
                className={`${cellCls} w-[110px] ${dup ? "border-danger focus:border-danger" : ""}`}
                value={s.label}
                placeholder={ph("과목명 (예: 수학)")}
                onChange={(e) => set(i, { label: e.target.value })}
                onBlur={() => finalizeKey(i)}
                aria-invalid={dup}
              />
              {/* 색 — 미리보기 칩 + 선택.
                  ⚠️ 초록·빨강·앰버는 앱 전체에서 **상태색**이다(정상·위험·주의 — 의미색 캐논,
                  src/lib/design/semantic-color.ts). 과목에 그 색을 고르면 학생목록처럼 상태 배지와
                  과목 배지가 한 행에 서는 화면에서 둘이 같은 색이 돼 구분이 사라진다.
                  🔑 선택지에서 **빼지는 않는다** — 이미 그 색으로 저장한 학원이 있으면 Zod가 거절해
                  학원설정 저장 자체가 막힌다(fail-closed). 대신 고른 순간 경고를 띄운다. */}
              <span className="flex items-center gap-1.5">
                <span className={`size-4 shrink-0 rounded-sm ${SUBJECT_SOLID[s.color]}`} aria-hidden />
                <select
                  className={`${cellCls} w-[100px]`}
                  value={s.color}
                  onChange={(e) => set(i, { color: e.target.value as SubjectSetting["color"] })}
                  aria-label="과목 색"
                  title={
                    STATE_RESERVED_COLORS.has(s.color)
                      ? "초록·빨강·앰버는 상태색(정상·위험·주의)이라 과목에 쓰면 상태 배지와 헷갈립니다"
                      : undefined
                  }
                >
                  {SUBJECT_COLORS.map((c) => (
                    <option key={c} value={c}>
                      {STATE_RESERVED_COLORS.has(c) ? `${SUBJECT_COLOR_LABEL[c]} (상태색)` : SUBJECT_COLOR_LABEL[c]}
                    </option>
                  ))}
                </select>
              </span>
              {/* 요일 병합 — 과목별 시간표 기본뷰 병합 프리셋 */}
              <select
                className={`${cellCls} w-[220px]`}
                value={
                  groupingChoices.some((choice) => choice.value === (s.weekdayGrouping ?? "mon-thu"))
                    ? (s.weekdayGrouping ?? "mon-thu")
                    : (groupingChoices[0]?.value ?? "mon-thu")
                }
                onChange={(e) => set(i, { weekdayGrouping: e.target.value })}
                aria-label="시간표 요일 병합"
              >
                {groupingChoices.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
              {/* 처음 보이는 시간표 뷰 — 과목마다 주로 보는 뷰가 다르다(원장 2026-08-06 "영어는 기본뷰를
                  잘 안 쓴다"). 코드에 과목 키를 박지 않고 여기서 고른다. 시간표에서 다른 뷰를 누르면
                  그 뷰로 가고(URL에 실린다), 링크 없이 열면 여기 값으로 열린다.
                  ⚠️ 강사뷰는 허용 과목(영어·강사별시간표 설정 보유)에서만 유효 — 아니면 기본뷰로 강등된다. */}
              <select
                className={`${cellCls} w-[104px]`}
                value={s.defaultView ?? "basic"}
                onChange={(e) =>
                  set(i, { defaultView: e.target.value as SubjectSetting["defaultView"] })
                }
                aria-label="처음 보이는 시간표 뷰"
                title="이 과목의 시간표를 열 때 처음 보이는 뷰"
              >
                {SUBJECT_DEFAULT_VIEW_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
              {/* QR 공개접수 '상담 희망 과목' 노출 — 끄면 학부모 접수 폼에서 숨는다(재원생 전용 반 등).
                  내부 화면·시간표엔 영향 없음. 체크=노출이 직관적이라 저장값(hiddenFromIntake)과 반전. */}
              <label className="text-text-dim flex w-[92px] shrink-0 cursor-pointer items-center gap-1.5 text-xs">
                <input
                  type="checkbox"
                  className="accent-primary size-3.5"
                  checked={!s.hiddenFromIntake}
                  onChange={(e) => set(i, { hiddenFromIntake: !e.target.checked })}
                />
                {s.hiddenFromIntake ? "숨김" : "노출"}
              </label>
              {/* 원생상담 의무(원장 2026-10-19) — 요일 많은 선생님 / 수업 담당(반에 '담당'으로 세팅된 선생님). 미설정 기본은 영어만 수업 담당(counselByClassTeacher). */}
              <select
                className={`${cellCls} w-[112px]`}
                aria-label={`${s.label || "과목"} 원생상담 의무`}
                value={counselByClassTeacher(s) ? "all" : "most"}
                onChange={(e) => set(i, { counselAllHomerooms: e.target.value === "all" })}
              >
                <option value="most">요일 많은 선생님</option>
                <option value="all">수업 담당</option>
              </select>
              {/* 내부 ID — 읽기전용(데이터 보존용, 자동 확정·고정) */}
              <span
                className="text-text-faint w-[70px] shrink-0 truncate text-xs"
                title={`내부 ID: ${s.key} (자동·변경 불가)`}
              >
                {s.key}
              </span>
              <RemoveButton
                onClick={() => (onRemove ? onRemove(i) : onChange(value.filter((_, j) => j !== i)))}
              />
            </div>
            {dup ? (
              <p className="text-danger pl-0.5 text-xs">이미 있는 과목명입니다 — 다른 이름을 쓰거나 한 행을 삭제하세요.</p>
            ) : null}
            {/* 저장은 막지 않는다(경고만) — 이미 그 색을 쓰던 학원의 설정이 잠기면 안 된다. */}
            {STATE_RESERVED_COLORS.has(s.color) ? (
              <p className="text-amber pl-0.5 text-xs">
                초록·빨강·앰버는 앱 전체에서 <b>상태색</b>(정상·위험·주의)입니다 — 과목에 쓰면 학생목록
                등에서 상태 배지와 같은 색이 되어 구분이 어려워집니다.
              </p>
            ) : null}
          </div>
        );
      })}
      <AddButton
        onClick={() =>
          onChange([
            ...value,
            { key: nextSubjectKey(new Set(value.map((s) => s.key))), label: "", color: "neutral", weekdayGrouping: groupingChoices[0]?.value ?? "mon-thu", testMax: 5 },
          ])
        }
        label="과목 추가"
      />
    </div>
  );
}

/**
 * 교시 한 줄 — 왼쪽 손잡이만 드래그 대상이라 시각 입력은 평소대로 클릭·편집된다.
 * (행 전체를 잡게 하면 input을 누르는 순간 드래그가 시작돼 시각을 못 고친다.)
 */
function PeriodRow({
  id,
  row,
  onPatch,
  onRemove,
}: {
  id: string;
  row: PeriodTimeRow;
  onPatch: (patch: Partial<PeriodTimeRow>) => void;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const { locked } = useWriteLock();
  const ph = useLockedPlaceholder();
  return (
    <div
      ref={setNodeRef}
      // 세로 목록이라 y만 반영(가로 흔들림 제거). @dnd-kit/utilities는 미설치라 transform은 직접 만든다.
      style={{
        transform: transform ? `translate3d(0, ${Math.round(transform.y)}px, 0)` : undefined,
        transition,
      }}
      className={`${periodStyles.row} ${
        isDragging ? "bg-bg-soft relative z-10 rounded-md opacity-90 shadow-sm" : ""
      }`}
    >
      {locked ? null : (
        <button
          type="button"
          aria-label={`${row.label || "교시"} 순서 이동`}
          title="끌어서 순서 변경"
          // touch-none이 없으면 터치에서 스크롤이 드래그를 삼킨다(dnd-kit 요구).
          className="text-text-faint hover:text-foreground shrink-0 cursor-grab touch-none rounded p-1 active:cursor-grabbing"
          {...attributes}
          {...listeners}
        >
          <GripVertical className="size-4" />
        </button>
      )}
      <input
        // 2026-09-08 v5 글자 기준 실측: text-sm 16px에서 placeholder '이름 없음(시간만)'이 ≈115px라
        // 110px 칸(안쪽 88px)에서 '이름 없음(시'로 끊겼다(input이라 말줄임도 없다) → 140px(필요 137px).
        className={`${cellCls} w-[140px]`}
        value={row.label}
        // 비워도 저장된다(2026-08-13) — 그 교시는 화면에서 이름 없이 시간대만 나온다. placeholder에
        // "1교시"를 두면 비운 칸이 "1교시로 저장될 것"처럼 보여 그 규칙이 안 보인다.
        placeholder={ph("이름 없음(시간만)")}
        title="비워 두면 시간표·시트에 이름 없이 시간대만 표시됩니다"
        onChange={(e) => onPatch({ label: e.target.value })}
      />
      <div className={periodStyles.times}>
      <input
        type="time"
        // 2026-09-08 v5 글자 기준 실측: ko-KR time 입력은 text-sm 16px에서 콘텐츠 113 + px-2.5 20 + 테두리 2
        // = 135px가 필요해 120px에서 '오후 03:4'로 끊겼다 → 140px(끝 칸도 같은 값).
        className={`${cellCls} w-[140px]`}
        value={row.startTime}
        onChange={(e) => onPatch({ startTime: e.target.value })}
      />
      <span className="text-text-faint text-xs">~</span>
      <input
        type="time"
        className={`${cellCls} w-[140px]`}
        value={row.endTime}
        onChange={(e) => onPatch({ endTime: e.target.value })}
      />
      </div>
      <RemoveButton onClick={onRemove} />
    </div>
  );
}

/**
 * 교시 목록 편집기 — 행의 **순서가 곧 교시 번호**(1행=1교시)라 중간에 교시를 끼우려면 순서를 바꿀 수
 * 있어야 한다. '교시 추가'는 항상 맨 아래에 붙으므로, 손잡이로 끌어 제자리에 놓는다.
 * ⚠️ 저장된 수업(class_schedules)은 교시 번호가 아니라 **시각**으로 연결되므로 순서를 바꿔도 배치는 안 옮겨간다.
 */
export function PeriodListEditor({
  value,
  onChange,
}: {
  value: PeriodTimeRow[];
  onChange: (v: PeriodTimeRow[]) => void;
}) {
  const set = (i: number, patch: Partial<PeriodTimeRow>) =>
    onChange(value.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  // 한 화면에 편집기가 여러 개(전역 평일·주말·과목별)라 id를 인스턴스마다 분리.
  // SSR/CSR 동일 id가 필요해 useId 사용(하드코딩 id는 hydration 불일치).
  const uid = useId();
  const ids = value.map((_, i) => `${uid}-p${i}`);
  const sensors = useSensors(
    // 4px 이동 전엔 클릭으로 취급 — 손잡이를 살짝 눌러도 순서가 안 흔들린다.
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const handleDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const from = ids.indexOf(String(active.id));
    const to = ids.indexOf(String(over.id));
    if (from < 0 || to < 0) return;
    onChange(arrayMove(value, from, to));
  };
  const { locked } = useWriteLock();
  return (
    <div className={`${periodStyles.list} space-y-2`}>
      <DndContext id={uid} sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={ids} strategy={verticalListSortingStrategy}>
          <div className="space-y-2">
            {value.map((p, i) => (
              <PeriodRow
                key={ids[i]}
                id={ids[i]}
                row={p}
                onPatch={(patch) => set(i, patch)}
                onRemove={() => onChange(value.filter((_, j) => j !== i))}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>
      <div className="flex flex-wrap items-center gap-2">
        <AddButton
          onClick={() => onChange([...value, { label: `${value.length + 1}교시`, startTime: "", endTime: "" }])}
          label="교시 추가"
        />
        {value.length > 1 && !locked ? (
          <span className="text-text-faint text-xs">왼쪽 손잡이를 끌어 순서를 바꿉니다.</span>
        ) : null}
      </div>
    </div>
  );
}

export function HolidayListEditor({
  value,
  onChange,
}: {
  value: HolidaySetting[];
  onChange: (v: HolidaySetting[]) => void;
}) {
  const set = (i: number, patch: Partial<HolidaySetting>) =>
    onChange(value.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const ph = useLockedPlaceholder();
  return (
    <div className="space-y-2">
      {value.map((h, i) => (
        <div key={i} className="flex items-center gap-2">
          <input
            type="date"
            className={`${cellCls} w-[150px]`}
            value={h.date}
            onChange={(e) => set(i, { date: e.target.value })}
          />
          <input
            className={`${cellCls} flex-1`}
            value={h.name}
            placeholder={ph("공휴일명 (예: 개교기념일, 설날)")}
            onChange={(e) => set(i, { name: e.target.value })}
          />
          <RemoveButton onClick={() => onChange(value.filter((_, j) => j !== i))} />
        </div>
      ))}
      <AddButton onClick={() => onChange([...value, { date: "", name: "" }])} label="휴일 추가" />
    </div>
  );
}

// 셔틀버스 — 노출여부 + 요금 문구 + 노선(라벨 + 정류장 목록). 공개 접수 폼이 이 값을 표시.
export function ShuttleEditor({
  value,
  onChange,
}: {
  value: ShuttleSetting;
  onChange: (v: ShuttleSetting) => void;
}) {
  const setRoute = (i: number, patch: Partial<ShuttleSetting["routes"][number]>) =>
    onChange({ ...value, routes: value.routes.map((r, j) => (j === i ? { ...r, ...patch } : r)) });
  const ph = useLockedPlaceholder();
  return (
    <div className="space-y-3">
      <label className="text-foreground flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={value.enabled}
          onChange={(e) => onChange({ ...value, enabled: e.target.checked })}
          className="size-4"
        />
        공개 접수 폼에 셔틀버스 신청 표시
      </label>
      <label className="block">
        <span className="text-text-dim text-xs">요금 문구</span>
        <input
          className={`${cellCls} ml-2 w-[160px]`}
          value={value.fee}
          placeholder={ph("월 20,000원")}
          onChange={(e) => onChange({ ...value, fee: e.target.value })}
        />
      </label>

      <div className="space-y-3">
        {value.routes.map((r, i) => (
          <div key={i} className="border-line space-y-2 rounded-md border p-3">
            <div className="flex items-center gap-2">
              <input
                className={`${cellCls} flex-1`}
                value={r.label}
                placeholder={ph("노선 이름 (예: 1호차 주요 노선)")}
                onChange={(e) => setRoute(i, { label: e.target.value })}
              />
              <RemoveButton onClick={() => onChange({ ...value, routes: value.routes.filter((_, j) => j !== i) })} />
            </div>
            <StringListEditor
              value={r.stops}
              onChange={(stops) => setRoute(i, { stops })}
              placeholder="정류장"
              addLabel="정류장 추가"
            />
          </div>
        ))}
        <AddButton
          onClick={() => onChange({ ...value, routes: [...value.routes, { label: "", stops: [] }] })}
          label="노선 추가"
        />
      </div>
    </div>
  );
}

// 학생상담 양식(템플릿) — 이름 + 요약 뼈대 + (선택) 기본 범주/대상 + 기본양식 라디오. 상담 등록 폼이 소비.
// 범주/대상 "기본값" 옵션(value="")은 양식이 값을 지정하지 않음을 뜻함(폼의 일반/학부모 기본을 유지).
const CONSULT_CATEGORY_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "범주: 기본(일반)" },
  { value: "general", label: "일반" },
  { value: "academic", label: "학습/성적" },
  { value: "emotional", label: "정서/심리" },
  { value: "career", label: "진로" },
  { value: "social", label: "교우관계" },
  { value: "other", label: "기타" },
];
const CONSULT_AUDIENCE_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "대상: 기본(학부모)" },
  { value: "parent", label: "학부모" },
  { value: "student", label: "학생" },
  { value: "both", label: "학부모+학생" },
];

function nextTemplateKey(taken: Set<string>): string {
  let n = 1;
  while (taken.has(`template_${n}`)) n += 1;
  return `template_${n}`;
}

export function ConsultationTemplateEditor({
  value,
  onChange,
}: {
  value: ConsultationTemplate[];
  onChange: (v: ConsultationTemplate[]) => void;
}) {
  const set = (i: number, patch: Partial<ConsultationTemplate>) =>
    onChange(value.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  // 기본양식은 1개만 — 한 행을 기본으로 지정하면 나머지는 자동 해제. i=null이면 전부 해제(기본 없음).
  const setDefault = (i: number | null) =>
    onChange(value.map((x, j) => ({ ...x, isDefault: i !== null && j === i })));
  const noDefault = !value.some((t) => t.isDefault);
  const ph = useLockedPlaceholder();

  return (
    <div className="space-y-3">
      <label className="text-foreground flex items-center gap-2 text-sm">
        <input
          type="radio"
          name="consultation-default"
          checked={noDefault}
          onChange={() => setDefault(null)}
          className="size-4"
        />
        기본양식 지정 안 함 <span className="text-text-dim">(새 상담은 빈 요약으로 시작)</span>
      </label>

      {/* 치환 태그 안내 — 요약 뼈대에 넣으면 상담 등록 시 실제 값으로 자동 치환. */}
      <p className="text-text-dim border-line bg-bg-soft/40 rounded-md border px-3 py-2 text-xs leading-relaxed break-keep">
        요약 뼈대에 치환 태그를 넣으면 상담 등록 시 자동으로 채워집니다 —{" "}
        {["{{날짜}}", "{{담당}}", "{{학생}}", "{{학년}}"].map((tag) => (
          <code key={tag} className="border-line text-foreground mx-0.5 rounded border bg-transparent px-1 font-mono">
            {tag}
          </code>
        ))}
      </p>

      {value.map((t, i) => (
        <div key={t.key} className="border-line space-y-2 rounded-md border p-3">
          <div className="flex flex-wrap items-center gap-2">
            <input
              className={`${cellCls} min-w-[180px] flex-1`}
              value={t.name}
              placeholder={ph("양식 이름 (예: 신입생 관리 #1 – 첫수업 전 전화)")}
              onChange={(e) => set(i, { name: e.target.value })}
            />
            <select
              className={`${cellCls} w-[150px]`}
              value={t.category ?? ""}
              onChange={(e) => set(i, { category: (e.target.value || null) as ConsultationTemplate["category"] })}
              aria-label="기본 범주"
            >
              {CONSULT_CATEGORY_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
            <select
              className={`${cellCls} w-[150px]`}
              value={t.audience ?? ""}
              onChange={(e) => set(i, { audience: (e.target.value || null) as ConsultationTemplate["audience"] })}
              aria-label="기본 대상"
            >
              {CONSULT_AUDIENCE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
            <label className="text-text-dim inline-flex items-center gap-1.5 text-xs">
              <input
                type="radio"
                name="consultation-default"
                checked={t.isDefault}
                onChange={() => setDefault(i)}
                className="size-4"
              />
              기본양식
            </label>
            <RemoveButton onClick={() => onChange(value.filter((_, j) => j !== i))} />
          </div>
          <textarea
            className={`${cellCls} w-full resize-y break-keep`}
            rows={4}
            value={t.body}
            placeholder={ph("요약 뼈대 — 상담 등록 시 요약란에 채워집니다. {{날짜}} {{담당}} 태그 사용 가능")}
            onChange={(e) => set(i, { body: e.target.value })}
          />
        </div>
      ))}
      <AddButton
        onClick={() =>
          onChange([
            ...value,
            {
              key: nextTemplateKey(new Set(value.map((t) => t.key))),
              name: "",
              body: "",
              category: null,
              audience: null,
              isDefault: false,
            },
          ])
        }
        label="양식 추가"
      />
    </div>
  );
}

export function TermListEditor({
  value,
  onChange,
}: {
  value: TermSetting[];
  onChange: (v: TermSetting[]) => void;
}) {
  const set = (i: number, patch: Partial<TermSetting>) =>
    onChange(value.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const ph = useLockedPlaceholder();
  return (
    <div className="space-y-2">
      {value.map((t, i) => (
        <div key={i} className="flex items-center gap-2">
          <input
            className={`${cellCls} w-[140px]`}
            value={t.name}
            placeholder={ph("1학기")}
            onChange={(e) => set(i, { name: e.target.value })}
          />
          <input
            type="date"
            className={`${cellCls} w-[150px]`}
            value={t.start}
            onChange={(e) => set(i, { start: e.target.value })}
          />
          <span className="text-text-faint text-xs">~</span>
          <input
            type="date"
            className={`${cellCls} w-[150px]`}
            value={t.end}
            onChange={(e) => set(i, { end: e.target.value })}
          />
          <RemoveButton onClick={() => onChange(value.filter((_, j) => j !== i))} />
        </div>
      ))}
      <AddButton
        onClick={() => onChange([...value, { name: "", start: "", end: "" }])}
        label="학기 추가"
      />
    </div>
  );
}
