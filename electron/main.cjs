const { app, BrowserWindow, dialog, ipcMain, protocol } = require('electron')
const path = require('path')
const fs = require('fs')

let mainWindow

protocol.registerSchemesAsPrivileged([{
  scheme: 'moon-audio',
  privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true },
}])

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1120,
    minHeight: 720,
    backgroundColor: '#090b13',
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  if (process.env.VITE_DEV_SERVER_URL) mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL)
  else if (!app.isPackaged) mainWindow.loadURL('http://127.0.0.1:5173')
  else mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
}

app.whenReady().then(() => {
  protocol.handle('moon-audio', request => {
    const filePath = decodeURIComponent(new URL(request.url).pathname.slice(1))
    const bytes = fs.readFileSync(filePath)
    const size = bytes.length
    const extension = path.extname(filePath).toLowerCase()
    const contentType = ({ '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.m4a': 'audio/mp4', '.flac': 'audio/flac' })[extension] || 'application/octet-stream'
    const range = request.headers.get('range')
    if (range) {
      const match = /bytes=(\d+)-(\d*)/.exec(range)
      if (match) {
        const start = Number(match[1])
        const end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1
        return new Response(bytes.subarray(start, end + 1), { status: 206, headers: { 'Content-Type': contentType, 'Content-Length': String(end - start + 1), 'Content-Range': `bytes ${start}-${end}/${size}`, 'Accept-Ranges': 'bytes' } })
      }
    }
    return new Response(bytes, { status: 200, headers: { 'Content-Type': contentType, 'Content-Length': String(size), 'Accept-Ranges': 'bytes' } })
  })
  createWindow()
})
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })

ipcMain.handle('audio:choose', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [{ name: 'Audio', extensions: ['mp3', 'wav', 'ogg', 'm4a', 'flac'] }],
  })
  if (result.canceled) return null
  const filePath = result.filePaths[0]
  return { path: filePath, url: `moon-audio://local/${encodeURIComponent(filePath)}`, name: path.basename(filePath) }
})

ipcMain.handle('chart:save', async (_event, payload) => {
  const suggested = `${(payload.title || 'untitled').replace(/[<>:\"/\\|?*]/g, '_')}.moon.json`
  const result = await dialog.showSaveDialog(mainWindow, {
    defaultPath: payload.currentPath || suggested,
    filters: [{ name: 'Moonweave Chart', extensions: ['moon.json'] }, { name: 'JSON', extensions: ['json'] }],
  })
  if (result.canceled || !result.filePath) return null
  if (fs.existsSync(result.filePath)) {
    const backupDir = path.join(path.dirname(result.filePath), '.moonweave-backups')
    fs.mkdirSync(backupDir, { recursive: true })
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    fs.copyFileSync(result.filePath, path.join(backupDir, `${path.basename(result.filePath)}.${stamp}.bak`))
  }
  fs.writeFileSync(result.filePath, JSON.stringify(payload.chart, null, 2), 'utf8')
  return result.filePath
})

ipcMain.handle('chart:load', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [{ name: 'Moonweave Chart', extensions: ['json'] }],
  })
  if (result.canceled) return null
  const filePath = result.filePaths[0]
  return { path: filePath, chart: JSON.parse(fs.readFileSync(filePath, 'utf8')) }
})
