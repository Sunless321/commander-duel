import { contextBridge, ipcRenderer } from 'electron';
import type { ArchidektResult, DuelBridge } from '../src/net/protocol';

const duel: DuelBridge = {
  getEngine: () => ipcRenderer.invoke('engine:get'),
  restartEngine: () => ipcRenderer.invoke('engine:restart'),
  importArchidekt: (text: string): Promise<ArchidektResult> => ipcRenderer.invoke('deck:import', text),
  saveRecording: (r) => ipcRenderer.invoke('recording:save', r),
  listRecordings: () => ipcRenderer.invoke('recording:list'),
  loadRecording: (id) => ipcRenderer.invoke('recording:load', id),
  deleteRecording: (id) => ipcRenderer.invoke('recording:delete', id),
};

contextBridge.exposeInMainWorld('duel', duel);
