// 영어 시트 반영 스켈레톤 — 자기 loading이 없으면 부모(시간표 격자) 스켈레톤을 받아 머리글·툴바·격자가 떴다가
// 좁은 폼으로 바뀌었다. 실물(page.tsx)은 PageHeader 없이 **자체 머리**(돌아가기 링크·h1·설명) + `max-w-6xl` 폼이다.
// 치수는 실물과 같은 클래스 + 투명 글자로 줄 높이를 잡는다(손 px 금지). 권한 없음 화면(짧은 안내)은 드문 경로라 따르지 않는다.
const bar = "bg-bg-soft text-transparent animate-pulse rounded";
// 입력칸 껍데기 = sheet-form.tsx `field`와 같은 상자(테두리·안쪽 여백·글자 크기가 높이를 정한다).
const FIELD = "border-line bg-card w-full rounded-md border px-3 py-2 text-sm";

function Field({ label }: { label: string }) {
  return (
    <div className="min-w-0 flex-1 space-y-1 text-sm">
      <span className={bar}>{label}</span>
      <div className={FIELD}>
        <span className={bar}>탭 선택</span>
      </div>
    </div>
  );
}

export default function EnglishSheetLoading() {
  return (
    <div aria-hidden className="mx-auto w-full max-w-6xl space-y-6 p-4 md:p-6">
      <header>
        <div className="text-sm">
          <span className={bar}>← 영어 시간표</span>
        </div>
        <div className="mt-3 text-xl font-semibold">
          <span className={bar}>영어 시트 반영</span>
        </div>
        <p className="mt-1 text-sm">
          <span className={bar}>월별 시트의 수업 배치·반 이름·학생 이동을 확인하고 적용일을 지정합니다.</span>
        </p>
      </header>
      <div className="space-y-6">
        {/* 시트와 적용일 카드 — 주소 + 탭 불러오기 / 탭 둘 + 적용일 / 읽을 범위 접힘 / 미리보기 줄 */}
        <section className="border-line space-y-4 rounded-lg border p-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <Field label="구글 시트 주소" />
            <div className="bg-bg-soft h-(--control-h) w-24 shrink-0 animate-pulse rounded-lg" />
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="강사별 시간표" />
            <Field label="통합 시간표 · 학생 명단" />
            <Field label="적용일" />
          </div>
          <div className="text-sm">
            <span className={bar}>▸ 읽을 범위 설정</span>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <div className="bg-bg-soft h-(--control-h) w-20 shrink-0 animate-pulse rounded-lg" />
            <p className="text-xs">
              <span className={bar}>오늘부터 반영합니다. 이전 날짜의 배치 이력을 보존합니다.</span>
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}
