const NO_RESTORE_WORKSPACES_OPTION = "--no-restore-workspaces";

function shouldRestoreWorkspaces(argv = process.argv) {
  return !argv.includes(NO_RESTORE_WORKSPACES_OPTION);
}

module.exports = {
  NO_RESTORE_WORKSPACES_OPTION,
  shouldRestoreWorkspaces,
};
