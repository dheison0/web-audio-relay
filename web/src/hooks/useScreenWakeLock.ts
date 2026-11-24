import { useEffect, useRef, useState } from "react";
import type { Role } from "../types";

type Status = "inactive" | "active" | "unsupported" | "unavailable";

function useScreenWakeLock(
  connected: boolean,
  role: Role,
  playing: boolean,
  addDebugLog: (message: string) => void,
) {
  const [status, setStatus] = useState<Status>("inactive");
  const sentinelRef = useRef<WakeLockSentinel | null>(null);
  const requestedRef = useRef(false);
  const addDebugLogRef = useRef(addDebugLog);
  addDebugLogRef.current = addDebugLog;

  useEffect(() => {
    const shouldKeepScreenAwake = connected && role === "transmitter" && playing;
    requestedRef.current = shouldKeepScreenAwake;

    const releaseScreenWakeLock = () => {
      const sentinel = sentinelRef.current;
      sentinelRef.current = null;
      if (sentinel) void sentinel.release();
    };

    if (!shouldKeepScreenAwake) {
      releaseScreenWakeLock();
      setStatus("inactive");
      return;
    }

    const requestScreenWakeLock = async () => {
      if (
        document.visibilityState !== "visible" ||
        sentinelRef.current ||
        !requestedRef.current
      ) {
        return;
      }
      if (!("wakeLock" in navigator)) {
        setStatus("unsupported");
        return;
      }

      try {
        const sentinel = await navigator.wakeLock.request("screen");
        if (!requestedRef.current) {
          void sentinel.release();
          return;
        }
        sentinelRef.current = sentinel;
        setStatus("active");
        addDebugLogRef.current("Tela: bloqueio de suspensão ativado durante a transmissão");
        sentinel.addEventListener(
          "release",
          () => {
            if (sentinelRef.current === sentinel) {
              sentinelRef.current = null;
              setStatus("unavailable");
              addDebugLogRef.current("Tela: bloqueio de suspensão liberado pelo navegador ou sistema");
            }
          },
          { once: true },
        );
      } catch (error) {
        setStatus("unavailable");
        addDebugLogRef.current(`Tela: não foi possível manter a tela ativa: ${error}`);
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void requestScreenWakeLock();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    void requestScreenWakeLock();

    return () => {
      requestedRef.current = false;
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      releaseScreenWakeLock();
    };
  }, [connected, playing, role]);

  return status;
}

export default useScreenWakeLock;
