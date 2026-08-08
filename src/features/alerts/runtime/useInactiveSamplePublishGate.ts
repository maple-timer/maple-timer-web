import { useCallback, useRef } from "react";

export function useInactiveSamplePublishGate() {
  const lastInactivePublishKeyRef = useRef<string | null>(null);

  const shouldPublishInactiveSample = useCallback((key: string) => {
    if (lastInactivePublishKeyRef.current === key) {
      return false;
    }
    lastInactivePublishKeyRef.current = key;
    return true;
  }, []);

  const markActiveSamplePublished = useCallback(() => {
    lastInactivePublishKeyRef.current = null;
  }, []);

  return {
    markActiveSamplePublished,
    shouldPublishInactiveSample,
  };
}
