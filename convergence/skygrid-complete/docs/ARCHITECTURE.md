# Architecture notes

## Invariants

1. One healthy shard owns an aircraft at a given ownership version.
2. A destination only replaces local state with an equal or newer version.
3. A source deletes state only after destination acknowledgement.
4. Recovery increments ownership version.
5. Network publication frequency is independent of simulation tick frequency.

## Current tradeoffs

The control plane is a single process. This makes ownership reasoning inspectable and keeps the project runnable on a laptop, but it is itself a failure domain. A production evolution would replicate ownership metadata through a consensus-backed coordinator or partition ownership by cell.

The event log is JSONL rather than Kafka/Redpanda. This repository implements the event-sourcing semantics directly and keeps local startup lightweight. Redpanda can replace the Store boundary without changing worker ownership semantics.

The UI renders one mesh per aircraft. At larger visual scales this should become instanced rendering.

The X-axis partition is intentionally simple. S2 or H3 cells are a natural next partitioning model for globe-scale coordinates.
