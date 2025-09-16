const fs = require('fs');
const path = require('path');

const distPath = path.join(__dirname, '..', 'dist');

try {
  fs.rmSync(distPath, { recursive: true, force: true });
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Failed to clean dist folder: ${message}`);
  process.exitCode = 1;
}
