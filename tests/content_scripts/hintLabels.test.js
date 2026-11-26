import createHints from '../../src/content_scripts/common/hints.js';
import { generatePriorityLabels, groupHintTargets } from '../../src/content_scripts/common/hintLabels.js';
import KeyboardUtils from '../../src/content_scripts/common/keyboardUtils';
import { runtime } from '../../src/content_scripts/common/runtime.js';

afterEach(() => {
    document.body.replaceChildren();
    jest.restoreAllMocks();
});

test('groups candidates in configured order and skips empty categories', () => {
    document.body.innerHTML = '<a href="#"><span></span></a><textarea></textarea><select></select><img><button></button>';
    const candidates = [...document.querySelectorAll('span, textarea, select, img, button')];
    expect(groupHintTargets(candidates, ['image', 'link', 'image', 'unknown']))
        .toEqual([
            ['image', [candidates[3]]],
            ['link', [candidates[0]]],
            ['input', [candidates[1]]],
            ['select', [candidates[2]]],
            ['other', [candidates[4]]],
        ]);
    expect(groupHintTargets([candidates[4]], ['link']).map(([type]) => type)).toEqual(['other']);
});

test('gives nearer candidates preferred short labels without prefix conflicts', () => {
    expect(generatePriorityLabels(5, 'abcd', 'ba')).toEqual(['B', 'A', 'C', 'DB', 'DA']);
    for (const count of [1, 4, 13, 40, 100]) {
        const labels = generatePriorityLabels(count, 'abcd', 'ba');
        expect(labels).toHaveLength(count);
        expect(labels.every(label => labels.filter(other => other.startsWith(label)).length === 1)).toBe(true);
    }
});

test('cycles the rendered groups, honors a single-call override and selects with lowercase', async () => {
    document.body.innerHTML = '<a id="far" href="#">Far</a><a id="near" href="#">Near</a><select></select>';
    const [far, near, select] = [...document.querySelectorAll('a, select')];
    const makeRect = (left, top) => ({left, top, right: left + 20, bottom: top + 20, width: 20, height: 20});
    jest.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function() {
        return this === near ? makeRect(window.innerWidth / 2 - 10, window.innerHeight / 2 - 10) : makeRect(20, 20);
    });
    jest.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(20);
    jest.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(20);
    jest.spyOn(window, 'getComputedStyle').mockReturnValue({
        visibility: 'visible', opacity: '1', getPropertyValue: () => '0',
    });
    const original = {...runtime.conf};
    Object.assign(runtime.conf, {hintGroupByType: true, hintPriorityCharacters: 'sf'});
    const normal = {isScrollKeyInHints: () => false, appendKeysForRepeat: jest.fn()};
    const hints = createHints({}, normal, {});
    const selected = jest.fn();
    const labels = () => [...document.querySelector('.surfingkeys_hints_host').shadowRoot.querySelectorAll('section > div')];
    const press = (key, keyCode) => hints.eventListeners.keydown({
        sk_keyName: KeyboardUtils.encodeKeystroke(key), keyCode,
        stopImmediatePropagation() {}, preventDefault() {},
    });
    try {
        await expect(hints.create([far, near, select], selected)).resolves.toBe(3);
        expect(labels().map(label => [label.link, label.label])).toEqual([[far, 'F'], [near, 'S']]);
        expect(hints.statusLine).toContain('link (2)');
        press('<Tab>', 9);
        expect(labels().map(label => label.link)).toEqual([select]);
        hints.onScrollStarted();
        hints.onScrollDone();
        expect(labels().map(label => label.link)).toEqual([select]);
        expect(selected).not.toHaveBeenCalled();
        press('<Tab>', 9);
        press('s', 83);
        expect(selected).toHaveBeenCalledWith(near);
        expect(normal.appendKeysForRepeat).toHaveBeenCalledWith('Hints', 'link:S');

        runtime.conf.hintNextTypeKey = '<Ctrl-ArrowRight>';
        await hints.create([far, near, select], selected);
        press('<Ctrl-ArrowRight>', 39);
        expect(labels().map(label => label.link)).toEqual([select]);
        press('<Esc>', 27);

        await hints.create([far, near, select], selected, {groupByType: false});
        expect(labels()).toHaveLength(3);
        press('<Esc>', 27);
    } finally {
        Object.assign(runtime.conf, original);
    }
});
