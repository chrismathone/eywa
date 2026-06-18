import { getStudentOptions } from "@/features/billing/server/textbook-queries";
import { currentPeriod } from "@/features/billing/calc";
import { TuitionCalculator } from "./tuition-calculator";

// 수강료 계산기 면 — 학생 목록·기본 청구월만 서버에서 준비하고 계산은 클라이언트(라이브 견적).
export async function CalculatorPanel() {
  const students = await getStudentOptions();
  return <TuitionCalculator students={students} defaultPeriod={currentPeriod()} />;
}
