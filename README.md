# StreamTest - Video Testing Tool

A Chrome extension for testing and monitoring WebRTC video streams in real-time developed by Fora Soft. This tool provides detailed analytics about video stream quality, including FPS, bitrate, packet loss, delays, and more.

## Features

- **Real-time Stream Monitoring**: Track live video stream performance metrics
- **Comprehensive Analytics**: Monitor FPS, bitrate, resolution, packet loss, audio/video delays, and freeze duration
- **WebRTC Integration**: Automatically detects and analyzes WebRTC connections on any website
- **Visual Dashboard**: Clean, intuitive popup interface displaying all metrics
- **Multi-language Support**: Built with internationalization support
- **Export Functionality**: Generate CSV reports of stream performance data
- **Background Processing**: Non-intrusive monitoring that runs in the background

## Monitored Metrics

- **Frame Rate (FPS)**: Average frames per second
- **Bitrate**: Current stream bitrate
- **Resolution**: Video resolution information
- **Packet Loss**: Network packet loss percentage
- **Audio Delay**: Audio latency measurements
- **Video Delay**: Video latency measurements
- **Connection Status**: Real-time connection health

## Installation

### Development Setup

1. **Install dependencies**:
   ```bash
   npm --prefix injection i
   npm --prefix popup i
   ```

2. **Build the extension**:
   ```bash
   npm run build
   ```

3. **Load in Chrome**:
   - Open [chrome://extensions/](chrome://extensions/)
   - Enable "Developer mode"
   - Click "Load unpacked"
   - Select the `./build` directory

### Quick Setup

```bash
npm run install-all
npm run build
```

## Project Structure

```
video-testing-tool/
├── popup/              # React-based extension popup UI
│   ├── src/
│   │   ├── components/ # React components for UI
│   │   ├── context/    # React context providers
│   │   ├── utils/      # Statistics handlers and utilities
│   │   └── types/      # TypeScript type definitions
│   └── package.json
├── injection/          # Content script for WebRTC monitoring
│   ├── src/
│   │   ├── wrappers/   # WebRTC API wrappers
│   │   ├── utils/      # Monitoring utilities
│   │   └── types/      # TypeScript definitions
│   └── package.json
├── build.sh           # Build script
└── package.json       # Root package configuration
```

## Technology Stack

- **Frontend**: React 17 with TypeScript
- **Extension**: Chrome Extension Manifest V3
- **Build Tools**: Webpack, React Scripts
- **WebRTC**: Native WebRTC API integration
- **Styling**: CSS Modules

## Development

### Scripts

- `npm run install-all` - Install all dependencies
- `npm run build` - Build the extension
- `npm --prefix popup run build` - Build popup only
- `npm --prefix injection run build` - Build injection script only
- `npm --prefix popup run lint` - Lint popup code

### Architecture

The extension consists of two main parts:

1. **Injection Script** (`injection/`): Monitors WebRTC connections by wrapping native APIs and collecting performance metrics
2. **Popup UI** (`popup/`): React-based interface that displays collected metrics in real-time

The injection script runs as a content script on all HTTPS pages, automatically detecting WebRTC connections and gathering performance data without interfering with the website's functionality.

## Permissions

- `contextMenus`: For right-click menu integration
- `activeTab`: Access to current tab for injection
- `scripting`: Dynamic script injection
- `host_permissions`: Access to all HTTPS/HTTP sites for monitoring

## Browser Compatibility

- Chrome (Manifest V3)
- Chromium-based browsers
