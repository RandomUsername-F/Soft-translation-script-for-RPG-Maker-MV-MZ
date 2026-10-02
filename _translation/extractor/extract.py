#!/usr/bin/env python3
"""
Extracts translatable text from an RPG Maker MV/MZ game's "data" folder
(and, optionally, js/plugins) and saves it into this extractor folder as
a JSON file named after _translation/config.ini's "file" key (e.g.
translation.json) — never into the file the game actually loads.

If that file already exists here, you're asked whether to overwrite it;
nothing is merged or appended automatically.
"""
import json
import os
import re
import sys

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
TRANS_DIR = os.path.dirname(SCRIPT_DIR)   # _translation
GAME_ROOT = os.path.dirname(TRANS_DIR)    # folder next to the game exe


def find_base(root):
    # Same layout heuristic as the installer: flattened MZ (or flattened
    # MV), or an MV game packaged with a "www" subfolder.
    for base in (root, os.path.join(root, 'www')):
        if os.path.isdir(os.path.join(base, 'data')):
            return base
    return None


def load_config():
    defaults = {'file': 'translation.json'}
    cfg_path = os.path.join(TRANS_DIR, 'config.ini')
    if not os.path.isfile(cfg_path):
        return defaults
    cfg = dict(defaults)
    with open(cfg_path, 'r', encoding='utf-8') as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith((';', '#', '[')):
                continue
            if '=' not in line:
                continue
            k, v = line.split('=', 1)
            cfg[k.strip()] = v.strip()
    return cfg


# --------------------------------------------------------------------
# Text Helpers & Filtering
# --------------------------------------------------------------------

STRING_RE = re.compile(r"'((?:\\.|[^'\\])*)'|\"((?:\\.|[^\"\\])*)\"")

SKIP_KEYS = {
    'bgm', 'bgs', 'me', 'se', 'audio',
    'faceName', 'characterName', 'battlerName', 'panoramicName',
    'title1Name', 'title2Name', 'graphic', 'image', 'iconIndex', 'color',
    'id', 'code', 'switchId', 'variableId', 'animationId',
    'position', 'positionType', 'background', 'speed', 'type', 'blendMode'
}


def add_text(collected, s):
    if isinstance(s, str) and s.strip() != '':
        collected.setdefault(s, s)


def unescape_js(s):
    return (s.replace('\\n', '\n').replace('\\t', '\t')
             .replace("\\'", "'").replace('\\"', '"').replace('\\\\', '\\'))


def is_likely_translatable(s):
    if not isinstance(s, str):
        return False
    t = s.strip()
    if not t:
        return False

    # Pure numeric / percentage values (e.g., "123", "-4.5", "100%")
    if re.match(r'^-?\d+(\.\d+)?%?$', t):
        return False

    # Boolean and null keywords
    if t in {'true', 'false', 'null', 'undefined', 'NaN', 'Infinity'}:
        return False

    # Hex colors (e.g., #fff, #1a2b3c)
    if re.match(r'^#[0-9A-Fa-f]{3,8}$', t):
        return False

    # Asset filenames or code files ending with common extensions
    if re.search(r'\.(png|jpe?g|gif|webp|json|js|ogg|m4a|wav|mp3|ttf|otf|css|html)$', t, re.IGNORECASE):
        return False

    # Pure system file paths (e.g. /usr/bin or ./path)
    if re.match(r'^[\\/][\w./\\-]*$', t):
        return False

    # Standalone kebab-case CSS classes/identifiers without spaces
    if re.match(r'^[a-z0-9]+(-[a-z0-9]+)+$', t) and ' ' not in t:
        return False

    return True


def is_js_code_snippet(s):
    """Check if a string represents a JS expression/script snippet rather than display text."""
    if s.startswith('javascript:'):
        return True
    if re.search(r'(\$game|\$data|var\s+|let\s+|const\s+|function\s*\(|return\s+|this\.|Input\.|TouchInput\.)', s):
        return True
    return False


def extract_string_content(collected, s):
    if not isinstance(s, str):
        return
    val_str = s.strip()
    if not val_str:
        return

    # Case 1: Embedded JSON string (frequent in RPG Maker MZ plugin parameters)
    if (val_str.startswith('{') and val_str.endswith('}')) or \
       (val_str.startswith('[') and val_str.endswith(']')):
        try:
            parsed = json.loads(val_str)
            extract_json_recursive(collected, parsed)
            return
        except Exception:
            pass

    # Case 2: Code snippet containing quoted string literals
    if is_js_code_snippet(val_str):
        matches = list(STRING_RE.finditer(val_str))
        if matches:
            for m in matches:
                raw = m.group(1) if m.group(1) is not None else m.group(2)
                if raw:
                    extract_string_content(collected, unescape_js(raw))
            return

    # Case 3: Raw display text string
    if is_likely_translatable(val_str):
        add_text(collected, val_str)


# --------------------------------------------------------------------
# data/*.json recursive extraction
# --------------------------------------------------------------------

def extract_event_list(collected, event_list):
    if not isinstance(event_list, list):
        return
    for cmd in event_list:
        if not isinstance(cmd, dict):
            continue
        code = cmd.get('code')
        params = cmd.get('parameters') or []

        # Handle specific known RPG Maker event command structures
        if code in (401, 405):  # Show Text, Scroll Text
            if params and isinstance(params[0], str):
                add_text(collected, params[0])
        elif code == 101:  # Show Text Header (MZ speaker name in params[4])
            if len(params) >= 5 and isinstance(params[4], str):
                extract_string_content(collected, params[4])
        elif code == 102:  # Show Choices
            if params and isinstance(params[0], list):
                for choice in params[0]:
                    if isinstance(choice, str):
                        add_text(collected, choice)
        elif code in (108, 408):  # Comments (often contain plugin dialogue or text tags)
            if params and isinstance(params[0], str):
                extract_string_content(collected, params[0])
        elif code in (320, 324, 325):  # Change Actor Name / Nickname / Profile
            if len(params) >= 2 and isinstance(params[1], str):
                add_text(collected, params[1])
        elif code == 122:  # Control Variables
            if len(params) >= 5:
                extract_string_content(collected, params[4])
        elif code in (355, 655):  # Script lines
            if params and isinstance(params[0], str):
                extract_string_content(collected, params[0])
        elif code == 356:  # Plugin Command (MV)
            if params and isinstance(params[0], str):
                extract_string_content(collected, params[0])
        elif code == 357:  # Plugin Command (MZ)
            if len(params) >= 4:
                extract_json_recursive(collected, params[3])
        else:
            # For any other command, recursively inspect all parameters
            for p in params:
                extract_json_recursive(collected, p)


def extract_json_recursive(collected, data):
    if isinstance(data, dict):
        # If object contains an event command list, parse it through event extractor
        if 'list' in data and isinstance(data['list'], list):
            extract_event_list(collected, data['list'])

        for key, val in data.items():
            if key == 'list':
                continue
            if key in SKIP_KEYS:
                continue
            extract_json_recursive(collected, val)

    elif isinstance(data, list):
        for item in data:
            extract_json_recursive(collected, item)

    elif isinstance(data, str):
        extract_string_content(collected, data)


def scan_data_folder(collected, data_dir):
    for root, dirs, files in os.walk(data_dir):
        for fname in sorted(files):
            if not fname.lower().endswith('.json'):
                continue
            fpath = os.path.join(root, fname)
            try:
                with open(fpath, 'r', encoding='utf-8') as f:
                    data = json.load(f)
            except Exception as e:
                print(f'  Skipped {fname}: {e}')
                continue
            extract_json_recursive(collected, data)


# --------------------------------------------------------------------
# js/plugins/*.js extraction (optional, heuristic, best-effort)
# --------------------------------------------------------------------

def prune_against_common_terms(json_path, common_terms_path):
    """Remove entries whose original-text key exists in commonTerms.json."""
    with open(common_terms_path, 'r', encoding='utf-8') as f:
        common_terms = json.load(f)

    if not isinstance(common_terms, dict):
        raise ValueError('commonTerms.json must contain a JSON object.')

    with open(json_path, 'r', encoding='utf-8') as f:
        extracted = json.load(f)

    if not isinstance(extracted, dict):
        raise ValueError('The extracted JSON must contain a JSON object.')

    original_count = len(extracted)
    for key in common_terms:
        extracted.pop(key, None)

    removed_count = original_count - len(extracted)

    with open(json_path, 'w', encoding='utf-8') as f:
        json.dump(extracted, f, ensure_ascii=False, indent=4)
        f.write('\n')

    return removed_count, len(extracted)


def scan_plugins_folder(collected, plugins_dir):
    for fname in sorted(os.listdir(plugins_dir)):
        if not fname.lower().endswith('.js'):
            continue
        fpath = os.path.join(plugins_dir, fname)
        try:
            with open(fpath, 'r', encoding='utf-8') as f:
                src = f.read()
        except Exception as e:
            print(f'  Skipped {fname}: {e}')
            continue
        for m in STRING_RE.finditer(src):
            raw = m.group(1) if m.group(1) is not None else m.group(2)
            s = unescape_js(raw)
            if is_likely_translatable(s):
                add_text(collected, s)


# --------------------------------------------------------------------
# main
# --------------------------------------------------------------------

def main():
    base = find_base(GAME_ROOT)
    if not base:
        print('Could not find a "data" folder next to this game.')
        print("Make sure _translation sits in the game's main directory.")
        input('Press Enter to exit')
        sys.exit(1)

    data_dir = os.path.join(base, 'data')
    plugins_dir = os.path.join(base, 'js', 'plugins')

    print(f'Game data found at: {data_dir}')
    print('')
    print('What should be scanned?')
    print('  1) data folder only')
    print('  2) data folder + js/plugins(best guess)')
    choice = input('Select an option (1/2): ').strip()
    scan_plugins = (choice == '2')

    collected = {}

    print('Scanning data folder...')
    scan_data_folder(collected, data_dir)

    if scan_plugins:
        if os.path.isdir(plugins_dir):
            print('Scanning js/plugins...')
            scan_plugins_folder(collected, plugins_dir)
        else:
            print('js/plugins folder not found, skipping.')

    config = load_config()
    out_path = os.path.join(SCRIPT_DIR, config['file'])

    if os.path.isfile(out_path):
        print('')
        print(f'{config["file"]} already exists in the extractor folder.')
        print('  1) Overwrite it')
        print('  2) Cancel')
        choice2 = input('Select an option (1/2): ').strip()
        if choice2 != '1':
            print('Cancelled. Nothing was written.')
            input('Press Enter to exit')
            return

    with open(out_path, 'w', encoding='utf-8') as f:
        json.dump(collected, f, ensure_ascii=False, indent=4)
        f.write('\n')

    print('')
    print(f'Found {len(collected)} unique strings.')
    print(f'Saved to: {out_path}')

    common_terms_path = os.path.join(TRANS_DIR, 'commonTerms.json')
    if os.path.isfile(common_terms_path):
        print('')
        prune_choice = input('Prune the extracted file against commonTerms.json? (y/n): ').strip().lower()
        if prune_choice in ('y', 'yes'):
            try:
                removed_count, remaining_count = prune_against_common_terms(
                    out_path, common_terms_path
                )
                print(f'Pruned {removed_count} strings already present in commonTerms.json.')
                print(f'{remaining_count} strings remain.')
            except Exception as e:
                print(f'Could not prune the file: {e}')
        elif prune_choice not in ('n', 'no', ''):
            print('Invalid choice; pruning skipped.')
    else:
        print('')
        print(f'commonTerms.json not found at: {common_terms_path}')
        print('Pruning skipped.')

    if scan_plugins:
        print('Note: js/plugins text is found heuristically and may include some')
        print('false positives (code, not player-facing text) - please review.')

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