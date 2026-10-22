# Contributing to ivoraige

Check the [capability map](docs/plan/0.1.0/capabilities.md), existing issues and
[follow-ups](docs/plan/follow-ups/README.md) before starting. Discuss large changes
first; keep each pull request focused.

## Issues and pull requests

For bugs, include the version or commit, platform, expected and observed behavior,
and steps to reproduce. Use small original or authorized samples, without private
documents or credentials. Report vulnerabilities through [SECURITY.md](SECURITY.md).

Use Node.js `>=24.22.1 <25 || >=26.12.1 <27` with npm. Later stable
patches within either supported major are suitable for source work; Node 25
and future majors are outside the current supported range:

```sh
npm ci
npm run setup:dsh
npm test
npm run smoke:package
```

See the [development guide](docs/plan/0.1.0/development-guide.md) and, for PDF work,
[PDF development](docs/plan/0.1.0/pdf-development.md). Default tests use a mock
provider. Run checks relevant to your change and state what you ran; documentation
edits do not need the full suite. Keep business behavior in its owning service or
adapter. Update both READMEs and the relevant guide when behavior or setup changes.

## License and sign-off

The core uses **LGPL-3.0-or-later**, the existing business modules listed in
[LICENSE](LICENSE) use **MIT**, and the separate BabelDOC Python plugin uses
**AGPL-3.0-only**. Independent plugins declare their own license; third-party
notices remain intact. Contributions use the license of the component changed.

Sign off every new contribution commit under the
[Developer Certificate of Origin 1.1](https://developercertificate.org/), certifying
your right to submit it under that license:

```sh
git commit -s
```

This adds `Signed-off-by: Your Name <you@example.org>` to the commit message.
Use your own identity and sign off only contributions you can certify. The sign-off
becomes part of public Git history; it is distinct from a cryptographic commit signature.
