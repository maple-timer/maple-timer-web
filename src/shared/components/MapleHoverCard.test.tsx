import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MapleHoverCard } from "./MapleHoverCard";

describe("MapleHoverCard", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("does not duplicate layer toggle listeners across rerenders", () => {
    const originalAddEventListener = HTMLElement.prototype.addEventListener as (
      this: HTMLElement,
      type: string,
      listener: EventListenerOrEventListenerObject | null,
      options?: boolean | AddEventListenerOptions,
    ) => void;
    const originalRemoveEventListener = HTMLElement.prototype.removeEventListener as (
      this: HTMLElement,
      type: string,
      listener: EventListenerOrEventListenerObject | null,
      options?: boolean | EventListenerOptions,
    ) => void;
    const activePopoverToggleListeners = new Map<
      HTMLElement,
      Set<EventListenerOrEventListenerObject>
    >();
    const countActivePopoverToggleListeners = () =>
      Array.from(activePopoverToggleListeners.values()).reduce(
        (total, listeners) => total + listeners.size,
        0,
      );

    vi.spyOn(HTMLElement.prototype, "addEventListener").mockImplementation(function (
      this: HTMLElement,
      type: string,
      listener: EventListenerOrEventListenerObject | null,
      options?: boolean | AddEventListenerOptions,
    ) {
      if (type === "toggle" && listener && this.hasAttribute("popover")) {
        const listeners = activePopoverToggleListeners.get(this) ?? new Set();
        listeners.add(listener);
        activePopoverToggleListeners.set(this, listeners);
      }
      return originalAddEventListener.call(this, type, listener, options);
    } as typeof HTMLElement.prototype.addEventListener);
    vi.spyOn(HTMLElement.prototype, "removeEventListener").mockImplementation(function (
      this: HTMLElement,
      type: string,
      listener: EventListenerOrEventListenerObject | null,
      options?: boolean | EventListenerOptions,
    ) {
      if (type === "toggle" && listener && this.hasAttribute("popover")) {
        const listeners = activePopoverToggleListeners.get(this);
        listeners?.delete(listener);
        if (listeners?.size === 0) {
          activePopoverToggleListeners.delete(this);
        }
      }
      return originalRemoveEventListener.call(this, type, listener, options);
    } as typeof HTMLElement.prototype.removeEventListener);

    const renderCard = (label: string) => (
      <MapleHoverCard content={<span>{label}</span>}>
        <button type="button">도움말</button>
      </MapleHoverCard>
    );

    const { rerender, unmount } = render(renderCard("initial"));
    const initialActiveToggleListeners = countActivePopoverToggleListeners();

    expect(initialActiveToggleListeners).toBeGreaterThan(0);

    for (let index = 0; index < 20; index += 1) {
      rerender(renderCard(`rerender-${index}`));
    }

    expect(countActivePopoverToggleListeners()).toBe(initialActiveToggleListeners);

    unmount();

    expect(countActivePopoverToggleListeners()).toBe(0);
  });
});
