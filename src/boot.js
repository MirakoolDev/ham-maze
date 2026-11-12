// Entry point: fetch the game settings first, then start the game with them.
import { loadConfig } from './config.js';

loadConfig().finally(() => import('./main.js'));
