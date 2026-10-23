import { contextBridge, ipcRenderer } from 'electron';
import type { ArchidektResult, DuelBridge } from '../src/net/protocol';

const duel: DuelBridge = {
  getEngine: () => ipcRenderer.invoke('engine:get'),
  restartEngine: () => ipcRenderer.invoke('engine:restart'),
  importArchidekt: (text: string): Promise<ArchidektResult> => ipcRenderer.invoke('deck:import', text),
};

contextBridge.exposeInMainWorld('duel', duel);
