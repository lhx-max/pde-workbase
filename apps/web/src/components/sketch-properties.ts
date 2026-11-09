const generatedNames = new WeakMap<HTMLElement, string>();

function setAttribute(element: HTMLElement, name: string, value: string): void {
  if (element.getAttribute(name) !== value) element.setAttribute(name, value);
}

/** Use the engine's localized labels (including shortcuts) for one shared bubble.
 * Decorate existing hit targets, never wrap/replace controls or change their
 * native selection/click handlers. TooltipLayer owns placement and title suppression.
 */
export function applySketchPropertyTooltips(root: HTMLElement): void {
  const targets = root.querySelectorAll<HTMLElement>(
    '.selected-shape-actions button, .selected-shape-actions label:has(input[type="radio"]), .selected-shape-actions label:has(input[type="checkbox"])',
  );
  for (const target of targets) {
    const control = target.querySelector<HTMLInputElement>('input') ?? target;
    const label = [target.getAttribute('title'), target.getAttribute('data-bezier-tooltip-native-title'),
      control.getAttribute('aria-label'), target.getAttribute('aria-label')]
      .find(value => value?.trim())?.replace(/\s+/g, ' ').trim();
    if (!label) continue;
    setAttribute(target, 'data-tooltip', label);
    setAttribute(target, 'data-tooltip-placement', 'right');
    if (!target.classList.contains('bezier-tooltip')) target.classList.add('bezier-tooltip');
    // Preserve names owned by the engine; update only names synthesized here.
    const existing = control.getAttribute('aria-label');
    if (!existing || existing === generatedNames.get(control)) {
      setAttribute(control, 'aria-label', label);
      generatedNames.set(control, label);
    }
  }
}
