import test from "node:test";
import assert from "node:assert/strict";
import {
  parseGeneratedCommand,
  parseDiagnosis,
  generateCommandFromNaturalLanguage,
  diagnoseCommand,
} from "../assistant.js";
import { AIManager } from "../manager.js";
import type { AIProvider } from "../types.js";

test("parseGeneratedCommand handles structured COMMAND and EXPLANATION format", () => {
  const raw = `
COMMAND: find . -name "*.log" -type f -mtime +7 -delete
EXPLANATION: Finds and deletes log files older than 7 days in the current directory.
`;
  const result = parseGeneratedCommand(raw);
  assert.equal(result.command, 'find . -name "*.log" -type f -mtime +7 -delete');
  assert.equal(result.explanation, "Finds and deletes log files older than 7 days in the current directory.");
});

test("parseGeneratedCommand handles markdown codeblocks", () => {
  const raw = `
Here is the command you need:
\`\`\`bash
git log --oneline -n 5
\`\`\`
This shows the last 5 git commits in one line each.
`;
  const result = parseGeneratedCommand(raw);
  assert.equal(result.command, "git log --oneline -n 5");
  assert.ok(result.explanation.includes("last 5 git commits"));
});

test("parseGeneratedCommand handles plain one-liner fallback", () => {
  const raw = `docker ps -a --format "table {{.ID}}\\t{{.Image}}\\t{{.Status}}"`;
  const result = parseGeneratedCommand(raw);
  assert.equal(result.command, 'docker ps -a --format "table {{.ID}}\\t{{.Image}}\\t{{.Status}}"');
  assert.ok(result.explanation.length > 0);
});

test("parseDiagnosis handles structured DIAGNOSIS and FIX format", () => {
  const raw = `
DIAGNOSIS: The port 8080 is already in use by another process.
FIX: lsof -i :8080 | awk 'NR>1 {print $2}' | xargs kill -9
`;
  const result = parseDiagnosis(raw);
  assert.equal(result.diagnosis, "The port 8080 is already in use by another process.");
  assert.equal(result.suggestedFix, "lsof -i :8080 | awk 'NR>1 {print $2}' | xargs kill -9");
});

test("parseDiagnosis handles fallback without explicit tags", () => {
  const raw = `
Permission denied error encountered. Try running:
\`\`\`bash
chmod +x ./build.sh
\`\`\`
`;
  const result = parseDiagnosis(raw);
  assert.ok(result.diagnosis.includes("Permission denied"));
  assert.equal(result.suggestedFix, "chmod +x ./build.sh");
});

test("generateCommandFromNaturalLanguage calls manager with natural language prompt", async () => {
  const mockManager = {
    complete: async (req: { prompt: string; systemPrompt?: string }) => {
      assert.ok(req.prompt.includes("kill process on port 3000"));
      assert.ok(req.prompt.includes("OS / Platform: linux"));
      return {
        text: `COMMAND: npx kill-port 3000\nEXPLANATION: Kills whatever process is listening on port 3000.`,
      };
    },
  } as unknown as AIManager;

  const res = await generateCommandFromNaturalLanguage("kill process on port 3000", {
    manager: mockManager,
    cwd: "/home/user/project",
    os: "linux",
    shell: "/bin/bash",
  });

  assert.equal(res.command, "npx kill-port 3000");
  assert.equal(res.explanation, "Kills whatever process is listening on port 3000.");
});

test("diagnoseCommand calls manager with error diagnostic context", async () => {
  const mockManager = {
    complete: async (req: { prompt: string }) => {
      assert.ok(req.prompt.includes("git push origin main"));
      assert.ok(req.prompt.includes("Updates were rejected because the remote contains work"));
      return {
        text: `DIAGNOSIS: Your local branch is behind the remote.\nFIX: git pull --rebase origin main && git push origin main`,
      };
    },
  } as unknown as AIManager;

  const res = await diagnoseCommand(
    "git push origin main",
    1,
    "Updates were rejected because the remote contains work that you do not have locally.",
    {
      manager: mockManager,
      cwd: "/repo",
      os: "linux",
      shell: "zsh",
    }
  );

  assert.equal(res.diagnosis, "Your local branch is behind the remote.");
  assert.equal(res.suggestedFix, "git pull --rebase origin main && git push origin main");
});
