/** Programs whose command line, re-run in a fresh shell, reopens the same
 * connection. Anything else running in the foreground (a build, a deploy,
 * an editor) is never captured: re-running it on launch would repeat work
 * the user didn't ask to repeat. */
const CONNECTION_PROGRAMS = new Set(["ssh", "autossh"]);
/** Container/cluster CLIs, captured only for their `exec` subcommand. */
const EXEC_PROGRAMS = new Set(["docker", "podman", "kubectl"]);

function shellQuote(arg: string): string {
  return /^[\w@%+=:,./-]+$/.test(arg) ? arg : `'${arg.replace(/'/g, `'\\''`)}'`;
}

/** The shell command that reopens the connection `argv` is running (an
 * `ssh user@host`, a `docker exec -it app sh`), quoted so it types back
 * into a shell unchanged — or null when `argv` isn't a connection. */
export function reconnectCommand(argv: string[] | null): string | null {
  if (!argv?.length) return null;
  const program = argv[0].split("/").pop() ?? "";
  const isConnection = CONNECTION_PROGRAMS.has(program) || (EXEC_PROGRAMS.has(program) && argv.includes("exec"));
  return isConnection ? argv.map(shellQuote).join(" ") : null;
}
