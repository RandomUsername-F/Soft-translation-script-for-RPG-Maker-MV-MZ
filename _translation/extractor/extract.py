#!/usr/bin/env python3
"""
Extracts translatable text from an RPG Maker MV/MZ game's "data" folder
(and, optionally, js/plugins) and saves it into this extractor folder as
a JSON file named textForTranslation.json — never into the file the game
actually loads.

If that file already exists here, you're asked whether to overwrite it;
nothing is merged or appended automatically.

A separate text-processing menu prunes the extracted file in place. All
pruning works on whole JSON entries (keys), so the file stays valid JSON.
"""
import json
import os
import re
import sys
import unicodedata

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

    # Plugin command with a JSON argument object, e.g. `Name = {"id":"18",...}`
    if re.match(r'^\S+(\s*=\s*|\s+)\{\s*"[^"]*"\s*:.*\}\s*$', t, re.DOTALL):
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

OUTPUT_NAME = 'textForTranslation.json'

# Japanese: CJK ideographs, hiragana, katakana, half-width katakana.
# Equivalent to the requested ^[^\u4E00-\u9FFF\u3040-\u309F\u30A0-\u30FF\uFF65-\uFF9F]*\n
# applied to a whole entry: an entry with no Japanese character is removed.
JP_RE = re.compile(r'[\u4E00-\u9FFF\u3040-\u309F\u30A0-\u30FF\uFF65-\uFF9F]')


def load_dict(path):
    with open(path, 'r', encoding='utf-8') as f:
        data = json.load(f)
    if not isinstance(data, dict):
        raise ValueError(f'{os.path.basename(path)} must contain a JSON object.')
    return data


def save_dict(path, data):
    # Write to a temp file first so a failure can't leave a broken JSON file.
    tmp = path + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=4)
        f.write('\n')
    os.replace(tmp, path)


def prune_entries(json_path, should_remove):
    """Remove entries whose key satisfies should_remove(key). Returns (removed, remaining)."""
    data = load_dict(json_path)
    kept = {k: v for k, v in data.items() if not should_remove(k)}
    removed = len(data) - len(kept)
    save_dict(json_path, kept)
    return removed, len(kept)


def is_symbols_only(s):
    """True if every character is a symbol, punctuation, whitespace, control,
    or emoji-support character (ZWJ, variation selectors). Covers Unicode and
    the Unicode equivalents of S-JIS symbols (○●★※→ etc.). Letters, digits and
    kana/kanji (incl. the long-vowel mark ー) count as text."""
    for ch in s:
        cat = unicodedata.category(ch)
        if cat[0] in 'PSZC' or cat in ('Mn', 'Me'):
            continue
        return False
    return True


def load_key_set(path):
    return set(load_dict(path).keys())


def iter_js_strings(src):
    """Yield raw string-literal bodies from JS source, skipping // and /* */ comments."""
    i, n = 0, len(src)
    while i < n:
        c = src[i]
        nxt = src[i + 1] if i + 1 < n else ''
        if c == '/' and nxt == '*':
            j = src.find('*/', i + 2)
            i = n if j == -1 else j + 2
        elif c == '/' and nxt == '/':
            j = src.find('\n', i)
            i = n if j == -1 else j + 1
        elif c in '\'"`':
            j = i + 1
            while j < n and src[j] != c:
                if src[j] == '\\':
                    j += 2
                elif src[j] == '\n' and c != '`':
                    break  # unterminated (e.g. regex literal); resync
                else:
                    j += 1
            yield src[i + 1:j]
            i = j + 1
        else:
            i += 1


def add_plugin_text(collected, s):
    # Plugin scans only keep Japanese, non-code text.
    if JP_RE.search(s) and is_likely_translatable(s):
        add_text(collected, s.strip())


def extract_plugin_param(collected, val):
    """Parameter values only (never keys/descriptions, which are editor-only).
    Unwraps nested JSON strings; code snippets contribute only their literals."""
    if isinstance(val, dict):
        for v in val.values():
            extract_plugin_param(collected, v)
    elif isinstance(val, list):
        for v in val:
            extract_plugin_param(collected, v)
    elif isinstance(val, str):
        s = val.strip()
        if not s:
            return
        if s[0] in '[{':
            try:
                parsed = json.loads(s)
            except Exception:
                parsed = None
            if isinstance(parsed, (dict, list)):
                extract_plugin_param(collected, parsed)
                return
        if is_js_code_snippet(s):
            for m in STRING_RE.finditer(s):
                raw = m.group(1) if m.group(1) is not None else m.group(2)
                if raw:
                    add_plugin_text(collected, unescape_js(raw))
            return
        add_plugin_text(collected, s)


def load_plugins_js(path):
    """Return the parsed $plugins list, or None."""
    try:
        with open(path, 'r', encoding='utf-8') as f:
            raw = f.read()
        m = re.search(r'\$plugins\s*=\s*\[', raw)
        start = m.end() - 1 if m else raw.find('[')
        end = raw.rfind(']')
        if start < 0 or end < start:
            return None
        data = json.loads(raw[start:end + 1])
        return data if isinstance(data, list) else None
    except Exception as e:
        print(f'  Could not parse plugins.js: {e}')
        return None


def scan_plugins_folder(collected, plugins_dir):
    plugins_js = os.path.join(os.path.dirname(plugins_dir), 'plugins.js')
    plugins = load_plugins_js(plugins_js) if os.path.isfile(plugins_js) else None

    enabled = None
    if plugins is not None:
        enabled = set()
        for p in plugins:
            if not isinstance(p, dict) or p.get('status') not in (True, 'true'):
                continue  # disabled plugins never show text
            name = p.get('name')
            if not isinstance(name, str) or name == 'Translation':
                continue
            enabled.add(name)
            extract_plugin_param(collected, p.get('parameters') or {})

    for fname in sorted(os.listdir(plugins_dir)):
        if not fname.lower().endswith('.js'):
            continue
        if enabled is not None and fname[:-3] not in enabled:
            continue
        fpath = os.path.join(plugins_dir, fname)
        try:
            with open(fpath, 'r', encoding='utf-8') as f:
                src = f.read()
        except Exception as e:
            print(f'  Skipped {fname}: {e}')
            continue
        for raw in iter_js_strings(src):
            if not raw or is_js_code_snippet(raw):
                continue
            add_plugin_text(collected, unescape_js(raw))


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
    out_path = os.path.join(SCRIPT_DIR, OUTPUT_NAME)

    print(f'Game data found at: {data_dir}')

    while True:
        print('')
        print('Main menu:')
        print('  1) Extract text')
        print('  2) Process extracted text')
        print('  0) Quit')
        choice = input('Select an option (1/2/0): ').strip()
        if choice == '0':
            return
        elif choice == '1':
            extract_menu(data_dir, plugins_dir, out_path)
        elif choice == '2':
            process_menu(out_path)
        else:
            print('Invalid choice.')


def extract_menu(data_dir, plugins_dir, out_path):
    print('')
    print('What should be scanned?')
    print('  1) data folder only')
    print('  2) data folder + js/plugins(best guess)')
    choice = input('Select an option (1/2): ').strip()
    if choice not in ('1', '2'):
        print('Invalid choice.')
        return
    scan_plugins = (choice == '2')

    if os.path.isfile(out_path):
        print('')
        print(f'{OUTPUT_NAME} already exists in the extractor folder.')
        print('  1) Overwrite it')
        print('  2) Cancel')
        choice2 = input('Select an option (1/2): ').strip()
        if choice2 != '1':
            print('Cancelled. Nothing was written.')
            return

    collected = {}

    print('Scanning data folder...')
    scan_data_folder(collected, data_dir)

    if scan_plugins:
        if os.path.isdir(plugins_dir):
            print('Scanning js/plugins...')
            scan_plugins_folder(collected, plugins_dir)
        else:
            print('js/plugins folder not found, skipping.')

    save_dict(out_path, collected)

    print('')
    print(f'Found {len(collected)} unique strings.')
    print(f'Saved to: {out_path}')

    if scan_plugins:
        print('Note: js/plugins text is found heuristically and may include some')
        print('false positives (code, not player-facing text) - please review.')


def process_menu(out_path):
    if not os.path.isfile(out_path):
        print('')
        print(f'{OUTPUT_NAME} not found. Extract text first (main menu option 1).')
        return

    common_terms_path = os.path.join(TRANS_DIR, 'commonTerms.json')
    config = load_config()
    translation_path = os.path.join(TRANS_DIR, config['file'])

    while True:
        print('')
        print('Text processing:')
        print('  1) Prune against commonTerms.json')
        print(f'  2) Prune against commonTerms.json + {config["file"]}')
        print('  3) Prune non-Japanese text')
        print('  4) Prune symbol-only text')
        print('  0) Back')
        choice = input('Select an option (1/2/3/4/0): ').strip()

        try:
            if choice == '0':
                return
            elif choice in ('1', '2'):
                known = set()
                sources = [common_terms_path]
                if choice == '2':
                    sources.append(translation_path)
                for p in sources:
                    if os.path.isfile(p):
                        known |= load_key_set(p)
                    else:
                        print(f'Not found, skipped: {p}')
                if not known:
                    print('Nothing to prune against.')
                    continue
                removed, remaining = prune_entries(out_path, lambda k: k in known)
                print(f'Pruned {removed} already-known strings. {remaining} remain.')
            elif choice == '3':
                removed, remaining = prune_entries(out_path, lambda k: not JP_RE.search(k))
                print(f'Pruned {removed} non-Japanese strings. {remaining} remain.')
            elif choice == '4':
                removed, remaining = prune_entries(out_path, is_symbols_only)
                print(f'Pruned {removed} symbol-only strings. {remaining} remain.')
            else:
                print('Invalid choice.')
        except Exception as e:
            print(f'Could not process the file: {e}')


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