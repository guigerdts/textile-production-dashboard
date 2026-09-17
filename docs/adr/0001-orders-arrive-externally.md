# Production orders arrive from external weekly programming

The weekly programming (outside the system) creates production orders; the dashboard receives them and records/controls their execution. We deliberately did not build order creation or scheduling: the boundary was drawn at "the order arrives", so the data model references an external origin of truth and does not own order generation.

## Considered Options

- Build full order creation/scheduling inside the system: rejected because planning already exists upstream and the area's goal is executing the program, not planning it.