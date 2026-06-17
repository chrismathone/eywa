import { Reveal } from "../_motion/reveal";
import { FeatureSwitcher, type Feature } from "../_ui/feature-switcher";
import { SectionShell } from "../_ui/section-shell";
import { MockAttendance } from "../_ui/mock-attendance";
import { MockBilling } from "../_ui/mock-billing";
import { MockTimetable } from "../_ui/mock-timetable";

const FEATURES: Feature[] = [
  {
    key: "timetable",
    label: "시간표",
    eyebrow: "시간표",
    title: (
      <>
        강사·교시·학생을 <span className="text-primary">한 장에.</span>
      </>
    ),
    desc: "강사별·요일별 수업을 한 화면에서 보고, 드래그로 옮기고, 반별 학생 명단까지 바로 확인합니다. 바뀐 시간표는 PNG·A4로 한 번에 내보내세요.",
    points: ["강사뷰 · 통합뷰 토글", "드래그앤드롭으로 시간 조정", "PNG · A4 인쇄 내보내기"],
    url: "eywa.app/timetable",
    mock: <MockTimetable />,
  },
  {
    key: "attendance",
    label: "출석부",
    eyebrow: "출석부",
    title: (
      <>
        한 달 출결을 <span className="text-primary">한눈에.</span>
      </>
    ),
    desc: "학생 × 한 달 매트릭스로 출석·지각·결석을 한 화면에 펼칩니다. 셀 하나만 누르면 출결이 기록되고, 결석은 학부모에게 바로 알림이 갑니다.",
    points: ["학생 × 30일 출결 매트릭스", "셀 클릭 즉시 입력 · 메모", "결석 시 학부모 자동 알림"],
    url: "eywa.app/attendance",
    mock: <MockAttendance />,
  },
  {
    key: "billing",
    label: "수납",
    eyebrow: "수납",
    title: (
      <>
        청구·미납·할인을 <span className="text-primary">자동으로.</span>
      </>
    ),
    desc: "수강료가 자동 계산·청구되고, 미납은 한곳에 모입니다. 기한 경과·부분 납부까지 색으로 구분해, 받아야 할 돈을 놓치지 않습니다.",
    points: ["수강료 자동 계산 · 청구", "미납 · 기한경과 자동 표시", "할인 · 메모 · 일괄 처리"],
    url: "eywa.app/billing",
    mock: <MockBilling />,
  },
];

export function FeaturesSection() {
  return (
    <SectionShell id="features" tone="soft" bordered pad="lg">
      <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
        <div className="max-w-[40rem]">
          <Reveal variant="up">
            <p className="text-primary font-mono text-[11px] font-bold tracking-[0.16em] uppercase">핵심 기능</p>
          </Reveal>
          <Reveal variant="clip" delay={60}>
            <h2 className="text-foreground mt-4 text-[clamp(1.9rem,4vw,3.1rem)] leading-[1.2] font-extrabold tracking-[-0.025em]">
              매일 여는 <span className="text-primary">세 화면.</span>
            </h2>
          </Reveal>
        </div>
        <Reveal variant="up" delay={120}>
          <p className="text-text-dim max-w-[24rem] text-[15px] leading-[1.7]">
            탭을 눌러 시간표·출석부·수납을 둘러보세요. 데모가 아니라 실제 화면 그대로입니다.
          </p>
        </Reveal>
      </div>

      <Reveal variant="up" delay={120} className="mt-12">
        <FeatureSwitcher features={FEATURES} />
      </Reveal>
    </SectionShell>
  );
}
