const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("dshDesktop", {
  getSidecarStatus: () => ipcRenderer.invoke("sidecar:get"),
  startSidecar: () => ipcRenderer.invoke("sidecar:start"),
  stopSidecar: () => ipcRenderer.invoke("sidecar:stop"),
  restartSidecar: () => ipcRenderer.invoke("sidecar:restart"),
  openHarness: () => ipcRenderer.invoke("harness:open"),
  subscribeSidecar: (listener) => {
    const handler = (_event, snapshot) => listener(snapshot);
    ipcRenderer.on("sidecar:changed", handler);
    return () => ipcRenderer.removeListener("sidecar:changed", handler);
  },
  listProjects: () => ipcRenderer.invoke("projects:list"),
  chooseProject: () => ipcRenderer.invoke("projects:choose"),
  activateProject: (id) => ipcRenderer.invoke("projects:activate", id),
  removeProject: (id) => ipcRenderer.invoke("projects:remove", id),
  revealProject: (id) => ipcRenderer.invoke("projects:reveal", id),
  subscribeProjectPicker: (listener) => {
    const handler = () => listener();
    ipcRenderer.on("projects:choose-requested", handler);
    return () => ipcRenderer.removeListener("projects:choose-requested", handler);
  },
  getProtocolStatus: () => ipcRenderer.invoke("protocol:get"),
  refreshTasks: () => ipcRenderer.invoke("protocol:refresh"),
  createTask: (prompt) => ipcRenderer.invoke("tasks:create", prompt),
  cancelTask: (sessionId) => ipcRenderer.invoke("tasks:cancel", sessionId),
  sendTaskMessage: (sessionId, prompt, mode) => ipcRenderer.invoke("tasks:message", sessionId, prompt, mode),
  renameTask: (sessionId, title) => ipcRenderer.invoke("tasks:rename", sessionId, title),
  forkTask: (sessionId, atSeq) => ipcRenderer.invoke("tasks:fork", sessionId, atSeq),
  archiveTask: (sessionId) => ipcRenderer.invoke("tasks:archive", sessionId),
  getTaskReview: (sessionId) => ipcRenderer.invoke("review:get", sessionId),
  getTaskFileDiff: (sessionId, path) => ipcRenderer.invoke("review:diff", sessionId, path),
  commitTask: (sessionId, message) => ipcRenderer.invoke("review:commit", sessionId, message),
  discardTaskWorkspace: (sessionId) => ipcRenderer.invoke("review:discard", sessionId),
  openTaskWorkspace: (sessionId, target) => ipcRenderer.invoke("review:open", sessionId, target),
  getSettings: () => ipcRenderer.invoke("settings:get"),
  saveSettings: (input) => ipcRenderer.invoke("settings:save", input),
  testModelConnection: (input) => ipcRenderer.invoke("settings:test", input),
  exportDiagnostics: () => ipcRenderer.invoke("diagnostics:export"),
  respondApproval: (approvalId, outcome) => ipcRenderer.invoke("approvals:respond", approvalId, outcome),
  respondQuestion: (requestId, answers) => ipcRenderer.invoke("questions:respond", requestId, answers),
  getTaskTimeline: (sessionId) => ipcRenderer.invoke("tasks:timeline", sessionId),
  loadOlderTaskTimeline: (sessionId) => ipcRenderer.invoke("tasks:timeline-older", sessionId),
  subscribeTaskTimeline: (listener) => {
    const handler = (_event, snapshot) => listener(snapshot);
    ipcRenderer.on("tasks:timeline-changed", handler);
    return () => ipcRenderer.removeListener("tasks:timeline-changed", handler);
  },
  subscribeProtocol: (listener) => {
    const handler = (_event, snapshot) => listener(snapshot);
    ipcRenderer.on("protocol:changed", handler);
    return () => ipcRenderer.removeListener("protocol:changed", handler);
  },
  subscribeNewTask: (listener) => {
    const handler = () => listener();
    ipcRenderer.on("tasks:new-requested", handler);
    return () => ipcRenderer.removeListener("tasks:new-requested", handler);
  },
  subscribeInboxFocus: (listener) => {
    const handler = () => listener();
    ipcRenderer.on("inbox:focus", handler);
    return () => ipcRenderer.removeListener("inbox:focus", handler);
  },
});
