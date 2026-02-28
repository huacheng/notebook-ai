/**
 * Compute breadcrumb display data, hiding .worktrees/ intermediate layer.
 */
export function computeBreadcrumb(subPath: string, initialPath: string) {
  // Strip initialPath prefix
  let displayPath = initialPath !== '.' && subPath.startsWith(initialPath)
    ? subPath.slice(initialPath.length).replace(/^\//, '') || '.'
    : subPath;

  // Hide .worktrees/ intermediate layer
  const worktreePrefix = displayPath.startsWith('.worktrees/') ? '.worktrees/' : '';
  if (worktreePrefix) {
    displayPath = displayPath.slice(worktreePrefix.length) || '.';
  }

  const pathParts = displayPath === '.' ? [] : displayPath.split('/');

  // Build crumb paths that map back to the real subPath
  const crumbPaths = pathParts.map((_, i) => {
    const displayCrumb = pathParts.slice(0, i + 1).join('/');
    const realCrumb = worktreePrefix ? `${worktreePrefix}${displayCrumb}` : displayCrumb;
    return initialPath !== '.' ? `${initialPath}/${realCrumb}` : realCrumb;
  });

  return { displayPath, pathParts, crumbPaths };
}

/**
 * Compute the target path when navigating up, skipping .worktrees/.
 */
export function computeNavigateUp(subPath: string, initialPath: string): string {
  if (subPath === initialPath || subPath === '.') return initialPath;

  const parts = subPath.split('/');
  parts.pop();
  let target = parts.length === 0 ? initialPath : parts.join('/');

  // Skip .worktrees/ intermediate directory — go straight to root
  if (target === '.worktrees' || target.endsWith('/.worktrees')) {
    target = initialPath;
  }

  return target;
}
