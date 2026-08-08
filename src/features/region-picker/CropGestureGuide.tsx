import { Hand, Maximize2, MousePointer2, X, ZoomIn } from "lucide-react";

export function CropGestureGuide({ selectGuideText }: { selectGuideText: string }) {
  return (
    <div className="crop-gesture-guide" aria-label="영역 선택 조작 안내">
      <span>
        <MousePointer2 size={15} />
        {selectGuideText}
      </span>
      <span>
        <Hand size={15} />
        이동: 화면/상자 조정
      </span>
      <span>
        <ZoomIn size={15} />
        휠/트랙패드: 확대·축소
      </span>
      <span>
        <Maximize2 size={15} />
        화면 맞춤: 확대 초기화
      </span>
      <span>
        <X size={15} />
        ESC: 영역 삭제
      </span>
    </div>
  );
}
