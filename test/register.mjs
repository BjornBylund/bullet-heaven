// Installs the resolution hook. Used as `node --import ./test/register.mjs ...`.
import { register } from 'node:module';
register('./hooks.mjs', import.meta.url);
