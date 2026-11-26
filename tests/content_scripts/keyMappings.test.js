import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import createAPI from '../../src/content_scripts/common/api.js';
import createDefaultMappings from '../../src/content_scripts/common/default.js';
import createNormal from '../../src/content_scripts/common/normal.js';
import KeyboardUtils from '../../src/content_scripts/common/keyboardUtils';
import Trie from '../../src/content_scripts/common/trie';
import { skEventName } from '../../src/content_scripts/common/runtime.js';

jest.mock('../../src/content_scripts/ui/llmchat', () => () => ({}));

function createMode(name, keys) {
    const mappings = new Trie();
    for (const key of keys) {
        mappings.add(KeyboardUtils.encodeKeystroke(key), { code: () => key });
    }
    return { name, mappings, map_node: mappings };
}

function keys(mode) {
    return mode.mappings.getWords().map(KeyboardUtils.decodeKeystroke);
}

test('map and vmap move actions, including when the old key prefixes the new one', () => {
    const normal = createMode('Normal', ['a', 'b']);
    const visual = createMode('Visual', ['x', 'y']);
    const api = createAPI({}, {}, normal, {}, visual, {}, {});
    api.map('a', 'a');
    api.map('aa', 'a');
    api.vmap('y', 'x', null, '#9Moved');

    expect(keys(normal)).toEqual(['b', 'aa']);
    expect(normal.mappings.find('aa').meta.code()).toBe('a');
    expect(keys(visual)).toEqual(['y']);
    expect(visual.mappings.find('y').meta).toMatchObject({ annotation: ['Moved'], feature_group: 9 });
    expect(visual.mappings.find('y').meta.code()).toBe('x');
});

test('each whitelist keeps exact mappings in its own mode', () => {
    const normal = createMode('Normal', ['aa', 'ab', 'b']);
    const insert = createMode('Insert', ['aa', 'b']);
    const visual = createMode('Visual', ['aa', 'b']);
    const api = createAPI({}, insert, normal, {}, visual, {}, {});

    api.nunmapAllExcept(['a', 'ab']);
    expect(keys(normal)).toEqual(['ab']);
    expect(keys(insert)).toEqual(['aa', 'b']);
    api.iunmapAllExcept(['b']);
    api.vunmapAllExcept([], /another-site/);
    expect(keys(insert)).toEqual(['b']);
    expect(keys(visual)).toEqual(['aa', 'b']);
    api.vunmapAllExcept([]);
    expect(keys(visual)).toEqual([]);
    api.unmapAllExcept(['ab']);
    expect(keys(normal)).toEqual(['ab']);
    expect(keys(insert)).toEqual([]);
});

test('Lurk configuration is applied in order before the mode starts', () => {
    const normal = createNormal({});
    const api = createAPI({}, {}, normal, {}, {}, {}, {});
    api.lmap('i', '<Alt-i>');
    api.lunmapAllExcept(['i']);
    normal.startLurk();

    const lurk = normal.getLurkMode();
    expect(keys(lurk)).toEqual(['i']);
    lurk.exit();
});

test('Omnibar allowlist filters the default launch shortcuts without clearing unrelated keys', () => {
    global.chrome = {storage: {local: {get: jest.fn()}}};
    const normal = createMode('Normal', []);
    const visual = createMode('Visual', []);
    const insert = createMode('Insert', []);
    const front = {openOmnibar: jest.fn()};
    const api = createAPI({}, insert, normal, {}, visual, front, {});
    const userAgent = jest.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Chrome');
    createDefaultMappings(api, {}, insert, normal, {}, visual, front, {});
    userAgent.mockRestore();
    const allowlist = [
        'go', 'og', ':', 'b', '<Ctrl-.>', '<Ctrl-,>', '<Esc>', '<Tab>',
        '<Shift-Tab>', '<ArrowDown>', '<ArrowUp>',
    ];

    api.cunmapAllExcept(allowlist, /another-site/);
    expect(keys(normal)).toEqual(expect.arrayContaining(['t', 'A']));
    api.cunmapAllExcept(allowlist);

    for (const key of ['go', 'og', ':', 'b']) {
        normal.mappings.find(key).meta.code();
    }
    expect(front.openOmnibar.mock.calls.map(([options]) => options.type))
        .toEqual(['URLs', 'SearchEngine', 'Commands', 'Bookmarks']);
    expect(keys(normal)).not.toContain('t');
    expect(keys(normal)).not.toContain('A');
    expect(keys(visual)).not.toContain('A');
    expect(keys(normal)).toEqual(expect.arrayContaining(['r', 'sg']));
    expect(keys(visual)).toContain('t');
});

test('Omnibar runs a moved Escape command and honors single and allowlist removals', () => {
    global.chrome = {
        runtime: {
            getURL: path => `chrome-extension://surfingkeys/${path}`,
            sendMessage: jest.fn(),
        },
    };
    jest.spyOn(window, 'focus').mockImplementation(() => {});
    const html = readFileSync(resolve(__dirname, '../../src/content_scripts/ui/frontend.html'), 'utf8');
    document.body.innerHTML = new DOMParser().parseFromString(html, 'text/html').body.innerHTML;
    const frontend = require('../../src/content_scripts/ui/frontend.js').default;
    frontend._actions.initFrontend({origin: window.origin, winSize: [800, 600]});
    const api = createAPI({}, {}, createMode("Normal", []), {}, createMode("Visual", []), {}, {});
    const commands = {
        addMapkey: (mode, new_keystroke, old_keystroke, new_annotation, replace) => {
            frontend._actions.addMapkey({mode, new_keystroke, old_keystroke, new_annotation, replace});
        },
        unmap: (mode, keystroke) => frontend._actions.unmap({mode, keystroke}),
        unmapAllExcept: (mode, keystrokes) => frontend._actions.unmapAllExcept({mode, keystrokes}),
    };
    // The browser runs these listeners in separate documents.
    document.addEventListener(skEventName('front'), ({detail: [action, ...args]}) => {
        commands[action]?.(...args);
    }, {capture: true});

    const omnibar = document.getElementById('sk_omnibar');
    const open = () => frontend.openOmnibar({type: 'Commands'});
    const press = (key, keyCode) => omnibar.querySelector('input').dispatchEvent(
        new KeyboardEvent('keydown', {key, keyCode, bubbles: true, cancelable: true})
    );

    open();
    expect(press('Tab', 9)).toBe(false);
    api.cunmap('<Tab>', /another-site/);
    expect(press('Tab', 9)).toBe(false);
    api.cunmap('<Tab>');
    expect(press('Tab', 9)).toBe(true);
    press('Escape', 27);
    expect(omnibar.style.display).toBe('none');

    api.cmap('<F2>', '<Esc>');
    api.cunmapAllExcept(['<F2>']);
    open();
    press('Escape', 27);
    expect(omnibar.style.display).not.toBe('none');
    press('F2', 113);
    expect(omnibar.style.display).toBe('none');

    api.cunmap('<F2>');
    open();
    press('F2', 113);
    expect(omnibar.style.display).not.toBe('none');
    frontend.hidePopup();
    jest.restoreAllMocks();
});
