import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeft, ChevronDown, CirclePlay, Download, FolderOpen, Gauge, Music2,
  Pause, Play, Redo2, RotateCcw, Save, Settings2, SlidersHorizontal, Sparkles,
  Trash2, Undo2, Upload, X,
} from 'lucide-react'
import type { Chart, ChartNote, ToolMode } from './types'
import { Badge, Button, Dialog, DialogContent, Input, Select, Slider } from './components/ui'

const SUBDIVISIONS = [2, 3, 4, 6, 8, 12, 16, 24, 32] as const
const PLAYBACK_RATES = [0.5, 0.75, 1] as const
const LANE_COLORS = ['#31d7ff', '#b788ff', '#b788ff', '#31d7ff']
const BPM_THRESHOLD = { min: 20, max: 400 }

const DEFAULT_CHART: Chart = {
  version: 1,
  title: 'Untitled constellation',
  artist: '',
  audioPath: '',
  audioName: '',
  bpm: 120,
  offset: 0,
  duration: 120000,
  notes: [],
  settings: { laneTilt: 0, scrollSpeed: 7, editorZoom: 230, timingWindow: 'standard', keys: ['F', 'G', 'H', 'J'] },
}

const uid = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v))
const formatTime = (ms: number) => {
  const total = Math.max(0, ms) / 1000
  const min = Math.floor(total / 60)
  const sec = Math.floor(total % 60).toString().padStart(2, '0')
  const milli = Math.floor((total % 1) * 1000).toString().padStart(3, '0')
  return `${min}:${sec}.${milli}`
}

function IconButton({ label, children, disabled, onClick }: { label: string; children: React.ReactNode; disabled?: boolean; onClick?: () => void }) {
  return <Button variant="outline" size="icon" className="icon-button" aria-label={label} title={label} disabled={disabled} onClick={onClick}>{children}</Button>
}

function App() {
  const [chart, setChart] = useState<Chart>(DEFAULT_CHART)
  const [currentTime, setCurrentTime] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)
  const [playbackRate, setPlaybackRate] = useState<(typeof PLAYBACK_RATES)[number]>(1)
  const [subdivision, setSubdivision] = useState<(typeof SUBDIVISIONS)[number]>(4)
  const [tool, setTool] = useState<ToolMode>('note')
  const [holdStart, setHoldStart] = useState<{ lane: number; time: number } | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [history, setHistory] = useState<ChartNote[][]>([])
  const [future, setFuture] = useState<ChartNote[][]>([])
  const [view, setView] = useState<'editor' | 'play'>('editor')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [chartPath, setChartPath] = useState('')
  const [audioUrl, setAudioUrl] = useState('')
  const [toast, setToast] = useState('')
  const [bpmDraft, setBpmDraft] = useState(String(DEFAULT_CHART.bpm))
  const [offsetDraft, setOffsetDraft] = useState(String(DEFAULT_CHART.offset))
  const audioRef = useRef<HTMLAudioElement>(null)
  const audioInputRef = useRef<HTMLInputElement>(null)
  const chartInputRef = useRef<HTMLInputElement>(null)
  const objectUrlRef = useRef('')
  const rafRef = useRef(0)
  const editorPlayingRef = useRef(false)

  const showToast = (message: string) => {
    setToast(message)
    window.setTimeout(() => setToast(''), 2400)
  }

  const commitNotes = useCallback((next: ChartNote[]) => {
    setChart(prev => {
      setHistory(h => [...h.slice(-79), prev.notes])
      setFuture([])
      return { ...prev, notes: next.sort((a, b) => a.time - b.time) }
    })
  }, [])

  const undo = () => {
    if (!history.length) return
    const previous = history[history.length - 1]
    setFuture(f => [chart.notes, ...f])
    setHistory(h => h.slice(0, -1))
    setChart(c => ({ ...c, notes: previous }))
    setSelectedIds(new Set())
  }

  const redo = () => {
    if (!future.length) return
    const next = future[0]
    setHistory(h => [...h, chart.notes])
    setFuture(f => f.slice(1))
    setChart(c => ({ ...c, notes: next }))
    setSelectedIds(new Set())
  }

  const stopAnimation = useCallback(() => cancelAnimationFrame(rafRef.current), [])

  const tick = useCallback(() => {
    if (!audioRef.current) return
    setCurrentTime(audioRef.current.currentTime * 1000)
    if (!audioRef.current.paused) rafRef.current = requestAnimationFrame(tick)
  }, [])

  const togglePlay = async () => {
    const audio = audioRef.current
    if (!audioUrl || !audio) { showToast('请先选择歌曲音频'); return }
    if (editorPlayingRef.current) {
      audio.pause()
      stopAnimation()
      const beatStep = 60000 / chart.bpm / subdivision
      const snapped = Math.round((audio.currentTime * 1000 - chart.offset) / beatStep) * beatStep + chart.offset
      audio.currentTime = clamp(snapped, 0, chart.duration) / 1000
      setCurrentTime(audio.currentTime * 1000)
      editorPlayingRef.current = false
      setIsPlaying(false)
    } else {
      audio.playbackRate = playbackRate
      try {
        await audio.play()
        editorPlayingRef.current = true
        setIsPlaying(true)
        rafRef.current = requestAnimationFrame(tick)
      } catch { showToast('音频无法播放，请重新选择文件') }
    }
  }

  const seek = (time: number) => {
    const value = clamp(time, 0, chart.duration)
    setCurrentTime(value)
    if (audioRef.current) audioRef.current.currentTime = value / 1000
  }

  const applyOffset = (value: number) => {
    if (!Number.isFinite(value)) return
    setChart(previous => {
      const delta = value - previous.offset
      if (!delta) return previous
      return {
        ...previous,
        offset: value,
        notes: previous.notes.map(note => ({
          ...note,
          time: note.time + delta,
          endTime: note.endTime === undefined ? undefined : note.endTime + delta,
        })),
      }
    })
  }

  const applyBpm = (value: number) => {
    if (!Number.isFinite(value) || value < BPM_THRESHOLD.min || value > BPM_THRESHOLD.max) return
    setChart(previous => {
      if (value === previous.bpm) return previous
      const timeScale = previous.bpm / value
      const scaleFromOffset = (time: number) => previous.offset + (time - previous.offset) * timeScale
      return {
        ...previous,
        bpm: value,
        notes: previous.notes.map(note => ({
          ...note,
          time: scaleFromOffset(note.time),
          endTime: note.endTime === undefined ? undefined : scaleFromOffset(note.endTime),
        })),
      }
    })
  }

  const chooseAudio = async () => {
    if (!window.moonweave) { audioInputRef.current?.click(); return }
    const result = await window.moonweave.chooseAudio()
    if (!result) return
    setAudioUrl(result.url)
    setChart(c => ({ ...c, audioPath: result.path, audioName: result.name }))
    setCurrentTime(0)
  }

  const saveChart = async () => {
    if (!window.moonweave) {
      const blob = new Blob([JSON.stringify(chart, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a'); anchor.href = url; anchor.download = `${chart.title.replace(/[<>:\"/\\|?*]/g, '_')}.moon.json`; anchor.click()
      URL.revokeObjectURL(url); showToast('谱面已下载'); return
    }
    const path = await window.moonweave.saveChart({ title: chart.title, currentPath: chartPath, chart })
    if (path) { setChartPath(path); showToast('谱面已保存，并保留旧版本备份') }
  }

  const loadChart = async () => {
    if (!window.moonweave) { chartInputRef.current?.click(); return }
    const result = await window.moonweave.loadChart()
    if (!result) return
    const loaded = { ...DEFAULT_CHART, ...result.chart, settings: { ...DEFAULT_CHART.settings, ...result.chart.settings } }
    setChart(loaded)
    setChartPath(result.path)
    setHistory([]); setFuture([]); setSelectedIds(new Set()); setCurrentTime(0)
    if (loaded.audioPath) setAudioUrl(`moon-audio://local/${encodeURIComponent(loaded.audioPath)}`)
    showToast('谱面已载入')
  }

  useEffect(() => () => stopAnimation(), [stopAnimation])
  useEffect(() => { setBpmDraft(String(chart.bpm)) }, [chart.bpm])
  useEffect(() => { setOffsetDraft(String(chart.offset)) }, [chart.offset])
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); event.shiftKey ? redo() : undo() }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); saveChart() }
      const target = event.target as HTMLElement
      const editing = target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement || target.isContentEditable
      if (view === 'editor' && !editing) {
        if (event.repeat) return
        const beat = 60000 / chart.bpm
        const step = beat / subdivision
        if (event.code === 'KeyQ') { event.preventDefault(); togglePlay() }
        if (event.code === 'Delete' && selectedIds.size) {
          event.preventDefault(); commitNotes(chart.notes.filter(note => !selectedIds.has(note.id))); setSelectedIds(new Set()); setTool('note')
        }
        if (event.code === 'ArrowUp') { event.preventDefault(); seek(currentTime + step) }
        if (event.code === 'ArrowDown') { event.preventDefault(); seek(currentTime - step) }
        if (event.code === 'Space') { event.preventDefault(); seek(currentTime + beat) }
      }
    }
    window.addEventListener('keydown', keydown)
    return () => window.removeEventListener('keydown', keydown)
  })

  return (
    <div className="app-shell">
      <audio ref={audioRef} src={audioUrl || undefined} onLoadedMetadata={e => {
        const duration = e.currentTarget.duration * 1000
        if (Number.isFinite(duration)) setChart(c => ({ ...c, duration }))
      }} onEnded={() => { editorPlayingRef.current = false; setIsPlaying(false); setCurrentTime(chart.duration); stopAnimation() }} />
      <Input ref={audioInputRef} className="sr-only" type="file" accept="audio/*,.flac,.m4a" onChange={event => {
        const file = event.target.files?.[0]; if (!file) return
        if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current)
        objectUrlRef.current = URL.createObjectURL(file); setAudioUrl(objectUrlRef.current)
        setChart(c => ({ ...c, audioName: file.name, audioPath: '' })); setCurrentTime(0); event.target.value = ''
      }} />
      <Input ref={chartInputRef} className="sr-only" type="file" accept="application/json,.json" onChange={async event => {
        const file = event.target.files?.[0]; if (!file) return
        try { const value = JSON.parse(await file.text()); setChart({ ...DEFAULT_CHART, ...value, settings: { ...DEFAULT_CHART.settings, ...value.settings } }); setHistory([]); setFuture([]); setSelectedIds(new Set()); setCurrentTime(0); showToast('谱面已载入') }
        catch { showToast('谱面文件格式无效') }
        event.target.value = ''
      }} />

      {view === 'editor' ? (
        <>
          <header className="topbar">
            <div className="brand"><div className="brand-mark"><Sparkles size={18} /></div><div><b>MOONWEAVE</b><span>CHART STUDIO</span></div></div>
            <div className="song-heading">
              <Input value={chart.title} onChange={e => setChart(c => ({ ...c, title: e.target.value }))} aria-label="歌曲标题" />
              <span>{chart.audioName || '尚未选择音频'} · {chart.notes.length} NOTES</span>
            </div>
            <div className="top-actions">
              <IconButton label="打开谱面" onClick={loadChart}><FolderOpen size={18} /></IconButton>
              <IconButton label="保存谱面" onClick={saveChart}><Save size={18} /></IconButton>
              <Button className="playtest-button" onClick={() => { if (!audioUrl) showToast('请先选择歌曲音频'); else { audioRef.current?.pause(); editorPlayingRef.current = false; setIsPlaying(false); setView('play'); seek(0) } }}><CirclePlay size={18} /> 谱面试玩</Button>
            </div>
          </header>

          <main className="workspace">
            <aside className="left-panel panel">
              <section>
                <label className="section-label">谱面工具</label>
                <div className="tool-grid">
                  <Button variant="outline" className={tool === 'note' ? 'active' : ''} onClick={() => { setTool('note'); setHoldStart(null); setSelectedIds(new Set()) }}><span className="note-glyph tap" />NOTE<small>单击放置</small></Button>
                  <Button variant="outline" className={tool === 'hold' ? 'active' : ''} onClick={() => { setTool('hold'); setSelectedIds(new Set()) }}><span className="note-glyph hold" />HOLD<small>{holdStart ? '选择终点' : '两次点击'}</small></Button>
                  <Button variant="destructive" className={tool === 'delete' ? 'active danger' : 'danger'} onClick={() => {
                    if (selectedIds.size) { commitNotes(chart.notes.filter(note => !selectedIds.has(note.id))); setSelectedIds(new Set()); setTool('note') }
                    else { setTool('delete'); setHoldStart(null) }
                  }}><Trash2 size={20} />删除<small>{selectedIds.size ? `删除 ${selectedIds.size} 个` : '点击移除'}</small></Button>
                </div>
              </section>
              <section>
                <label className="section-label">吸附精度</label>
                <div className="select-wrap"><Select value={subdivision} onChange={e => setSubdivision(Number(e.target.value) as typeof subdivision)}>{SUBDIVISIONS.map(v => <option key={v} value={v}>1 / {v}</option>)}</Select><ChevronDown size={15} /></div>
                <p className="hint">仅影响放置吸附，已有音符不会移动</p>
              </section>
              <section className="song-config">
                <label className="section-label">歌曲配置</label>
                <label>歌曲标题<Input value={chart.title} onChange={e => setChart(c => ({ ...c, title: e.target.value }))} /></label>
                <label>艺术家<Input value={chart.artist} placeholder="Unknown artist" onChange={e => setChart(c => ({ ...c, artist: e.target.value }))} /></label>
                <div className="field-row"><label>BPM<Input inputMode="decimal" value={bpmDraft} onChange={event => {
                  const raw = event.target.value; setBpmDraft(raw)
                  const value = Number(raw)
                  if (raw !== '') applyBpm(value)
                }} onBlur={() => {
                  const value = Number(bpmDraft)
                  if (bpmDraft === '' || !Number.isFinite(value) || value < BPM_THRESHOLD.min || value > BPM_THRESHOLD.max) {
                    showToast(`BPM 需在 ${BPM_THRESHOLD.min}–${BPM_THRESHOLD.max} 之间，本次修改未应用`); setBpmDraft(String(chart.bpm))
                  }
                }} /></label><label>谱面偏移 ms<Input inputMode="numeric" value={offsetDraft} onChange={event => {
                  const raw = event.target.value; setOffsetDraft(raw)
                  if (raw !== '' && Number.isFinite(Number(raw))) applyOffset(Number(raw))
                }} onBlur={() => { if (offsetDraft === '' || !Number.isFinite(Number(offsetDraft))) { showToast('偏移值必须是有效毫秒数'); setOffsetDraft(String(chart.offset)) } }} /></label></div>
                <Button variant="outline" className="audio-picker" onClick={chooseAudio}><Music2 size={18} /><span><b>{chart.audioName || '选择音频文件'}</b><small>MP3, WAV, OGG, M4A, FLAC</small></span><Upload size={16} /></Button>
              </section>
              <section className="history-actions">
                <Button variant="outline" onClick={undo} disabled={!history.length}><Undo2 size={17} />撤回</Button>
                <Button variant="outline" onClick={redo} disabled={!future.length}><Redo2 size={17} />重做</Button>
              </section>
            </aside>

            <aside className="shortcut-rail" aria-label="编辑器快捷键">
              <div><kbd>Q</kbd><span>播放<br />暂停</span></div>
              <div><kbd>Space</kbd><span>前进<br />主拍</span></div>
              <div><kbd>↑</kbd><kbd>↓</kbd><span>分拍<br />步进</span></div>
              <div><kbd>Ctrl</kbd><span>滚轮<br />缩放</span></div>
              <div><kbd>⌃ Z</kbd><span>撤回</span></div>
              <div><kbd>⇧ Z</kbd><span>重做</span></div>
              <div><kbd>⌃ S</kbd><span>保存</span></div>
              <div><kbd>Del</kbd><span>删除<br />选中</span></div>
            </aside>

            <Editor chart={chart} currentTime={currentTime} subdivision={subdivision} tool={tool} holdStart={holdStart} selectedIds={selectedIds} zoom={chart.settings.editorZoom} isPlaying={isPlaying} onSeek={seek} onNotesChange={commitNotes} onHoldStart={setHoldStart} onSelectionChange={setSelectedIds} onZoomChange={editorZoom => setChart(c => ({ ...c, settings: { ...c.settings, editorZoom } }))} />

            <aside className="right-panel panel">
              <section className="inspector-head"><div><label className="section-label">编辑器状态</label><b>{isPlaying ? '实时制谱' : '已暂停'}</b></div><Badge className={isPlaying ? 'status live' : 'status'}>{isPlaying ? 'PLAY' : 'READY'}</Badge></section>
              <section className="time-card"><span>当前时间</span><strong>{formatTime(currentTime)}</strong><div><span>总时长</span><b>{formatTime(chart.duration)}</b></div></section>
              <section>
                <label className="section-label">时间轴</label>
                <Slider className="range" min="0" max={chart.duration || 1} value={currentTime} onValueChange={seek} />
              </section>
              <section>
                <label className="section-label">编辑播放速度</label>
                <div className="segmented">{PLAYBACK_RATES.map(rate => <Button variant="ghost" key={rate} className={playbackRate === rate ? 'active' : ''} onClick={() => { setPlaybackRate(rate); if (audioRef.current) audioRef.current.playbackRate = rate }}>{rate}×</Button>)}</div>
              </section>
              <section className="summary-card"><div><span>NOTE</span><b>{chart.notes.filter(n => n.kind === 'note').length}</b></div><div><span>HOLD</span><b>{chart.notes.filter(n => n.kind === 'hold').length}</b></div><div><span>密度</span><b>{(chart.notes.length / Math.max(1, chart.duration / 60000)).toFixed(1)} /m</b></div></section>
              <Button variant="outline" className="settings-button" onClick={() => setSettingsOpen(true)}><Settings2 size={18} /><span><b>玩法设置</b><small>轨道、速度、判定与按键</small></span><ChevronDown size={16} /></Button>
              <div className="editor-tip"><SlidersHorizontal size={17} /><span>播放时仍可放置音符。暂停后最近的吸附线会自动对准判定线。</span></div>
            </aside>
          </main>

          <footer className="transport">
            <div className="transport-time">{formatTime(currentTime).slice(0, -4)}<span> / {formatTime(chart.duration).slice(0, -4)}</span></div>
            <Button size="icon" className="transport-play" onClick={togglePlay}>{isPlaying ? <Pause fill="currentColor" /> : <Play fill="currentColor" />}</Button>
            <div className="transport-meta"><div className="mini-wave">{Array.from({ length: 34 }, (_, i) => <i key={i} style={{ height: `${8 + (Math.sin(i * 1.7) + 1) * 8}px` }} />)}</div></div>
          </footer>
        </>
      ) : (
        <Playtest chart={chart} audio={audioRef.current} audioUrl={audioUrl} onExit={() => { audioRef.current?.pause(); editorPlayingRef.current = false; setView('editor'); setIsPlaying(false); seek(0) }} />
      )}

      {settingsOpen && <SettingsModal chart={chart} onChange={setChart} onClose={() => setSettingsOpen(false)} />}
      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}

interface EditorProps {
  chart: Chart; currentTime: number; subdivision: number; tool: ToolMode; holdStart: { lane: number; time: number } | null; selectedIds: Set<string>; zoom: number; isPlaying: boolean
  onSeek(time: number): void; onNotesChange(notes: ChartNote[]): void; onHoldStart(value: { lane: number; time: number } | null): void; onSelectionChange(ids: Set<string>): void; onZoomChange(value: number): void
}

function Editor({ chart, currentTime, subdivision, tool, holdStart, selectedIds, zoom, isPlaying, onSeek, onNotesChange, onHoldStart, onSelectionChange, onZoomChange }: EditorProps) {
  const laneRef = useRef<HTMLDivElement>(null)
  const [laneHeight, setLaneHeight] = useState(700)
  const [dragPreview, setDragPreview] = useState<Record<string, { lane: number; time: number; endTime?: number }>>({})
  const dragPreviewRef = useRef<Record<string, { lane: number; time: number; endTime?: number }>>({})
  const pps = zoom
  const headerHeight = 34
  const judgmentY = Math.max(300, laneHeight - headerHeight - 18)
  const beat = 60000 / chart.bpm
  const step = beat / subdivision
  const lines = useMemo(() => {
    const from = currentTime - ((laneHeight - headerHeight - judgmentY + 120) / pps * 1000)
    const to = currentTime + ((judgmentY + 120) / pps * 1000)
    const first = Math.floor((from - chart.offset) / step)
    const result: { time: number; major: boolean; index: number }[] = []
    for (let i = first; chart.offset + i * step <= to; i++) {
      if (chart.offset + i * step < 0) continue
      result.push({ time: chart.offset + i * step, major: i % subdivision === 0, index: i })
    }
    return result
  }, [currentTime, chart.offset, chart.bpm, step, subdivision, laneHeight, judgmentY, pps])

  const yAt = (time: number) => judgmentY - (time - currentTime) / 1000 * pps
  const pointerTime = (clientY: number) => {
    const rect = laneRef.current!.getBoundingClientRect()
    const raw = currentTime + (judgmentY - (clientY - rect.top - headerHeight)) / pps * 1000
    return clamp(Math.round((raw - chart.offset) / step) * step + chart.offset, 0, chart.duration)
  }

  const laneClick = (event: React.MouseEvent, lane: number) => {
    if (selectedIds.size) { onSelectionChange(new Set()); return }
    const time = pointerTime(event.clientY)
    if (tool === 'delete') return
    if (tool === 'note') onNotesChange([...chart.notes, { id: uid(), lane, time, kind: 'note' }])
    else if (!holdStart) onHoldStart({ lane, time })
    else {
      const start = Math.min(holdStart.time, time)
      const end = Math.max(holdStart.time, time)
      if (end - start >= step * 0.5) onNotesChange([...chart.notes, { id: uid(), lane: holdStart.lane, time: start, endTime: end, kind: 'hold' }])
      onHoldStart(null)
    }
  }

  const noteMouseDown = (event: React.MouseEvent, id: string) => {
    if (event.button !== 0) return
    event.stopPropagation()
    event.preventDefault()
    if (tool === 'delete') { onNotesChange(chart.notes.filter(n => n.id !== id)); return }

    const nextSelection = new Set(selectedIds)
    nextSelection.add(id)
    onSelectionChange(nextSelection)

    const startX = event.clientX
    const startY = event.clientY
    const rect = laneRef.current!.getBoundingClientRect()
    const selectedNotes = chart.notes.filter(note => nextSelection.has(note.id))
    const earliest = Math.min(...selectedNotes.map(note => note.time))
    const latest = Math.max(...selectedNotes.map(note => note.endTime ?? note.time))

    const move = (moveEvent: MouseEvent) => {
      const laneDelta = Math.round((moveEvent.clientX - startX) / (rect.width / 4))
      const requestedTimeDelta = Math.round((-(moveEvent.clientY - startY) / pps * 1000) / step) * step
      const timeDelta = clamp(requestedTimeDelta, -earliest, chart.duration - latest)
      const preview: Record<string, { lane: number; time: number; endTime?: number }> = {}
      selectedNotes.forEach(note => {
        preview[note.id] = {
          lane: clamp(note.lane + laneDelta, 0, 3),
          time: note.time + timeDelta,
          endTime: note.endTime === undefined ? undefined : note.endTime + timeDelta,
        }
      })
      dragPreviewRef.current = preview
      setDragPreview(preview)
    }
    const up = () => {
      const preview = dragPreviewRef.current
      if (Object.keys(preview).length) onNotesChange(chart.notes.map(note => preview[note.id] ? { ...note, ...preview[note.id] } : note))
      dragPreviewRef.current = {}; setDragPreview({})
      window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  const resizeHold = (event: React.MouseEvent, edge: 'start' | 'end') => {
    if (event.button !== 0) return
    event.stopPropagation(); event.preventDefault()
    const holds = chart.notes.filter(note => note.kind === 'hold' && selectedIds.has(note.id))
    if (!holds.length) return
    const startY = event.clientY

    const move = (moveEvent: MouseEvent) => {
      const requestedDelta = Math.round((-(moveEvent.clientY - startY) / pps * 1000) / step) * step
      const minimumLength = step
      const minDelta = edge === 'end'
        ? Math.max(...holds.map(note => note.time + minimumLength - note.endTime!))
        : Math.max(...holds.map(note => -note.time))
      const maxDelta = edge === 'end'
        ? Math.min(...holds.map(note => chart.duration - note.endTime!))
        : Math.min(...holds.map(note => note.endTime! - minimumLength - note.time))
      const delta = clamp(requestedDelta, minDelta, maxDelta)
      const preview: Record<string, { lane: number; time: number; endTime?: number }> = {}
      holds.forEach(note => {
        preview[note.id] = {
          lane: note.lane,
          time: edge === 'start' ? note.time + delta : note.time,
          endTime: edge === 'end' ? note.endTime! + delta : note.endTime,
        }
      })
      dragPreviewRef.current = preview; setDragPreview(preview)
    }
    const up = () => {
      const preview = dragPreviewRef.current
      if (Object.keys(preview).length) onNotesChange(chart.notes.map(note => preview[note.id] ? { ...note, ...preview[note.id] } : note))
      dragPreviewRef.current = {}; setDragPreview({})
      window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up)
    }
    window.addEventListener('mousemove', move); window.addEventListener('mouseup', up)
  }

  useEffect(() => {
    if (!laneRef.current) return
    const observer = new ResizeObserver(entries => setLaneHeight(entries[0].contentRect.height))
    observer.observe(laneRef.current)
    return () => observer.disconnect()
  }, [])

  const handleWheel = useCallback((event: WheelEvent) => {
    event.preventDefault()
    if (event.ctrlKey) {
      const factor = event.deltaY < 0 ? 1.12 : 1 / 1.12
      onZoomChange(clamp(Math.round(pps * factor), 90, 1320))
    } else {
      onSeek(currentTime - event.deltaY / pps * 1000)
    }
  }, [currentTime, onSeek, onZoomChange, pps])

  useEffect(() => {
    const element = laneRef.current
    if (!element) return
    element.addEventListener('wheel', handleWheel, { passive: false })
    return () => element.removeEventListener('wheel', handleWheel)
  }, [handleWheel])

  return (
    <section className="editor-stage">
      <div className="stage-caption"><span>OVERVIEW</span><span>4K TIMELINE · CTRL + WHEEL {Math.round(pps / 2.3)}%</span><span>{selectedIds.size ? `SELECTED ${selectedIds.size}` : isPlaying ? 'RECORDING INPUT' : `SNAP 1/${subdivision}`}</span></div>
      <div className="editor-body">
        <div className="minimap" onClick={e => {
          const rect = e.currentTarget.getBoundingClientRect(); onSeek((rect.bottom - e.clientY) / rect.height * chart.duration)
        }}>
          <div className="minimap-beats" style={{ backgroundSize: `100% ${Math.max(.5, (60000 / chart.bpm) / chart.duration * 100)}%` }} />
          {chart.notes.map(n => <i key={n.id} style={{ bottom: `${n.time / chart.duration * 100}%`, left: `${10 + n.lane * 11}px`, height: n.kind === 'hold' ? `${Math.max(3, ((n.endTime! - n.time) / chart.duration) * 100)}%` : 2, background: LANE_COLORS[n.lane] }} />)}
          <div className="minimap-window" style={{ bottom: `${clamp(currentTime / chart.duration * 100, 0, 94)}%` }} />
        </div>
        <div className="lane-editor" ref={laneRef}>
          <div className="lane-header">{chart.settings.keys.map((k, i) => <div key={i}><span>{i + 1}</span><b>{k}</b></div>)}</div>
          <div className="beat-layer">{lines.map(line => {
            const y = yAt(line.time)
            const position = ((line.index % subdivision) + subdivision) % subdivision
            const tone = line.major ? 'major' : subdivision === 3 || (subdivision % 2 === 0 && position === subdivision / 2) ? 'blue' : 'violet'
            return <div key={line.index} className={`beat-line ${tone}`} style={{ top: y }}><span>{line.major ? Math.floor((line.time - chart.offset) / beat) + 1 : ''}</span></div>
          })}</div>
          <div className="lanes">{[0, 1, 2, 3].map(lane => <div className={`edit-lane lane-${lane}`} key={lane} onMouseDown={e => laneClick(e, lane)} />)}</div>
          <div className="notes-layer">{chart.notes.map(originalNote => {
            const preview = dragPreview[originalNote.id]
            const note = preview ? { ...originalNote, ...preview } : originalNote
            const y = yAt(note.time)
            const endY = note.kind === 'hold' ? yAt(note.endTime!) : y
            if (y < -150 || endY > laneHeight) return null
            return <div key={note.id} className={`editor-note ${note.kind} ${selectedIds.has(note.id) ? 'selected' : ''} ${tool === 'delete' ? 'deletable' : ''}`} onMouseDown={e => noteMouseDown(e, note.id)} style={{ left: `${note.lane * 25 + 1.6}%`, top: note.kind === 'hold' ? endY : y - 7, height: note.kind === 'hold' ? Math.max(16, y - endY + 12) : 14, '--lane': LANE_COLORS[note.lane] } as React.CSSProperties}><i />{note.kind === 'hold' && selectedIds.has(note.id) && <><Button className="hold-resize-handle end" aria-label="调整 Hold 终点" onMouseDown={event => resizeHold(event, 'end')} /><Button className="hold-resize-handle start" aria-label="调整 Hold 起点" onMouseDown={event => resizeHold(event, 'start')} /></>}</div>
          })}{holdStart && <div className="hold-pending" style={{ left: `${holdStart.lane * 25 + 2}%`, top: yAt(holdStart.time) - 8 }} />}</div>
          <div className="judgment-line" style={{ top: headerHeight + judgmentY }}><span>JUDGEMENT</span></div>
        </div>
      </div>
    </section>
  )
}

function SettingsModal({ chart, onChange, onClose }: { chart: Chart; onChange(chart: Chart): void; onClose(): void }) {
  const update = (patch: Partial<Chart['settings']>) => onChange({ ...chart, settings: { ...chart.settings, ...patch } })
  return <Dialog open onOpenChange={open => { if (!open) onClose() }}><DialogContent>
    <div className="modal-head"><div><span>PLAYSTYLE</span><h2>玩法设置</h2></div><IconButton label="关闭" onClick={onClose}><X /></IconButton></div>
    <label className="setting-row"><span><b>轨道倾斜度</b><small>改变透视角度，不影响判定</small></span><div><Slider min="0" max="18" value={chart.settings.laneTilt} onValueChange={value => update({ laneTilt: value })} /><output>{chart.settings.laneTilt}°</output></div></label>
    <label className="setting-row"><span><b>下落速度</b><small>试玩时音符的视觉速度</small></span><div><Slider min="4" max="12" step="0.5" value={chart.settings.scrollSpeed} onValueChange={value => update({ scrollSpeed: value })} /><output>{chart.settings.scrollSpeed}</output></div></label>
    <div className="setting-block"><span><b>判定宽松度</b><small>Perfect / Good / Miss 的时间窗口</small></span><div className="segmented">{(['strict', 'standard', 'relaxed'] as const).map((v, i) => <Button variant="ghost" key={v} className={chart.settings.timingWindow === v ? 'active' : ''} onClick={() => update({ timingWindow: v })}>{['严格', '标准', '宽松'][i]}</Button>)}</div></div>
    <div className="setting-block"><span><b>默认按键</b><small>点击输入框后按下新按键</small></span><div className="key-inputs">{chart.settings.keys.map((key, index) => <Input key={index} value={key} maxLength={1} onChange={e => { const keys = [...chart.settings.keys]; keys[index] = e.target.value.slice(-1).toUpperCase(); update({ keys }) }} />)}</div></div>
    <Button className="primary full" onClick={onClose}>完成</Button>
  </DialogContent></Dialog>
}

function Playtest({ chart, audio, audioUrl, onExit }: { chart: Chart; audio: HTMLAudioElement | null; audioUrl: string; onExit(): void }) {
  const [time, setTime] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [pressed, setPressed] = useState<Set<number>>(new Set())
  const [judged, setJudged] = useState<Record<string, 'Perfect' | 'Good' | 'Miss'>>({})
  const [holdStarts, setHoldStarts] = useState<Record<string, 'Perfect' | 'Good' | 'Miss'>>({})
  const [flash, setFlash] = useState<number[]>([])
  const [lastJudge, setLastJudge] = useState('')
  const [judgePulse, setJudgePulse] = useState(0)
  const [combo, setCombo] = useState(0)
  const raf = useRef(0)
  const timeRef = useRef(0)
  const playingRef = useRef(false)
  const pressedRef = useRef<Set<number>>(new Set())
  const windows = useMemo(() => chart.settings.timingWindow === 'strict' ? [55, 105, 145] : chart.settings.timingWindow === 'relaxed' ? [95, 180, 240] : [75, 140, 190], [chart.settings.timingWindow])
  const holdStartsRef = useRef(holdStarts)
  const travelMs = 1400 * (7 / chart.settings.scrollSpeed)
  const announceJudge = useCallback((result: string) => { setLastJudge(result); setJudgePulse(value => value + 1) }, [])

  const animate = useCallback(() => {
    if (!audio) return
    const now = audio.currentTime * 1000
    timeRef.current = now; setTime(now)
    setJudged(prev => {
      let changed = false; const next = { ...prev }
      chart.notes.forEach(n => {
        if (next[n.id]) return
        const startedAs = holdStartsRef.current[n.id]
        if (n.kind === 'hold' && startedAs && now >= (n.endTime || n.time)) {
          const result = pressedRef.current.has(n.lane) ? startedAs : 'Miss'
          next[n.id] = result; changed = true
          setCombo(c => result === 'Miss' ? 0 : c + 1); announceJudge(result)
          setHoldStarts(starts => { const rest = { ...starts }; delete rest[n.id]; return rest })
        } else if (!startedAs && now - n.time > windows[2]) {
          next[n.id] = 'Miss'; changed = true; setCombo(0); announceJudge('Miss')
        }
      })
      return changed ? next : prev
    })
    if (!audio.paused) raf.current = requestAnimationFrame(animate)
  }, [announceJudge, audio, chart.notes, windows])

  const toggle = async () => {
    if (!audioUrl || !audio) return
    if (playingRef.current) { audio.pause(); cancelAnimationFrame(raf.current); playingRef.current = false; setPlaying(false) }
    else {
      if (audio.ended) { audio.currentTime = 0; setJudged({}); setHoldStarts({}); holdStartsRef.current = {}; setCombo(0); setLastJudge(''); setTime(0); timeRef.current = 0 }
      audio.playbackRate = 1; await audio.play(); playingRef.current = true; setPlaying(true); raf.current = requestAnimationFrame(animate)
    }
  }

  const restart = async () => {
    if (!audioUrl || !audio) return
    audio.pause(); cancelAnimationFrame(raf.current); audio.currentTime = 0
    setJudged({}); setHoldStarts({}); holdStartsRef.current = {}; setPressed(new Set()); pressedRef.current = new Set()
    setCombo(0); setLastJudge(''); setTime(0); timeRef.current = 0
    audio.playbackRate = 1
    await audio.play(); playingRef.current = true; setPlaying(true); raf.current = requestAnimationFrame(animate)
  }

  const hit = useCallback((lane: number) => {
    const now = timeRef.current
    const candidate = chart.notes.filter(n => n.lane === lane && !judged[n.id] && !holdStarts[n.id]).sort((a, b) => Math.abs(a.time - now) - Math.abs(b.time - now))[0]
    if (!candidate) return
    const delta = Math.abs(candidate.time - now)
    if (delta > windows[2]) return
    const result: 'Perfect' | 'Good' | 'Miss' = delta <= windows[0] ? 'Perfect' : delta <= windows[1] ? 'Good' : 'Miss'
    if (candidate.kind === 'hold' && result !== 'Miss') setHoldStarts(prev => ({ ...prev, [candidate.id]: result }))
    else {
      setJudged(prev => ({ ...prev, [candidate.id]: result }))
      setCombo(c => result === 'Miss' ? 0 : c + 1)
    }
    announceJudge(result)
    setFlash(f => [...f, lane]); window.setTimeout(() => setFlash(f => f.filter(x => x !== lane)), 120)
  }, [announceJudge, chart.notes, judged, holdStarts, windows])

  const releaseHold = useCallback((lane: number) => {
    const active = chart.notes.find(n => n.kind === 'hold' && n.lane === lane && holdStarts[n.id] && !judged[n.id])
    if (!active) return
    const delta = Math.abs((active.endTime || active.time) - timeRef.current)
    const result: 'Perfect' | 'Good' | 'Miss' = delta <= windows[0] ? holdStarts[active.id] : delta <= windows[1] ? 'Good' : 'Miss'
    setJudged(prev => ({ ...prev, [active.id]: result }))
    setHoldStarts(prev => { const next = { ...prev }; delete next[active.id]; return next })
    announceJudge(result); setCombo(c => result === 'Miss' ? 0 : c + 1)
  }, [announceJudge, chart.notes, holdStarts, judged, windows])

  useEffect(() => { holdStartsRef.current = holdStarts }, [holdStarts])

  useEffect(() => {
    if (!audio) return
    audio.currentTime = 0; timeRef.current = 0
    playingRef.current = false; setPlaying(false); setTime(0)
    return () => { audio.pause(); cancelAnimationFrame(raf.current) }
  }, [audio])

  useEffect(() => {
    if (!audio) return
    const ended = () => { playingRef.current = false; setPlaying(false); setTime(chart.duration); timeRef.current = chart.duration }
    const down = (e: KeyboardEvent) => {
      if (e.repeat) return
      if (e.code === 'Escape') onExit()
      if (e.code === 'Space') { e.preventDefault(); toggle(); return }
      const lane = chart.settings.keys.findIndex(k => k.toLowerCase() === e.key.toLowerCase())
      if (lane >= 0) { const next = new Set(pressedRef.current); next.add(lane); pressedRef.current = next; setPressed(next); hit(lane) }
    }
    const up = (e: KeyboardEvent) => { const lane = chart.settings.keys.findIndex(k => k.toLowerCase() === e.key.toLowerCase()); if (lane >= 0) { const next = new Set(pressedRef.current); next.delete(lane); pressedRef.current = next; setPressed(next); releaseHold(lane) } }
    window.addEventListener('keydown', down); window.addEventListener('keyup', up); audio.addEventListener('ended', ended)
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); audio.removeEventListener('ended', ended) }
  }, [audio, chart.duration, chart.settings.keys, hit, releaseHold])

  const visible = chart.notes.filter(n => !judged[n.id] && ((holdStarts[n.id] && (n.endTime || n.time) >= time) || (n.time >= time - 250 && n.time <= time + travelMs)))
  return <div className="playtest">
    <header className="play-head"><Button variant="outline" onClick={onExit}><ArrowLeft size={18} />返回编辑器</Button><div><b>{chart.title}</b><span>{chart.artist || 'MOONWEAVE PLAYTEST'}</span></div><div className="play-actions"><IconButton label="重新开始" onClick={restart}><RotateCcw size={17} /></IconButton><Button variant="outline" size="icon" aria-label={playing ? '暂停' : '继续'} onClick={toggle}>{playing ? <Pause /> : <Play />}</Button></div></header>
    <div className="game-area">
      <div className="game-stats"><span>SCORE</span><b>{Object.values(judged).filter(v => v !== 'Miss').length.toString().padStart(7, '0')}</b></div>
      <div className="game-lanes" style={{ transform: `perspective(850px) rotateX(${chart.settings.laneTilt}deg)` }}>
        <div className="game-beat-grid" style={{ '--beat-size': `${Math.max(60, (60000 / chart.bpm) / travelMs * 620)}px`, '--beat-offset': `${time / travelMs * 620}px` } as React.CSSProperties} />
        {[0, 1, 2, 3].map(lane => <div key={lane} className={`game-lane lane-${lane} ${pressed.has(lane) ? 'pressed' : ''} ${Object.keys(holdStarts).some(id => chart.notes.some(note => note.id === id && note.lane === lane)) ? 'holding' : ''} ${flash.includes(lane) ? 'hit-flash' : ''}`}><div className="key-cap">{chart.settings.keys[lane]}</div></div>)}
        {visible.map(note => {
          const progress = 1 - (note.time - time) / travelMs
          const top = (note.kind === 'hold' ? 1 - ((note.endTime || note.time) - time) / travelMs : progress) * 86
          const holdBottom = holdStarts[note.id] ? 86 : progress * 86
          const holdHeight = note.kind === 'hold' ? Math.max(1.8, holdBottom - top) : 0
          return <div key={note.id} className={`game-note ${note.kind} ${holdStarts[note.id] ? 'active-hold' : ''}`} style={{ left: `${note.lane * 25 + 2}%`, top: `${top}%`, height: note.kind === 'hold' ? `${holdHeight}%` : 18, '--lane': LANE_COLORS[note.lane] } as React.CSSProperties}><i /></div>
        })}
        <div className="game-judgment-line" />
      </div>
      {lastJudge && <div key={judgePulse} className={`judge-text ${lastJudge.toLowerCase()}`}>{lastJudge}<span>{combo > 1 ? `${combo} COMBO` : ''}</span></div>}
      {!playing && <Button variant="outline" className="game-pause" onClick={toggle}><Play fill="currentColor" /><b>{time > 0 ? '继续' : '开始试玩'}</b><span>SPACE</span></Button>}
      <div className="game-progress"><i style={{ width: `${time / chart.duration * 100}%` }} /></div>
    </div>
  </div>
}

export default App
