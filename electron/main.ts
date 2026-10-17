import { app } from 'electron';
import { createRequire } from 'module';
import { resolve } from 'path';
import { PROTOCOL_PREFIX } from './protocol-handler';
import { startApp } from './start-app';

if (!app.isPackaged) {
  const loadMainModule = createRequire(__filename);
  const dotenv = loadMainModule('dotenv') as typeof import('dotenv');
  dotenv.config({ path: resolve(__dirname, '../.env.local'), quiet: true });
  dotenv.config({ path: resolve(__dirname, '../.env'), quiet: true });
}

const IS_MAC = process.platform === 'darwin';

if (!IS_MAC) {
  // make it a single instance by closing other instances but allow for dev mode
  // because of https://github.com/electron/electron/issues/14094
  const isLockObtained = app.requestSingleInstanceLock();
  if (!isLockObtained) {
    const hasProtocolUrl = process.argv.some((arg) => arg.startsWith(PROTOCOL_PREFIX));
    if (!hasProtocolUrl) {
      console.log('Another instance is already running. Exiting.');
    }
    // Force immediate exit without waiting for graceful shutdown
    process.exit(0);
  } else {
    console.log('Start app...');
    startApp();
  }
} else {
  startApp();
}
