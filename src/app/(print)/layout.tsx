import type { ReactNode } from "react";

export default function PrintLayout({ children }: { children: ReactNode }) {
  return <div className="paper-scale bg-white text-black">{children}</div>;
}
