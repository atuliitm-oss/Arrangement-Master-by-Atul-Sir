# Security Specification for ArrangeMaster

## Data Invariants
1. Teacher names must be unique (used as IDs).
2. Schedule must be an object where values are lists of 8 periods.
3. Daily data date must be in YYYY-MM-DD format.
4. Absent list in daily data must contain names existing in the teachers collection.
5. Arrangements must map existing absent teachers to existing available teachers.

## The Dirty Dozen Payloads
1. **P1: Shadow Field Injection** - Attempt to write `isVerified: true` to a teacher document.
2. **P2: ID Poisoning** - Attempt a write with a 2MB string as a document ID.
3. **P3: Type Mismatch** - Attempt to write a string into the `total` (number) field.
4. **P4: Schedule Overflow** - Write a schedule list with 10 periods instead of 8.
5. **P5: Identity Theft** - (Not strictly applicable since it's open for now, but should require auth).
6. **P6: Denial of Wallet** - Attempt to write a 1MB string into the teacher `name`.
7. **P7: Future/Past Date Bypass** - (Logic check).
8. **P8: Null Hijack** - Set `absent` to `null` to crash client logic.
9. **P9: Arrangement Spoofing** - Assigning a substitute who isn't in the database.
10. **P10: Unverified Write** - (If we mandate verified email).
11. **P11: Bulk Scraping** - Trying to read all collections without a query filter.
12. **P12: Recursive Loop** - (Not applicable to this data model).

## Implementation Plan
1. Update `firestore.rules` with strict schema validation.
2. Mandate `isSignedIn()` for all writes.
3. Implement `isValidTeacher` and `isValidDailyData`.
4. Use `affectedKeys().hasOnly()` for updates.
