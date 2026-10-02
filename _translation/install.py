#!/usr/bin/env python3
import os
import platform
import re
import sys

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
GAME_ROOT = os.path.dirname(SCRIPT_DIR)


def find_executable(root):
    system = platform.system()
    try:
        entries = os.listdir(root)
    except OSError:
        return None

    if system == 'Darwin':
        for e in entries:
            if e.endswith('.app') and os.path.isdir(os.path.join(root, e)):
                return e
        return None

    # Linux / other: any regular, executable file that isn't one of our
    # own installer scripts.
    skip = {'install.sh', 'install_linux.sh', 'install_macos.sh', 'install.py'}
    for e in entries:
        if e in skip or e.startswith('.'):
            continue
        full = os.path.join(root, e)
        if os.path.isfile(full) and os.access(full, os.X_OK):
            return e
    return None


def find_engine_base(root):
    checks = [
        (root, 'js/rmmz_core.js', 'MZ'),
        (root, 'js/rpg_core.js', 'MV'),
        (os.path.join(root, 'www'), 'js/rmmz_core.js', 'MZ'),
        (os.path.join(root, 'www'), 'js/rpg_core.js', 'MV'),
    ]
    for base, rel, engine in checks:
        if os.path.isfile(os.path.join(base, rel)):
            return base, engine

    # Fallback: find the game executable, then infer layout.
    if find_executable(root):
        if os.path.isdir(os.path.join(root, 'www')):
            return os.path.join(root, 'www'), 'MV'
        elif os.path.isdir(os.path.join(root, 'js')):
            return root, 'MZ'

    return None, None


def find_top_level_objects(inner_text):
    """Returns (start, end) inclusive offsets, within inner_text, of every
    top-level {...} object — i.e. each plugin entry in the array. Brace/
    bracket depth is tracked while ignoring anything inside JSON string
    literals (including escaped quotes), so this is safe even if a
    plugin's own description or parameters contain {, }, [ or ]."""
    objects = []
    depth = 0
    in_string = False
    escaped = False
    obj_start = -1
    for i, ch in enumerate(inner_text):
        if in_string:
            if escaped:
                escaped = False
            elif ch == '\\':
                escaped = True
            elif ch == '"':
                in_string = False
            continue
        if ch == '"':
            in_string = True
            continue
        if ch in '{[':
            if depth == 0 and ch == '{':
                obj_start = i
            depth += 1
        elif ch in '}]':
            depth -= 1
            if depth == 0 and ch == '}' and obj_start >= 0:
                objects.append((obj_start, i))
                obj_start = -1
    return objects


def main():
    base, engine = find_engine_base(GAME_ROOT)
    if not base:
        print('Could not detect an RPG Maker MV or MZ game next to this folder.')
        print('Make sure "_translation" sits in the same directory as the game executable.')
        input('Press Enter to exit')
        sys.exit(1)

    print(f'Detected RPG Maker {engine} game at: {base}')

    plugins_dir = os.path.join(base, 'js', 'plugins')
    plugins_js = os.path.join(base, 'js', 'plugins.js')
    plugin_file = os.path.join(plugins_dir, 'Translation.js')
    src_plugin = os.path.join(SCRIPT_DIR, 'Translation.js')
    backup_file = os.path.join(base, 'js', 'plugins.js.bak')

    if not os.path.isfile(plugins_js):
        print('js/plugins.js not found. This does not look like a valid game folder.')
        input('Press Enter to exit')
        sys.exit(1)

    with open(plugins_js, 'r', encoding='utf-8') as f:
        raw = f.read()

    start_idx = raw.find('[')
    end_idx = raw.rfind(']')
    if start_idx == -1 or end_idx < start_idx:
        raise ValueError('Could not find the plugin list inside js/plugins.js.')

    inner_text = raw[start_idx + 1:end_idx]
    objects = find_top_level_objects(inner_text)

    our_obj = None
    for (s, e) in objects:
        text = inner_text[s:e + 1]
        if re.search(r'"name"\s*:\s*"Translation"', text):
            our_obj = (s, e)
            break

    # One-time backup of the pristine file, made before this plugin ever
    # touches it. Never overwritten, so it's always a safe restore point.
    if not os.path.isfile(backup_file):
        with open(plugins_js, 'rb') as fsrc, open(backup_file, 'wb') as fdst:
            fdst.write(fsrc.read())

    if our_obj:
        print('\nTranslation plugin is currently INSTALLED.')
        answer = input('Uninstall it? (y/n) ').strip().lower()
        if answer == 'y':
            abs_start = start_idx + 1 + our_obj[0]
            abs_end = start_idx + 1 + our_obj[1]

            after = abs_end + 1
            while after < len(raw) and raw[after].isspace():
                after += 1
            if after < len(raw) and raw[after] == ',':
                remove_start, remove_end = abs_start, after
            else:
                before = abs_start - 1
                while before >= 0 and raw[before].isspace():
                    before -= 1
                if before >= 0 and raw[before] == ',':
                    remove_start = before
                else:
                    remove_start = abs_start
                remove_end = abs_end

            new_raw = raw[:remove_start] + raw[remove_end + 1:]
            with open(plugins_js, 'w', encoding='utf-8') as f:
                f.write(new_raw)
            if os.path.isfile(plugin_file):
                os.remove(plugin_file)
            print('Translation plugin uninstalled.')
        else:
            print('Cancelled.')
    else:
        print('\nTranslation plugin is NOT installed.')
        answer = input('Install it now? (y/n) ').strip().lower()
        if answer == 'y':
            os.makedirs(plugins_dir, exist_ok=True)
            with open(src_plugin, 'rb') as fsrc, open(plugin_file, 'wb') as fdst:
                fdst.write(fsrc.read())

            entry_json = '{"name":"Translation","status":true,"description":"Soft translation loader","parameters":{}}'

            if objects:
                last_end = objects[-1][1]
                insert_pos = start_idx + 1 + last_end + 1
                insert_text = ',\n' + entry_json
            else:
                insert_pos = start_idx + 1
                insert_text = '\n' + entry_json + '\n'

            new_raw = raw[:insert_pos] + insert_text + raw[insert_pos:]
            with open(plugins_js, 'w', encoding='utf-8') as f:
                f.write(new_raw)
            print('Translation plugin installed. Launch the game to see translated text.')
        else:
            print('Cancelled.')

    input('Press Enter to exit')


if __name__ == '__main__':
    try:
        main()
    except SystemExit:
        raise
    except Exception:
        import traceback
        print()
        print('ERROR:')
        traceback.print_exc()
        input('Press Enter to exit')
