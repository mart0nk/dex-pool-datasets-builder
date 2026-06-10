import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

const rootDir = new URL('../..', import.meta.url).pathname;

describe('compiled CLI help', () => {
  it('registers top-level and stabilization commands', () => {
    execFileSync('npm', ['run', 'build'], { cwd: rootDir, stdio: 'pipe' });

    const topLevelHelp = execFileSync('node', ['dist/cli/index.js', '--help'], {
      cwd: rootDir,
      encoding: 'utf8',
      stdio: 'pipe',
    });
    expect(topLevelHelp).toContain('build');
    expect(topLevelHelp).toContain('inspect');
    expect(topLevelHelp).toContain('doctor');
    expect(topLevelHelp).toContain('init');
    expect(topLevelHelp).not.toContain('validate');
    expect(topLevelHelp).not.toContain('plan');

    for (const args of [
      ['--help'],
      ['build', '--help'],
      ['inspect', '--help'],
      ['doctor', '--help'],
    ]) {
      const output = execFileSync('node', ['dist/cli/index.js', ...args], {
        cwd: rootDir,
        encoding: 'utf8',
        stdio: 'pipe',
      });

      expect(output).toContain('Usage:');
    }
  });
});
