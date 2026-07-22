import { createInterface } from 'node:readline';
import { Writable } from 'node:stream';
import { KEYCHAIN_SERVICE } from '../config.js';
import { maskAccount } from '../logging/logger.js';
import { deleteSecret, getSecret, setSecret } from './keychain.js';

/**
 * Secrets CLI (PLAN.md §1.1): values are read from stdin with echo muted —
 * never as CLI arguments (visible in `ps` and shell history), never logged.
 *
 *   npm run secrets -- set <name>      prompt for value (hidden), store in Keychain
 *   npm run secrets -- get <name>      print masked value (last 4 chars)
 *   npm run secrets -- delete <name>   remove from Keychain
 */

function readHidden(promptText: string): Promise<string> {
  const muted = new Writable({ write: (_chunk, _enc, cb) => cb() });
  const rl = createInterface({ input: process.stdin, output: muted, terminal: true });
  process.stderr.write(promptText);
  return new Promise((resolve) => {
    rl.question('', (answer) => {
      rl.close();
      process.stderr.write('\n');
      resolve(answer);
    });
  });
}

function usage(): never {
  console.error('שימוש: npm run secrets -- <set|get|delete> <name>');
  process.exit(2);
}

async function main(): Promise<void> {
  const [command, name, ...rest] = process.argv.slice(2);
  if (!command || !name) usage();
  if (rest.length > 0) {
    // Refuse anything that looks like a value passed on the command line.
    console.error('שגיאה: אין להעביר ערכים כארגומנטים — הערך נקלט מ-stdin בלבד (PLAN.md §1.1).');
    process.exit(2);
  }

  switch (command) {
    case 'set': {
      const value = await readHidden(`ערך הסוד עבור "${name}" (הקלדה מוסתרת): `);
      if (!value) {
        console.error('שגיאה: ערך ריק — לא נשמר.');
        process.exit(1);
      }
      setSecret(name, value);
      console.log(`נשמר ב-Keychain: service="${KEYCHAIN_SERVICE}" account="${name}"`);
      break;
    }
    case 'get': {
      const value = getSecret(name);
      if (value === null) {
        console.error(`לא נמצא סוד בשם "${name}".`);
        process.exit(1);
      }
      console.log(`${name} = ${maskAccount(value)} (${value.length} תווים; מוצג ממוסך בלבד)`);
      break;
    }
    case 'delete': {
      console.log(deleteSecret(name) ? `נמחק: "${name}"` : `לא נמצא סוד בשם "${name}".`);
      break;
    }
    default:
      usage();
  }
}

main().catch(() => {
  // Fail closed without echoing anything that might contain a secret.
  console.error('שגיאה בגישה ל-Keychain.');
  process.exit(1);
});
