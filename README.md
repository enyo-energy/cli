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
- **One device on the simulated LAN** (`useNetworkDevices()`), at `192.168.178.42`
  with a MAC, open ports and access already granted, findable by the same id the host
  hands your dynamic handler.

When your app answers `null` for a dynamic block, the simulator falls back the way
the cloud does: an `ocpp-url` slot gets the host-built URL, a `device-ip` slot gets
the run's device address — and stays empty when the run has no device, exactly as in
a `device-not-found` run. The UI labels which of the two filled the slot.

It then serves a local UI on <http://localhost:4600> that lists your guides by start
variant (`device-not-found`, `device-found-config`, `manual-setup`, `maintenance`) and
lets you walk any of them:

- **Choices, actions, inputs** — no hardware answers here, so you pick the outcome you
  want to walk. That is how a single guide is checked down each of its branches.
- **Dynamic blocks** call your `registerDynamicValueHandler`, and the UI says whether
  the value came from your app or was left unresolved.
- **Additional-setup blocks** call your `registerAdditionalSetupHandler` with the
  fields you filled in, and route on the verdict exactly as the device does —
  anything that is not a declared outcome falls back to the reserved `failed` branch.
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

`example/onboarding-sim-fixture` is a runnable app with one guide per start variant —
`cd` into it and run `enyo onboarding-sim` to see what the simulator does.

The simulator previews *your app's* guides and handler logic. The screens an installer
sees are rendered by the enyo app, not by this UI.
