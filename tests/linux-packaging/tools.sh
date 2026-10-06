#!/usr/bin/env bash
set -Eeuo pipefail
export LC_ALL=C.UTF-8
case "$TEST_DISTRO" in
  ubuntu)
    apt-get update
    DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
      xvfb dbus-x11 openbox xfce4-panel xdotool python3 python3-pyatspi \
      python3-dbus python3-gi at-spi2-core ffmpeg fonts-dejavu-core procps util-linux
    ;;
  fedora)
    dnf install -y --setopt=install_weak_deps=False \
      xorg-x11-server-Xvfb dbus-daemon dbus-x11 openbox xfce4-panel xdotool \
      python3 python3-pyatspi python3-dbus python3-gobject gobject-introspection at-spi2-core \
      ffmpeg-free dejavu-sans-fonts procps-ng util-linux
    ;;
  opensuse)
    zypper --non-interactive --gpg-auto-import-keys refresh
    zypper --non-interactive install --no-recommends \
      xorg-x11-server-Xvfb dbus-1-x11 dbus-1-daemon openbox xfce4-panel xdotool \
      python3 python313-atspi python313-dbus-python python313-gobject \
      at-spi2-core ffmpeg-4 dejavu-fonts procps util-linux
    ;;
  *) echo "Unknown distribution: $TEST_DISTRO" >&2; exit 2 ;;
esac
useradd --create-home --shell /bin/bash tester
command -v dbus-run-session
python3 -c 'import dbus; import pyatspi'
ffmpeg -hide_banner -encoders > /tmp/recording-encoders.txt 2>&1
grep 'libvpx ' /tmp/recording-encoders.txt
