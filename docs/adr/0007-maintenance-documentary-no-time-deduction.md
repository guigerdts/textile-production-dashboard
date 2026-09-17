# Maintenance records are documentary: they do not deduct productive time

Maintenance is a machine-level record (ADR 0006) that never directly deducts productive time from the shift summary: its contribution to the time model exists only when a linked parada already counts the incidence, so there is no double counting and no change to `ResumenTiempoTurno`. We chose documentary over time-deducting because maintenance coverage is already expressed through paradas when a stop happened, and a preventivo without a stop must not fabricate an incidence; deducting time here would couple maintenance to the Ticket 04 time model for no operational signal.

## Considered Options

- **Documentary (chosen)**: maintenance stores context; the time model stays untouched; a reactivo whose daño caused a parada inherits the incidence through that parada only.
- **Time-deducting**: maintenance minutes subtract from productive time even without a parada. Rejected: it double-charges when a parada exists and invents downtime for preventivo work.

## Consequences

- A future reader must not "fix" maintenance into the time calculation; changing this requires a new decision and a `ResumenTiempoTurno` change.