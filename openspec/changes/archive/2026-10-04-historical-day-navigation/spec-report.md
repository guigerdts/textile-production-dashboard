## Specs Created

**Change**: historical-day-navigation

### Specs Written
| Domain | Type | Requirements | Scenarios |
|--------|------|-------------|-----------|
| historical-day-navigation | New (full) | 11 (11 added) | 40 |
| operational-repository-contracts | Delta | 4 (4 added) | 19 |
| operational-recovery-wiring | Delta | 4 (4 added) | 20 |

### Coverage
- Happy paths: covered (read for selected day, today unchanged, navigation, empty day, order-less events)
- Edge cases: covered (midnight-crossing records, open events spanning midnight, identical timestamps different days, day-free listing survives, cancellation flags)
- Error states: covered (recovery failures propagate, no partial state; read-only mode prevents writes; persistence failures do not mutate state)

### Artifacts
- /root/textile-production-dashboard/openspec/changes/historical-day-navigation/specs/historical-day-navigation/spec.md (367 lines)
- /root/textile-production-dashboard/openspec/changes/historical-day-navigation/specs/operational-repository-contracts/spec.md (165 lines)
- /root/textile-production-dashboard/openspec/changes/historical-day-navigation/specs/operational-recovery-wiring/spec.md (208 lines)

### Observation: Superseded text
The pending change `operational-event-operative-date`'s operational-repository-contracts delta contains a requirement asserting `listarPorMaquina` accepts only `maquinaId` (no date parameter). That is correct for that change, but it is **superseded** once the day-scoped listing is introduced by this change (historical-day-navigation). When archiving the former, the superseded scenario should not be promoted as-is; the promoted state is the day-scoped contract defined here.

### Next Step
Ready for design (sdd-design). If design already exists, ready for tasks (sdd-tasks).
