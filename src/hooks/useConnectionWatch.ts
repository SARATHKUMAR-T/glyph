import { useEffect, useRef, useState } from "react";

import type { ConnectionLossAction } from "../lib/workspace/types";
import { getForegroundCommand, stopForegroundJob } from "./useTerminalSession";

/** How often a watched command is checked for having exited — one
 * `tcgetpgrp` syscall on the Rust side, so this costs next to nothing. */
const POLL_MS = 2000;
/** A command that exits before it was ever seen running (e.g. `ssh` failing
 * to resolve its host) is judged once it's had this long to start. */
const START_GRACE_MS = 1500;
/** A command that stays up this long counts as reconnected for good, so the
 * retry backoff starts over the next time it drops. */
const STABLE_MS = 30_000;
/** Auto-restart backoff, in seconds, by attempt — so a server that's still
 * down isn't hammered every couple of seconds. */
const RETRY_DELAYS_S = [3, 5, 10, 20, 30, 60];
const INFO_NOTICE_MS = 4000;
/** How many lines up from the cursor are checked for the exit message. */
const RECENT_LINES = 4;
/** How long each step of stopping a stuck command gets to work. */
const STOP_STEP_MS = 800;

/** ssh keepalives added to watched panes' ssh commands: with these, a
 * server that stops answering makes ssh exit within ~30s ("Timeout,
 * server not responding") instead of freezing for as long as TCP allows,
 * which is what lets a dead server be noticed while the local network
 * stays up. */
const SSH_KEEPALIVE = "-o ServerAliveInterval=10 -o ServerAliveCountMax=3";

/** Messages a command prints when it dies from a network failure (ssh,
 * curl, git, kubectl, docker against a remote host, ...). A plain
 * `Connection to host closed.` — what ssh prints after a normal `exit` —
 * deliberately doesn't match. */
const NETWORK_ERROR =
  /connection (reset|refused|timed out|lost|closed by)|closed by remote host|broken pipe|network is unreachable|no route to host|host is down|could not resolve|name or service not known|temporary failure in name resolution|client_loop: send disconnect|operation timed out|server .* not responding/i;

/** The command as typed into a watched pane: the first `ssh` in it gets
 * `SSH_KEEPALIVE`, unless it already sets its own `ServerAlive*` options.
 * Anything else is typed unchanged. */
export function withConnectionKeepalive(command: string): string {
  if (/ServerAlive/i.test(command)) return command;
  return command.replace(/(^|\s)ssh(?=\s)/, `$1ssh ${SSH_KEEPALIVE}`);
}

export type ConnectionNotice = {
  tone: "warning" | "info";
  message: string;
  canRestart: boolean;
};

type ConnectionWatchOptions = {
  action: ConnectionLossAction;
  /** The pane's startup command, or "" when it has none. */
  command: string;
  getSessionId: () => string | null;
  /** The last few lines of output above the cursor. */
  readRecentOutput: (lines: number) => string;
  sendBytes: (bytes: string) => void;
};

const sleep = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

/**
 * Watches a workspace pane's startup command for a lost network connection
 * and, per the pane's `onConnectionLoss` setting, either shows a warning
 * with a Restart button (`warn`) or re-runs the command by itself once the
 * network is back (`restart`).
 *
 * A connection counts as lost when the OS reports the network going down
 * while the command runs, or when the command exits while offline or with
 * a network error in its last lines of output. Network state comes from
 * the webview's `online`/`offline` events (no polling); only the "has the
 * command exited" check polls, and only while a watched command runs.
 *
 * Every helper below reads its inputs from refs, so the stale closures
 * held by timers and the pane's mount effect stay correct.
 */
export function useConnectionWatch(options: ConnectionWatchOptions) {
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const [notice, setNotice] = useState<ConnectionNotice | null>(null);
  const phaseRef = useRef<"idle" | "running" | "lost">("idle");
  const startedAtRef = useRef(0);
  const seenRunningRef = useRef(false);
  const attemptRef = useRef(0);
  const pollTimerRef = useRef<number | undefined>(undefined);
  const retryTimerRef = useRef<number | undefined>(undefined);
  const noticeTimerRef = useRef<number | undefined>(undefined);

  const isEnabled = () => optionsRef.current.action !== "off" && optionsRef.current.command !== "";

  const showNotice = (next: ConnectionNotice | null, autoClearMs?: number) => {
    window.clearTimeout(noticeTimerRef.current);
    setNotice(next);
    if (next && autoClearMs) noticeTimerRef.current = window.setTimeout(() => setNotice(null), autoClearMs);
  };

  /** The foreground program's name ("" if unreadable), false while the
   * shell is idle, or null when the session can't be asked. */
  const foreground = async (): Promise<string | false | null> => {
    const sessionId = optionsRef.current.getSessionId();
    if (!sessionId) return null;
    return getForegroundCommand(sessionId)
      .then((name) => name ?? false)
      .catch(() => null);
  };
  const commandRunning = async (): Promise<boolean | null> => {
    const job = await foreground();
    return job === null ? null : job !== false;
  };

  /** Stops whatever is still running in the foreground, gently first:
   * ssh's own disconnect escape (`~.` — a frozen ssh ignores Ctrl+C,
   * which it just forwards to the dead server), or Ctrl+C for anything
   * else; then SIGTERM, then SIGKILL to the job's process group. The
   * shell itself is never signalled. Resolves true once the shell is idle. */
  const stopStuckCommand = async (): Promise<boolean> => {
    const { getSessionId, sendBytes } = optionsRef.current;
    const job = await foreground();
    if (job === false) return true;
    if (job === null) return false;

    sendBytes(job === "ssh" ? "\r~." : "\x03");
    await sleep(STOP_STEP_MS);
    for (const force of [false, true]) {
      if ((await foreground()) === false) return true;
      const sessionId = getSessionId();
      if (!sessionId) return false;
      await stopForegroundJob(sessionId, force).catch(() => {});
      await sleep(STOP_STEP_MS);
    }
    return (await foreground()) === false;
  };

  const schedulePoll = () => {
    window.clearTimeout(pollTimerRef.current);
    pollTimerRef.current = window.setTimeout(() => void poll(), POLL_MS);
  };

  /** Starts watching once the startup command has been typed into the shell. */
  const markCommandStarted = () => {
    if (!isEnabled()) return;
    phaseRef.current = "running";
    startedAtRef.current = performance.now();
    seenRunningRef.current = false;
    schedulePoll();
  };

  const poll = async () => {
    if (phaseRef.current !== "running" || !isEnabled()) return;
    const running = await commandRunning();
    if (phaseRef.current !== "running" || running === null) return;

    const elapsed = performance.now() - startedAtRef.current;
    if (running) {
      seenRunningRef.current = true;
      if (elapsed >= STABLE_MS) attemptRef.current = 0;
      schedulePoll();
      return;
    }
    if (!seenRunningRef.current && elapsed < START_GRACE_MS) {
      schedulePoll();
      return;
    }

    // The command exited: a network failure, or did it just finish?
    if (!navigator.onLine || NETWORK_ERROR.test(optionsRef.current.readRecentOutput(RECENT_LINES))) {
      handleLost("exited");
    } else {
      phaseRef.current = "idle";
    }
  };

  const handleLost = (reason: "offline" | "exited") => {
    phaseRef.current = "lost";
    window.clearTimeout(pollTimerRef.current);
    const { action, command } = optionsRef.current;

    if (action === "restart" && reason === "exited" && navigator.onLine) {
      scheduleRetry();
      return;
    }
    const what =
      reason === "exited" ? `Connection lost: ${command} stopped.` : `Network disconnected while ${command} is running.`;
    const next = action === "restart" ? `${what} It will run again when the network is back.` : what;
    showNotice({ tone: "warning", message: next, canRestart: true });
  };

  const scheduleRetry = () => {
    window.clearTimeout(retryTimerRef.current);
    const attempt = attemptRef.current + 1;
    attemptRef.current = attempt;
    let remaining = RETRY_DELAYS_S[Math.min(attempt - 1, RETRY_DELAYS_S.length - 1)];

    const tick = () => {
      if (phaseRef.current !== "lost") return;
      const { command } = optionsRef.current;
      if (!navigator.onLine) {
        // The `online` listener picks this back up.
        showNotice({ tone: "warning", message: `Waiting for the network to run ${command} again.`, canRestart: true });
        return;
      }
      if (remaining <= 0) {
        void restart();
        return;
      }
      const tries = attempt > 1 ? ` (attempt ${attempt})` : "";
      showNotice({ tone: "info", message: `Connection lost. Running ${command} again in ${remaining}s${tries}.`, canRestart: true });
      remaining -= 1;
      retryTimerRef.current = window.setTimeout(tick, 1000);
    };
    tick();
  };

  /** Re-runs the command — the Restart button, or auto-restart. A command
   * that's still hanging is stopped first (see `stopStuckCommand`). */
  const restart = async () => {
    window.clearTimeout(retryTimerRef.current);
    const { command, sendBytes } = optionsRef.current;
    if (!command) return;

    if ((await commandRunning()) === true) {
      showNotice({ tone: "info", message: `Stopping the stuck ${command}…`, canRestart: false });
    }
    if (!(await stopStuckCommand())) {
      phaseRef.current = "lost";
      showNotice({ tone: "warning", message: `Couldn't stop ${command}. Close it by hand, then restart.`, canRestart: true });
      return;
    }

    // Ctrl+U first, so the command never lands after stray typed text.
    sendBytes(`\x15${withConnectionKeepalive(command)}\r`);
    showNotice({ tone: "info", message: `Running ${command} again.`, canRestart: false }, INFO_NOTICE_MS);
    markCommandStarted();
  };

  const dismiss = () => {
    window.clearTimeout(retryTimerRef.current);
    window.clearTimeout(pollTimerRef.current);
    phaseRef.current = "idle";
    showNotice(null);
  };

  /** Starts watching a command that's already running — for a pane
   * remounted onto its existing shell (e.g. by a split), or whose option
   * was just turned on — rather than only from the next restart. */
  const resumeWatching = () => {
    if (phaseRef.current !== "idle" || !isEnabled()) return;
    void commandRunning().then((running) => {
      if (!running || phaseRef.current !== "idle" || !isEnabled()) return;
      markCommandStarted();
      seenRunningRef.current = true;
    });
  };

  // The option or command changed on an open pane (its workspace was
  // edited): turning watching off clears everything; turning it on picks
  // up a command that's already running.
  useEffect(() => {
    if (!isEnabled()) {
      if (phaseRef.current !== "idle") dismiss();
      return;
    }
    resumeWatching();
  }, [options.action, options.command]);

  useEffect(() => {
    const handleOffline = () => {
      if (phaseRef.current === "running" && isEnabled()) handleLost("offline");
    };
    const handleOnline = async () => {
      if (phaseRef.current !== "lost" || !isEnabled()) return;
      const running = await commandRunning();
      if (phaseRef.current !== "lost") return;
      const { action, command } = optionsRef.current;

      if (running) {
        // It rode out the outage (or is hung — if so it'll exit with a
        // network error later, and the poll catches that).
        phaseRef.current = "running";
        seenRunningRef.current = true;
        startedAtRef.current = performance.now();
        schedulePoll();
        if (action === "restart") {
          showNotice({ tone: "info", message: `Network is back. ${command} is still running.`, canRestart: false }, INFO_NOTICE_MS);
        } else {
          showNotice({ tone: "warning", message: `Network is back. If ${command} is stuck, restart it.`, canRestart: true });
        }
        return;
      }
      if (action === "restart") scheduleRetry();
      else showNotice({ tone: "warning", message: `Network is back. ${command} stopped. Restart it?`, canRestart: true });
    };
    const onOnline = () => void handleOnline();

    window.addEventListener("offline", handleOffline);
    window.addEventListener("online", onOnline);
    return () => {
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("online", onOnline);
      window.clearTimeout(pollTimerRef.current);
      window.clearTimeout(retryTimerRef.current);
      window.clearTimeout(noticeTimerRef.current);
    };
  }, []);

  return {
    notice,
    markCommandStarted,
    resumeWatching,
    restart: () => void restart(),
    dismiss,
  };
}
