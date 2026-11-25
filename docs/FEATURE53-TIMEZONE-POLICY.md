# Section 5.3 timezone policy

## Booking conversion

Local booking times supplied as `YYYY-MM-DD` plus `HH:mm` are interpreted in the trainer's configured IANA timezone and converted to a UTC instant with `zonedTimeToUtc()` (`lib/api/src/services/timeZone.ts`). No fixed-offset workaround is used.

## Daylight-saving policy

- Nonexistent local times in a spring-forward gap are rejected. For example, `2026-03-08 02:30` in `America/New_York` has no UTC instant and returns `null`.
- Ambiguous local times that occur twice in an autumn fallback are resolved deterministically to the **earlier instant**. For example, `2026-11-01 01:30` in `America/New_York` maps to `2026-11-01T05:30:00.000Z` (EDT, UTC-04:00), not `06:30Z` (EST, UTC-05:00).
- The conversion function enumerates all candidate instants that round-trip to the requested wall-clock time and returns the minimum. This does not depend on server-local time, the host timezone, or the order in which `Intl` reports offsets.
- `Africa/Johannesburg` has no current seasonal DST transition, so its local times map to UTC-02:00 throughout the test period.

This policy is deliberately narrower than adding a disambiguation field to the booking API: the existing API cannot express a choice, and choosing the earlier instant preserves the pre-existing conversion behaviour while making it explicit and deterministic.
