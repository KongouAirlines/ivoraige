# Owner transport review hardening

This follow-up to [#88](https://github.com/KongouAirlines/ivoraige/pull/88) covers the owner IPC response budget, cancellation, socket location, and browser session state. The contract change is merged from the HostControl design branch; `OwnerIPCRequest` is now separate from generic `HostControl Request`. `validateHostRequest` accepts only owner IPC actions, while `validateHostAttach` checks attach. Generic `start` remains a local entry action and is never forwarded to the owner socket. The existing HostControl@1 minor 0, API 2.0, discovery record shape, and ephemeral-owner refusal remain unchanged.

## Response and cancellation behavior

Connecting to a registered endpoint has a five-second POSIX bound; Windows retains the native broker’s 25-second cold-start/connect bound. The attach handshake has a separate five-second bound after connection. Ordinary control replies retain a five-second bound; drain and exit use their requested budget plus five seconds. `business` and `mcp.*` replies have no built-in deadline. Their caller may pass `request(action, params, { signal, timeoutMs })`; existing two-argument callers still work. A bounded response timeout or a lost connection after sending an action reports `CONFLICT / outcome-unknown`, not `owner-unreachable`. An explicit caller abort reports `request-cancelled`. This distinction does not prove whether an operation had side effects, so callers must reconcile by operation or task state rather than automatically retry a non-idempotent business action.

The server passes `{ signal }` as a third argument to `handleBusiness(method, input, options)`, including MCP forwarding. The signal is aborted when the client disconnects. Cancellation is attached before awaiting owner state and a disconnected socket cannot start a new business dispatch. No disconnect cancellation is attached to lifecycle control actions: an accepted exit continues after its requester leaves. Handlers must observe the signal for active work to stop; it is not a process kill. The downstream A3 adapter must pass this signal into the P04 catalog invocation (and through MCP forwarding), and must pass the initiating CLI/HTTP signal and any explicit timeout to `connection.request`. Those entry paths are outside this foundation PR.

Owner IPC failures now use the same API 2.0 error location as the external envelope: `{ ok: false, apiVersion: "2.0", error: { code, message, details: { reason, supportedMinors? } } }`. The reason remains a machine-readable value. The server does not expose raw exception text, received frames or credentials. The checked-in HostControl design schema/fixtures separately describe owner IPC requests and responses. A Node test checks every `OwnerIPCRequest` fixture against the runtime Zod validators, rejects generic `start`, and validates actual formatted errors including unsupported-minor details against `OwnerIPCFrame`.

## Socket location

On Linux, the owner prefers a validated 0700 `XDG_RUNTIME_DIR` subdirectory, then a private persistent directory directly under the user's home. On macOS it prefers the validated per-user `os.tmpdir()` directory, then the private home directory. If neither fits the conservative 100-byte Unix socket path limit or is usable, it allocates a random 0700 directory beneath the system temporary directory and writes its actual socket address into the protected discovery record. A predictable path occupied by another user is not trusted or modified. Clients validate the recorded address's private directory, socket name, owner, socket type and 0600 mode rather than recomputing a deterministic path. The directory assertion checks ownership, symlinks and ancestry; socket DAC is the POSIX authorization boundary, not an unimplemented peer-credential API. Windows continues to use the native DACL/token-verified pipe and per-generation capability.

A system that lacks a usable runtime or persistent home location still uses a shared temporary-directory fallback. Such a location may be aged away by OS cleanup during a very long-running owner, leaving discovery unable to attach; no automatic socket rebinding is claimed. Native Linux/macOS availability testing should include the intended installed-user runtime/home policy. The fallback is short and random for path-length and preoccupation safety, not a durability guarantee.

## Browser sessions

`refreshCsrf` now requires `method: 'POST'` and an exact full Origin match before rotating a token. A missing Origin, a different loopback port or a GET cannot invalidate a legitimate page's CSRF token. A3 must expose refresh only through POST and pass the received HTTP method, Origin, Host and cookie unchanged to this method; there is no browser refresh route in the foundation layer. Issuing a bootstrap prunes expired credentials, then evicts the oldest pending credential at the 64-grant cap. Session exchange evicts the oldest active session at the 64-session cap. These admission caps avoid unbounded state in a resident owner. Tests use smaller configured caps to verify deterministic eviction and expiry pruning.

## Verification and remaining work

`node --test test/host-contract.test.mjs test/host-transport.test.mjs test/host-session.test.mjs`: 18 tests, 16 passed, 2 skipped, 0 failed on Linux / Node 24.22.1. Socket-free Duplex tests demonstrate a 5.1-second business response, an independent response timeout, connection cancellation, business disconnect during a deferred state lookup, and exit continuation after disconnect. The two real Unix-socket tests were skipped because this sandbox rejects bind with EPERM; no permission change or alternate network transport was used. Native POSIX integration and Windows pipe disconnect/cancellation behavior remain unverified here. The preexisting registry-lease discovery cleanup regression still passes. No HTTP/browser entry, installed CLI owner path, or native Windows evidence is claimed by these tests.

Additional Linux checks of `test/host-permissions.test.mjs`, `test/host-windows-pipe.test.mjs` and `test/host-windows-pipe-broker.test.mjs` reported 23 tests, 7 passed, 16 platform skips, 0 failures. These do not substitute for native Windows pipe verification.

An integration check found that an empty capability was still accepted by Zod
despite the shared schema's nonempty requirement, and a raw exception could
copy arbitrary `details.supportedMinors` into the public failure frame. Both
were reproduced and corrected. Capability validation now agrees with the
schema; supported minors come only from the local interface definition, and
unknown/internal errors expose only the fixed internal-error reason.

## Follow-up: response delivery and owned-directory cleanup

A handler result that exceeds the frame limit, cannot be serialized, or has no result no longer returns invalid-request, which would incorrectly imply that no side effect occurred. Corrupt, oversized or invalid response frames report outcome-unknown after dispatch. True input validation errors remain distinct. Socket-free tests commit a visible effect before provoking delivery failures and verify this classification.

Normal close retires only random fallback leaves allocated by this process, with nonrecursive removal and retryable ownership tracking. Shared runtime/home directories and unowned directories are never removed. Abrupt process death may still leave directories, and OS temporary cleanup can still affect a live fallback socket. macOS tests compare canonical temporary paths; Windows direct-dispatch tests supply a matching synthetic capability so they exercise the authenticated path rather than stopping at authentication.

The 12 targeted Linux / Node 24.22.1 tests passed after rebuilding the exact ec4e20d baseline; native platform outcomes remain the responsibility of current-head CI. The downstream A3 cancellation propagation and POST refresh wiring remain outside this PR.

## Follow-up: local broker failures after submission

Review of `af661fd` reproduced a remaining result-classification gap: after a
business frame was written, a Windows helper/channel failure propagated
`PRECONDITION_FAILED / owner-permissions-unverified` rather than
`CONFLICT / outcome-unknown`. The client normalized only a short list of network
errno values, while the pipe broker emits its own KernelError. A socket-free
probe recorded one visible effect before provoking this failure.

Reply-channel errors now use the same outcome-unknown classification regardless
of their local exception type. Connection-time authorization failures, explicit
failure frames received from the owner, local input-size rejection and caller
cancellation retain their distinct meanings. Regression tests exercise both a
Duplex stream and the actual JavaScript Windows broker with an injected child
failure after its write command. These are deterministic local fault-injection
checks, not native Windows acceptance.

Linux / Node 24.22.1 `npm test` passed 614 of 634 tests with 20 platform/sandbox
skips and no failures. An initial build through a shared vendor path selected
an ancestor dependency cache containing fast-uri 3.1.8 and failed the bundle
dependency-baseline check. A clean local checkout of the unchanged DSH pin,
using the exact-lockfile dependency cache, produced the passing build. The
100-fixture Python schema check passed. Package staging and tarball checks
completed, but the isolated installation could not run because the offline npm
cache lacked the pi-ai registry response (`ENOTCACHED`); persistence/export/MCP
package smoke is therefore not established by this run. Unix socket bind still
returns EPERM in this environment, and native macOS/Windows checks remain needed.
