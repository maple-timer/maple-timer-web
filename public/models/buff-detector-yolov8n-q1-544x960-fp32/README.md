# YOLOv8n Q1 Buff Detector 544x960 FP32

WebGPU compatibility artifact for devices without `shader-f16`:

```text
best.onnx
```

Contract summary:

- Input: `images [1, 3, 544, 960]`, float32 RGB NCHW, normalized `0..1`
- Input content: one complete top-right-quadrant ROI; do not crop it again
- Internal precision: FP32
- Output: `output0 [1, 5, 10710]`, float32
- Class: `buff_icon`
- Recommended confidence: `0.5`
- Recommended NMS IoU: `0.5`
- Letterbox padding value: RGB `114,114,114`
- Model size: `12,311,446` bytes

This model uses the same rectangular input and preprocessing contract as the
FP16 artifact. The runtime selects it only when WebGPU is available but the
adapter cannot enable `shader-f16`.

Use the upstream `docs/DL_RUNTIME_HANDOFF.md` for validation and browser
benchmark details.
