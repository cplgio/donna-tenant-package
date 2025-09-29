// Dependencies
const { copyFileSync, mkdirSync } = require('node:fs');
const { dirname, resolve } = require('node:path');

// Utils
const copyPackageJson = () => {
  const sourcePath = resolve(__dirname, '..', 'package.json');
  const targetPath = resolve(__dirname, '..', 'dist', 'package.json');

  mkdirSync(dirname(targetPath), { recursive: true });
  copyFileSync(sourcePath, targetPath);
};

// Execution
copyPackageJson();
