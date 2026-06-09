const electron = {
  app: {
    getPath: (name: string) => `/tmp/cosmo-test/${name}`,
    on: jest.fn(),
    whenReady: jest.fn().mockResolvedValue(undefined),
    dock: { hide: jest.fn() },
    setLoginItemSettings: jest.fn(),
    requestSingleInstanceLock: jest.fn().mockReturnValue(true),
    quit: jest.fn(),
  },
  ipcMain: {
    handle: jest.fn(),
    on: jest.fn(),
    removeAllListeners: jest.fn(),
  },
  ipcRenderer: {
    on: jest.fn(),
    invoke: jest.fn(),
    send: jest.fn(),
  },
  contextBridge: {
    exposeInMainWorld: jest.fn(),
  },
  BrowserWindow: jest.fn().mockImplementation(() => ({
    loadFile: jest.fn(),
    loadURL: jest.fn(),
    on: jest.fn(),
    webContents: { send: jest.fn(), on: jest.fn() },
    getBounds: jest.fn().mockReturnValue({ x: 100, y: 100, width: 220, height: 170 }),
    setBounds: jest.fn(),
    show: jest.fn(),
    hide: jest.fn(),
    focus: jest.fn(),
    blur: jest.fn(),
    isVisible: jest.fn().mockReturnValue(true),
    isDestroyed: jest.fn().mockReturnValue(false),
    setAlwaysOnTop: jest.fn(),
  })),
  Tray: jest.fn().mockImplementation(() => ({
    setToolTip: jest.fn(),
    setContextMenu: jest.fn(),
    on: jest.fn(),
  })),
  Menu: {
    buildFromTemplate: jest.fn().mockReturnValue({}),
  },
  nativeImage: {
    createEmpty: jest.fn().mockReturnValue({ resize: jest.fn().mockReturnThis() }),
    createFromPath: jest.fn().mockReturnValue({ resize: jest.fn().mockReturnThis() }),
  },
  powerMonitor: {
    getSystemIdleTime: jest.fn().mockReturnValue(0),
    on: jest.fn(),
    getSystemPowerState: jest.fn().mockReturnValue({ isOnBatteryPower: false, percent: 100 }),
  },
  screen: {
    getAllDisplays: jest.fn().mockReturnValue([{ bounds: { x: 0, y: 0, width: 1920, height: 1080 } }]),
    getPrimaryDisplay: jest.fn().mockReturnValue({ bounds: { x: 0, y: 0, width: 1920, height: 1080 }, workArea: { x: 0, y: 0, width: 1920, height: 1080 } }),
  },
  globalShortcut: {
    register: jest.fn(),
    unregisterAll: jest.fn(),
  },
  shell: {
    openExternal: jest.fn(),
  },
};

module.exports = electron;
