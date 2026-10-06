# Linux package validation

All Docker definitions, automation, and documentation live in this directory.
Generated evidence lives in the gitignored `artifacts/linux-packaging/<run>/<distribution>/` directory at the repository root. The runner never installs development packages or changes Docker permissions on the host.

A `.deb` or `.rpm` contains the compiled application, its assets, and dependency metadata. Building proves the compiler can produce an executable. Packaging adds the instructions that APT, DNF, or Zypper use to install its runtime libraries. A clean installation checks those instructions; the desktop workflow then checks that the installed application actually works. Development packages are needed to compile the application, while end users need the runtime packages declared in the installer.

The recorded results for the current installers are in [RESULTS.md](RESULTS.md).

## Run

Build the exact packages you want to validate, then run the matrix from the repository root:

```bash
pnpm install --frozen-lockfile
pnpm tauri build --bundles deb,rpm -- --locked
bash tests/linux-packaging/run.sh
```

Docker must be running and accessible to your account. The package directories must each contain exactly one installer for the current build. Docker pulls the distribution tag, resolves its immutable image digest, and records that digest before building. Test images remain cached locally as `openmd-packaging:<distribution>-clean` and `openmd-packaging:<distribution>-desktop`; each test container is removed after completion. No host display, D-Bus, system libraries, Docker socket, or home directory is mounted in a test container.

To run only clean installation checks, or just one distribution:

```bash
bash tests/linux-packaging/run.sh --mode package
bash tests/linux-packaging/run.sh --distro ubuntu
bash tests/linux-packaging/run.sh --distro fedora
bash tests/linux-packaging/run.sh --distro opensuse
```

The matrix uses Ubuntu 24.04, Fedora 44, and openSUSE Leap 16.0 on x86-64. These are explicit test targets, not a promise that every Debian/RPM distribution works. The current Mint/Ubuntu 24.04 build requires glibc 2.39, which is also declared in its dependency metadata. To support older systems, build on an older compatible baseline, audit the resulting ELF dependencies and symbol versions, and adjust the minimum requirement before validation. The RPM capabilities in the current config target 64-bit systems.

## What is checked

1. A minimal distribution container records OS information, package SHA-256, `dpkg-deb -I` or `rpm -qpR`, and its installed packages before installation.
2. The native package manager installs the actual package with optional/recommended dependencies disabled. No missing library is installed manually. Unresolvable metadata or a missing `ldd` dependency fails the test. The runtime linker cache must contain Ayatana AppIndicator, which the application loads dynamically, and the declared certificate store must exist for HTTPS features.
3. Only after the minimal installation check passes does a separate image install desktop testing tools. It uses Xvfb, Openbox, an Xfce panel with a StatusNotifier tray host, and a private D-Bus session. OpenMD runs as an unprivileged user.
4. The desktop test opens a Markdown fixture, verifies its rendered heading through accessibility, minimizes through the application's own control, restores through the visible tray menu, chooses Hide to tray in the close dialog, restores again, and quits through the visible tray menu. It asserts window visibility, process lifetime, and tray registration/removal at each stage.
5. Screenshots, a WebM recording, accessibility dumps, and a machine-readable `workflow.json` provide review evidence. Failed workflows record their exception and a screenshot; they do not count as passes.

The desktop container permits nested namespaces using Docker's `seccomp=unconfined` and `apparmor=unconfined` options so WebKit can run its own sandbox. It does not run privileged or disable WebKit sandboxing. This container configuration is recorded here and in the runner; it does not validate Docker's default security profile.

The tested desktop is X11 with Openbox/Xfce, not the default GNOME/KDE/Wayland session of each distribution. It uses Mesa software rendering (`LIBGL_ALWAYS_SOFTWARE=1`) and disables the DMA-BUF rendering transport (`WEBKIT_DISABLE_DMABUF_RENDERER=1`) for the virtual display. It checks both the accessibility heading and nonblank painted content. These settings do not disable WebKit's sandbox and do not validate physical GPU drivers. Container results share the host kernel. Test other desktop sessions separately if those are part of the compatibility claim.

## Evidence to attach to the PR

- `commit.txt`, `source.diff`, and `tauri.conf.json` identify the build configuration; `base-image.txt` identifies the clean distribution image.
- `package-sha256.txt`, `dpkg-deb-I.txt` / `rpm-qpR.txt`, `package.log`, and `package-ldd.txt` establish which artifact was installed and how its dependencies resolved.
- `workflow.json`, numbered screenshots, `launch.log`, `desktop.log`, and `workflow.webm` establish the actual desktop flow.
- `*.status` files contain zero for successful phases. Build/pull failures are recorded separately as `infrastructure.status`; an infrastructure failure is not an application pass.

Keep the original failure logs when correcting a package. Run the full matrix again after any change to the artifact; a result for a previous SHA-256 does not validate a new installer.

References: [Tauri distribution configuration](https://v2.tauri.app/reference/config/), [Linux build compatibility](https://v2.tauri.app/distribute/debian/#limitations), [Tauri Linux tray event limitations](https://v2.tauri.app/learn/system-tray/), and [Docker bind mounts](https://docs.docker.com/engine/storage/bind-mounts/).
