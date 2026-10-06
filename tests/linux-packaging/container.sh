#!/usr/bin/env bash
set -Eeuo pipefail

mode=${1:?Expected package or desktop}
export LC_ALL=C.UTF-8
[[ "$mode" == package || "$mode" == desktop ]] || exit 2
mkdir -p /evidence
exec > >(tee "/evidence/$mode.log") 2>&1
finish() {
  local status=$?
  printf '%s\n' "$status" > "/evidence/$mode.status"
  chown -R "${HOST_UID:-1000}:${HOST_GID:-1000}" /evidence
  exit "$status"
}
trap finish EXIT

set -x
cat /etc/os-release | tee /evidence/os-release.txt
uname -a | tee /evidence/kernel.txt
if [[ "$TEST_DISTRO" == ubuntu ]]; then
  packages=(/packages/*.deb)
  [[ ${#packages[@]} == 1 && -f "${packages[0]}" ]]
  package=${packages[0]}
  dpkg-query -W > "/evidence/$mode-packages-before.txt"
  dpkg-deb -I "$package" | tee /evidence/dpkg-deb-I.txt
  dpkg-deb -c "$package" > /evidence/package-files.txt
  sha256sum "$package" | tee /evidence/package-sha256.txt
  apt-get update
  DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends "$package"
  dpkg-query -W > "/evidence/$mode-packages-after.txt"
else
  packages=(/packages/*.rpm)
  [[ ${#packages[@]} == 1 && -f "${packages[0]}" ]]
  package=${packages[0]}
  rpm -qa | sort > "/evidence/$mode-packages-before.txt"
  rpm -qpR "$package" | tee /evidence/rpm-qpR.txt
  rpm -qpl "$package" > /evidence/package-files.txt
  sha256sum "$package" | tee /evidence/package-sha256.txt
  if [[ "$TEST_DISTRO" == fedora ]]; then
    dnf install -y --setopt=install_weak_deps=False "$package"
  else
    zypper --non-interactive --gpg-auto-import-keys refresh
    zypper --non-interactive install --no-recommends --allow-unsigned-rpm "$package"
  fi
  rpm -qa | sort > "/evidence/$mode-packages-after.txt"
fi

ldd /usr/bin/openmd | tee "/evidence/$mode-ldd.txt"
if grep -q 'not found' "/evidence/$mode-ldd.txt"; then
  echo 'FAIL: unresolved executable dependencies'
  exit 1
fi
# AppIndicator is loaded with dlopen, so ldd alone cannot check it.
ldconfig -p | tee "/evidence/$mode-library-cache.txt" >/dev/null
grep -F 'libayatana-appindicator3.so.1' "/evidence/$mode-library-cache.txt"
if [[ "$TEST_DISTRO" == ubuntu || "$TEST_DISTRO" == fedora ]]; then
  test -s /etc/ssl/certs/ca-certificates.crt
else
  test -s /etc/pki/tls/certs/ca-bundle.crt || test -s /etc/ssl/ca-bundle.pem
fi

if [[ "$mode" == desktop ]]; then
  chown -R tester:tester /evidence
  install -d -o tester -g tester -m 700 /home/tester/runtime
  timeout --signal=TERM --kill-after=10s 180s \
    runuser -u tester -- env DISPLAY=:99 LANG=C.UTF-8 LANGUAGE=en \
      XDG_RUNTIME_DIR=/home/tester/runtime GTK_A11Y=always NO_AT_BRIDGE=0 \
      GDK_BACKEND=x11 LIBGL_ALWAYS_SOFTWARE=1 WEBKIT_DISABLE_DMABUF_RENDERER=1 \
      dbus-run-session -- bash /opt/linux-packaging/desktop.sh
  test -s /evidence/workflow.webm
  ffprobe -v error -show_entries stream=codec_name,width,height \
    -of json /evidence/workflow.webm > /evidence/recording-info.json
fi
echo "PASS: $TEST_DISTRO $mode"
