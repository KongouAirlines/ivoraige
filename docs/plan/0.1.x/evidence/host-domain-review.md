# Host domain review recovery evidence

Base: `d59282f` on the host-owner foundation branch. This record covers the two domain findings in the 2026-11-10 PR #88 review, not the transport or session findings. Tests ran on Linux with Node's built-in test runner; Windows/macOS behavior is not claimed from these results.

## Original failures

An isolated copy of `d59282f:src/host-domain.mjs` was run against temporary stores. For a registered store copied out, removed, and restored byte-identically at the same path with a new inode, `inspectHostDomain` reported `domain-at-other-path` and `availableModes: ["copy"]`. Recovery in each of `copy`, `migrate`, and `repair-registration` returned `CONFLICT/domain-registration-mismatch`. With an initialization intent for store C, both creating unrelated B and finding registered A returned `CONFLICT/registry-intent-pending`. The baseline module and temporary stores were removed after the reproduction.

## Recovery rules implemented

- A canonical target has its own `domain-intent-<sha256(canonical path)>.json`. The old `domain-intent.json` remains readable and replayable for its exact target, but does not block unrelated targets. New intents never replace that legacy file.
- Intent replay requires the target record and any source record to match the recorded preconditions, rather than comparing a hash of the whole registry. The whole registry is still parsed and validated before action. Other domains can change without invalidating replay. Conflicting pending operations that touch the same source are rejected.
- `store-replaced-in-place` is distinct from `domain-at-other-path`. `refresh-identity` requires an exact diagnostic, confirmation, the registry lease and target store lease, unchanged target record, and matching store domainId and registrationId. It updates only fileIdentity; IDs and owner binding stay unchanged. A different domain at the path is rejected. The unreachable `repair-registration` branch is removed.
- A pending initialization may be explicitly abandoned only when its target has no registry record and is absent or is readable with no host-domain metadata, under both locks. The initialization catch path removes its intent only after a confirmed metadata-free read and confirmed storage disposal. An inaccessible parent or volume cannot prove that no write occurred, so this route remains unavailable for that target; unrelated stores continue working. An absent file that later reappears with metadata still fails closed rather than receiving a new ID.
- A pending migration cannot replay without fresh local source-retirement proof. `recoverHostDomain` accepts `mode: "migrate"` with the pending diagnostic and a synchronous verifier to resume it. `copy` and initialization preserve replay compatibility. No recovery path steals a busy source or target.

## Verification

- `node --test test/host-domain.test.mjs`: 17 passed. Covers in-place replacement and ID preservation, different-domain rejection, pending target isolation, unrelated registry changes during replay, legacy intent replay, absent-target abandonment, overlapping source intent rejection, migration replay proof, and prior recovery behavior.
- `node --test test/host-domain.test.mjs test/host-transport.test.mjs test/host-session.test.mjs test/host-permissions.test.mjs`: 29 passed, 6 platform/sandbox skips.
- `node --test --test-timeout=180000 test/*.test.mjs`: 593 passed, 19 skips, 0 failed. This used the prebuilt local `dist/dsh.mjs`; it did not rebuild the distribution.

## Remaining boundary

Metadata inspection still makes a full SQLite backup through `readMetadataSnapshot`, including while a registry lease is held on mutation/replay paths. Large stores can hold that lease for a long time. The snapshot uses a temporary directory and normally removes it, but an abrupt process kill can leave a temporary copy. This patch does not optimize that cost or add orphan cleanup. Safe abandoned-init detection does not treat an inaccessible volume as an absent store. POSIX tests here do not validate Windows ACL/write-through or macOS file-identity behavior; those still need native platform runs.

A malformed legacy singleton intent cannot be assigned to a target safely and still blocks all targets. Source-conflict checks scan pending intents, so a malformed intent file can also block recovery that needs the same source. Those cases require manual review or restoration from a trusted backup rather than guessing ownership from the filename.
