import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RegionEditor } from "./RegionEditor";

describe("RegionEditor", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("keeps an existing region intact when its background is used for panning", () => {
    const onChange = vi.fn();
    const onBackgroundPointerDown = vi.fn();
    const { container } = render(
      <section onPointerDown={onBackgroundPointerDown}>
        <RegionEditor
          region={{ x: 0.1, y: 0.1, width: 0.8, height: 0.8 }}
          onChange={onChange}
          disabled={false}
          sourceAspect={16 / 9}
          shape="rectangle"
          lockedAspectRatio={16 / 9}
          interactionMode="edit-existing"
        />
      </section>,
    );
    const editor = container.querySelector(".region-editor");

    expect(editor).not.toBeNull();
    expect(container.querySelectorAll(".region-handle")).toHaveLength(4);

    fireEvent.pointerDown(editor as Element, {
      button: 0,
      clientX: 50,
      clientY: 50,
      pointerId: 1,
    });

    expect(onChange).not.toHaveBeenCalled();
    expect(onBackgroundPointerDown).toHaveBeenCalledOnce();
  });
});
