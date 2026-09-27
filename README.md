Textile Production Dashboard

A production management and operational monitoring system designed for textile printing operations.

The project aims to provide operators, supervisors, and management with a clear and reliable view of daily production, machine activity, downtime, production quality, fabric conditions, maintenance, and operational events.

The system is designed around the real workflow of a textile printing area, where production is organized by orders assigned to a printing machine and measured primarily through golpes (machine cycles). One golpe produces three towels, allowing production progress to be tracked from machine activity to the planned number of units.

Purpose

The dashboard centralizes production information that is commonly recorded or communicated manually during the workday.

Its main purpose is to answer, at any moment:

- What needs to be produced today?
- Which design and reference are currently being produced?
- How much production has been completed?
- How much remains?
- Is the machine currently producing?
- If production stopped, why did it stop?
- How long did the stop last?
- How much time was productive versus non-productive?
- What fabric is being used and was it approved for production?
- Which paint process is being used: reactive or pigment?
- What quality problems or suspected second-quality production occurred?
- Has the machine experienced damage or maintenance?
- Which operators and personnel participated in the production?
- How is the current production performance compared with the planned program?

Production

The system is centered around the weekly production program and the orders generated from that program.

An order represents production assigned to a machine and contains information such as:

- Design
- Production reference
- Fabric reference
- Paint type
- Planned quantity
- Required machine cycles (golpes)
- Planned second-quality allowance when applicable
- Production progress
- Remaining production
- Assigned personnel

The system distinguishes between units and machine cycles.

For example:

2,400 towels = 800 golpes

because each golpe produces three towels.

Machine Operations

The initial domain focuses on a textile printing table consisting of:

- Conveyor belt
- Printing area
- Oven
- Seven numbered carts
- Automatic golpe counting

The machine automatically provides the golpe count, while operational information is recorded by personnel.

Machine problems and production stops are tracked independently because a machine damage event does not necessarily mean that production stopped, and a stop does not necessarily represent machine damage.

Downtime and Operational Events

The dashboard records the reasons production becomes non-productive and the duration of each event.

Examples include:

- Cart damage
- Electrical damage
- Unstable electrical supply
- Lack of paint
- Lack of printing screens
- Damaged screen
- Lack of fabric
- Fabric return
- Oven damage
- Lack of water

Each event can contain observations and relevant details.

Planned non-production activities are treated separately from incidents, including:

- Lunch
- Authorized breaks
- Scheduled design changes
- Cleaning
- Other authorized activities

This distinction allows the system to calculate productive time without incorrectly treating planned activities as machine failures.

Quality

Quality monitoring is an important part of the dashboard.

The concept of "buena racha" represents a quality streak rather than machine uptime.

The system tracks suspected second-quality production generated during the printing operation and provides visibility into the accumulated percentage of second-quality units.

A production order can define a planned second-quality allowance, while operational alerts can identify when the observed percentage exceeds the defined threshold.

The final designation of second-quality production belongs to the finishing process; the printing area records the suspected cases and their operational context.

Fabric Control

Fabric must be inspected before production and whenever a new fabric lot is introduced.

Relevant inspection information includes:

- Fabric reference
- Absorption
- Measurements
- Condition
- Whether the fabric must be returned
- Reason for return
- Observations
- Authorization when an anomaly is accepted for production

Fabric anomalies are treated as operationally relevant events because using unsuitable fabric can directly affect production and quality.

Paint Processes

The system supports both:

- Reactive printing
- Pigment printing

The paint type affects the production process and the associated color/formula requirements.

Pigment production involves printing followed by the oven process.

Reactive production involves printing and an initial oven process, followed by a later thermofixing process after production is completed.

The system therefore keeps the paint type as an important part of the production context rather than treating all printing orders as identical.

Maintenance

Maintenance is tracked at the machine level.

Maintenance records include:

- Date
- Reason
- Duration
- Relevant observations

Preventive maintenance is based on operational needs and the actual condition of the equipment.

Maintenance is intentionally modeled separately from ordinary production stops and operational incidents so that the history of machine care remains traceable.

Personnel

The system records the personnel involved in production.

The initial operation normally involves a team of seven people, including the person responsible for preparing paints and pigments.

Recording personnel allows production information to retain operational context instead of representing production only as anonymous machine activity.

Design Goals

The dashboard is intended to be:

- Clear
- Fast to use
- Operationally focused
- Easy to understand during a busy production shift
- Reliable for historical analysis
- Useful for both operators and management
- Focused on actionable production information
- Traceable at the level of orders, production, events, quality, fabric, and maintenance

The interface should prioritize information density and clarity over decorative elements.

Project Status

This repository is being developed as a domain-driven learning project while also modeling a real textile printing production workflow.

The domain is intentionally being explored and validated before implementation decisions are finalized.

The project will evolve through explicit stages, with domain understanding and documented decisions preceding unnecessary technical complexity.
