import { FeatureBlock } from "../_ui/feature-block";
import { MockAttendance } from "../_ui/mock-attendance";
import { MockBilling } from "../_ui/mock-billing";
import { MockTimetable } from "../_ui/mock-timetable";

export function FeaturesSection() {
  return (
    <>
      <FeatureBlock
        id="timetable"
        eyebrow="시간표"
        title={
          <>
            강사·교시·학생을 <span className="text-primary">한 장에.</span>
          </>
        }
        desc="강사별·요일별 수업을 한 화면에서 보고, 드래그로 옮기고, 반별 학생 명단까지 바로 확인합니다. 바뀐 시간표는 PNG·A4로 한 번에 내보내세요."
        points={["강사뷰 · 통합뷰 토글", "드래그앤드롭으로 시간 조정", "PNG · A4 인쇄 내보내기"]}
        url="eywa.app/timetable"
      >
        <MockTimetable />
      </FeatureBlock>

      <FeatureBlock
        id="attendance"
        reverse
        tone="soft"
        eyebrow="출석부"
        title={
          <>
            한 달 출결을 <span className="text-primary">한눈에.</span>
          </>
        }
        desc="학생 × 한 달 매트릭스로 출석·지각·결석을 한 화면에 펼칩니다. 셀 하나만 누르면 출결이 기록되고, 결석은 학부모에게 바로 알림이 갑니다."
        points={["학생 × 30일 출결 매트릭스", "셀 클릭 즉시 입력 · 메모", "결석 시 학부모 자동 알림"]}
        url="eywa.app/attendance"
      >
        <MockAttendance />
      </FeatureBlock>

      <FeatureBlock
        id="billing"
        eyebrow="수납"
        title={
          <>
            청구·미납·할인을 <span className="text-primary">자동으로.</span>
          </>
        }
        desc="수강료가 자동 계산·청구되고, 미납은 한곳에 모입니다. 기한 경과·부분 납부까지 색으로 구분해, 받아야 할 돈을 놓치지 않습니다."
        points={["수강료 자동 계산 · 청구", "미납 · 기한경과 자동 표시", "할인 · 메모 · 일괄 처리"]}
        url="eywa.app/billing"
      >
        <MockBilling />
      </FeatureBlock>
    </>
  );
}
