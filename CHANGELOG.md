# Changelog

All notable changes to this project will be documented in this file.

## 0.2.3

- Add opt-in spawn logging (`logSpawn`) with prompt redaction and shell-style output formatting.

## 0.2.2

- Add Codex reasoning summary and verbosity flags with opt-in raw reasoning and debug logging.

## 0.2.1

- Add provider binding and deterministic cancel semantics for embedded hosts.
- Add status check options (`fast`/`force`) and align protocol/schema/docs for host changes.
- Improve embedded dev host bootstrapping in example apps (wait for readiness, avoid conflicts).

## 0.2.0

- Add new `@agentconnect/host` package for embedded hosting and shared provider runtime.
- Move host runtime out of CLI; CLI now wraps `startDevHost` from the host package.
- Add in-process host bridge for embedded usage (`createHostBridge`).
- Remove `@agentconnect/sdk/host` auto-spawn dev host helper (use `@agentconnect/host` instead).
- Update docs, tests, and examples to reflect embedded host guidance.

## 0.1.7

- Fix lint failures in provider code and modal-only app.
- Stabilize Cursor fast status to avoid login/detected flicker.

## 0.1.6

- Add fast provider status checks with background refresh for faster initial UI.
- Improve Claude login detection and avoid double-login flows.
- Add provider update checks, update actions, and UI indicators for updates.
- Refine provider card styling and cursor/codex icon treatments.

## 0.1.5

- Add provider detail events, provider session IDs, and update metadata across SDK/CLI.
- Improve host status caching, logging, and parallelism for provider checks.

## 0.1.1

- Fix CommonJS resolution by adding default exports.
- Move protocol and host details into docs for a clearer README.

## 0.1.0

- Initial public SDK, UI, and CLI release.
- Publish-ready build outputs for SDK and CLI.
- SDK reference docs and contributor documentation.
