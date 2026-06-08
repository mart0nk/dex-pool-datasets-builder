#!/usr/bin/env node

import { Command } from "commander";
import { registerValidateCommand } from "./commands/validate.command.js";
import { registerPlanCommand } from "./commands/plan.command.js";
import { registerBuildCommand } from "./commands/build.command.js";
import { registerInspectCommand } from "./commands/inspect.command.js";
import { registerDoctorCommand } from "./commands/doctor.command.js";
import { registerInitCommand } from "./commands/init.command.js";

const program = new Command();

program
  .name("dex-pool")
  .description("DEX pool dataset builder")
  .version("0.1.0");

registerBuildCommand(program);
registerInspectCommand(program);
registerDoctorCommand(program);
registerInitCommand(program);

registerValidateCommand(program);
registerPlanCommand(program);

program.parseAsync(process.argv).catch((error: unknown) => {
  process.stderr.write(
    `${String(error instanceof Error ? error.message : error)}\n`,
  );
  process.exit(1);
});
