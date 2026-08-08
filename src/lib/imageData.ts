export { imageDataToCanvas, imageDataToUrl } from "./canvasImage";
export {
  cropRuneCandidateToImageData,
  cropRuneCandidateToUrl,
  getRuneCandidateCropBounds,
} from "./runeCandidateImage";

export function cloneImageData(imageData: ImageData): ImageData {
  return new ImageData(
    new Uint8ClampedArray(imageData.data),
    imageData.width,
    imageData.height,
  );
}

export function createPlaceholderImageData(): ImageData {
  return new ImageData(new Uint8ClampedArray([0, 0, 0, 255]), 1, 1);
}
