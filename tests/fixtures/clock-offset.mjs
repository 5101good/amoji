// Controllable wall clock for this test's real service; never loaded by installed adapters.
import { readFileSync } from 'node:fs';
const now = Date.now;
Date.now = () => now() + Number(readFileSync(process.env.AMOJI_TEST_CLOCK_FILE, 'utf8'));
