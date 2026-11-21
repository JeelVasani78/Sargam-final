import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const audioExtensions = new Set(['.mp3', '.wav', '.ogg', '.m4a', '.aac', '.flac'])
const imageExtensions = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.avif'])

function encodePath(...parts) {
  return parts.map((part) => encodeURIComponent(part)).join('/')
}

function artistFrom(filename, fallback) {
  const name = path.parse(filename).name
  const split = name.split(/\s+-\s+|\s+[–—]\s+/)
  return split.length > 1 ? split[0].trim() : fallback
}

function songsLibraryPlugin() {
  let songsDirectory = ''

  async function readSongsLibrary() {
    let albumEntries

    try {
      albumEntries = await readdir(songsDirectory, { withFileTypes: true })
    } catch (error) {
      if (error.code === 'ENOENT') return []
      throw error
    }

    const albums = []

    for (const albumEntry of albumEntries) {
      if (!albumEntry.isDirectory() || albumEntry.name.startsWith('.')) continue

      const albumPath = path.join(songsDirectory, albumEntry.name)
      const fileEntries = await readdir(albumPath, { withFileTypes: true })
      const files = fileEntries.filter((entry) => entry.isFile())
      const infoFile = files.find((file) => file.name.toLowerCase() === 'info.json')

      let info = {}
      if (infoFile) {
        try {
          info = JSON.parse(await readFile(path.join(albumPath, infoFile.name), 'utf8'))
        } catch (error) {
          console.warn(`Skipping ${albumEntry.name}: info.json is not valid JSON.`, error)
          continue
        }
      }

      const audioFiles = files
        .filter((file) => audioExtensions.has(path.extname(file.name).toLowerCase()))
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }))

      if (!audioFiles.length) continue

      const imageFiles = files.filter((file) => imageExtensions.has(path.extname(file.name).toLowerCase()))
      const requestedCover = typeof info.cover === 'string'
        ? path.basename(info.cover.replace(/\\/g, '/'))
        : ''
      const coverFile = imageFiles.find((file) => file.name === requestedCover)
        || imageFiles.find((file) => /^(cover|folder|album|art|front)/i.test(file.name))
        || imageFiles[0]

      const albumUrl = `/songs/${encodePath(albumEntry.name)}/`
      const coverUrl = coverFile
        ? `/songs/${encodePath(albumEntry.name, coverFile.name)}`
        : '/music.svg'
      const albumTitle = info.title || info.name || albumEntry.name
      const artistFallback = info.artist || 'Sargam.play'

      const songs = audioFiles.map((file, index) => {
        const url = `/songs/${encodePath(albumEntry.name, file.name)}`

        return {
          id: url,
          name: path.parse(file.name).name.replace(/_/g, ' '),
          filename: file.name,
          artist: artistFrom(file.name, artistFallback),
          url,
          cover: coverUrl,
          duration: 0,
          index
        }
      })

      albums.push({
        id: albumUrl,
        title: albumTitle,
        description: info.description || `${songs.length} song${songs.length === 1 ? '' : 's'}`,
        cover: coverUrl,
        songs,
        url: albumUrl
      })
    }

    return albums.sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }))
  }

  async function handleSongsRequest(request, response, next) {
    if (request.url?.split('?')[0] !== '/api/songs') return next()

    if (request.method !== 'GET') {
      response.statusCode = 405
      response.setHeader('Allow', 'GET')
      response.end()
      return
    }

    try {
      const albums = await readSongsLibrary()
      response.statusCode = 200
      response.setHeader('Content-Type', 'application/json; charset=utf-8')
      response.setHeader('Cache-Control', 'no-store')
      response.end(JSON.stringify(albums))
    } catch (error) {
      console.error('Could not scan public/songs:', error)
      response.statusCode = 500
      response.setHeader('Content-Type', 'application/json; charset=utf-8')
      response.end(JSON.stringify({ error: 'Could not read the music library.' }))
    }
  }

  return {
    name: 'sargam-songs-library',
    configResolved(config) {
      songsDirectory = path.resolve(config.root, 'public', 'songs')
    },
    configureServer(server) {
      server.middlewares.use(handleSongsRequest)
      server.watcher.add(songsDirectory)

      let refreshTimeout
      server.watcher.on('all', (_event, changedPath) => {
        const absolutePath = path.resolve(changedPath)
        if (absolutePath !== songsDirectory && !absolutePath.startsWith(`${songsDirectory}${path.sep}`)) return

        clearTimeout(refreshTimeout)
        refreshTimeout = setTimeout(() => {
          server.ws.send({ type: 'custom', event: 'sargam:songs-updated' })
        }, 180)
      })
    },
    configurePreviewServer(server) {
      server.middlewares.use(handleSongsRequest)
    }
  }
}

export default defineConfig({
  plugins: [react(), songsLibraryPlugin()]
})
