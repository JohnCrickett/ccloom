import { useState, useEffect, useRef, useCallback } from 'react'

const STORAGE_KEY = 'loom-clone-folder-path'
const MIC_STORAGE_KEY = 'loom-clone-selected-mic'
const CAMERA_STORAGE_KEY = 'loom-clone-selected-camera'
const MIC_ENABLED_KEY = 'loom-clone-mic-enabled'
const CAMERA_ENABLED_KEY = 'loom-clone-camera-enabled'
const SCREEN_ENABLED_KEY = 'loom-clone-screen-enabled'

// Check File System Access API support at module level
const isApiSupported = typeof window !== 'undefined' && 'showDirectoryPicker' in window

interface MediaDeviceInfo {
  deviceId: string
  label: string
  kind: MediaDeviceKind
}

interface RecordingMetadata {
  filename: string
  timestamp: Date
  size: number
  fileHandle: FileSystemFileHandle
}

function App() {
  // Initialize folder path from localStorage
  const [folderPath, setFolderPath] = useState<string | null>(() => {
    return localStorage.getItem(STORAGE_KEY)
  })
  const [folderHandle, setFolderHandle] = useState<FileSystemDirectoryHandle | null>(null)
  const [error, setError] = useState<string | null>(() => {
    if (!isApiSupported) {
      return 'Your browser does not support folder selection. Please use a modern browser like Chrome or Edge.'
    }
    return null
  })

  // Device state
  const [microphones, setMicrophones] = useState<MediaDeviceInfo[]>([])
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([])
  const [selectedMicId, setSelectedMicId] = useState<string>(() => {
    return localStorage.getItem(MIC_STORAGE_KEY) || ''
  })
  const [selectedCameraId, setSelectedCameraId] = useState<string>(() => {
    return localStorage.getItem(CAMERA_STORAGE_KEY) || ''
  })
  const [deviceError, setDeviceError] = useState<string | null>(null)
  const [permissionGranted, setPermissionGranted] = useState(false)

  // Toggle states for enabling/disabling devices
  const [isMicEnabled, setIsMicEnabled] = useState<boolean>(() => {
    const saved = localStorage.getItem(MIC_ENABLED_KEY)
    return saved === null ? true : saved === 'true'
  })
  const [isCameraEnabled, setIsCameraEnabled] = useState<boolean>(() => {
    const saved = localStorage.getItem(CAMERA_ENABLED_KEY)
    return saved === null ? true : saved === 'true'
  })
  const [isScreenEnabled, setIsScreenEnabled] = useState<boolean>(() => {
    const saved = localStorage.getItem(SCREEN_ENABLED_KEY)
    return saved === null ? false : saved === 'true'
  })
  const [screenStream, setScreenStream] = useState<MediaStream | null>(null)

  // Recording state
  const [isRecording, setIsRecording] = useState(false)
  const [recordingError, setRecordingError] = useState<string | null>(null)
  const [recordingDuration, setRecordingDuration] = useState(0)
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null)

  // Recordings list state
  const [recordings, setRecordings] = useState<RecordingMetadata[]>([])
  const [selectedRecording, setSelectedRecording] = useState<RecordingMetadata | null>(null)
  const [isLoadingRecordings, setIsLoadingRecordings] = useState(false)
  const [playbackUrl, setPlaybackUrl] = useState<string | null>(null)
  const [playbackError, setPlaybackError] = useState<string | null>(null)

  // Refs for recording
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const recordedChunksRef = useRef<Blob[]>([])
  const mediaStreamRef = useRef<MediaStream | null>(null)
  const recordingTimerRef = useRef<number | null>(null)

  // Detect available devices
  useEffect(() => {
    const detectDevices = async () => {
      // Check if mediaDevices API is available
      if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
        setDeviceError('Your browser does not support device detection.')
        return
      }

      try {
        // Request permission to access devices (needed to get device labels)
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: true,
          video: true
        })

        // Stop all tracks immediately - we just needed permission
        stream.getTracks().forEach(track => track.stop())
        setPermissionGranted(true)
        setDeviceError(null)

        // Now enumerate devices - labels will be available
        const devices = await navigator.mediaDevices.enumerateDevices()

        const mics = devices
          .filter(device => device.kind === 'audioinput')
          .map(device => ({
            deviceId: device.deviceId,
            label: device.label || `Microphone ${device.deviceId.slice(0, 8)}`,
            kind: device.kind as MediaDeviceKind
          }))

        const cams = devices
          .filter(device => device.kind === 'videoinput')
          .map(device => ({
            deviceId: device.deviceId,
            label: device.label || `Camera ${device.deviceId.slice(0, 8)}`,
            kind: device.kind as MediaDeviceKind
          }))

        setMicrophones(mics)
        setCameras(cams)

        // Auto-select first device if none saved
        const savedMicId = localStorage.getItem(MIC_STORAGE_KEY)
        const savedCameraId = localStorage.getItem(CAMERA_STORAGE_KEY)

        if (!savedMicId && mics.length > 0) {
          setSelectedMicId(mics[0].deviceId)
          localStorage.setItem(MIC_STORAGE_KEY, mics[0].deviceId)
        } else if (savedMicId && !mics.find(m => m.deviceId === savedMicId) && mics.length > 0) {
          // Saved device no longer exists, select first available
          setSelectedMicId(mics[0].deviceId)
          localStorage.setItem(MIC_STORAGE_KEY, mics[0].deviceId)
        }

        if (!savedCameraId && cams.length > 0) {
          setSelectedCameraId(cams[0].deviceId)
          localStorage.setItem(CAMERA_STORAGE_KEY, cams[0].deviceId)
        } else if (savedCameraId && !cams.find(c => c.deviceId === savedCameraId) && cams.length > 0) {
          // Saved device no longer exists, select first available
          setSelectedCameraId(cams[0].deviceId)
          localStorage.setItem(CAMERA_STORAGE_KEY, cams[0].deviceId)
        }

      } catch (err) {
        if (err instanceof Error) {
          if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
            setDeviceError('Permission denied. Please allow access to your microphone and camera to select devices.')
          } else if (err.name === 'NotFoundError') {
            setDeviceError('No microphone or camera found on your device.')
          } else {
            setDeviceError(`Failed to detect devices: ${err.message}`)
          }
        }
        setPermissionGranted(false)
      }
    }

    detectDevices()
  }, [])

  // Load recordings from the selected folder
  const loadRecordings = useCallback(async () => {
    if (!folderHandle) {
      setRecordings([])
      return
    }

    setIsLoadingRecordings(true)
    setPlaybackError(null)

    try {
      const recordingsList: RecordingMetadata[] = []

      // Iterate through files in the folder
      for await (const entry of folderHandle.values()) {
        if (entry.kind === 'file' && entry.name.endsWith('.webm')) {
          try {
            // Cast to FileSystemFileHandle since we checked entry.kind === 'file'
            const fileHandle = entry as FileSystemFileHandle
            const file = await fileHandle.getFile()

            // Extract timestamp from filename: recording-YYYY-MM-DD-HH-MM-SS.webm
            const match = entry.name.match(/recording-(\d{4})-(\d{2})-(\d{2})-(\d{2})-(\d{2})-(\d{2})\.webm/)
            let timestamp: Date
            if (match) {
              const [, year, month, day, hour, min, sec] = match
              timestamp = new Date(
                parseInt(year),
                parseInt(month) - 1,
                parseInt(day),
                parseInt(hour),
                parseInt(min),
                parseInt(sec)
              )
            } else {
              // Fallback to file modification time
              timestamp = new Date(file.lastModified)
            }

            recordingsList.push({
              filename: entry.name,
              timestamp,
              size: file.size,
              fileHandle: fileHandle
            })
          } catch {
            // Skip files that can't be read
            console.warn(`Could not read file: ${entry.name}`)
          }
        }
      }

      // Sort by timestamp (newest first)
      recordingsList.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
      setRecordings(recordingsList)

    } catch (err) {
      if (err instanceof Error) {
        if (err.name === 'NotAllowedError') {
          setPlaybackError('Folder access was revoked. Please re-select the folder.')
        } else {
          setPlaybackError(`Failed to load recordings: ${err.message}`)
        }
      }
      setRecordings([])
    } finally {
      setIsLoadingRecordings(false)
    }
  }, [folderHandle])

  // Load recordings when folder handle changes
  useEffect(() => {
    loadRecordings()
  }, [loadRecordings])

  // Handle microphone selection
  const handleMicChange = (deviceId: string) => {
    setSelectedMicId(deviceId)
    localStorage.setItem(MIC_STORAGE_KEY, deviceId)
  }

  // Handle camera selection
  const handleCameraChange = (deviceId: string) => {
    setSelectedCameraId(deviceId)
    localStorage.setItem(CAMERA_STORAGE_KEY, deviceId)
  }

  // Handle microphone toggle
  const handleToggleMic = () => {
    const newState = !isMicEnabled
    setIsMicEnabled(newState)
    localStorage.setItem(MIC_ENABLED_KEY, String(newState))
  }

  // Handle camera toggle
  const handleToggleCamera = () => {
    const newState = !isCameraEnabled
    setIsCameraEnabled(newState)
    localStorage.setItem(CAMERA_ENABLED_KEY, String(newState))
  }

  // Handle screen toggle - request screen capture when enabled
  const handleToggleScreen = async () => {
    if (isScreenEnabled) {
      // Turning off - stop the screen stream
      if (screenStream) {
        screenStream.getTracks().forEach(track => track.stop())
        setScreenStream(null)
      }
      setIsScreenEnabled(false)
      localStorage.setItem(SCREEN_ENABLED_KEY, 'false')
    } else {
      // Turning on - request screen capture
      try {
        const stream = await navigator.mediaDevices.getDisplayMedia({
          video: true,
          audio: false
        })

        // Handle user stopping screen share from browser UI
        stream.getVideoTracks()[0].onended = () => {
          setScreenStream(null)
          setIsScreenEnabled(false)
          localStorage.setItem(SCREEN_ENABLED_KEY, 'false')
        }

        setScreenStream(stream)
        setIsScreenEnabled(true)
        localStorage.setItem(SCREEN_ENABLED_KEY, 'true')
      } catch (err) {
        // User cancelled screen selection - don't show error, just keep disabled
        if (err instanceof Error && err.name !== 'NotAllowedError') {
          setRecordingError(`Failed to capture screen: ${err.message}`)
        }
        setIsScreenEnabled(false)
        localStorage.setItem(SCREEN_ENABLED_KEY, 'false')
      }
    }
  }

  // Format duration as MM:SS
  const formatDuration = (seconds: number): string => {
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
  }

  // Format file size for display
  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  // Format date for display
  const formatRecordingDate = (date: Date): string => {
    return date.toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    })
  }

  // Handle playing a recording
  const handlePlayRecording = async (recording: RecordingMetadata) => {
    // Clean up previous playback URL if exists
    if (playbackUrl) {
      URL.revokeObjectURL(playbackUrl)
      setPlaybackUrl(null)
    }
    setPlaybackError(null)

    try {
      const file = await recording.fileHandle.getFile()
      const url = URL.createObjectURL(file)
      setPlaybackUrl(url)
      setSelectedRecording(recording)
    } catch (err) {
      if (err instanceof Error) {
        if (err.name === 'NotAllowedError') {
          setPlaybackError('File access was revoked. Please re-select the folder.')
        } else {
          setPlaybackError(`Failed to load recording: ${err.message}`)
        }
      }
    }
  }

  // Handle closing the video player
  const handleClosePlayer = () => {
    if (playbackUrl) {
      URL.revokeObjectURL(playbackUrl)
      setPlaybackUrl(null)
    }
    setSelectedRecording(null)
    setPlaybackError(null)
  }

  // Handle deleting a recording
  const handleDeleteRecording = async (recording: RecordingMetadata, e: React.MouseEvent) => {
    e.stopPropagation() // Prevent triggering play

    if (!confirm(`Delete "${recording.filename}"?`)) return

    try {
      await folderHandle?.removeEntry(recording.filename)
      // Close player if this recording was playing
      if (selectedRecording?.filename === recording.filename) {
        handleClosePlayer()
      }
      // Refresh list
      await loadRecordings()
    } catch (err) {
      if (err instanceof Error) {
        setPlaybackError(`Failed to delete recording: ${err.message}`)
      }
    }
  }

  // Generate filename with timestamp
  const generateFilename = (): string => {
    const now = new Date()
    const timestamp = now.toISOString()
      .replace(/[:.]/g, '-')
      .replace('T', '-')
      .slice(0, 19)
    return `recording-${timestamp}.webm`
  }

  // Save recording to file
  const saveRecording = useCallback(async (blob: Blob) => {
    const filename = generateFilename()

    // Try File System Access API first (if folder handle is available)
    if (folderHandle) {
      try {
        const fileHandle = await folderHandle.getFileHandle(filename, { create: true })
        const writable = await fileHandle.createWritable()
        await writable.write(blob)
        await writable.close()
        setSaveSuccess(`Recording saved: ${filename}`)
        setTimeout(() => setSaveSuccess(null), 5000)
        // Refresh recordings list
        await loadRecordings()
        return
      } catch (err) {
        console.error('File System Access API save failed:', err)
        // Fall through to download fallback
      }
    }

    // Fallback: trigger download
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
    setSaveSuccess(`Recording downloaded: ${filename}`)
    setTimeout(() => setSaveSuccess(null), 5000)
  }, [folderHandle, loadRecordings])

  // Start recording
  const handleStartRecording = async () => {
    // Reset states
    setRecordingError(null)
    setSaveSuccess(null)
    recordedChunksRef.current = []

    // Check if at least one source is enabled
    const hasVideoSource = isCameraEnabled || isScreenEnabled
    const hasAudioSource = isMicEnabled

    if (!hasVideoSource && !hasAudioSource) {
      setRecordingError('Please enable at least the microphone, camera, or screen recording.')
      return
    }

    // Check screen stream is available if screen is enabled
    if (isScreenEnabled && !screenStream) {
      setRecordingError('Screen stream not available. Please re-enable screen recording.')
      return
    }

    try {
      // Build combined stream
      const tracks: MediaStreamTrack[] = []

      // Add screen video track if enabled (prioritize screen over camera for video)
      if (isScreenEnabled && screenStream) {
        const screenVideoTrack = screenStream.getVideoTracks()[0]
        if (screenVideoTrack) {
          tracks.push(screenVideoTrack)
        }
      } else if (isCameraEnabled) {
        // Only use camera if screen is not enabled
        const cameraConstraints: MediaStreamConstraints = {
          video: selectedCameraId ? { deviceId: { exact: selectedCameraId } } : true
        }
        const cameraStream = await navigator.mediaDevices.getUserMedia(cameraConstraints)
        const cameraVideoTrack = cameraStream.getVideoTracks()[0]
        if (cameraVideoTrack) {
          tracks.push(cameraVideoTrack)
        }
      }

      // Add microphone audio track if enabled
      if (isMicEnabled) {
        const audioConstraints: MediaStreamConstraints = {
          audio: selectedMicId ? { deviceId: { exact: selectedMicId } } : true
        }
        const audioStream = await navigator.mediaDevices.getUserMedia(audioConstraints)
        const audioTrack = audioStream.getAudioTracks()[0]
        if (audioTrack) {
          tracks.push(audioTrack)
        }
      }

      // Create combined stream from all tracks
      const combinedStream = new MediaStream(tracks)
      mediaStreamRef.current = combinedStream

      // Determine supported mimeType
      let mimeType = 'video/webm;codecs=vp9'
      if (!MediaRecorder.isTypeSupported(mimeType)) {
        mimeType = 'video/webm;codecs=vp8'
        if (!MediaRecorder.isTypeSupported(mimeType)) {
          mimeType = 'video/webm'
          if (!MediaRecorder.isTypeSupported(mimeType)) {
            mimeType = '' // Use default
          }
        }
      }

      // Create MediaRecorder
      const options: MediaRecorderOptions = mimeType ? { mimeType } : {}
      const mediaRecorder = new MediaRecorder(combinedStream, options)
      mediaRecorderRef.current = mediaRecorder

      // Handle data available
      mediaRecorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          recordedChunksRef.current.push(event.data)
        }
      }

      // Handle stop
      mediaRecorder.onstop = async () => {
        // Stop the timer
        if (recordingTimerRef.current) {
          clearInterval(recordingTimerRef.current)
          recordingTimerRef.current = null
        }

        // Stop all tracks in the recording stream (except screen tracks which are managed separately)
        if (mediaStreamRef.current) {
          mediaStreamRef.current.getTracks().forEach(track => {
            // Don't stop screen tracks here - they're managed by handleToggleScreen
            if (!screenStream || !screenStream.getTracks().includes(track)) {
              track.stop()
            }
          })
          mediaStreamRef.current = null
        }

        // Create blob and save
        if (recordedChunksRef.current.length > 0) {
          const blob = new Blob(recordedChunksRef.current, { type: mimeType || 'video/webm' })
          await saveRecording(blob)
        }

        // Reset
        recordedChunksRef.current = []
        setRecordingDuration(0)
      }

      // Handle error
      mediaRecorder.onerror = (event) => {
        console.error('MediaRecorder error:', event)
        setRecordingError('Recording error occurred. Please try again.')
        setIsRecording(false)
      }

      // Start recording (collect data every second)
      mediaRecorder.start(1000)
      setIsRecording(true)

      // Start duration timer
      setRecordingDuration(0)
      recordingTimerRef.current = window.setInterval(() => {
        setRecordingDuration(prev => prev + 1)
      }, 1000)

    } catch (err) {
      if (err instanceof Error) {
        if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
          setRecordingError('Permission denied. Please allow access to your microphone and camera.')
        } else if (err.name === 'NotFoundError') {
          setRecordingError('Selected device not found. Please check your device settings.')
        } else if (err.name === 'NotReadableError') {
          setRecordingError('Device is already in use by another application.')
        } else {
          setRecordingError(`Failed to start recording: ${err.message}`)
        }
      }
    }
  }

  // Stop recording
  const handleStopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop()
    }
    setIsRecording(false)
  }

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (recordingTimerRef.current) {
        clearInterval(recordingTimerRef.current)
      }
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach(track => track.stop())
      }
      if (screenStream) {
        screenStream.getTracks().forEach(track => track.stop())
      }
    }
  }, [screenStream])

  // Cleanup playback URL on unmount
  useEffect(() => {
    return () => {
      if (playbackUrl) {
        URL.revokeObjectURL(playbackUrl)
      }
    }
  }, [playbackUrl])

  const handleSelectFolder = async () => {
    if (!isApiSupported) return

    try {
      setError(null)
      const handle = await window.showDirectoryPicker({
        mode: 'readwrite',
      })

      setFolderHandle(handle)
      setFolderPath(handle.name)
      localStorage.setItem(STORAGE_KEY, handle.name)
    } catch (err) {
      if (err instanceof Error) {
        // User cancelled the picker - not an error
        if (err.name === 'AbortError') {
          return
        }
        setError(`Failed to select folder: ${err.message}`)
      }
    }
  }

  const handleClearFolder = () => {
    setFolderPath(null)
    setFolderHandle(null)
    localStorage.removeItem(STORAGE_KEY)
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-900 via-purple-800 to-indigo-900 flex flex-col">
      {/* Header */}
      <header className="p-6">
        <h1 className="text-3xl font-bold text-white">
          🎥 Loom Clone
        </h1>
      </header>

      {/* Main Content */}
      <main className="flex-1 flex flex-col items-center justify-center px-4">
        <div className="text-center max-w-2xl w-full">
          <h2 className="text-4xl font-bold text-white mb-4">
            Record and Share Video Messages
          </h2>
          <p className="text-xl text-purple-200 mb-8">
            Select a folder to store your recordings
          </p>

          {/* Folder Selection Card */}
          <div className="bg-white/10 backdrop-blur-sm rounded-xl p-8 mb-8">
            <div className="flex items-center justify-center mb-6">
              <div className="w-16 h-16 bg-purple-500/30 rounded-full flex items-center justify-center">
                <svg className="w-8 h-8 text-purple-200" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                </svg>
              </div>
            </div>

            {folderPath ? (
              <div className="mb-6">
                <p className="text-purple-300 text-sm mb-2">Selected Folder</p>
                <div className="bg-purple-900/50 rounded-lg px-4 py-3 flex items-center justify-between">
                  <span className="text-white font-medium truncate">{folderPath}</span>
                  <button
                    onClick={handleClearFolder}
                    className="text-purple-300 hover:text-white ml-4 transition-colors"
                    title="Clear selection"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
                {folderHandle && (
                  <p className="text-green-400 text-sm mt-2 flex items-center justify-center gap-1">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    Folder access granted
                  </p>
                )}
                {folderPath && !folderHandle && (
                  <p className="text-yellow-400 text-sm mt-2">
                    Click "Change Folder" to grant access again
                  </p>
                )}
              </div>
            ) : (
              <div className="mb-6">
                <p className="text-purple-200">
                  No folder selected yet. Choose where your recordings will be saved.
                </p>
              </div>
            )}

            <button
              onClick={handleSelectFolder}
              disabled={!isApiSupported}
              className="bg-purple-500 hover:bg-purple-600 disabled:bg-gray-500 disabled:cursor-not-allowed text-white font-semibold py-3 px-8 rounded-lg transition-colors duration-200 w-full sm:w-auto"
            >
              {folderPath ? 'Change Folder' : 'Select Folder'}
            </button>
          </div>

          {/* Device Settings Card */}
          <div className="bg-white/10 backdrop-blur-sm rounded-xl p-8 mb-8">
            <div className="flex items-center justify-center mb-6">
              <div className="w-16 h-16 bg-purple-500/30 rounded-full flex items-center justify-center">
                <svg className="w-8 h-8 text-purple-200" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
              </div>
            </div>

            <h3 className="text-xl font-semibold text-white mb-6">Device Settings</h3>

            {deviceError ? (
              <div className="bg-red-500/20 border border-red-500/50 rounded-lg px-4 py-3 mb-4">
                <p className="text-red-200">{deviceError}</p>
              </div>
            ) : (
              <>
                {permissionGranted && (
                  <p className="text-green-400 text-sm mb-4 flex items-center justify-center gap-1">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    Device permissions granted
                  </p>
                )}

                {/* Microphone Selection */}
                <div className="mb-6 text-left">
                  <label className="text-purple-300 text-sm mb-2 block">
                    <span className="flex items-center gap-2">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                      </svg>
                      Microphone
                    </span>
                  </label>
                  <div className="flex items-center gap-3">
                    {microphones.length > 0 ? (
                      <select
                        value={selectedMicId}
                        onChange={(e) => handleMicChange(e.target.value)}
                        className="flex-1 bg-purple-900/50 border border-purple-500/30 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-purple-400 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        disabled={!isMicEnabled || isRecording}
                      >
                        {microphones.map((mic) => (
                          <option key={mic.deviceId} value={mic.deviceId} className="bg-purple-900">
                            {mic.label}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <p className="flex-1 text-purple-400 text-sm">No microphones found</p>
                    )}
                    <button
                      onClick={handleToggleMic}
                      disabled={isRecording}
                      className={`flex items-center gap-2 px-4 py-3 rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                        isMicEnabled
                          ? 'bg-green-500/20 border border-green-500/50 text-green-400 hover:bg-green-500/30'
                          : 'bg-red-500/20 border border-red-500/50 text-red-400 hover:bg-red-500/30'
                      }`}
                      title={isMicEnabled ? 'Mute microphone' : 'Unmute microphone'}
                    >
                      <span className="text-lg">{isMicEnabled ? '🎤' : '🔇'}</span>
                      <span className="text-sm">{isMicEnabled ? 'Enabled' : 'Muted'}</span>
                    </button>
                  </div>
                </div>

                {/* Camera Selection */}
                <div className="text-left">
                  <label className="text-purple-300 text-sm mb-2 block">
                    <span className="flex items-center gap-2">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                      </svg>
                      Camera
                    </span>
                  </label>
                  <div className="flex items-center gap-3">
                    {cameras.length > 0 ? (
                      <select
                        value={selectedCameraId}
                        onChange={(e) => handleCameraChange(e.target.value)}
                        className="flex-1 bg-purple-900/50 border border-purple-500/30 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-purple-400 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        disabled={!isCameraEnabled || isRecording}
                      >
                        {cameras.map((cam) => (
                          <option key={cam.deviceId} value={cam.deviceId} className="bg-purple-900">
                            {cam.label}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <p className="flex-1 text-purple-400 text-sm">No cameras found</p>
                    )}
                    <button
                      onClick={handleToggleCamera}
                      disabled={isRecording}
                      className={`flex items-center gap-2 px-4 py-3 rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                        isCameraEnabled
                          ? 'bg-green-500/20 border border-green-500/50 text-green-400 hover:bg-green-500/30'
                          : 'bg-red-500/20 border border-red-500/50 text-red-400 hover:bg-red-500/30'
                      }`}
                      title={isCameraEnabled ? 'Disable camera' : 'Enable camera'}
                    >
                      <span className="text-lg">{isCameraEnabled ? '📹' : '📵'}</span>
                      <span className="text-sm">{isCameraEnabled ? 'Enabled' : 'Disabled'}</span>
                    </button>
                  </div>
                </div>

                {/* Screen Recording */}
                <div className="mt-6 text-left">
                  <label className="text-purple-300 text-sm mb-2 block">
                    <span className="flex items-center gap-2">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                      </svg>
                      Screen Recording
                    </span>
                  </label>
                  <div className="flex items-center gap-3">
                    <div className="flex-1 bg-purple-900/50 border border-purple-500/30 rounded-lg px-4 py-3 text-white">
                      {isScreenEnabled && screenStream ? (
                        <span className="text-green-400 flex items-center gap-2">
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                          </svg>
                          Screen capture active
                        </span>
                      ) : (
                        <span className="text-purple-400">No screen selected</span>
                      )}
                    </div>
                    <button
                      onClick={handleToggleScreen}
                      disabled={isRecording}
                      className={`flex items-center gap-2 px-4 py-3 rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                        isScreenEnabled && screenStream
                          ? 'bg-green-500/20 border border-green-500/50 text-green-400 hover:bg-green-500/30'
                          : 'bg-red-500/20 border border-red-500/50 text-red-400 hover:bg-red-500/30'
                      }`}
                      title={isScreenEnabled ? 'Disable screen recording' : 'Enable screen recording'}
                    >
                      <span className="text-lg">{isScreenEnabled && screenStream ? '🖥️' : '⬛'}</span>
                      <span className="text-sm">{isScreenEnabled && screenStream ? 'Enabled' : 'Disabled'}</span>
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>

          {/* Error Messages */}
          {error && (
            <div className="bg-red-500/20 border border-red-500/50 rounded-lg px-4 py-3 mb-4">
              <p className="text-red-200">{error}</p>
            </div>
          )}

          {recordingError && (
            <div className="bg-red-500/20 border border-red-500/50 rounded-lg px-4 py-3 mb-4">
              <p className="text-red-200">{recordingError}</p>
            </div>
          )}

          {/* Success Message */}
          {saveSuccess && (
            <div className="bg-green-500/20 border border-green-500/50 rounded-lg px-4 py-3 mb-4">
              <p className="text-green-200 flex items-center justify-center gap-2">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                {saveSuccess}
              </p>
            </div>
          )}

          {/* Recording Indicator */}
          {isRecording && (
            <div className="bg-red-500/20 border border-red-500/50 rounded-xl p-6 mb-8 animate-pulse">
              <div className="flex items-center justify-center gap-4">
                <div className="w-4 h-4 bg-red-500 rounded-full animate-pulse" />
                <span className="text-red-400 font-semibold text-xl">Recording...</span>
                <span className="text-white font-mono text-2xl">{formatDuration(recordingDuration)}</span>
              </div>
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex gap-4 justify-center flex-wrap">
            {!isRecording ? (
              <button
                onClick={handleStartRecording}
                disabled={!folderHandle || (!isMicEnabled && !isCameraEnabled && !(isScreenEnabled && screenStream))}
                className="bg-red-500 hover:bg-red-600 disabled:bg-gray-500 disabled:cursor-not-allowed text-white font-semibold py-4 px-8 rounded-lg transition-colors duration-200 text-lg flex items-center gap-2"
                title={!folderHandle ? 'Please select a folder first' : (!isMicEnabled && !isCameraEnabled && !(isScreenEnabled && screenStream)) ? 'Enable at least microphone, camera, or screen' : 'Start recording'}
              >
                <span className="w-3 h-3 bg-white rounded-full" />
                Start Recording
              </button>
            ) : (
              <button
                onClick={handleStopRecording}
                className="bg-red-600 hover:bg-red-700 text-white font-semibold py-4 px-8 rounded-lg transition-colors duration-200 text-lg flex items-center gap-2 animate-pulse"
              >
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                  <rect x="6" y="6" width="12" height="12" rx="2" />
                </svg>
                Stop Recording
              </button>
            )}

          </div>

          {/* Helper text when no folder selected */}
          {!folderHandle && (
            <p className="text-purple-300 text-sm mt-4">
              Select a folder above to start recording
            </p>
          )}

          {/* Recordings List */}
          {folderHandle && !isRecording && (
            <div className="bg-white/10 backdrop-blur-sm rounded-xl p-6 mt-8 w-full">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-xl font-semibold text-white flex items-center gap-2">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                  </svg>
                  Recordings
                </h3>
                <button
                  onClick={() => loadRecordings()}
                  disabled={isLoadingRecordings}
                  className="text-purple-300 hover:text-white transition-colors flex items-center gap-1 text-sm disabled:opacity-50"
                  title="Refresh recordings list"
                >
                  <svg className={`w-4 h-4 ${isLoadingRecordings ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                  Refresh
                </button>
              </div>

              {/* Playback Error */}
              {playbackError && (
                <div className="bg-red-500/20 border border-red-500/50 rounded-lg px-4 py-3 mb-4">
                  <p className="text-red-200">{playbackError}</p>
                </div>
              )}

              {isLoadingRecordings ? (
                <div className="text-center py-8">
                  <div className="inline-block w-8 h-8 border-4 border-purple-400 border-t-transparent rounded-full animate-spin" />
                  <p className="text-purple-300 mt-2">Loading recordings...</p>
                </div>
              ) : recordings.length === 0 ? (
                <div className="text-center py-8">
                  <svg className="w-12 h-12 text-purple-400 mx-auto mb-3 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                  <p className="text-purple-300">No recordings yet</p>
                  <p className="text-purple-400 text-sm mt-1">Start recording to see your videos here</p>
                </div>
              ) : (
                <div className="space-y-3 max-h-64 overflow-y-auto">
                  {recordings.map((recording) => (
                    <div
                      key={recording.filename}
                      onClick={() => handlePlayRecording(recording)}
                      className="bg-purple-900/50 hover:bg-purple-800/50 rounded-lg px-4 py-3 flex items-center justify-between cursor-pointer transition-colors group"
                    >
                      <div className="flex items-center gap-3 flex-1 min-w-0">
                        <div className="w-10 h-10 bg-purple-500/30 rounded-lg flex items-center justify-center flex-shrink-0 group-hover:bg-purple-500/50 transition-colors">
                          <svg className="w-5 h-5 text-purple-200" fill="currentColor" viewBox="0 0 24 24">
                            <path d="M8 5v14l11-7z" />
                          </svg>
                        </div>
                        <div className="min-w-0">
                          <p className="text-white font-medium truncate">{formatRecordingDate(recording.timestamp)}</p>
                          <p className="text-purple-400 text-sm">{formatFileSize(recording.size)}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 ml-4">
                        <button
                          onClick={(e) => handleDeleteRecording(recording, e)}
                          className="text-purple-400 hover:text-red-400 transition-colors p-2 rounded-lg hover:bg-red-500/20"
                          title="Delete recording"
                        >
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </main>

      {/* Video Player Modal */}
      {selectedRecording && playbackUrl && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex flex-col">
          {/* Header */}
          <div className="flex items-center justify-between p-4 border-b border-white/10">
            <div className="flex items-center gap-3">
              <svg className="w-6 h-6 text-purple-400" fill="currentColor" viewBox="0 0 24 24">
                <path d="M8 5v14l11-7z" />
              </svg>
              <div>
                <p className="text-white font-medium">{formatRecordingDate(selectedRecording.timestamp)}</p>
                <p className="text-purple-400 text-sm">{selectedRecording.filename}</p>
              </div>
            </div>
            <button
              onClick={handleClosePlayer}
              className="text-white hover:text-red-400 transition-colors p-2 rounded-lg hover:bg-white/10"
              title="Close player"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Video Player */}
          <div className="flex-1 flex items-center justify-center p-4">
            <video
              src={playbackUrl}
              controls
              autoPlay
              className="max-w-full max-h-full rounded-lg shadow-2xl"
              onError={() => setPlaybackError('Failed to play this recording. The file may be corrupted.')}
            />
          </div>
        </div>
      )}

      {/* Footer */}
      <footer className="p-6 text-center">
        <p className="text-purple-300 text-sm">
          Built with React + Vite + Tailwind CSS
        </p>
      </footer>
    </div>
  )
}

export default App
