import { writeFileSync } from 'node:fs';
import { runHvhBenchmark } from './hvhBenchmark';
const result = runHvhBenchmark(1000);
if (process.argv[2]) writeFileSync(process.argv[2], JSON.stringify(result, null, 2));
process.stdout.write(JSON.stringify(result, null, 2) + '\n');
