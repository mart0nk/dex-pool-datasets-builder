#!/usr/bin/env node
import { Command } from 'commander';
import { registerValidateCommand } from './commands/validate.command.js';
import { registerPlanCommand } from './commands/plan.command.js';
import { registerBuildCommand } from './commands/build.command.js';

const program = new Command();
program
  .name('dex-pool-datasets')
  .description('DEX pool dataset builder')
  .version('0.1.0');

registerValidateCommand(program);
registerPlanCommand(program);
registerBuildCommand(program);

program.parseAsync(process.argv).catch((error: unknown) => {
  process.stderr.write(String(error instanceof Error ? error.message : error) + '\n');
  process.exit(1);
});
