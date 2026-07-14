"use client";

// 배열형 설정(과목·직급·학년·교시·학기·공휴일) 편집기 — 행 추가/삭제 + 인라인 입력.
import { useRef } from "react";
import { Plus, X } from "@/components/icons/eywa-icon-compat";
import { SUBJECT_COLORS, type ConsultationTemplate, type HolidaySetting, type PeriodTimeRow, type ShuttleSetting, type SubjectSetting, type TermSetting } from "@/features/owner/settings-types";
import { SUBJECT_SOLID, KNOWN_SUBJECT_KEYS } from "@/features/owner/subjects";
import { WEEKDAY_GROUPING_OPTIONS } from "@/features/timetable/lib/weekday-groups";

const cellCls =
  "border-line text-foreground rounded-md border bg-transparent px-2.5 py-1.5 text-[13px] outline-none focus:border-primary";

function AddButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="border-line text-text-dim hover:text-foreground hover:border-primary inline-flex items-center gap-1 rounded-md border border-dashed px-3 py-1.5 text-[12px]"
    >
      <Plus className="size-3.5" /> {label}
    </button>
  );
}

function RemoveButton({ onClick }: { onClick: () => void }) {
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
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {value.map((v, i) => (
          <div key={i} className="flex items-center gap-1">
            <input
              type={type}
              className={`${cellCls} ${type === "date" ? "w-[140px]" : "w-[110px]"}`}
              value={v}
              placeholder={placeholder}
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
}: {
  value: SubjectSetting[];
  onChange: (v: SubjectSetting[]) => void;
  // 삭제를 가로채는 콜백(과목 흡수 다이얼로그) — 미지정 시 기존처럼 행 즉시 제거.
  onRemove?: (index: number) => void;
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

  return (
    <div className="space-y-2">
      {/* 행 제목(열 헤더) */}
      {value.length > 0 ? (
        <div className="text-text-faint micro flex flex-wrap items-center gap-2 px-0.5">
          <span className="w-[110px]">과목명</span>
          <span className="w-[122px]">색</span>
          <span className="w-[160px]">시간표 요일 병합</span>
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
                placeholder="과목명 (예: 수학)"
                onChange={(e) => set(i, { label: e.target.value })}
                onBlur={() => finalizeKey(i)}
                aria-invalid={dup}
              />
              {/* 색 — 미리보기 칩 + 선택 */}
              <span className="flex items-center gap-1.5">
                <span className={`size-4 shrink-0 rounded-sm ${SUBJECT_SOLID[s.color]}`} aria-hidden />
                <select
                  className={`${cellCls} w-[100px]`}
                  value={s.color}
                  onChange={(e) => set(i, { color: e.target.value as SubjectSetting["color"] })}
                  aria-label="과목 색"
                >
                  {SUBJECT_COLORS.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </span>
              {/* 요일 병합 — 과목별 시간표 기본뷰 병합 프리셋(월목/화금·월화/목금·월수금/화목·없음) */}
              <select
                className={`${cellCls} w-[160px]`}
                value={s.weekdayGrouping ?? "mon-thu"}
                onChange={(e) => set(i, { weekdayGrouping: e.target.value as SubjectSetting["weekdayGrouping"] })}
                aria-label="시간표 요일 병합"
              >
                {WEEKDAY_GROUPING_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
              {/* 내부 ID — 읽기전용(데이터 보존용, 자동 확정·고정) */}
              <span
                className="text-text-faint w-[70px] shrink-0 truncate font-mono text-[11px]"
                title={`내부 ID: ${s.key} (자동·변경 불가)`}
              >
                {s.key}
              </span>
              <RemoveButton
                onClick={() => (onRemove ? onRemove(i) : onChange(value.filter((_, j) => j !== i)))}
              />
            </div>
            {dup ? (
              <p className="text-danger pl-0.5 text-[11px]">이미 있는 과목명입니다 — 다른 이름을 쓰거나 한 행을 삭제하세요.</p>
            ) : null}
          </div>
        );
      })}
      <AddButton
        onClick={() =>
          onChange([
            ...value,
            { key: nextSubjectKey(new Set(value.map((s) => s.key))), label: "", color: "neutral", weekdayGrouping: "mon-thu", testMax: 5 },
          ])
        }
        label="과목 추가"
      />
    </div>
  );
}

export function PeriodListEditor({
  value,
  onChange,
}: {
  value: PeriodTimeRow[];
  onChange: (v: PeriodTimeRow[]) => void;
}) {
  const set = (i: number, patch: Partial<PeriodTimeRow>) =>
    onChange(value.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  return (
    <div className="space-y-2">
      {value.map((p, i) => (
        <div key={i} className="flex flex-wrap items-center gap-2">
          <input
            className={`${cellCls} w-[90px]`}
            value={p.label}
            placeholder="1교시"
            onChange={(e) => set(i, { label: e.target.value })}
          />
          <input
            type="time"
            className={`${cellCls} w-[120px]`}
            value={p.startTime}
            onChange={(e) => set(i, { startTime: e.target.value })}
          />
          <span className="text-text-faint text-[12px]">~</span>
          <input
            type="time"
            className={`${cellCls} w-[120px]`}
            value={p.endTime}
            onChange={(e) => set(i, { endTime: e.target.value })}
          />
          <RemoveButton onClick={() => onChange(value.filter((_, j) => j !== i))} />
        </div>
      ))}
      <AddButton
        onClick={() => onChange([...value, { label: `${value.length + 1}교시`, startTime: "", endTime: "" }])}
        label="교시 추가"
      />
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
            placeholder="공휴일명 (예: 개교기념일, 설날)"
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
  return (
    <div className="space-y-3">
      <label className="text-foreground flex items-center gap-2 text-[13px]">
        <input
          type="checkbox"
          checked={value.enabled}
          onChange={(e) => onChange({ ...value, enabled: e.target.checked })}
          className="size-4"
        />
        공개 접수 폼에 셔틀버스 신청 표시
      </label>
      <label className="block">
        <span className="text-text-dim text-[12px]">요금 문구</span>
        <input
          className={`${cellCls} ml-2 w-[160px]`}
          value={value.fee}
          placeholder="월 20,000원"
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
                placeholder="노선 이름 (예: 1호차 주요 노선)"
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

  return (
    <div className="space-y-3">
      <label className="text-foreground flex items-center gap-2 text-[13px]">
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
      <p className="text-text-dim border-line bg-bg-soft/40 rounded-md border px-3 py-2 text-[11px] leading-relaxed break-keep">
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
              placeholder="양식 이름 (예: 신입생 관리 #1 – 첫수업 전 전화)"
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
            <label className="text-text-dim inline-flex items-center gap-1.5 text-[12px]">
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
            placeholder="요약 뼈대 — 상담 등록 시 요약란에 채워집니다. {{날짜}} {{담당}} 태그 사용 가능"
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
  return (
    <div className="space-y-2">
      {value.map((t, i) => (
        <div key={i} className="flex items-center gap-2">
          <input
            className={`${cellCls} w-[140px]`}
            value={t.name}
            placeholder="1학기"
            onChange={(e) => set(i, { name: e.target.value })}
          />
          <input
            type="date"
            className={`${cellCls} w-[150px]`}
            value={t.start}
            onChange={(e) => set(i, { start: e.target.value })}
          />
          <span className="text-text-faint text-[12px]">~</span>
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
