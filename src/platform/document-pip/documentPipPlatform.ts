export type DocumentPipWindowSize = {
  width?: number;
  height?: number;
};

export type DocumentPipWindow = Window;

export type DocumentPipPlatform = {
  isSupported: () => boolean;
  requestWindow: (size?: DocumentPipWindowSize) => Promise<DocumentPipWindow>;
  createMountHost: (pipWindow: DocumentPipWindow, id: string) => HTMLElement;
  isWindowClosed: (pipWindow: DocumentPipWindow) => boolean;
  tryResizeWindow: (
    pipWindow: DocumentPipWindow,
    size: DocumentPipWindowSize,
  ) => boolean;
  closeWindow: (pipWindow: DocumentPipWindow) => void;
  onPageHide: (
    pipWindow: DocumentPipWindow,
    listener: () => void,
  ) => () => void;
};

type DocumentPictureInPictureApi = {
  requestWindow: (size?: DocumentPipWindowSize) => Promise<DocumentPipWindow>;
};

type DocumentPipHostWindow = Window & {
  documentPictureInPicture?: DocumentPictureInPictureApi;
};

export function createBrowserDocumentPipPlatform(
  getHostWindow: () => DocumentPipHostWindow | null = getBrowserWindow,
): DocumentPipPlatform {
  return {
    isSupported() {
      return Boolean(getHostWindow()?.documentPictureInPicture);
    },
    async requestWindow(size) {
      const api = getHostWindow()?.documentPictureInPicture;
      if (!api) {
        throw new Error("Document Picture-in-Picture is unavailable.");
      }
      return api.requestWindow(size);
    },
    createMountHost(pipWindow, id) {
      const host = pipWindow.document.createElement("div");
      host.id = id;
      pipWindow.document.body.appendChild(host);
      return host;
    },
    isWindowClosed(pipWindow) {
      return Boolean(pipWindow.closed);
    },
    tryResizeWindow(pipWindow, size) {
      if (pipWindow.closed) {
        return false;
      }
      try {
        pipWindow.resizeTo(
          size.width ?? pipWindow.outerWidth,
          size.height ?? pipWindow.outerHeight,
        );
        return true;
      } catch {
        return false;
      }
    },
    closeWindow(pipWindow) {
      if (!pipWindow.closed) {
        pipWindow.close();
      }
    },
    onPageHide(pipWindow, listener) {
      pipWindow.addEventListener("pagehide", listener, { once: true });
      return () => pipWindow.removeEventListener("pagehide", listener);
    },
  };
}

export const browserDocumentPipPlatform = createBrowserDocumentPipPlatform();

function getBrowserWindow(): DocumentPipHostWindow | null {
  return typeof window === "undefined" ? null : window;
}
