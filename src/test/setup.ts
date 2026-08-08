import "@testing-library/jest-dom/vitest";

type PopoverTestElement = HTMLElement & {
  __mapleTimerPopoverMock?: true;
  hidePopover: () => void;
  showPopover: () => void;
};

if (typeof HTMLElement !== "undefined") {
  const popoverOpenState = new WeakMap<HTMLElement, boolean>();
  const htmlElementPrototype = HTMLElement.prototype as PopoverTestElement;

  if (!htmlElementPrototype.__mapleTimerPopoverMock) {
    const nativeMatches = htmlElementPrototype.matches;

    htmlElementPrototype.showPopover = function showPopover() {
      popoverOpenState.set(this, true);
      queueMicrotask(() => {
        const event = new Event("toggle");
        Object.defineProperty(event, "newState", { value: "open" });
        this.dispatchEvent(event);
      });
    };

    htmlElementPrototype.hidePopover = function hidePopover() {
      popoverOpenState.set(this, false);
      queueMicrotask(() => {
        const event = new Event("toggle");
        Object.defineProperty(event, "newState", { value: "closed" });
        this.dispatchEvent(event);
      });
    };

    htmlElementPrototype.matches = function matches(selector: string) {
      if (selector === ":popover-open") {
        return popoverOpenState.get(this) ?? false;
      }
      return nativeMatches.call(this, selector);
    };

    Object.defineProperty(htmlElementPrototype, "__mapleTimerPopoverMock", {
      value: true,
    });
  }
}

if (
  typeof globalThis.localStorage === "undefined" ||
  typeof globalThis.localStorage.getItem !== "function"
) {
  class TestStorage implements Storage {
    [name: string]: unknown;

    get length() {
      return Object.keys(this).length;
    }

    clear() {
      for (const key of Object.keys(this)) {
        delete this[key];
      }
    }

    getItem(key: string) {
      return Object.prototype.hasOwnProperty.call(this, key) ? String(this[key]) : null;
    }

    key(index: number) {
      return Object.keys(this)[index] ?? null;
    }

    removeItem(key: string) {
      delete this[key];
    }

    setItem(key: string, value: string) {
      Object.defineProperty(this, key, {
        value: String(value),
        enumerable: true,
        configurable: true,
        writable: true,
      });
    }
  }

  Object.defineProperty(globalThis, "localStorage", {
    value: new TestStorage(),
    configurable: true,
  });
}

if (typeof globalThis.ImageData === "undefined") {
  class TestImageData {
    readonly colorSpace = "srgb" as PredefinedColorSpace;
    readonly data: ImageDataArray;
    readonly height: number;
    readonly width: number;

    constructor(width: number, height: number);
    constructor(data: Uint8ClampedArray, width: number, height?: number);
    constructor(dataOrWidth: Uint8ClampedArray | number, widthOrHeight: number, height?: number) {
      if (typeof dataOrWidth === "number") {
        this.width = dataOrWidth;
        this.height = widthOrHeight;
        this.data = new Uint8ClampedArray(this.width * this.height * 4) as ImageDataArray;
      } else {
        this.width = widthOrHeight;
        this.height = height ?? dataOrWidth.length / 4 / widthOrHeight;
        this.data = dataOrWidth as ImageDataArray;
      }
    }
  }

  globalThis.ImageData = TestImageData as unknown as typeof ImageData;
}
