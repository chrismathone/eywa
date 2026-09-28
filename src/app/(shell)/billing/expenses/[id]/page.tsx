import { notFound } from "next/navigation";
import { requireAccess } from "@/lib/auth/require-access";
import { getExpenseById } from "@/features/billing/server/expense-queries";
import { ExpenseDocument } from "../../_components/expense-document";

type Params = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Params) {
  const { id } = await params;
  const expense = await getExpenseById(id);
  return { title: expense ? `${expense.title} · 지출결의서 — 에이와` : "지출결의서 — 에이와" };
}

export default async function ExpenseDetailPage({ params }: Params) {
  await requireAccess("billing");
  const { id } = await params;
  const expense = await getExpenseById(id);
  if (!expense) notFound();
  return <ExpenseDocument expense={expense} />;
}
