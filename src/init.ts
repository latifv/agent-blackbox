import { Command } from "commander";
import { writeDefaultPolicyIfMissing } from "./policy.js";

export function buildInitCommand(): Command {
  return new Command("init")
    .description("Create a default blackbox.yml policy in the current directory")
    .action(async () => {
      const result = await writeDefaultPolicyIfMissing(process.cwd());
      if (result.created) {
        console.log(`Created ${result.path}`);
        return;
      }

      console.log(`Policy already exists: ${result.path}`);
    });
}
