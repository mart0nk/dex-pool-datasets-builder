#!/usr/bin/env node

import "dotenv/config";

import { Command } from "commander";
import { registerBuildCommand } from "./commands/build.command.js";
import { registerInspectCommand } from "./commands/inspect.command.js";
import { registerDoctorCommand } from "./commands/doctor.command.js";
import { registerInitCommand } from "./commands/init.command.js";
import { registerDiscoverCommand } from "./commands/discover.command.js";

const program = new Command();

program
  .name("dex-pool")
  .description("DEX pool dataset builder")
  .version("0.1.0");

registerBuildCommand(program);
registerDiscoverCommand(program);
registerInspectCommand(program);
registerDoctorCommand(program);
registerInitCommand(program);

program.parseAsync(process.argv).catch((error: unknown) => {
  process.stderr.write(
    `${String(error instanceof Error ? error.message : error)}\n`,
  );
  process.exit(1);
});
