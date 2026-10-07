import { isTauriRuntime } from "../terminal/events";

/**
 * Fully quits and relaunches the running process via `tauri-plugin-process`,
 * so the update flow picks up the newly installed binary without asking the
 * user to close and reopen the window themselves.
 */
export async function restartApp(): Promise<void> {
  if (!isTauriRuntime()) return;
  const { relaunch } = await import("@tauri-apps/plugin-process");
  await relaunch();
}
