# Single machine scope, no multi-machine model

Estampado currently has exactly one flatbed machine; the user decided not to model multiple machines. The data model keeps a machine identifier (always "M1" today) so a future second machine is a data change, not a schema migration — zero-cost flexibility without modeling fleet features (allocation, machine-specific ratios, routing).

## Considered Options

- Omit machine identity entirely (production is "the area's"): rejected because a naive schema would force a migration later.
- Model capacity/ratio per machine: rejected, no real need exists yet.