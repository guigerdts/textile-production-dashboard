# 03: UI and integration for maintenance

**What to build:** The operator sees a maintenance section inside the current shift/operative-day timeline (never a full history panel) and can open a maintenance in progress or register one complete in a single step, then close it later with what was checked or repaired. The section is machine-level and appears in all four order states and in EmptyDay. Reactivo maintenance offers a daño selector sourced from the already-built daño repository; preventivo never offers one. The screen wires the domain from ticket 01 and the in-memory repository from ticket 02, so the whole flow works end to end through the existing dashboard.

**Blocked by:** 01, 02.

**Status:** closed

- [x] `MantenimientoSection` is rendered in `src/App.tsx` for EmptyDay, OrderAvailable, OrderInProduction, and OrderFinished as a machine-level section (no `ordenId`), with the repository injected and the daño lookup wired as `(id) => danoRepository.obtenerPorId(id)`.
- [x] The form preloads the operator's name, requires `inicio`, and lets the operator open an in-progress maintenance (description optional) or register one complete in a single step (description required, end after start enforced) — every rule surfaces the domain validation error to the operator.
- [ ] When the type is reactivo the daño selector appears and allows linking to a registered daño or none; when the type is preventivo the selector is absent and no daño link is stored.
- [ ] An open maintenance displays in the timeline with its derived duration (never manually entered) and an explicit close action that requires `queSeRevisoReparo` before it succeeds; closing moves the record to closed and the section rejects a second open maintenance while one is open.
- [ ] There is no edit or delete action on any maintenance, no history panel, and no historical reconstruction beyond the current shift/operative-day timeline.
- [ ] Tests in `src/App.test.tsx` under a "ticket 08" describe cover the section in the four states and EmptyDay, open/one-step/close flows, reactivo-only daño selector, un-abierto-per-machine rejection, and close-requires-description, following the "ticket 05" describe pattern.