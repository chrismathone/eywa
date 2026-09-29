import { notFound } from "next/navigation";
import { NavigationPreview } from "./preview";

export const metadata = { title: "탭 구성 미리보기 — 에이와" };

export default function NavigationPreviewPage() {
  if (process.env.NODE_ENV !== "development") notFound();
  return <NavigationPreview />;
}
