import moduleStyles from './ClipDetailedEditor.module.css';

/**
 * Workspace-package CSS modules expose the generated class map to Next, but
 * their style side effect can be dropped by the host build. The canonical
 * stylesheet is also loaded from canvas-workbench.css, inside a CSS @scope.
 * Add the stable scoped class beside the generated class so both paths render
 * identically without leaking generic names such as `.field` into the host.
 */
const styles = new Proxy(moduleStyles, {
  get(target, key: string) {
    const generated = target[key] || '';
    return `${generated} ${key}${key === 'editor' ? ' clip-detailed-scope' : ''}`.trim();
  },
});

export default styles;
