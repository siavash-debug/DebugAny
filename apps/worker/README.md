# Event worker

Planned service: Node.js + TypeScript using BullMQ and Redis.

Responsibilities:
- Consume validated event jobs
- Normalize and redact event payloads
- Compute issue grouping fingerprints
- Persist events and update issue aggregates
- Retry transient failures safely

The worker has not been implemented yet. Processing should be idempotent where practical, and retry/dead-letter behavior must be documented.
