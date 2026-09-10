import { matchCandidate } from "../matching.js";
import { LocalKnowledgeManager } from "../../knowledge/manager.js";
import type { CompletionCandidate, CompletionContext, CompletionProvider, ParsedCommandContext } from "../types.js";

export class ProjectProvider implements CompletionProvider {
  id = "project-provider";
  name = "Project Scripts";
  priority = 115;

  async complete(
    context: CompletionContext,
    parsed: ParsedCommandContext
  ): Promise<CompletionCandidate[]> {
    const cwd = context.cwd || "/";
    const candidates: CompletionCandidate[] = [];
    const query = parsed.activeToken.clean;

    // 1. npm subcommands (e.g. "npm r" → "npm run")
    if (parsed.command === "npm" && parsed.activeTokenIndex === 1 && !parsed.isFlag) {
      const npmCommands = [
        { name: "run",      desc: "Run a package script" },
        { name: "install",  desc: "Install package dependencies" },
        { name: "test",     desc: "Run package test script" },
        { name: "start",    desc: "Start the package" },
        { name: "build",    desc: "Build the package" },
        { name: "init",     desc: "Create a package.json file" },
        { name: "update",   desc: "Update packages" },
        { name: "audit",    desc: "Run a security audit" },
        { name: "outdated", desc: "Check for outdated packages" },
      ];

      for (const cmd of npmCommands) {
        const match = matchCandidate(query, cmd.name);
        if (match.matched) {
          candidates.push({
            text: cmd.name,
            displayText: cmd.name,
            type: "subcommand",
            source: "npm",
            score: match.score + this.priority + 50,
            replacementStart: parsed.activeToken.start,
            replacementEnd: parsed.activeToken.end,
            matchedIndices: match.matchedIndices,
            description: cmd.desc,
          });
        }
      }
    }

    // 2. npm / pnpm / yarn / bun scripts from package.json
    const isNpmRun =
      (parsed.command === "npm" || parsed.command === "pnpm" || parsed.command === "bun") &&
      parsed.subcommand === "run" &&
      parsed.activeTokenIndex >= 2;

    const isYarnRun = parsed.command === "yarn" && parsed.activeTokenIndex >= 1;

    if (isNpmRun || isYarnRun) {
      // Delegate to LocalKnowledgeManager — cached per CWD
      const data = await LocalKnowledgeManager.getInstance().getProjectData(cwd);
      for (const script of data.npmScripts) {
        const match = matchCandidate(query, script);
        if (match.matched) {
          candidates.push({
            text: script,
            displayText: script,
            type: "project-script",
            source: "package.json",
            score: match.score + this.priority + 150,
            replacementStart: parsed.activeToken.start,
            replacementEnd: parsed.activeToken.end,
            matchedIndices: match.matchedIndices,
            description: "npm run script",
          });
        }
      }
    }

    // 3. cargo targets
    if (parsed.command === "cargo" && parsed.activeTokenIndex === 1 && !parsed.isFlag) {
      const data = await LocalKnowledgeManager.getInstance().getProjectData(cwd);
      for (const target of data.cargoTargets) {
        const match = matchCandidate(query, target);
        if (match.matched) {
          candidates.push({
            text: target,
            displayText: target,
            type: "project-script",
            source: "Cargo.toml",
            score: match.score + this.priority + 15,
            replacementStart: parsed.activeToken.start,
            replacementEnd: parsed.activeToken.end,
            matchedIndices: match.matchedIndices,
            description: "Cargo command",
          });
        }
      }
    }

    // 4. make targets
    if (parsed.command === "make" && parsed.activeTokenIndex >= 1 && !parsed.isFlag) {
      const data = await LocalKnowledgeManager.getInstance().getProjectData(cwd);
      for (const target of data.makeTargets) {
        const match = matchCandidate(query, target);
        if (match.matched) {
          candidates.push({
            text: target,
            displayText: target,
            type: "project-script",
            source: "Makefile",
            score: match.score + this.priority + 15,
            replacementStart: parsed.activeToken.start,
            replacementEnd: parsed.activeToken.end,
            matchedIndices: match.matchedIndices,
            description: "Makefile target",
          });
        }
      }
    }

    return candidates;
  }
}
