# Android controlled-pilot device provisioning

This procedure installs a reviewed **controlled-pilot release APK** on a dedicated Android POS device and retains machine-readable evidence tying the installed package to the reviewed GitHub Actions artifact.

It does not approve live money by itself. It closes only the physical-device installation/provenance checkpoint for that device; the hardware/network, offline durability, payment fault, abuse/flood, inventory/reconciliation and controlled-pilot-close gates still apply.

## Inputs

Use only the artifact produced by a deliberate **Android controlled pilot signed APK** `workflow_dispatch` run. Extract the artifact ZIP into a dedicated directory containing exactly the reviewed release files, including:

- `event-commerce-pos-controlled-pilot.apk`;
- `event-commerce-pos-controlled-pilot.apk.sha256`;
- `release-manifest.json`.

Keep the downloaded ZIP separately so the original artifact can be re-verified later.

The deployment machine needs:

- Node.js compatible with the repository toolchain;
- Android SDK Platform Tools (`adb`);
- Android SDK Build Tools (`apksigner`);
- USB debugging enabled on the controlled POS device;
- the device physically authorized for the deployment machine.

`ANDROID_HOME` or `ANDROID_SDK_ROOT` is preferred. `ADB` and `APKSIGNER` may be set explicitly when the executables live elsewhere.

## 1. Verify the artifact before connecting a device

From a repository checkout containing `scripts/android-device-evidence.mjs`:

```powershell
pnpm pilot:android:verify -- --artifact-dir "C:\path\to\extracted-artifact"
```

The command fails closed unless:

- `release-manifest.json` identifies `ArlZ/EventcommerceOS`;
- the artifact is a real `release` build, not CI validation;
- `validationOnly=false`;
- `signingKeyClass=controlled-pilot-secret`;
- application id is `com.eventcommerce.pos`;
- the manifest records `signed=true` and `debuggable=false`;
- the APK SHA-256 exactly matches the manifest;
- `apksigner` verifies the APK;
- the actual APK signer-certificate SHA-256 exactly matches the manifest.

Do not install if any one of these checks fails.

## 2. Prepare the controlled device

Record a physical asset identifier before installation, for example the organization's actual inventory label. Do not invent an asset identifier solely for the evidence file.

On the Android device:

1. confirm supported Android version and sufficient battery;
2. set the correct local timezone/time;
3. enable Developer options and USB debugging for provisioning;
4. connect the device by USB;
5. accept the host authorization prompt on the device;
6. confirm `adb devices -l` shows the device in `device` state, not `unauthorized` or `offline`.

If more than one authorized Android device is connected, use the explicit `--serial` option.

## 3. Install and capture evidence

With one authorized device attached:

```powershell
pnpm pilot:android:install -- `
  --artifact-dir "C:\path\to\extracted-artifact" `
  --asset-id "<physical-asset-id>"
```

With multiple devices attached:

```powershell
pnpm pilot:android:install -- `
  --artifact-dir "C:\path\to\extracted-artifact" `
  --asset-id "<physical-asset-id>" `
  --serial "<adb-serial>"
```

The tool re-runs all artifact provenance checks **before** installation, installs only the reviewed APK with `adb install -r`, then confirms the installed package and version through Android package-manager state.

The generated JSON evidence records:

- exact release commit and originating workflow run;
- reviewed APK SHA-256;
- reviewed signer-certificate SHA-256;
- application id/version;
- physical asset ID and ADB device serial;
- manufacturer/model/Android SDK metadata;
- timezone and battery level at provisioning time;
- installed package path/version and install/update timestamps.

The evidence intentionally contains no signing password, keystore, bearer token, payment credential or customer/order content.

## 4. Post-install app checks

After installation:

1. launch the POS app normally;
2. provision the register through the approved flow;
3. record assigned event, sales location and register identity;
4. confirm the app can cold-start;
5. cache/activate the approved event/menu;
6. confirm operator/supervisor access;
7. create the pre-open test order required by `docs/PILOT_RUNBOOK.md`;
8. use **Share pilot diagnostics** to retain the baseline JSON described in `docs/POS_FIELD_DIAGNOSTICS.md`.

Do not wipe app data, uninstall/reinstall, or reprovision the register merely to remove a failed state. A failed restart/reconnect/durability checkpoint must remain visible until its cause is understood.

## 5. Evidence handling

Retain the device JSON beside the controlled pilot evidence pack and hash it into the pilot evidence manifest when the corresponding real-world gate is reviewed.

The successful installation record is necessary but insufficient for the `hardwareNetwork` or `offlineDurability` gate. Those gates require real LAN/Event Edge evidence and the baseline/offline/restart/reconnect diagnostics sequence.

## Failure rules

Stop device provisioning if:

- artifact hash or signer differs from the reviewed manifest;
- the artifact is CI validation/debuggable/uncontrolled signing material;
- ADB reports the intended device as unauthorized/offline;
- Android rejects the install because an existing package uses a different signer;
- installed version differs from the reviewed artifact;
- the device cannot retain local application state through the subsequent restart test.

Never use `adb uninstall`, `pm clear`, a debug APK, or a differently signed rebuild as an expedient workaround for a controlled-pilot device.
