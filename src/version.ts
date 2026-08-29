// Single source of truth for the server version. release-please bumps the
// string below via the `x-release-please-version` marker (registered in
// release-please-config.json's `extra-files`), and `versionSyncTest` guards
// that it stays equal to package.json. Import VERSION wherever the version is
// needed rather than re-declaring it.
export const VERSION = '0.2.0'; // x-release-please-version
