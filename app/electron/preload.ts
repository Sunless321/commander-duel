import { contextBridge, ipcRenderer } from 'electron';
import type { ArchidektResult, DuelBridge } from '../src/net/protocol';

const duel: DuelBridge = {
  getEngine: () => ipcRenderer.invoke('engine:get'),
  restartEngine: () => ipcRenderer.invoke('engine:restart'),
  // Stub: Task 8 implements the Archidekt import.
  importArchidekt: (_url: string): Promise<ArchidektResult> => Promise.reject(new Error('not implemented')),
};

contextBridge.exposeInMainWorld('duel', duel);
