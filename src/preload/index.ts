// preload：只往渲染进程递六个方法，不递 node、不递 ipcRenderer 本体。
import { contextBridge, ipcRenderer } from 'electron';
import { IPC } from '../shared/ipc.ts';
import type { SandboxApi } from '../shared/ipc.ts';
import type { Params, World } from '../engine/types.ts';

const api: SandboxApi = {
  dataPath: () => ipcRenderer.invoke(IPC.dataPath) as Promise<string>,
  loadWorld: () => ipcRenderer.invoke(IPC.loadWorld) as Promise<World | null>,
  saveWorld: (world: World) => ipcRenderer.invoke(IPC.saveWorld, world) as Promise<boolean>,
  loadParams: () => ipcRenderer.invoke(IPC.loadParams) as Promise<Params | null>,
  saveParams: (params: Params) => ipcRenderer.invoke(IPC.saveParams, params) as Promise<boolean>,
  snapshot: (label: string) => ipcRenderer.invoke(IPC.snapshot, label) as Promise<string>,
};

contextBridge.exposeInMainWorld('sandbox', api);
