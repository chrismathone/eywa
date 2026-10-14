"use client";

import { useSyncExternalStore } from "react";
import { getMicrophoneStatus, getServerMicrophoneStatus, microphoneMessage, subscribeMicrophone } from "@/lib/microphone";

export function useMicrophone() {
  const status = useSyncExternalStore(subscribeMicrophone, getMicrophoneStatus, getServerMicrophoneStatus);
  return { available: status === "available", message: microphoneMessage(status) };
}
