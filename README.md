# Enyo CLI
The Enyo CLI is a npm-based cli to publish and deploy your Enyo Energy Apps to our store.

## Authorization
You need a Developer Org to use the Enyo CLI. Reach out to info@enyo-energy.de to get your Developer Org.
If you own a verified Developer Org, you can create a new API key and use this one by providing the `--api-key <API KEY>` argument to your call.

## Installation
To install the Enyo CLI, run:
```bash
npm install -g @enyo-energy/cli
```

To install the Enyo CLI locally in your project, run:
```bash
npm run build
npm link
```

## Usage
To see all available commands, run:
```bash
enyo --help
```
## Releasing

```bash
npx rsbuild build
enyo release --api-key <API KEY>
```

The CLI refuses a release that would change nothing. Before it asks for release notes
it fingerprints two things and compares them with what the channel already carries:

- the **contents** of `dist` — every file's path and digest, not the tarball, which
  carries timestamps and differs on every build;
- the **package definition** as it goes over the wire, minus the release notes and the
  internal description.

Both equal to the latest release on that channel means the release is skipped and the
command exits non-zero — in CI too, which is where a no-op release is most likely to
go unnoticed. It matters because a new version number is all a device compares: the
whole fleet would download and reinstall identical bytes and restart your app for it.

Changing only the release note counts as unchanged. Publish anyway with `--force`,
which is also what you want after an upload died halfway, for a rollback reissue, and
when promoting the same build to another channel.

| Option | Meaning |
| --- | --- |
| `--channel <channel>` | `production` (default) or `staging` |
| `--release-notes <file>` | JSON file with `{"de": "…", "en": "…"}`, skipping the prompt |
| `--force` | Publish even when nothing changed |
| `-f, --file <file>` | Release one specific config instead of every `*.package.ts` |

With several `*.package.ts` files, an unchanged one is skipped and the others are still
released; the command reports which were skipped and exits non-zero.

## Onboarding v2 simulator
Walk your app's onboarding v2 guides in a browser, without a device:

```bash
npx rsbuild build   # or pass --build
enyo onboarding-sim
```

The command loads your built bundle (`dist/index.js`) against a **mock SDK**: every
`use*()` call answers empty — no appliances, no storage, no network — and `useFetch()`
is blocked unless you pass `--allow-network`. Your app still runs for real, so the
guides it returns and the handlers it registers are the ones a device would get.

Two things are *not* empty, because they are what an installer reads off the screen
and types into a device — a guide that shows an empty box for them cannot be walked:

- **OCPP connection details** (`useOcpp().getAvailableConnectionDetails()`) come back
  as a cloud/local pair in the shape the hub sends:
  `wss://api.enyo-energy.de/ocpp/<deviceSlug>/<packageSlug>` and
  `ws://<hub ip>/ocpp/<packageSlug>`.
- **Three devices on the simulated LAN** (`useNetworkDevices()`), from `192.168.178.42`,
  each with a MAC, open ports and access already granted, findable by the same ids the
  host hands your dynamic handler. They are detected through different channels
  (`mdns`, `modbus`, `eebus`), so a `device-select` block's `detectedAt` filter has
  something to narrow.
- **Three EEBUS peers**, one of which announces no device type — the case a
  `deviceTypes` filter has to exclude rather than wave through.

When your app answers `null` for a dynamic block, the simulator falls back the way
the cloud does: an `ocpp-url` slot gets the host-built URL, a `device-ip` slot gets
the run's device address — and stays empty when the run has no device, exactly as in
a `device-not-found` run. The UI labels which of the two filled the slot.

It then serves a local UI on <http://localhost:4600> that lists your guides by start
variant (`device-not-found`, `device-found-config`, `manual-setup`, `maintenance`,
`offline-reconnect`) and lets you walk any of them:

- **Choices, actions, inputs** — no hardware answers here, so you pick the outcome you
  want to walk. That is how a single guide is checked down each of its branches.
- **Dynamic blocks** call your `registerDynamicValueHandler`, and the UI says whether
  the value came from your app or was left unresolved.
- **Additional-setup blocks** call your `registerAdditionalSetupHandler` with the
  fields you filled in, and route on the verdict exactly as the device does —
  anything that is not a declared outcome falls back to the reserved `failed` branch.
- **Picker blocks** (`device-select`, `eebus-device-select`) render their list on step
  entry, filtered by `detectedAt` / `deviceTypes`, and call your
  `registerDeviceSelectHandler` / `registerEebusDeviceSelectHandler` with what was
  picked. The appliance ids you answer with bind the run, which is what fills
  `applianceId` for the dynamic and setup requests that follow. The host's rules are
  the simulator's: exactly one match and `autoSelectSingleMatch` left on skips the
  screen (the handler still runs, with `autoSelected: true`), no match never skips, and
  nothing your handler does re-routes the flow — a rejection, a timeout and an empty
  answer all take the positive branch with no appliance. Walking back onto a skipped
  picker shows the screen, so you can change the pick.
- **`offline-reconnect` runs** carry the appliance their guide names and no device, and
  both pickers are handed that `applianceId` — answer with the same id to re-bind the
  appliance rather than leaving the customer a duplicate.
- Every guide is checked with the SDK's own validators, and the answer's `null` vs `[]`
  distinction is called out — an empty array retires every guide the host cached.
- The right-hand panel streams your app's console output and every SDK call it made.

Options:

| Option | Meaning |
| --- | --- |
| `--port <port>` | Port for the UI (default `4600`) |
| `--entry <file>` | Bundle entry point, if it is not `dist/index.js` |
| `--build` | Run `npx rsbuild build` first |
| `--allow-network` | Let the app use the real network |
| `--print` | Print the guides the app returned and exit |
| `-f, --file <file>` | Package config to read. Its directory becomes the app root, so you can point at an app in another project |

Note that `vendorId` and `modelIds` on a guide are enyo's to attach, not yours: the
SDK's validator warns when a guide sets them, and the simulator shows that warning on
the guide card.

`example/onboarding-sim-fixture` is a runnable app with one guide per start variant —
`cd` into it and run `enyo onboarding-sim` to see what the simulator does.

The simulator previews *your app's* guides and handler logic. The screens an installer
sees are rendered by the enyo app, not by this UI.
