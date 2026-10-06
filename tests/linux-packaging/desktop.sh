#!/usr/bin/env bash
set -Eeuo pipefail
export XDG_CURRENT_DESKTOP=XFCE XDG_SESSION_TYPE=x11
export XDG_CONFIG_HOME="$HOME/.config" XDG_CACHE_HOME="$HOME/.cache"
mkdir -p "$XDG_CONFIG_HOME/xfce4/xfconf/xfce-perchannel-xml"
# A deterministic panel containing the actual StatusNotifier tray host.
cat > "$XDG_CONFIG_HOME/xfce4/xfconf/xfce-perchannel-xml/xfce4-panel.xml" <<'XML'
<?xml version="1.0" encoding="UTF-8"?>
<channel name="xfce4-panel" version="1.0">
  <property name="configver" type="int" value="2"/>
  <property name="panels" type="array">
    <value type="int" value="1"/>
    <property name="panel-1" type="empty">
      <property name="position" type="string" value="p=6;x=640;y=18"/>
      <property name="position-locked" type="bool" value="true"/>
      <property name="size" type="uint" value="36"/>
      <property name="length" type="uint" value="100"/>
      <property name="plugin-ids" type="array"><value type="int" value="1"/></property>
    </property>
  </property>
  <property name="plugins" type="empty">
    <property name="plugin-1" type="string" value="systray">
      <property name="icon-size" type="uint" value="24"/>
      <property name="square-icons" type="bool" value="true"/>
    </property>
  </property>
</channel>
XML

cleanup() {
  local status=$?
  trap - EXIT
  # SIGINT lets FFmpeg finalize the recording before its container exits.
  if [[ -n ${recorder_pid:-} ]]; then
    kill -INT "$recorder_pid" 2>/dev/null || true
    wait "$recorder_pid" || true
  fi
  for pid in ${panel_pid:-} ${wm_pid:-} ${display_pid:-}; do
    kill "$pid" 2>/dev/null || true
  done
  exit "$status"
}
trap cleanup EXIT
Xvfb :99 -screen 0 1280x900x24 -nolisten tcp > /evidence/xvfb.log 2>&1 &
display_pid=$!
for attempt in {1..40}; do
  if xdotool getdisplaygeometry >/dev/null 2>&1; then break; fi
  sleep 0.25
done
xdotool getdisplaygeometry
openbox > /evidence/window-manager.log 2>&1 &
wm_pid=$!
xfce4-panel --disable-wm-check > /evidence/panel.log 2>&1 &
panel_pid=$!
ffmpeg -hide_banner -loglevel warning -y -threads 1 \
  -f x11grab -framerate 8 -video_size 1280x900 -i :99 \
  -c:v libvpx -deadline realtime -cpu-used 8 -b:v 1M \
  /evidence/workflow.webm > /evidence/recording.log 2>&1 &
recorder_pid=$!
python3 /opt/linux-packaging/workflow.py
