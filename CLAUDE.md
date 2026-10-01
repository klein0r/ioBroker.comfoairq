# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

ioBroker adapter (`iobroker.comfoairq`) that connects a Zehnder ComfoAirQ ventilation unit via the ComfoConnect LAN C gateway. Plain JavaScript (CommonJS, no build step), Node >= 22. All protocol work is delegated to the `comfoairq` npm package; this repo only maps it onto ioBroker states. LAN C gateways with firmware before U1.2.6 accept only one client at a time (ComfoControl app and adapter can't be connected simultaneously); since U1.2.6 multiple connections are supported.

## Commands

- `npm run lint` — ESLint (`@iobroker/eslint-config`, Prettier config in `prettier.config.mjs`)
- `npm run check` — type-check JS via `tsc --noEmit -p tsconfig.check.json` (JSDoc types; adapter config typed in `lib/adapter-config.d.ts`)
- `npm test` — unit tests (`test:js`) + package validation (`test:package`, checks `package.json`/`io-package.json` consistency)
- `npm run test:integration` — starts the adapter in a temporary js-controller via `@iobroker/testing`
- Single test file: `npx mocha --config test/mocharc.custom.json path/to/file.test.js`
- `npm run translate` — fills `admin/i18n/*.json` from English via `translate-adapter`
- `npm run release-patch|minor|major` — `@alcalzone/release-script` (plugins: iobroker, license, manual-review); bumps versions in `package.json`/`io-package.json` and moves the `### **WORK IN PROGRESS**` changelog block in README.md. Pushing a `v*` tag triggers npm deploy in `.github/workflows/test-and-release.yml`.

CI runs lint/check on Node 24, then adapter tests on Node 22/24/26 across Linux/Windows/macOS. Commits containing `[skip ci]` skip CI.

## Architecture

Everything lives in `main.js` (`Comfoairq extends utils.Adapter`, daemon mode).

- **Sensor selection is config-driven.** Each sensor is a boolean `native.sensor_<pdid>` (defaults in `io-package.json`, checkboxes in `admin/jsonConfig.json`). On `onReady`, every truthy `sensor_*` key is parsed into a PDID and registered with `RegisterSensor`. Adding a sensor means adding it to both files (plus i18n labels); add a unit to `sensorMeta` in `main.js` if applicable.
- **Sensor states are created lazily** under `sensor.<camelCaseName>` from the `kind == 40` (CnRpdoNotification) receive events, using `cleanNamespace()` on the name reported by the library. 32-bit sensors arrive as raw 4-byte buffers and are decoded with `readInt32LE`. Updates per sensor are throttled to one per 2 s via `pausedSensorValues` timeouts.
- **`kind == 68`** (VersionConfirm) fills `version.*` states; **`kind == 53`** (StartSessionConfirm) sets `info.connection` again after an automatic reconnect of the library.
- **Commands** are predefined states `command.*` in `io-package.json` `instanceObjects`. Buttons are mapped to the library's command constant via `this.commands` in `main.js` (e.g. `fanBoost10m` → `SendCommand(1, 'FAN_BOOST_10M')`); `boostDuration` / `awayDuration` (minutes, -1 = unlimited) call `SetBoost` / `SetAway`. New buttons need both an `instanceObjects` entry and a `this.commands` entry.
- **Settings** (`property.*`) are created lazily from `this.propertyMeta` (key = property name of the library, see `comfoProperties` in its `lib/const.js`). They are read via `GetProperty` / `GetPropertyRange` (min/max/step for writable numbers) on start and hourly; writes call `SetProperty` and re-read with retries (the unit answers `RMI_ERROR` right after a write).
- **Discovery wizard**: the admin `sendTo` button (`_startWizard`, command `wizard`) triggers `onMessage`, which runs the static `ComfoAirQ.discover()` of the library (broadcast on all interfaces, plus unicast to the configured `host` if set - works across subnets / Docker bridge networks; 5 s timeout) and returns `host`/`uuid` of the first device into the config form.
- The adapter identifies itself to the gateway with a fixed app UUID/device name (`this.uuid`, `this.deviceName`); the user-provided `uuid` is the gateway's UUID and `pin` its PIN.

## Repository conventions

- Admin UI is JSON Config (`admin/jsonConfig.json`, `"i18n": true`); translations use the flat `admin/i18n/<lang>.json` format. Keep all languages in sync with `en.json` — no keys that don't exist in English.
- Many commits address ioBroker repository-checker findings and are titled with the checker code, e.g. `[W5612] ...`.
- Add changelog entries under the `### **WORK IN PROGRESS**` placeholder in README.md in the form `* (@author) Description`; older entries live in `CHANGELOG_OLD.md`.
