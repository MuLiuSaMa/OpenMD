# Verified Linux installers

On 2026-10-06, the final OpenMD 1.0.2 x86-64 installers passed clean package installation and all seven desktop workflow checks on the following targets:

| Target | Native package installation | Metadata inspection | Desktop checks |
| --- | --- | --- | --- |
| Ubuntu 24.04.5 LTS | APT, without recommended packages | `dpkg-deb -I` | 7/7 pass |
| Fedora 44 | DNF, without weak dependencies | `rpm -qpR` | 7/7 pass |
| openSUSE Leap 16.0 | Zypper, without recommended packages | `rpm -qpR` | 7/7 pass |

Each minimal installation started from a clean distribution image, before installing any desktop testing tools. All linked libraries resolved, the runtime linker cache contained `libayatana-appindicator3.so.1`, and a system certificate bundle was present. Missing application dependencies were not installed manually. The subsequent desktop container installed the same artifact through the native package manager and ran OpenMD as an unprivileged user.

Each desktop run verified:

1. Launch and visibly render a Markdown fixture.
2. Register a tray icon with the desktop's StatusNotifier host.
3. Minimize the window while retaining the application process.
4. Restore the minimized window through the visible tray menu.
5. Select **Hide to tray** in the close dialog, retaining the process and tray icon.
6. Restore the hidden window through the visible tray menu.
7. Select **Quit** in the visible tray menu, exit with code zero, and remove the window and tray icon.

## Installer identity

The application was built with `pnpm tauri build --bundles deb,rpm -- --locked`. After adding `ca-certificates` to the dependency metadata, the same release executable was repackaged with `pnpm tauri bundle --bundles deb,rpm`. The following final artifacts were then installed and tested:

| Installer | SHA-256 |
| --- | --- |
| `src-tauri/target/release/bundle/deb/OpenMD_1.0.2_amd64.deb` | `f6b4e0f181197309a16b8fd16b31e54840e4d94ecbce41d2069fa695e0ef0553` |
| `src-tauri/target/release/bundle/rpm/OpenMD-1.0.2-1.x86_64.rpm` | `a1e8428ca829a3c36589dc0779f2da8d0161106835be7a288f3d094073eaeaea` |

The Debian metadata includes `libayatana-appindicator3-1`, WebKitGTK 4.1, libsoup 3, OpenSSL 3, `libc6 (>= 2.39)`, and `ca-certificates`. The RPM metadata includes Ayatana, WebKitGTK/JavaScriptCore, libsoup, GTK/GDK and the other linked library capabilities, `libc.so.6(GLIBC_2.39)(64bit)`, and `ca-certificates`. Tauri's CLI also adds some default dependencies, so the metadata contains harmless repeated entries. The raw inspection output is retained in the evidence.

## Evidence

Original successful runs, relative to the repository root:

- Ubuntu: `artifacts/linux-packaging/20261006T080336Z-742365/ubuntu/`
- Fedora: `artifacts/linux-packaging/20261006T080658Z-761421/fedora/`
- openSUSE: `artifacts/linux-packaging/20261006T080334Z-741967/opensuse/`

The combined evidence is in `artifacts/linux-packaging/verified-20261006/` and the review attachment is `artifacts/linux-packaging/verified-20261006.zip`. These generated files are intentionally ignored by Git; upload the ZIP to the PR separately. It contains the dependency inspection, native installation logs, before/after installed package inventories, library checks, workflow JSON, screenshots, WebM recordings, distribution image digests, and source/configuration snapshots. The installers themselves are not included in the ZIP; their hashes identify the tested files.

The dependency changes are committed as `2b3fe34` and `1b17f07`. Runs started before the latter commit was created; their `source.diff` and `tauri.conf.json` snapshots record the final dependency configuration. Use the artifact hashes to identify the tested installers, rather than assuming a run's recorded HEAD alone identifies every working-tree change.

Resolved base images:

```text
Ubuntu:   docker.io/library/ubuntu@sha256:534baea6a22c03a63003dbc8dbe78fe34bc0d7e595d9a9dc9834884ff530eb55
Fedora:   docker.io/library/fedora@sha256:43b29f65a41eb9c35e1cd5323e3bdf3b655c2357a9f4f1ff2f9c2798e5045d80
openSUSE: docker.io/opensuse/leap@sha256:7f3aeccb6a613c0fc1690d3d3e5eb493fd477ee4587de20640017fc36d72f9b0
```

## Scope and rerun

The desktop environment was Xvfb/X11, Openbox, and an Xfce StatusNotifier panel with software rendering. Containers shared the host kernel and permitted WebKit's nested namespace sandbox using Docker's `seccomp=unconfined` and `apparmor=unconfined` settings. They were not privileged. These results do not cover native GNOME/KDE sessions, Wayland, GPU drivers, or every Debian/RPM distribution. The current executable requires glibc 2.39; older systems require a build from an older compatible baseline.

After any installer change, rerun the matrix against the new artifacts:

```bash
bash tests/linux-packaging/run.sh
```

See [README.md](README.md) for build instructions, individual distribution runs, and how the checks work. A successful Docker matrix provides reproducible evidence for review; the maintainer decides whether additional native desktop testing is needed before merging.
