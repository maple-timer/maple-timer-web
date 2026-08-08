import { useCallback } from "react";
import { showAppToast } from "./appToastService";

export function useToastMessage() {
  const setMessage = useCallback((message: string | null) => {
    showAppToast(message);
  }, []);

  return { setMessage };
}
