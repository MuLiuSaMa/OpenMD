#!/usr/bin/env python3
"""Exercise installed OpenMD through desktop accessibility and its visible tray menu."""
import json
import os
import subprocess
import time
import traceback
from pathlib import Path

import dbus
import pyatspi

EVIDENCE = Path('/evidence')
RESULTS = {'desktop': 'Openbox + Xfce StatusNotifier panel', 'session': 'X11 / Xvfb', 'checks': []}
APP = None


def command(*args, check=True):
    return subprocess.run(args, text=True, capture_output=True, timeout=10, check=check)


def wait_for(description, predicate, timeout=25, allow_exit=False):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if APP is not None and APP.poll() is not None and not allow_exit:
            raise RuntimeError(f'OpenMD exited with {APP.returncode} while waiting for {description}')
        result = predicate()
        if result:
            return result
        time.sleep(0.3)
    raise TimeoutError(f'Timed out waiting for {description}')


def nodes():
    pending = [pyatspi.Registry.getDesktop(0)]
    visited = 0
    while pending and visited < 3000:
        node = pending.pop()
        visited += 1
        try:
            yield node
            pending.extend(reversed(list(node)))
        except Exception:
            continue


def find_named(name, role=None):
    for node in nodes():
        try:
            if node.name == name and (role is None or node.getRoleName() == role):
                return node
        except Exception:
            continue
    return None


def click_named(name):
    node = wait_for(f'accessible control {name!r}', lambda: find_named(name))
    action = node.queryAction()
    if not action.nActions or not action.doAction(0):
        raise RuntimeError(f'Could not activate {name!r}')


def screenshot(name):
    command('ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-threads', '1',
            '-f', 'x11grab', '-video_size', '1280x900', '-i', os.environ['DISPLAY'],
            '-frames:v', '1', '-update', '1', str(EVIDENCE / f'{name}.png'))


def pixels(crop):
    return subprocess.run(
        ['ffmpeg', '-hide_banner', '-loglevel', 'error', '-threads', '1',
         '-f', 'x11grab', '-video_size', '1280x900', '-i', os.environ['DISPLAY'],
         '-frames:v', '1', '-vf', f'crop={crop}', '-pix_fmt', 'rgb24',
         '-f', 'rawvideo', 'pipe:1'], capture_output=True, timeout=10, check=True).stdout


def painted_content():
    # Inspect a content region away from the panel, window border, and pointer.
    frame = pixels('800:300:160:100')
    return len({frame[i:i+3] for i in range(0, len(frame), 3)}) >= 16


def dump_tree(name):
    lines = []
    for node in nodes():
        try:
            lines.append(f'{node.getRoleName()}: {node.name!r}')
        except Exception:
            pass
    (EVIDENCE / name).write_text('\n'.join(lines))


def window_ids(visible=False):
    args = ['xdotool', 'search']
    if visible:
        args.append('--onlyvisible')
    args.extend(['--pid', str(APP.pid)])
    return command(*args, check=False).stdout.split()


def main_window():
    for window in window_ids():
        geometry = command('xdotool', 'getwindowgeometry', '--shell', window, check=False)
        values = dict(line.split('=', 1) for line in geometry.stdout.splitlines() if '=' in line)
        if int(values.get('WIDTH', 0)) >= 640 and int(values.get('HEIGHT', 0)) >= 480:
            return window
    return None


def check(name, details=None):
    RESULTS['checks'].append({'name': name, 'status': 'pass', 'details': details})
    print(f'PASS: {name}', flush=True)


def tray_item(bus):
    watcher = bus.get_object('org.kde.StatusNotifierWatcher', '/StatusNotifierWatcher')
    properties = dbus.Interface(watcher, 'org.freedesktop.DBus.Properties')
    if not properties.Get('org.kde.StatusNotifierWatcher', 'IsStatusNotifierHostRegistered'):
        return None
    for item in properties.Get('org.kde.StatusNotifierWatcher', 'RegisteredStatusNotifierItems'):
        service, separator, path = str(item).partition('/')
        path = '/' + path if separator else '/StatusNotifierItem'
        connection_pid = bus.call_blocking('org.freedesktop.DBus', '/org/freedesktop/DBus',
                                          'org.freedesktop.DBus', 'GetConnectionUnixProcessID',
                                          's', (service,))
        if int(connection_pid) == APP.pid:
            obj = bus.get_object(service, path)
            menu_path = str(dbus.Interface(obj, 'org.freedesktop.DBus.Properties').Get(
                'org.kde.StatusNotifierItem', 'Menu'))
            menu = dbus.Interface(bus.get_object(service, menu_path), 'com.canonical.dbusmenu')
            return service, path, menu
    return None


def registered_tray(bus):
    try:
        return tray_item(bus)
    except dbus.DBusException:
        return None


def tray_menu(action):
    # The panel contains only one tray plugin. Prefer its accessible icon location.
    x, y = 18, 18
    for node in nodes():
        try:
            if 'OpenMD' in node.name and node.getRoleName() in ('push button', 'icon'):
                bounds = node.queryComponent().getExtents(pyatspi.DESKTOP_COORDS)
                if 0 <= bounds.y < 40 and bounds.width > 0:
                    x, y = bounds.x + bounds.width // 2, bounds.y + bounds.height // 2
                    break
        except Exception:
            continue
    before = pixels('300:150:0:36')
    command('xdotool', 'mousemove', str(x), str(y), 'click', '3')

    def popup_visible():
        after = pixels('300:150:0:36')
        return sum(before[i:i+3] != after[i:i+3] for i in range(0, len(before), 3)) > 2000

    # Xfce's external tray wrapper does not expose popup menu items to AT-SPI.
    # Verify the painted popup, then use its normal keyboard navigation.
    wait_for(f'visible tray menu for {action}', popup_visible)
    screenshot('tray-menu-' + action.lower().replace(' ', '-'))
    command('xdotool', 'key', '--clearmodifiers',
            'Home' if action == 'Show Main Window' else 'End', 'Return')


def run():
    global APP
    fixture = Path.home() / 'packaging-check.md'
    fixture.write_text('# Linux packaging verification\n\nInstalled package rendering works.\n')
    with (EVIDENCE / 'launch.log').open('w') as log:
        APP = subprocess.Popen(['/usr/bin/openmd', str(fixture)], stdout=log, stderr=subprocess.STDOUT)
        window = wait_for('main application window', main_window)
        wait_for('visible application window', lambda: window in window_ids(visible=True))
        command('xdotool', 'windowactivate', '--sync', window)
        wait_for('rendered Markdown heading', lambda: find_named('Linux packaging verification'))
        wait_for('painted WebKit content', painted_content)
        screenshot('01-launched')
        dump_tree('accessibility-launched.txt')
        check('launch and render Markdown', {'pid': APP.pid, 'window': window})

        bus = dbus.SessionBus()
        service, path, menu = wait_for('registered tray icon and tray host', lambda: registered_tray(bus))
        layout = menu.GetLayout(0, -1, ['label', 'visible', 'enabled'])
        (EVIDENCE / 'tray-layout.txt').write_text(str(layout))
        labels = [str(child[1].get('label', '')) for child in layout[1][2]
                  if child[1].get('visible', True) and child[1].get('enabled', True)]
        if not labels or labels[0] != 'Show Main Window' or labels[-1] != 'Quit':
            raise RuntimeError(f'Unexpected tray menu action order: {labels}')
        check('tray registered with desktop host', {'service': service, 'path': path})

        click_named('Minimize')
        wait_for('minimized window', lambda: window not in window_ids(visible=True))
        screenshot('02-minimized')
        check('minimize retains process')
        tray_menu('Show Main Window')
        wait_for('restored minimized window', lambda: window in window_ids(visible=True))
        check('restore minimized window through tray menu')

        command('xdotool', 'windowactivate', '--sync', window)
        command('xdotool', 'key', '--clearmodifiers', 'alt+F4')
        wait_for('close dialog', lambda: find_named('Hide to tray'))
        screenshot('03-close-dialog')
        click_named('Hide to tray')
        wait_for('hidden window', lambda: window not in window_ids(visible=True))
        if APP.poll() is not None or not registered_tray(bus):
            raise RuntimeError('App or tray disappeared after Hide to tray')
        screenshot('04-hidden-to-tray')
        check('hide to tray retains process and registered icon')

        tray_menu('Show Main Window')
        wait_for('restored hidden window', lambda: window in window_ids(visible=True))
        screenshot('05-restored')
        check('restore hidden window through tray menu')

        tray_menu('Quit')
        wait_for('application exit', lambda: APP.poll() is not None, allow_exit=True)
        if APP.returncode != 0:
            raise RuntimeError(f'Quit exited with code {APP.returncode}')
        wait_for('window removed', lambda: not window_ids(), allow_exit=True)
        wait_for('tray unregistered', lambda: not registered_tray(bus), allow_exit=True)
        screenshot('06-exited')
        check('quit through tray menu exits successfully and removes window/icon')


if __name__ == '__main__':
    try:
        run()
        RESULTS['status'] = 'pass'
    except Exception:
        RESULTS['status'] = 'fail'
        RESULTS['error'] = traceback.format_exc()
        print(RESULTS['error'], flush=True)
        try:
            screenshot('failure')
            dump_tree('accessibility-failure.txt')
        except Exception:
            traceback.print_exc()
    finally:
        (EVIDENCE / 'workflow.json').write_text(json.dumps(RESULTS, indent=2) + '\n')
        if APP is not None and APP.poll() is None:
            APP.terminate()
    raise SystemExit(0 if RESULTS['status'] == 'pass' else 1)
