import { app, shell, BrowserWindow, Menu, protocol } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import {
  CH,
  type AudioDownloadProgress,
  type BibleInstallProgress,
  type MessageInstallProgress
} from '../shared/types'
import { openDb } from './db'
import { createSongsRepo } from './songsRepo'
import { createBiblesRepo } from './biblesRepo'
import { createScheduleRepo } from './scheduleRepo'
import { createSettingsRepo } from './settingsRepo'
import { createBibleInstaller } from './bibleInstaller'
import { createMessagesRepo } from './messagesRepo'
import { createMessagesScheduleRepo } from './messagesScheduleRepo'
import { createMessageInstaller } from './messageInstaller'
import { createMessageSource } from './messageSource'
import { seedIfEmpty } from './seed'
import { registerIpc } from './ipc'
import { initDisplays, openTestOutput, closeAllOutputs, resyncDisplays } from './displays'
import { registerMediaProtocol, libraryRoot } from './library'

protocol.registerSchemesAsPrivileged([
  { scheme: 'helm-media', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }
])

let operatorWindow: BrowserWindow | null = null

function createWindow(): void {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    title: 'Helm',
    width: 1280,
    height: 800,
    minWidth: 1200,
    minHeight: 760,
    show: false,
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  operatorWindow = mainWindow

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  // Output windows (real-display and test) are always-on-top and have no window
  // chrome of their own — if the operator window closes without taking them down,
  // they're orphaned with no way for the user to close them. Destroy them here.
  mainWindow.on('closed', () => {
    operatorWindow = null
    closeAllOutputs()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/operator/index.html`)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/operator/index.html'))
  }
}

function buildMenu(): void {
  const template: Electron.MenuItemConstructorOptions[] = [
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' as const }] : []),
    { role: 'editMenu' as const },
    {
      label: 'View',
      submenu: [{ label: 'Open Test Output', click: () => openTestOutput() }]
    }
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
  // Set app user model id for windows
  electronApp.setAppUserModelId('com.helm.app')

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  const db = openDb(join(app.getPath('userData'), 'helm.db'))
  const libRoot = libraryRoot()
  registerMediaProtocol(libRoot)
  const repo = createSongsRepo(db)
  seedIfEmpty(repo)
  const biblesRepo = createBiblesRepo(db)
  const scheduleRepo = createScheduleRepo(db)
  const settingsRepo = createSettingsRepo(db)
  // Same broadcast-to-all-windows pattern as displaysStatus in displays.ts.
  const broadcastBibleProgress = (p: BibleInstallProgress): void => {
    for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send(CH.biblesProgress, p)
  }
  const installer = createBibleInstaller(biblesRepo, broadcastBibleProgress)

  const messagesRepo = createMessagesRepo(db)
  const messagesScheduleRepo = createMessagesScheduleRepo(db)
  const broadcastMessageInstallProgress = (p: MessageInstallProgress): void => {
    for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send(CH.messageInstallProgress, p)
  }
  const broadcastAudioProgress = (p: AudioDownloadProgress): void => {
    for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send(CH.messageAudioProgress, p)
  }
  const messageInstaller = createMessageInstaller(
    messagesRepo,
    (p) => ('msgId' in p ? broadcastAudioProgress(p) : broadcastMessageInstallProgress(p)),
    { source: createMessageSource() }
  )

  registerIpc(
    repo,
    biblesRepo,
    scheduleRepo,
    settingsRepo,
    installer,
    messagesRepo,
    messagesScheduleRepo,
    messageInstaller
  )

  buildMenu()
  createWindow()
  initDisplays()

  // Fire-and-forget: awaiting this before createWindow() would block boot by ~2s
  // on first run. The UI catches up via bibles:progress broadcasts / manifest() polling.
  void installer.installBundledKjvIfMissing()

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open. Output windows
    // stay alive independently of the operator window, so checking for "no
    // operator window" (rather than BrowserWindow.getAllWindows().length === 0,
    // which output windows would keep non-zero) is what actually matters here.
    // Closing the operator window also tore down all output windows, so re-attach
    // them to external displays — otherwise they'd only return on a display replug.
    if (operatorWindow === null) {
      createWindow()
      resyncDisplays()
    }
  })
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
