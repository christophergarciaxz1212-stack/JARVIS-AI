import fs from 'fs'
import os from 'os'
import path from 'path'

// Every test file gets its own empty data folder: tests never read or write the real app data
process.env.JARVIS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-test-data-'))

// The Antigravity and OpenCode bridges spawn the real CLIs of this machine and spend the user's
// free quota. Tests see them as not installed unless a test points the path somewhere on purpose.
process.env.AGY_PATH = path.join(os.tmpdir(), 'jarvis-test-no-agy', 'agy.exe')
process.env.OPENCODE_CLI = path.join(os.tmpdir(), 'jarvis-test-no-opencode', 'opencode-cli.exe')
