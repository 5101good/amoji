// Record an actual failed election so the test can release its temporary kernel lock.
import { writeFileSync } from 'node:fs';
process.on('exit', code => {
  if (code === 75) writeFileSync(process.env.AMOJI_TEST_ELECTION_FILE, '75');
});
