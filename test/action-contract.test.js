import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

test('repository-root action retains the documented feature-parity inputs', () => {
  const action = fs.readFileSync(path.join(process.cwd(), 'action.yml'), 'utf8');

  for (const input of [
    'checkout:',
    'path:',
    'package_manager:',
    'install_command:',
    'build_command:',
    'mode:',
    'generate_badges:',
    'generate_stats_graph:',
    'enable_passcode_gate:',
    'create_deployment:',
    'smoke_test:',
    'smoke_test_stories:',
    'smoke_test_timeout_ms:'
  ]) {
    assert.match(action, new RegExp(`\\n  ${input}`));
  }
});
