# YOLOv8n Q1 Buff Detector 544x960 FP16

Recommended efficient browser runtime artifact:

```text
best.onnx
```

Contract summary:

- Input: `images [1, 3, 544, 960]`, float32 RGB NCHW, normalized `0..1`
- Input content: one complete top-right-quadrant ROI; do not crop it again
- Internal precision: FP16
- Output: `output0 [1, 5, 10710]`, float32
- Class: `buff_icon`
- Recommended confidence: `0.5`
- Recommended NMS IoU: `0.5`
- Letterbox padding value: RGB `114,114,114`
- Model size: `6,192,877` bytes

The input is rectangular on purpose. Most accepted Q1 samples are close to
16:9, so `544x960` removes square letterbox work without reducing their
effective horizontal resolution.

Use `docs/DL_RUNTIME_HANDOFF.md` for preprocessing, postprocessing, quality,
and browser benchmark details.
