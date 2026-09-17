# Textile Production Dashboard — Estampado Context

The domain of the printing (estampado) area of a textile company. A single flatbed printing machine with conveyor belt prints designs onto towels, tracked through production orders received from weekly programming.

## Language

### Core entities

**Orden de producción**:
An instruction to print a design onto a fabric reference in a requested quantity of units. Arrives from the weekly programming (created outside the system); the system records and controls its execution.
_Avoid_: Order created here, job, trabajo

**Diseño**:
The print design applied to the towel (e.g. "Jessie"), paired with a fabric reference to define an order.
_Avoid_: Art, motivo

**Máquina de estampado**:
The single flatbed printing machine with conveyor belt. Has 7 numbered carros (1–7) and a drying oven. Produces 3 towels per golpe.
_Avoid_: Rotativa, rotary, multi-machine fleet

**Golpe**:
The machine's unit of work: one press cycle of the flatbed table. 1 golpe prints 3 towels. The machine counts golpes automatically; nothing else is automatic.
_Avoid_: Hit, stroke, coup, pressada

**Carro**:
One of the 7 numbered printing units on the table that carries and moves the cuadro. Referenced as "carro N" when damaged.
_Avoid_: Screen unit, frame holder, carriage (English)

**Cuadro**:
The frame/screen that carries the print design and applies the ink to the fabric.
_Avoid_: Pantalla, mesh, stencil

**Tela**:
The raw fabric consumed by an order. A material with its own traceability (lot-level inspection), never the production unit.
_Avoid_: Rollo, pieza, fabric roll as order unit

**Unidades**:
The count of finished towels: solicitadas (requested), producidas (produced), primera (first quality), segunda (2da). The production quantity is expressed in units, never meters.
_Avoid_: Metros, meters, pieces

### Paint chemistry

**Pintura reactiva**:
Reactive ink. Requires an initial oven drying during printing plus a later separate termofijado pass.
_Avoid_: Reactive (as a machine characteristic)

**Pintura pigmento**:
Pigment ink. Single drying pass through the oven; machine speed controls drying (reference ~16 s per golpe).
_Avoid_: Pigment as maintenance domain

**Termofijado**:
The later, temporally separated process stage for reactive fabric: a second pass through an oven, not part of the printing cycle. Capacity ~305–310 golpes per hour. Exact registration level still pending.
_Avoid_: Second print, part of the same print cycle

### Quality

**Segunda (2da)**:
Towels that fail quality. An operational alert fires when 2da exceeds 3% of a production; the monthly target keeps 2da below 5%. Official classification is owned by Acabado; Estampado only records suspicions and their origins.
_Avoid_: Waste, scrap, descarte, rechazo

**Primera (1ra)**:
Towels that meet quality, as eventually classified by Acabado.

**Buena racha**:
Production with 2da inside thresholds (low risk of generating 2da). Not a continuity/uptime metric.
_Avoid_: No-stop streak, continuous production

### Time model

**Tiempo total disponible**:
From start to end of the workday (typically 7:00–17:00, extended by overtime).

**Tiempo no productivo planificado**:
Authorized, planned non-productive time: lunch, authorized breaks, cambio de diseño, limpieza. Deducted from productive time, never counted as incidences.
_Avoid_: Parada, stop, downtime

**Tiempo improductivo por incidencias**:
Unexpected non-productive time from stop causes (see Parada). Deducted from productive time.
_Avoid_: Downtime without cause origin

**Tiempo productivo**:
Derived: total available minus planned non-productive minus incidence time. Never entered manually, no double counting between the two deduction categories.
_Avoid_: Manual time entry, effective hours entered by operator

### Events

**Parada**:
An unexpected stop of the machine, registered with one of 10 predefined causes (each carrying its specific data: carro number, missing color, repair time, etc.) plus free-text observations.
_Avoid_: Free-text-only cause, catch-all categories

**Actividad planificada**:
An authorized planned activity that deducts from productive time: cambio de diseño (start/end, between orders) or limpieza (start/end, what was cleaned; fixed Tuesday 7:00–8:00, others authorized).
_Avoid_: Stop cause, incidence

**Daño**:
An independent event: type (eléctrico, mecánico, operacional), affected component, start time, repair duration, solution applied, whether it caused a stop, whether it may have produced 2da, observations. Multiple consequences can occur simultaneously.
_Avoid_: Damage as stop synonym

**Inspección de tela**:
Recurrent check each time a new fabric lot arrives, throughout production. Checklist: absorción, tundido, manchas, dimensiones/medidas, estado general, plus any other anomaly. Anomaly → stop → report → devolution or management authorization to use.
_Avoid_: Single pre-order inspection

**Devolución de tela**:
Return of fabric before printing, after an inspection anomaly. Only pre-printing returns exist; towel returns do not.
_Avoid_: Towel returns, post-production devolution

**Mantenimiento**:
A machine-level record (never per paint chemistry) with two types: reactivo (caused by a daño; links to the daño event when that daño was registered — the link is optional, never a precondition, and never an order) and preventivo (scheduled by machine needs, no fixed periodicity). Has an optional end (null = in progress); duration is derived from start and end, never entered manually. Motivo is free text; what was checked/repaired is free text completed at close — an in-progress maintenance may start without it, but closing requires it. Documentary: never deducts productive time; incidence is counted only through a parada, if one exists. Not tied to an order: registered during an order or on an empty day. One open maintenance per machine at a time (temporary operational restriction, relaxable if the flow requires it).
_Avoid_: Maintenance per chemistry, reactive-only maintenance, maintenance as time incidence

**Observaciones**:
A free-text field inside each event/record (parada, daño, inspección, mantenimiento), never an independent entity.
_Avoid_: Observations as a record type

### People and areas

**Operario de estampado**:
The primary user of the dashboard. Identified by name; stays with the single machine for the day shift.
_Avoid_: User roles, employee IDs

**Operario de pinturas**:
Prepares the inks (pinturas) for printing. Not a machine operator.
_Avoid_: Ink operator as machine operator

**Acabado**:
The area that officially classifies first/second quality. Estampado sends suspicions; how Acabado's official data reaches Estampado is not yet defined.
_Avoid_: Quality control inside Estampado

**Gerencia**:
Authorizes use of anomalous fabric and other operational exceptions.
_Avoid_: Permission system, approval workflows