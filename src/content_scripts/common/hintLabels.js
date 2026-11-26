export const hintTypes = ["link", "input", "select", "image", "other"];

export function getHintType(element) {
    if (element.closest('select, [role="combobox"], [role="listbox"], [role="option"]')) {
        return "select";
    }
    if (element.closest('input, textarea, [contenteditable="true"], [role="textbox"]')) {
        return "input";
    }
    if (element.closest('img, [role="img"]')) {
        return "image";
    }
    if (element.closest('a[href], [role="link"]')) {
        return "link";
    }
    return "other";
}

export function groupHintTargets(elements, order) {
    const configured = Array.isArray(order) ? order.filter(type => hintTypes.includes(type)) : [];
    const groups = new Map([...new Set([...configured, ...hintTypes])].map(type => [type, []]));
    for (const element of elements) {
        groups.get(getHintType(element)).push(element);
    }
    return [...groups].filter(([, candidates]) => candidates.length > 0);
}

export function generatePriorityLabels(total, characters, preferred) {
    const alphabet = [...new Set(characters.toUpperCase())];
    const priority = [...preferred.toUpperCase()].filter(character => alphabet.includes(character));
    const ordered = [...new Set([...priority, ...alphabet])];
    if (total <= ordered.length) {
        return ordered.slice(0, total);
    }
    if (ordered.length < 2) {
        return null;
    }

    // Expand the least preferred leaf at each depth so high-priority keys stay short.
    const leaves = [...ordered].reverse();
    let firstLeaf = 0;
    while (leaves.length - firstLeaf < total) {
        const prefix = leaves[firstLeaf++];
        const children = Math.min(ordered.length, total - (leaves.length - firstLeaf));
        for (let index = children - 1; index >= 0; index--) {
            leaves.push(prefix + ordered[index]);
        }
    }
    return leaves.slice(firstLeaf).reverse().sort((left, right) => left.length - right.length);
}
