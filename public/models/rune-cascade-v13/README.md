# Rune cascade V13 runtime bundle

Copy this directory as one unit. `proposal.onnx` generates the top-5 candidate boxes. Every candidate then passes independently through `gate.onnx`; a detection requires both the shape and appearance thresholds in `metadata.json`. V13 is the conservative V9 derivative that changes only the sealed overlapping-marker positive across the 99 real-user qualification frames. Temporal confirmation remains outside the models and uses the production `rune-confirmation-v3` policy.
