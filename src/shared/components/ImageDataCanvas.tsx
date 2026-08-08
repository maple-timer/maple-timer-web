import { useEffect, useRef } from "react";

export type CanvasImageDataSource = {
  width: number;
  height: number;
  data: Uint8ClampedArray | number[];
};

export function ImageDataCanvas({
  image,
  className,
  ariaLabel,
}: {
  image: CanvasImageDataSource | ImageData | null | undefined;
  className?: string;
  ariaLabel?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !image) {
      return;
    }

    canvas.width = image.width;
    canvas.height = image.height;

    if (navigator.userAgent.toLowerCase().includes("jsdom")) {
      return;
    }

    let context: CanvasRenderingContext2D | null = null;
    try {
      context = canvas.getContext("2d");
    } catch {
      return;
    }
    if (!context) {
      return;
    }

    const data =
      image.data instanceof Uint8ClampedArray
        ? new Uint8ClampedArray(image.data)
        : Uint8ClampedArray.from(image.data);
    context.putImageData(new ImageData(data, image.width, image.height), 0, 0);
  }, [image]);

  return (
    <canvas
      ref={canvasRef}
      className={className}
      role={ariaLabel ? "img" : undefined}
      aria-label={ariaLabel}
      aria-hidden={ariaLabel ? undefined : true}
    />
  );
}
