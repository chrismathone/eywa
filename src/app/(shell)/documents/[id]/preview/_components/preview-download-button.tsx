"use client";

import { useState } from "react";
import { Download, Loader2 } from "@/components/icons/eywa-icon-compat";
import { Button } from "@/components/ui/button";
import { downloadDocument } from "@/features/documents/open-file";

export function PreviewDownloadButton({ id }: { id: string }) {
  const [busy, setBusy] = useState(false);
  return (
    <Button
      variant="outline"
      disabled={busy}
      onClick={async () => {
        if (busy) return;
        setBusy(true);
        try {
          await downloadDocument(id);
        } finally {
          setBusy(false);
        }
      }}
    >
      {busy ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />} 다운로드
    </Button>
  );
}
