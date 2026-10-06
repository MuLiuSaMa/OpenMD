#!/usr/bin/env bash
set -Eeuo pipefail

root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)
mode=all
distro=all
usage() {
  echo 'Usage: bash tests/linux-packaging/run.sh [--distro all|ubuntu|fedora|opensuse] [--mode all|package|desktop]'
}
while (( $# )); do
  case "$1" in
    --distro) distro=${2:?Missing distribution}; shift 2 ;;
    --mode) mode=${2:?Missing mode}; shift 2 ;;
    --help|-h) usage; exit ;;
    *) usage >&2; exit 2 ;;
  esac
done
[[ "$mode" == all || "$mode" == package || "$mode" == desktop ]] || { usage >&2; exit 2; }
[[ "$distro" == all || "$distro" == ubuntu || "$distro" == fedora || "$distro" == opensuse ]] || { usage >&2; exit 2; }
docker version --format '{{.Server.Version}}' >/dev/null

run_dir="$root/artifacts/linux-packaging/$(date -u +%Y%m%dT%H%M%SZ)-$$"
mkdir -p "$run_dir"
git -C "$root" rev-parse HEAD > "$run_dir/commit.txt"
git -C "$root" diff > "$run_dir/source.diff"
docker version > "$run_dir/docker-version.txt"
cp "$root/src-tauri/tauri.conf.json" "$run_dir/tauri.conf.json"
echo "Evidence: $run_dir"

failed=0
distros=(ubuntu fedora opensuse)
[[ "$distro" == all ]] || distros=("$distro")
for target in "${distros[@]}"; do
  case "$target" in
    ubuntu) base=ubuntu:24.04; bundle=deb ;;
    fedora) base=fedora:44; bundle=rpm ;;
    opensuse) base=opensuse/leap:16.0; bundle=rpm ;;
  esac
  output="$run_dir/$target"
  mkdir -p "$output"
  echo "Checking $target ($base)"
  sha256sum "$root/tests/linux-packaging/"* > "$output/harness-sha256.txt"
  if ! docker pull --platform linux/amd64 "$base" > "$output/pull.log" 2>&1; then
    cat "$output/pull.log"
    echo 1 > "$output/infrastructure.status"
    failed=1
    continue
  fi
  resolved=$(docker image inspect "$base" --format '{{index .RepoDigests 0}}')
  echo "$resolved" > "$output/base-image.txt"
  if ! docker build --platform linux/amd64 --target clean \
      --build-arg "BASE_IMAGE=$resolved" --build-arg "DISTRO=$target" \
      -t "openmd-packaging:$target-clean" "$root/tests/linux-packaging" \
      > "$output/build-clean.log" 2>&1; then
    cat "$output/build-clean.log"
    echo 1 > "$output/infrastructure.status"
    failed=1
    continue
  fi
  echo 0 > "$output/infrastructure.status"
  mounts=(--mount "type=bind,src=$root/src-tauri/target/release/bundle/$bundle,dst=/packages,readonly"
          --mount "type=bind,src=$output,dst=/evidence"
          -e "HOST_UID=$(id -u)" -e "HOST_GID=$(id -g)")
  # A fresh minimal container ALWAYS installs first, even for --mode desktop.
  if ! docker run --rm --init --platform linux/amd64 "${mounts[@]}" \
      "openmd-packaging:$target-clean" package > "$output/package-console.log" 2>&1; then
    tail -40 "$output/package-console.log"
    failed=1
    continue
  fi
  echo "PASS: $target clean installation"
  if [[ "$mode" != package ]]; then
    if ! docker build --platform linux/amd64 --target desktop \
        --build-arg "BASE_IMAGE=$resolved" --build-arg "DISTRO=$target" \
        -t "openmd-packaging:$target-desktop" "$root/tests/linux-packaging" \
        > "$output/build-desktop.log" 2>&1; then
      cat "$output/build-desktop.log"
      echo 1 > "$output/infrastructure.status"
      failed=1
      continue
    fi
    docker image inspect "openmd-packaging:$target-desktop" > "$output/desktop-image.json"
    # Allow WebKit's own nested namespace sandbox; don't disable WebKit sandboxing.
    if ! docker run --rm --init --platform linux/amd64 \
        --shm-size=512m --pids-limit=512 --memory=3g --cpus=2 \
        --security-opt seccomp=unconfined --security-opt apparmor=unconfined \
        "${mounts[@]}" "openmd-packaging:$target-desktop" desktop > "$output/desktop-console.log" 2>&1; then
      tail -40 "$output/desktop-console.log"
      failed=1
    else
      echo "PASS: $target desktop workflow"
    fi
  fi
done
python3 - "$run_dir" <<'PY'
import json
import sys
from pathlib import Path

root = Path(sys.argv[1])
summary = {}
for distro in ('ubuntu', 'fedora', 'opensuse'):
    directory = root / distro
    if not directory.exists():
        continue
    phases = {}
    for phase in ('package', 'desktop', 'infrastructure'):
        status = directory / f'{phase}.status'
        phases[phase] = ('pass' if status.read_text().strip() == '0' else 'fail') if status.exists() else 'not run'
    workflow = directory / 'workflow.json'
    if workflow.exists():
        phases['workflow'] = json.loads(workflow.read_text())
    summary[distro] = phases
(root / 'summary.json').write_text(json.dumps(summary, indent=2) + '\n')
lines = ['# Linux package validation', '', f'Build commit: `{(root / "commit.txt").read_text().strip()}`; working changes are in `source.diff`.', '',
         '| Distribution | Clean installation | Desktop workflow | Infrastructure |',
         '| --- | --- | --- | --- |']
for distro, phases in summary.items():
    lines.append(f'| {distro} | {phases["package"]} | {phases["desktop"]} | {phases["infrastructure"]} |')
lines += ['', 'Desktop coverage: X11 / Xvfb, Openbox, Xfce StatusNotifier panel. See the per-distribution logs, screenshots, workflow JSON, and recording.', '']
(root / 'SUMMARY.md').write_text('\n'.join(lines))
print(json.dumps({distro: {key: value for key, value in phases.items() if key != 'workflow'} for distro, phases in summary.items()}, indent=2))
PY
echo "Evidence saved to: $run_dir"
exit "$failed"
