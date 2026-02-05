# 🎥 Loom Clone

A simplified Loom-style screen recording and video messaging application built with React.

## Features

- **📁 Folder Selection** — Choose where recordings are saved using the File System Access API
- **🎤 Microphone Recording** — Capture audio with selectable input devices
- **📹 Camera Recording** — Record video with selectable camera devices
- **🖥️ Screen Recording** — Capture your screen, window, or browser tab
- **🔘 Toggle Controls** — Enable/disable microphone, camera, or screen during setup
- **📼 Recording Playback** — View, play, and manage your recordings with a built-in video player
- **💾 Persistent Settings** — Device selections and folder path are saved across sessions

## Tech Stack

- **React 19** — Modern React with hooks
- **TypeScript** — Full type safety
- **Vite** — Fast development and production builds
- **Tailwind CSS 4** — Utility-first styling
- **Web APIs** — MediaRecorder, getUserMedia, getDisplayMedia, File System Access API

## Prerequisites

- **Modern Browser** — Chrome, Edge, or another Chromium-based browser with File System Access API support
- **Node.js 18+** — For development
- **Microphone and/or Camera** — For audio/video recording

> ⚠️ **Browser Compatibility:** The File System Access API is not supported in Firefox or Safari. Use Chrome or Edge for full functionality.

## Installation

```bash
# Clone the repository
git clone <repository-url>
cd ccloom

# Install dependencies
npm install

# Start development server
npm run dev
```

## Usage

1. **Select a Folder** — Click "Select Folder" to choose where recordings will be saved
2. **Configure Devices** — Select your preferred microphone and camera from the dropdowns
3. **Enable Sources** — Toggle on/off the microphone, camera, or screen recording
4. **Start Recording** — Click "Start Recording" to begin capturing
5. **Stop Recording** — Click "Stop Recording" when finished
6. **View Recordings** — Scroll down to see your recordings list and click to play

## Scripts

```bash
npm run dev      # Start development server
npm run build    # Build for production
npm run preview  # Preview production build
npm run lint     # Run ESLint
```

## Project Structure

```
src/
├── App.tsx              # Main application component
├── main.tsx             # Application entry point
├── index.css            # Global styles
├── App.css              # Component styles
├── types/
│   └── file-system.d.ts # File System Access API types
└── assets/              # Static assets
```

## Known Limitations

- **Browser Support** — File System Access API only works in Chromium browsers (Chrome, Edge)
- **Single Video Track** — Screen and camera cannot be combined in the same recording (screen takes priority)
- **Local Only** — Recordings are stored locally, no cloud sync or sharing
- **WebM Format** — Recordings are saved as WebM files (VP9 or VP8 codec)

## Future Enhancements

- Picture-in-picture camera overlay during screen recording
- Recording thumbnails and duration in the list
- Export to MP4 format
- Cloud storage integration
- Video trimming and editing
- Share via link functionality

## License

MIT
