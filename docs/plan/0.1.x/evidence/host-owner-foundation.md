# Host owner and data-domain foundation

This layer implements the local ownership primitives for D01.H01–H05 and H10. It does not yet activate the public application bootstrap or the management page; the next stack layers connect the existing entries and lifecycle.

## Implemented boundaries

- A protected OS-user registry binds a canonical local store/file identity to the `ivoraige_host` v1 DSH StorageDomain. Existing document, revision, task and snapshot identifiers are retained.
- Registry-before-store locking, bounded registry contention retries, flushed recovery intents, atomic registry replacement, and verified intent replay prevent an interrupted initialization from silently allocating a second identity.
- Read-only discovery checks the recorded file identity without opening an active application database. Corrupt registrations, unsupported metadata and replacement files fail closed.
- Owner transport uses a private Unix socket, or a random Windows named pipe with a per-generation capability in a verified current-user DACL file. Ephemeral owners publish only a refusal marker. HTTP instance ids and PIDs are not authentication.
- One-time browser bootstrap credentials are origin/domain/generation bound, replay protected, and held only in memory. Session cookies are HttpOnly/SameSite=Strict and writes require CSRF validation.

## Recovery and validation limits

`copy` requires a distinct verified store and allocates a new domain/registration identity. `migrate` additionally requires trusted evidence that the source process retired; a free lock and a command-line confirmation do not supply that proof. `repair-registration` does not overwrite an unparseable multi-domain registry: without a trustworthy complete backup and merge evidence it remains unavailable. These limits are deliberate fail-closed results, not completed migration/repair UX.

Metadata inspection uses SQLite's public backup API followed by the DSH domain API on a private temporary copy, without reading DSH private tables. This can hold the registry lock longer for a large database and needs performance evidence before large-library rollout.

The pinned DSH domain/backend close methods are explicitly awaited before context disposal. A close rejection keeps the store lease; root Cordis disposal alone is not evidence that storage closed.

## Observed checks

Linux, Node 24.22.1 compatibility runtime: domain initialization/reopen, canonical aliases, binding conflicts, corrupt registration, file replacement, copy, stale recovery preconditions, six-process registry contention, interrupted intent states and unsupported metadata were exercised by `test/host-domain.test.mjs`. Session expiry, replay, origin, CSRF and revocation were exercised by `test/host-session.test.mjs`. Transport framing/private-file tests are in `test/host-transport.test.mjs`.

The development container returns OS `EPERM` for Unix socket bind, including an isolated `node:net` probe. That one real handshake case is reported as skipped there, not passed. Native CI is needed to establish socket behavior and Windows DACL/MoveFileExW/file-identity behavior. The Windows implementation uses write-through atomic replacement; intent-file deletion may safely replay and is not claimed as a durable deletion guarantee. No BabelDOC, MinerU, Cordis or DSH version migration is included.

## Native CI follow-up

The first #88 CI head passed Linux but failed the new permission fixtures on
macOS and Windows. macOS uses the root-owned `/var` alias for temporary paths;
the permission helper now verifies both that alias's ownership and the resolved
ancestry instead of rejecting every alias. User-owned ancestor symlinks remain
rejected. Windows ACL construction now uses explicit .NET constructors and
retains the local subprocess cause for diagnostic evidence without exposing it
through the owner transport. Native reruns are required to accept these changes.
