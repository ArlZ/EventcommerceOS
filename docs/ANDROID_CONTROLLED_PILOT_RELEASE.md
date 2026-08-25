# Android controlled-pilot release

The automatically generated `Android pilot APK` artifact is a **debug/rehearsal artifact**. It is useful for development and venue setup rehearsal, but it is not approved for live-money service because a debug build is debuggable and is not signed with the controlled pilot release key.

Live-money pilot devices must use the separately produced **signed release APK** from `.github/workflows/android-controlled-pilot-apk.yml`.

## Release properties

The controlled-pilot workflow builds the Android `release` variant and fails closed unless all of the following are true:

- the workflow checkout exactly matches the recorded 40-character release SHA;
- the release build is signed;
- `apkanalyzer manifest debuggable` reports `false`;
- the application id is `com.eventcommerce.pos`;
- the APK SHA-256 is retained;
- the signing certificate SHA-256 is retained;
- the artifact manifest records the exact release SHA, workflow run, version, APK digest and signing-certificate digest.

Pull requests use a short-lived CI-only signing key to validate that the release/signing pipeline works. That CI key is **not** a pilot signing key and its artifact must never be installed for live-money service.

A real controlled-pilot artifact is produced only by a deliberate `workflow_dispatch` run using the configured repository secrets below.

## Required GitHub Actions secrets

Configure these through GitHub repository/environment administration. Never commit any of them to the repository:

- `POS_RELEASE_KEYSTORE_B64` — base64-encoded Java/Android release keystore bytes;
- `POS_RELEASE_KEYSTORE_PASSWORD` — keystore password;
- `POS_RELEASE_KEY_ALIAS` — release key alias;
- `POS_RELEASE_KEY_PASSWORD` — release key password.

The keystore is decoded only into the ephemeral GitHub Actions runner filesystem with restrictive permissions. It is not uploaded as an artifact.

## Signing-key handling

The signing key is an operational security asset:

- generate it outside source control;
- retain an encrypted offline backup before relying on it for field devices;
- restrict access to the minimum release operators;
- record the expected signer-certificate SHA-256 in the approved pilot evidence store;
- investigate any unexpected signer digest before installation;
- do not silently replace the key between devices in the same controlled pilot;
- if the key is believed compromised, stop using the affected build and rotate deliberately rather than continuing service with uncertain provenance.

This workflow does not claim Google Play/App Signing enrollment. The controlled pilot uses direct, deliberately signed APK distribution to supported dedicated devices.

## Build and evidence flow

1. Freeze the exact `main` release candidate.
2. Confirm the exact-main CI, dependency SCA, runtime-container, managed-deployment, recovery and Edge-bundle evidence is green.
3. Configure/verify the four Android signing secrets through repository administration.
4. Run **Android controlled pilot signed APK** manually against the frozen `main` candidate.
5. Retain the workflow run and `event-commerce-pos-controlled-pilot-<release-sha>` artifact.
6. Review `release-manifest.json` and record:
   - release SHA;
   - APK SHA-256;
   - signer certificate SHA-256;
   - `debuggable: false`;
   - application id/version.
7. Verify the APK checksum and signer again after copying it to the deployment machine.
8. Install only that reviewed APK on controlled-pilot POS devices using the fail-closed procedure in `docs/ANDROID_DEVICE_PROVISIONING.md`.
9. Retain the generated machine-readable installed-package/device evidence with the pilot evidence pack.

The repository commands `pnpm pilot:android:verify -- --artifact-dir <dir>` and `pnpm pilot:android:install -- --artifact-dir <dir> --asset-id <id>` perform the artifact and device checks documented in `docs/ANDROID_DEVICE_PROVISIONING.md`.

Do not rebuild the same release casually from a different key or distribute an APK whose digest is not the reviewed digest.

## Relationship to the pilot gates

A signed, non-debuggable APK closes only the **binary provenance** portion of Android deployment readiness. A successful device installation additionally proves that a specific controlled device received the reviewed package/version, but it still does not satisfy the real hardware/network, offline durability, payment fault, abuse/flood, inventory-close or controlled-pilot-close gates in `docs/PILOT_RUNBOOK.md`.
