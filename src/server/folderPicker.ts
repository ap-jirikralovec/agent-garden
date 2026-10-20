import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

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

export async function pickProjectFolder(): Promise<string | null> {
  if (process.platform !== 'darwin') throw new Error('Folder selection currently requires macOS.');
  if (picking) throw new Error('A folder picker is already open. Finish that selection first.');
  picking = true;
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
  } finally {
    picking = false;
  }
}
