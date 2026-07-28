async function restoreSavedWorkspaces({
  savedSession,
  legacyLastWorkspace = null,
  exists,
  open,
}) {
  const requestedRoots = savedSession
    ? savedSession.openWorkspaces
    : legacyLastWorkspace
      ? [legacyLastWorkspace]
      : [];
  const openedRoots = [];
  const missingRoots = [];
  const failures = [];

  for (const root of requestedRoots) {
    if (!exists(root)) {
      missingRoots.push(root);
      continue;
    }
    try {
      await open(root);
      openedRoots.push(root);
    } catch (error) {
      failures.push({ root, error });
    }
  }

  const requestedActive = savedSession && savedSession.activeWorkspace;
  const activeRoot =
    (requestedActive && openedRoots.includes(requestedActive) && requestedActive) || openedRoots[0] || null;

  return { openedRoots, activeRoot, missingRoots, failures };
}

module.exports = { restoreSavedWorkspaces };
