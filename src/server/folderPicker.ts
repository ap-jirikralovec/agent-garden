import { execFile } from 'node:child_process';
import { homedir } from 'node:os';
import { win32 } from 'node:path';
import { promisify } from 'node:util';
import {
  hostPlatform,
  isWindowsDriveMount,
  runWindowsScript,
  wslDistroName,
  type HostPlatform,
} from './platform.js';

const execute = promisify(execFile);
let picking = false;

// AppKit's folder panel supports New Folder without requiring browser filesystem access.
const script = `
ObjC.import('AppKit');
const app = $.NSApplication.sharedApplication;
app.setActivationPolicy($.NSApplicationActivationPolicyAccessory);
app.activateIgnoringOtherApps(true);
const panel = $.NSOpenPanel.openPanel;
panel.title = 'Choose a project folder';
panel.prompt = 'Select project';
panel.canChooseFiles = false;
panel.canChooseDirectories = true;
panel.canCreateDirectories = true;
panel.allowsMultipleSelection = false;
panel.runModal === $.NSModalResponseOK ? ObjC.unwrap(panel.URL.path) : '';
`;

export function wslFolderPath(selected: string, distro: string): string {
  const match = /^\\\\(?:wsl\$|wsl\.localhost)\\([^\\]+)(?:\\(.*))?$/i.exec(selected);
  if (!match || match[1].toLowerCase() !== distro.toLowerCase())
    throw new Error('Select a folder in the current WSL distribution.');
  const parts = (match[2] ?? '').split('\\').filter(Boolean);
  // eslint-disable-next-line no-control-regex -- Reject invalid selected path components.
  if (parts.some((part) => part === '.' || part === '..' || /[\x00-\x1f]/.test(part)))
    throw new Error('The selected WSL folder path is invalid.');
  const path = '/' + parts.join('/');
  if (isWindowsDriveMount(path))
    throw new Error('Select a folder in the WSL filesystem, not a mounted Windows drive.');
  return path;
}

async function pickWslFolder(env: NodeJS.ProcessEnv): Promise<string | null> {
  const distro = wslDistroName(env);
  const initial = `\\\\wsl.localhost\\${distro}\\${homedir().replace(/^\//, '').replaceAll('/', '\\')}`;
  const selected = await pickWindowsFolder(initial, 'Choose a project folder in WSL');
  return selected ? wslFolderPath(selected, distro) : null;
}

async function pickWindowsFolder(initial: string, description: string): Promise<string | null> {
  const payload = Buffer.from(JSON.stringify({ initial, description }), 'utf8').toString('base64');
  const source = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$inputData = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${payload}')) | ConvertFrom-Json
$dialog = New-Object System.Windows.Forms.FolderBrowserDialog
$dialog.Description = $inputData.description
$dialog.ShowNewFolderButton = $true
$dialog.SelectedPath = $inputData.initial
if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
  [Console]::WriteLine($dialog.SelectedPath)
}
`;
  let selected: string;
  try {
    selected = (await runWindowsScript(source, 300000)).replace(/\r?\n$/, '');
  } catch (error) {
    throw new Error('Could not select a project folder. Close the picker and try again.', {
      cause: error,
    });
  }
  return selected || null;
}

export function windowsFolderPath(selected: string): string {
  // eslint-disable-next-line no-control-regex -- Windows paths cannot contain control characters.
  if (!win32.isAbsolute(selected) || selected.length > 4096 || /[\x00-\x1f]/.test(selected))
    throw new Error('The selected Windows folder path is invalid.');
  return win32.normalize(selected);
}

export async function pickProjectFolder(
  platform: HostPlatform = hostPlatform(),
  env: NodeJS.ProcessEnv = process.env,
): Promise<string | null> {
  if (platform === 'unsupported')
    throw new Error('Folder selection is unsupported on this system.');
  if (picking) throw new Error('A folder picker is already open. Finish that selection first.');
  picking = true;
  try {
    if (platform === 'wsl') return await pickWslFolder(env);
    if (platform === 'windows') {
      const selected = await pickWindowsFolder(env.USERPROFILE ?? '', 'Choose a project folder');
      return selected ? windowsFolderPath(selected) : null;
    }
    try {
      const { stdout } = await execute('/usr/bin/osascript', ['-l', 'JavaScript', '-e', script], {
        timeout: 300000,
        maxBuffer: 16384,
      });
      // Remove only osascript's final newline; spaces can be part of a folder name.
      return stdout.replace(/\r?\n$/, '') || null;
    } catch (error) {
      throw new Error('Could not select a project folder. Close the picker and try again.', {
        cause: error,
      });
    }
  } finally {
    picking = false;
  }
}
