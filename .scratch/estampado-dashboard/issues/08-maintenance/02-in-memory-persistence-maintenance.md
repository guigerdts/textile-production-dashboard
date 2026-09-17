# 02: In-memory persistence for maintenance

**What to build:** Maintenance records validated by the domain persist across renders and can be read back for the current shift/operative-day timeline: inserting a new maintenance, updating one on close, reading one by id and listing by machine, plus reading the one open maintenance per machine. The repository is replaceable by a real SQLite store later without touching the domain or the UI, so this ticket delivers storage behind the domain's back.

**Blocked by:** 01.

**Status:** closed

- [x] `IMantenimientoRepository` interface exists in `src/store/mantenimientoRepository.ts` with `insertMantenimiento`, `updateMantenimiento`, `obtenerPorId`, `listarPorMaquina`, and `getMantenimientoAbierto`, written in the same style as `danosRepository.ts`.
- [x] `inMemoryMantenimientoRepository` implements the interface; every persist and read uses `structuredClone` so the caller never shares a mutable reference with the store.
- [ ] Methods are synchronous (an `async` annotation notes the future SQLite migration), and records are persisted as JSON-serializable plain objects exactly as the domain returned them.
- [ ] The repository never re-validates or re-normalizes business rules: it stores what the domain already validated (same stance as `danosRepository.ts`).
- [ ] An `obtenerPorId` for a missing id returns `undefined`; `getMantenimientoAbierto` returns the open maintenance for the machine or null when none is open.
- [ ] `mantenimientoFixtures.ts` provides fixtures to exercise the repository (valid reactivo linked to a daño, valid reactivo without a link, valid preventivo, an open maintenance, a closed one), following `danosFixtures.ts`.
- [ ] Tests in `src/store/mantenimientoRepository.test.ts` cover insert/update/read-by-id/list-by-machine/get-open, duplicate-id rejection, `structuredClone` defensive copying, and the no-re-normalization guarantee, following the `danosRepository.test.ts` (ticket 05) module pattern.