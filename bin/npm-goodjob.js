#!/usr/bin/env node

import { runCLI } from '../dist/cli.js';

runCLI().catch((err) => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
