import { matchCandidate } from "../matching.js";
import { LocalKnowledgeManager } from "../../knowledge/manager.js";
import type { CompletionCandidate, CompletionContext, CompletionProvider, ParsedCommandContext } from "../types.js";

const GIT_SUBCOMMANDS: Array<{ name: string; desc: string }> = [
  { name: "status",   desc: "Show the working tree status" },
  { name: "add",      desc: "Add file contents to the staging index" },
  { name: "commit",   desc: "Record changes to the repository" },
  { name: "push",     desc: "Update remote refs along with associated objects" },
  { name: "pull",     desc: "Fetch from and integrate with another repository" },
  { name: "checkout", desc: "Switch branches or restore working tree files" },
  { name: "switch",   desc: "Switch branches" },
  { name: "restore",  desc: "Restore working tree files" },
  { name: "branch",   desc: "List, create, or delete branches" },
  { name: "diff",     desc: "Show changes between commits, commit and working tree" },
  { name: "log",      desc: "Show commit logs" },
  { name: "merge",    desc: "Join two or more development histories together" },
  { name: "rebase",   desc: "Reapply commits on top of another base tip" },
  { name: "stash",    desc: "Stash the changes in a dirty working directory away" },
  { name: "reset",    desc: "Reset current HEAD to the specified state" },
  { name: "fetch",    desc: "Download objects and refs from another repository" },
  { name: "remote",   desc: "Manage set of tracked repositories" },
  { name: "clone",    desc: "Clone a repository into a new directory" },
  { name: "tag",      desc: "Create, list, delete or verify a tag object" },
];

const BRANCH_COMMANDS = new Set(["checkout", "switch", "merge", "rebase", "branch", "diff", "log"]);

export class GitProvider implements CompletionProvider {
  id = "git-provider";
  name = "Git";
  priority = 110;

  async complete(
    context: CompletionContext,
    parsed: ParsedCommandContext
  ): Promise<CompletionCandidate[]> {
    if (parsed.command !== "git") {
      return [];
    }

    const query = parsed.activeToken.clean;
    const candidates: CompletionCandidate[] = [];
    const cwd = context.cwd || "/";

    // 1. Git subcommands (e.g. "git ch" → "checkout")
    if (parsed.activeTokenIndex === 1 && !parsed.isFlag) {
      for (const sub of GIT_SUBCOMMANDS) {
        const match = matchCandidate(query, sub.name);
        if (match.matched) {
          candidates.push({
            text: sub.name,
            displayText: sub.name,
            type: "subcommand",
            source: "Git",
            score: match.score + this.priority + 20,
            replacementStart: parsed.activeToken.start,
            replacementEnd: parsed.activeToken.end,
            matchedIndices: match.matchedIndices,
            description: sub.desc,
          });
        }
      }
    }

    // 2. Branch names (e.g. "git checkout fea" → "feature/auth")
    if (
      parsed.activeTokenIndex >= 2 &&
      parsed.subcommand &&
      BRANCH_COMMANDS.has(parsed.subcommand) &&
      !parsed.isFlag
    ) {
      // Delegate to LocalKnowledgeManager — cached per CWD
      const gitData = await LocalKnowledgeManager.getInstance().getGitData(cwd);
      if (gitData.isRepo && gitData.branches.length > 0) {
        for (const branch of gitData.branches) {
          const match = matchCandidate(query, branch);
          if (match.matched) {
            const isCurrent = branch === gitData.currentBranch;
            candidates.push({
              text: branch,
              displayText: branch,
              type: "branch",
              source: "Git Branch",
              score: match.score + this.priority + (isCurrent ? 5 : 0),
              replacementStart: parsed.activeToken.start,
              replacementEnd: parsed.activeToken.end,
              matchedIndices: match.matchedIndices,
              description: isCurrent ? "Current branch" : "Git branch",
            });
          }
        }
      }
    }

    return candidates;
  }
}
