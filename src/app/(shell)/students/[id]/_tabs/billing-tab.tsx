import { getStudentInvoices } from "@/features/students/server/queries";
import { BillingView } from "./billing-view";

/** 수납 탭 — ijw BillingTab 이식. 연도 네비·상태 필터·통계 3카드·내역 테이블·페이지네이션·전체 통계. */
export async function BillingTab({ studentId }: { studentId: string }) {
  const invoices = await getStudentInvoices(studentId);
  return <BillingView invoices={invoices} />;
}
