import { fireEvent } from "@testing-library/react";

const SLIDER_TEST_RECT = {
  x: 0,
  y: 0,
  left: 0,
  top: 0,
  right: 200,
  bottom: 20,
  width: 200,
  height: 20,
  toJSON: () => ({}),
} as DOMRect;

function getSliderTrack(slider: HTMLElement): HTMLElement {
  const track = slider.parentElement;
  if (!track) {
    throw new Error("Slider thumb has no track element.");
  }
  return track;
}

export function dragSliderToValue(slider: HTMLElement, value: number): void {
  const min = Number(slider.getAttribute("aria-valuemin") ?? 0);
  const max = Number(slider.getAttribute("aria-valuemax") ?? 100);
  const percent = max === min ? 0 : Math.min(1, Math.max(0, (value - min) / (max - min)));
  const track = getSliderTrack(slider);

  Object.defineProperty(track, "getBoundingClientRect", {
    configurable: true,
    value: () => SLIDER_TEST_RECT,
  });

  fireEvent(
    track,
    new MouseEvent("pointerdown", {
      bubbles: true,
      cancelable: true,
      button: 0,
    clientX: SLIDER_TEST_RECT.left + SLIDER_TEST_RECT.width * percent,
    clientY: SLIDER_TEST_RECT.top + SLIDER_TEST_RECT.height / 2,
    }),
  );
}

export function releaseSlider(slider: HTMLElement): void {
  const track = getSliderTrack(slider);
  fireEvent(
    track,
    new MouseEvent("pointerup", {
      bubbles: true,
      cancelable: true,
      button: 0,
      clientX: SLIDER_TEST_RECT.left,
      clientY: SLIDER_TEST_RECT.top + SLIDER_TEST_RECT.height / 2,
    }),
  );
}

export function setSliderValue(slider: HTMLElement, value: number): void {
  dragSliderToValue(slider, value);
  releaseSlider(slider);
}
