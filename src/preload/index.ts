import { contextBridge } from 'electron'

const api = {
  version: '0.0.1'
}

contextBridge.exposeInMainWorld('pianoLearner', api)
