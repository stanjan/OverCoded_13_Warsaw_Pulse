// One-time local migration from the old RAM-only demo. Never pass capabilities as CLI arguments.
import { resolve } from 'node:path';
import { createDemoService } from '../server/demo.mjs';

try {
  let input = '';
  for await (const chunk of process.stdin) {
    input += chunk;
    if (input.length > 64000) throw new Error('Import jest zbyt duży.');
  }
  const entries = JSON.parse(input);
  const storePath = resolve(import.meta.dirname, '..', process.env.DEMO_STORE_FILE || '.local/demo-targets.json');
  const result = createDemoService({ enabled: true, storePath }).importTargets(entries);
  console.log(`Zachowano dostęp do ${result.imported} celów demo. Klucze nie zostały wyświetlone.`);
} catch (error) {
  console.error(error instanceof SyntaxError ? 'Import wymaga poprawnej tablicy JSON na standardowym wejściu.' : error.message);
  process.exitCode = 1;
}
