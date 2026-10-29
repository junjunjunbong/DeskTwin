import { execFile } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { resolve } from 'node:path';

// Fixed, reviewed source + fixed compiler arguments. No shell or user-supplied code.
if (process.platform !== 'darwin') {
  console.error('The native hardware helper can only be built on macOS (12 or later).');
  process.exitCode = 1;
} else {
  const root = fileURLToPath(new URL('../', import.meta.url));
  await mkdir(resolve(root, 'build'), { recursive: true });
  try {
    await promisify(execFile)(
      '/usr/bin/xcrun',
      [
        'swiftc',
        '-O',
        '-parse-as-library',
        '-swift-version',
        '5',
        '-framework',
        'AppKit',
        '-framework',
        'CoreGraphics',
        '-framework',
        'IOKit',
        '-framework',
        'CryptoKit',
        resolve(root, 'native/HardwareProbe.swift'),
        '-o',
        resolve(root, 'build/desktwin-hardware-probe'),
      ],
      {
        timeout: 120000,
        maxBuffer: 1024 * 1024,
        env: { ...process.env, MACOSX_DEPLOYMENT_TARGET: '12.0' },
      },
    );
    console.log(
      'Built the read-only macOS helper. Start DeskTwin, then explicitly enable hardware detection in the UI.',
    );
  } catch (error) {
    console.error(
      'Native helper build failed. Install Xcode Command Line Tools, then run npm run hardware:build again.',
    );
    // Compiler diagnostics contain source paths, not hardware snapshots or API keys.
    if (error && typeof error === 'object' && 'stderr' in error)
      console.error(String(error.stderr));
    process.exitCode = 1;
  }
}
