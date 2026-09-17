# Spec — Estampado Production Dashboard (v0)

## Problem Statement

The estampado (printing) area of a textile company has no system that records and controls the execution of its weekly production program. Today the operator tracks production by hand: how many golpes have been run, how many units remain, what stopped the machine and for how long, which damages occurred and what they may have caused. When a damage affects product quality, nobody can later trace which of the produced units may be segunda (2da) or why. The weekly program arrives from outside the system; the area's goal is to execute it, and today there is no record of that execution.

## Solution

A production dashboard for the single estampado machine, used primarily by the operario de estampado. It receives production orders from the weekly programming (created outside the system), records the execution of each order, and surfaces the answers the operator needs during the day:

- What to produce today (design, fabric reference, requested units, required golpes)
- How many units/golpes have been produced and how many remain
- Whether the machine is running or stopped, and if stopped, why and for how long
- The current "buena racha" state: how far the current production is from generating too much 2da
- The derived productive/non-productive time picture of the shift

The system records, as events with free-text observations: paradas with 10 predefined causes (each with its specific data), independent daño events (with multiple possible simultaneous consequences), planned activities (cambio de diseño, limpieza), recurring fabric inspections per lot, pre-printing devolución de tela, and maintenance records (reactivo linked to a daño, preventivo).

Estampado records production and events; the official first/second (1ra/2da) quality classification belongs to Acabado. Estampado only records suspicions and their origins (e.g. "this daño may have produced 2da"). No technical integration, permission system, or authorization workflow is invented; the human areas (programación semanal, Acabado, gerencia) remain outside the system's automation.

## User Stories

1. As an operario de estampado, I want to see today's production order with its design and fabric reference, so that I know what to produce when the day starts.
2. As an operario de estampado, I want to see the requested quantity in units and in golpes, so that I know the production target in the machine's own unit.
3. As an operario de estampado, I want designs that carry an explicit additional 2da percentage (e.g. 5%) to show that percentage and its effect on the total units/golpes target, so that I produce enough salable units.
4. As an operario de estampado, I want to see golpes produced so far, so that I know my progress without leaving the machine area.
5. As an operario de estampado, I want to see produced units derived from golpes (1 golpe = 3 toallas), so that I compare progress against requested units.
6. As an operario de estampado, I want to see how many units and golpes remain on the current order, so that I know how much work is left.
7. As an operario de estampado, I want to start and finish an order's production, so that the system knows which window belongs to which order.
8. As an operario de estampado, I want to record produced golpes per order, so that progress is tracked over the shift.
9. As an operario de estampado, I want to register a parada with one of the 10 predefined causes, so that unexpected stops are classified consistently.
10. As an operario de estampado, I want each parada cause to ask for its specific data (e.g. which carro for daño en el carro 1–7, which missing color for falta de pintura), so that reports carry the detail the cause needs.
11. As an operario de estampado, I want to add free-text observations to a parada, so that the context of the stop is not lost.
12. As an operario de estampado, I want the machine's golpe counter to be the source of produced golpes, so that I do not re-enter what the machine already counts.
13. As an operario de estampado, I want to register an independent daño event with type (eléctrico, mecánico, operacional), affected component, start time, repair duration, solution applied, and observations, so that the history of what broke and what was done exists.
14. As an operario de estampado, I want to indicate for a daño whether it caused a stop and whether it may have produced 2da, so that a single daño can have multiple simultaneous consequences.
15. As an operario de estampado, I want to link a daño to the units suspected as 2da, so that the origin of a quality problem is traceable later.
16. As an operario de estampado, I want to register a planned cambio de diseño with start and end times, so that this expected activity deducts from productive time without being counted as an incidence.
17. As an operario de estampado, I want to register limpieza with start and end times and what was cleaned, so that cleaning is tracked as a planned activity.
18. As an operario de estampado, I want the Tuesday 7:00–8:00 limpieza to be the known default, with other cleanings still recordable, so that the fixed schedule is reflected without blocking off-hours cleaning.
19. As an operario de estampado, I want to register each new fabric lot's inspection with the checklist (absorción, tundido, manchas, dimensiones/medidas, estado general, plus any other anomaly), so that every lot that enters production is checked.
20. As an operario de estampado, I want to report an inspection anomaly and stop the process, so that anomalous fabric is not used without authorization.
21. As an operario de estampado, I want an inspection observation to be associated with the order it belongs to, so that later we can trace which fabric was used and in what condition.
22. As an operario de estampado, I want to register a devolución de tela when anomalous fabric is returned, so that pre-printing returns are recorded with their motivo.
23. As an operario de estampado, I want to record when anomalous fabric is used anyway (with gerencia authorization noted), so that the traceability of that decision exists.
24. As an operario de estampado, I want to see the derived productive time of the shift, so that I know how much of the day was actually producing.
25. As an operario de estampado, I want to see planned non-productive time and incidence time separated, so that unexpected losses are not buried under lunch and cleaning.
26. As an operario de estampado, I want to see the current 2da alert state: whether the suspicion quantity has crossed the 3% operational threshold, so that I know when the current production is at risk.
27. As an operario de estampado, I want to know the current "buena racha" state (2da within thresholds), so that I know whether the current production is low-risk for 2da.
28. As an operario de estampado, I want to register overtime that extends the workday window, so that total available time reflects the real day.
29. As an operario de estampado, I want to register a maintenance record (reactivo linked to a daño, or preventivo) with date, type, motivo, start/end or duration, what was checked/repaired, and observations, so that the machine's maintenance history exists.
30. As an operario de estampado, I want reactive maintenance to reference the daño event that caused it, so that the damage→repair chain is complete.
31. As an operario de estampado, I want to open the dashboard and immediately see whether the machine is currently running or stopped, so that I do not have to reconstruct the state.
32. As an operario de estampado, I want to see, for the current stop, its cause and accumulated duration, so that I can answer "how long have we been stopped and why".
33. As an operario de estampado, I want the dashboard to never ask me to type a "productive time", so that I do not double-enter what the system can derive.
34. As an operario de estampado, I want today's order view to handle the case of no order assigned, so that an empty day is shown clearly instead of errors.
35. As an operario de estampado, I want each record I enter to carry my name, so that accountability and later cross-referencing are possible without employee IDs.

## Implementation Decisions

### First-version scope

- **Single machine model.** The system models exactly one machine: mesa de estampado con banda transportadora, 7 carros (1–7), drying oven, 3 toallas per golpe. A `machine` identity exists and always holds "M1"; no fleet features (allocation, per-machine ratios, routing) are modeled.
- **Orders are received, not created.** The system stores production orders, golpes, and execution records; order creation and scheduling remain outside (weekly programming). The order carries design, fabric reference, requested units, paint type (reactiva or pigmento), and optionally the required 2da percentage for designs that include one.
- **Two paint chemistries affect process, not machine.** Pigmento: single drying pass (reference ~16 s per golpe, affects machine speed). Reactiva: initial drying during printing plus a later, temporally separated termofijado stage. The orden carries the paint type so the process knows which stages apply.
- **10 predefined parada causes**, each with its own specific data fields, modeled as one discriminated set rather than ten fully independent structures:
  1. Daño en el carro — carro number (1–7)
  2. Daño eléctrico — what happened, repair time
  3. Flujo de luz inestable
  4. Falta de pintura — which color(s) or all
  5. Falta de cuadros a estampar
  6. Cuadro dañado — repair time
  7. No hay tela
  8. Devolución de la tela
  9. Daño del horno
  10. No hay agua
  Every parada carries free-text observations.
- **Daño is an independent event**, not a parada synonym: type (eléctrico, mecánico, operacional), affected component, start time, repair duration, solution applied, whether it caused a stop, whether it may have produced 2da, observations. Consequences are simultaneous (stop and/or 2da suspicion).
- **Planned activities are separate from paradas**: cambio de diseño (start/end) and limpieza (start/end, what was cleaned) live in the planned non-productive bucket. A limpieza outside the default (Tuesday 7:00–8:00) is still a limpieza, identified as such with its authorization noted.
- **Time is derived, never entered manually.** Tiempo productivo = tiempo total disponible − tiempo no productivo planificado − tiempo improductivo por incidencias. The two deduction categories are mutually exclusive; no double counting.
- **Fabric inspections recur per lot** during the whole production, not once per order. Each inspection is associated with its order and carries the checklist plus free-text observations.
- **Devolución de tela exists only pre-printing.** No towel returns.
- **2da in Estampado is suspicion, not classification.** Estampado records suspected 2da units and their origin (typically a daño). The official 1ra/2da classification is Acabado's; the dashboard does not expose a "mark as 2da" official action.
- **Operational 2da alert** fires when suspected 2da exceeds 3% of the production; the 5% monthly target is a monitoring threshold. The alert is computed from Estampado's own suspicion data as an operational warning; it is not the official percentage.
- **Every 2da percentage is a projection or operational estimate, never a classification.** Any calculation that uses a 2da percentage — the 3% alert, the 5% monthly monitoring value, the additional percentage a design may carry — is expressed as a projection or operational estimate built from Estampado's suspicion/origin data. It must never be presented or persisted as an official first/second quality classification: that classification belongs to Acabado and its synchronization with Estampado remains pending.
- **Maintenance applies to the machine, not per chemistry**: reactivo (referencing the daño that caused it) and preventivo (no fixed periodicity). Fields: date, type, motivo, start/end or duration, what was checked/repaired, observations.
- **Observations are free-text fields inside each record** (parada, daño, inspección, mantenimiento). No independent observation entity.
- **People are names, not roles.** Operario identification is the operator's name; no user roles, permissions, or technical authorization flows are modeled. Gerencia authorizations (anomalous fabric use) are recorded as part of the fabric flow's decision, not as a workflow.

### Module and interface shape (no file paths yet)

- A **production domain seam** owns the pure calculations and rules: golpes↔units conversion (1 golpe = 3 toallas), required golpes including optional 2da percentage, production projections, available/planned/incidence/productively derived time, parada cause validation (carro 1–7, missing color(s), repair-time fields), daño validation as an independent event, 2da suspicion percentage and the 3% alert boundary, and the 5% monthly monitoring value. Every 2da percentage computed here is a projection or operational estimate from Estampado's suspicion data — never an official quality classification, which is Acabado's alone. Everything that can be tested without infrastructure lives behind this one seam.
- A **recording seam** accepts operator-entered events (paradas with cause-specific fields, daños, planned activities, inspections, devoluciones, maintenance, order start/finish) and forwards them to the domain rules before persisting.
- A **dashboard seam** reads the derived state for the current order, shift time picture, stop status, and 2da alert state.
- Persistence holds orders, golpes, events, and their links (daño → parada consequence, daño → suspected 2da units, damage → reactive maintenance).

## Testing Decisions

- A good test checks external behavior through the production domain seam: given inputs (shift window, orders, golpes, events), the derived outputs are correct. Tests never assert implementation details of the seams.
- The production domain seam is the single preferred test seam; recording and dashboard seams are integration-tested only where behavior would otherwise be unverifiable.
- Focus areas:
  - **Conversion:** golpes → units (1:3) and required golpes from requested units, including designs with an additional 2da percentage.
  - **Time derivation:** productive time from total available minus planned minus incidences; mutual exclusivity of the two deduction buckets (no double counting); overtime extends the window.
  - **Parada validation:** each cause accepts only its specific data (carro in 1–7, at least one color or "all" for falta de pintura, repair time present where required).
  - **Daño consequences:** one daño can produce stop + 2da suspicion simultaneously; each consequence is independently recorded.
  - **2da alert boundary:** alert at exactly >3% of the production; monthly monitoring at 5% (threshold semantics tested at the boundary).
  - **Fabric flow:** anomaly → stop → report → devolución or use-with-authorization; inspection links to the order and recurs per lot.
- Prior art: none exists yet (greenfield repo); these are the first tests in the project.

## Out of Scope

### Deferred to later versions
- Multi-machine model, machine-specific ratios, machine routing or allocation.
- Order creation and weekly scheduling inside the system.
- Technical authorization flows, user roles, permissions, or authentication.
- Integration with Acabado (how its official 1ra/2da data reaches Estampado) — see pending below.
- Any post-production towel returns or devoluciones.
- Automatic capture of productive/incidence times from sensors; only the golpe counter is automatic.

### Pending domain questions (not decisions, not requirements)
- **Termofijado registration level**: reactiva's later stage has capacity ~305–310 golpes/hour and is temporally separated from the printing cycle; whether and how the dashboard records termofijado execution is not yet decided.
- **Acabado data source/sync**: how the official 1ra/2da classification reaches Estampado is undefined; until then Estampado only records suspicions.
- **Parada cause data granularity**: the 10 causes keep their specific fields as a discriminated set, but the exact field list per cause is to be confirmed during design.
- **Gerencia authorization mechanics**: anomalous-fabric authorization exists in the operation; its recording level (e.g. who/when noted) is not yet decided.

## Further Notes

- The glossary of the domain (CONTEXT.md) is the single source of truth for vocabulary: golpe, carro, cuadro, tela, unidades, parada, daño, inspección de tela, devolución de tela, termofijado, buena racha, etc. Use it verbatim in implementation.
- ADRs in docs/adr/ record the hard-to-reverse decisions this spec builds on (external order origin, Acabado-owned 2da classification, single-machine scope, derived productive time, planned activities vs paradas, maintenance on the machine not per chemistry).
- This spec covers the confirmed requirements only. The pending domain questions above are deliberately not turned into requirements.
- No code is implemented from this spec yet; implementation begins only after the spec is accepted and split into tickets.