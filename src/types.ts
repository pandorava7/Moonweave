export type NoteKind = 'note' | 'hold'
export type ToolMode = NoteKind | 'delete' | 'region' | 'paste'

export interface ChartNote {
  id: string
  lane: number
  time: number
  endTime?: number
  kind: NoteKind
}

export interface ChartSettings {
  laneTilt: number
  scrollSpeed: number
  editorZoom: number
  timingWindow: 'strict' | 'standard' | 'relaxed'
  keys: string[]
}

export interface Chart {
  version: 1
  title: string
  artist: string
  audioPath: string
  audioName: string
  bpm: number
  offset: number
  duration: number
  notes: ChartNote[]
  settings: ChartSettings
}

export interface ElectronBridge {
  chooseAudio(): Promise<{ path: string; url: string; name: string } | null>
  saveChart(payload: { title: string; currentPath: string; chart: Chart }): Promise<string | null>
  loadChart(): Promise<{ path: string; chart: Chart; audioAvailable: boolean } | null>
  minimizeWindow(): void
  toggleMaximizeWindow(): void
  closeWindow(): void
}

declare global { interface Window { moonweave?: ElectronBridge } }
