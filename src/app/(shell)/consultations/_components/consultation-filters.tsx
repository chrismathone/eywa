import { FilterSelect } from "@/components/filter-select";
import { TOOLBAR_SELECT } from "@/components/toolbar-controls";
import type { StudentConsultationCategory } from "@/features/consultations/server/queries";

type RangeKey = "all" | "7d" | "30d";
type CategoryKey = "all" | StudentConsultationCategory;
type UrgencyKey = "all" | "overdue" | "today" | "soon" | "later" | "done";

/**
 * 필터 축 — 목록과 통계 화면이 **같은 드롭다운**을 쓴다(원장 2026-10-01 — 오가도 필터 유지). 옛 화면은 알약 칩 16개를 툴바 두 줄에
 * 펼쳤다 → 디자인 지시서 §10(2026-09-03): 축마다 **라벨 하나**(드롭다운, 고른 값이 라벨이 된다). 선택지는 그대로다.
 */
const RANGE_OPTIONS: { value: Exclude<RangeKey, "all">; label: string }[] = [
  { value: "7d", label: "최근 7일" },
  { value: "30d", label: "최근 30일" },
];
const CATEGORY_OPTIONS: { value: Exclude<CategoryKey, "all">; label: string }[] = [
  { value: "academic", label: "학습" },
  { value: "emotional", label: "정서" },
  { value: "career", label: "진로" },
  { value: "social", label: "교우" },
  { value: "general", label: "일반" },
  { value: "other", label: "기타" },
];
const URGENCY_OPTIONS: { value: Exclude<UrgencyKey, "all">; label: string }[] = [
  { value: "overdue", label: "지연" },
  { value: "today", label: "오늘" },
  { value: "soon", label: "3일 내" },
  { value: "later", label: "예정" },
  { value: "done", label: "완료" },
];

const SEL = { className: "w-auto", triggerClassName: TOOLBAR_SELECT } as const;

export function ConsultationFilters({
  range,
  cat,
  urg,
  who,
  subject,
  counselorOptions,
  subjectOptions,
}: {
  range: string;
  cat: string;
  urg: string;
  who: string;
  subject: string;
  counselorOptions: { id: string; name: string }[];
  subjectOptions: { value: string; label: string }[];
}) {
  return (
    <>
      <FilterSelect paramName="range" value={range === "all" ? "" : range} options={RANGE_OPTIONS} axisLabel="기간" ariaLabel="기간 필터" {...SEL} />
      <FilterSelect paramName="cat" value={cat === "all" ? "" : cat} options={CATEGORY_OPTIONS} axisLabel="카테고리" ariaLabel="카테고리 필터" {...SEL} />
      <FilterSelect paramName="urg" value={urg === "all" ? "" : urg} options={URGENCY_OPTIONS} axisLabel="후속" ariaLabel="후속 조치 필터" {...SEL} />
      {/* 상담사 — 실제로 상담을 쓴 사람만 선다(직원 명부 전체가 아니다). 강사 계정은 자기 것만 보여
          선택지가 없으므로 줄 자체를 감춘다(고를 것이 하나뿐인 필터는 자리만 차지한다). */}
      {counselorOptions.length > 0 ? (
        <FilterSelect
          paramName="who"
          value={who}
          options={counselorOptions.map((c) => ({ value: c.id, label: c.name }))}
          axisLabel="상담사"
          ariaLabel="상담사 필터"
          {...SEL}
        />
      ) : null}
      {/* 과목 — 선택지·라벨은 학원설정이 단일 소스(코드에 과목을 적지 않는다). */}
      <FilterSelect paramName="subject" value={subject} options={subjectOptions} axisLabel="과목" ariaLabel="과목 필터" {...SEL} />
    </>
  );
}
