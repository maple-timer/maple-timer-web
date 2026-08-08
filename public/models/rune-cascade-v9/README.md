# Rune cascade V9 runtime bundle

Copy this directory as one unit. `proposal.onnx` generates the top-5 candidate boxes. Every candidate then passes independently through `gate.onnx`; a detection requires both the shape and appearance thresholds in `metadata.json`. Temporal confirmation remains outside the models and uses the production `rune-confirmation-v2` policy.
