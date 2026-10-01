# Slice evidence logs

One file per slice (`B1b.md`, `B2.md`, ...). A builder appends a block per group of steps with each proof command and its real output. The orchestrator re-runs the proofs before closing the slice in `../PLAN.md`.
