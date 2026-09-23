import { isTauriRuntime } from "../terminal/events";

/**
 * Fully quits and relaunches the running process via `tauri-plugin-process`.
 *
 * This exists because of the tray icon (see `src-tauri/src/tray.rs`):
 * closing the main window only hides it — the process (and whatever old
 * binary is already loaded into its memory) keeps running in the
 * background, so `getVersion()` keeps reporting the pre-update version even
 * after `self-update.sh` has replaced the file on disk. Only an actual
 * process relaunch picks up the new binary, so the update flow needs this
 * rather than telling the user to "restart" by closing and reopening the
 * window.
 */
export async function restartApp(): Promise<void> {
  if (!isTauriRuntime()) return;
  const { relaunch } = await import("@tauri-apps/plugin-process");
  await relaunch();
}
