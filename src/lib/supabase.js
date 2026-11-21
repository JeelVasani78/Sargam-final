import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim()
const supabasePublishableKey = (
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY
)?.trim()

export const isSupabaseConfigured = Boolean(supabaseUrl && supabasePublishableKey)
export const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl, supabasePublishableKey)
  : null

let session = null
let profile = null
let favoriteIds = []
let initialized = false
let authSubscription = null
let librarySubscription = null

function emitAuthState() {
  if (typeof window === 'undefined') return

  window.dispatchEvent(new CustomEvent('sargam:auth-changed', {
    detail: {
      configured: isSupabaseConfigured,
      initialized,
      user: session?.user || null,
      profile,
      avatarUrl: session?.user ? avatarUrl(session.user) : null,
      role: profile?.role || 'user',
      favoriteIds: [...favoriteIds]
    }
  }))
}

async function loadUserData(nextSession) {
  session = nextSession
  profile = null
  favoriteIds = []

  if (session?.user) {
    const [profileResult, favoritesResult] = await Promise.all([
      supabase
        .from('profiles')
        .select('id, display_name, role')
        .eq('id', session.user.id)
        .maybeSingle(),
      supabase
        .from('favorites')
        .select('track_id')
        .eq('user_id', session.user.id)
    ])

    if (profileResult.error) throw profileResult.error
    if (favoritesResult.error) throw favoritesResult.error

    profile = profileResult.data || {
      id: session.user.id,
      display_name: session.user.user_metadata?.display_name || '',
      role: 'user'
    }
    favoriteIds = (favoritesResult.data || []).map((favorite) => favorite.track_id)
  }

  initialized = true
  emitAuthState()
}

function requireClient() {
  if (!supabase) {
    throw new Error('Supabase is not configured. Add the project URL and anon key to .env.local.')
  }
  return supabase
}

function publicUrl(storagePath) {
  if (!storagePath) return '/music.svg'
  return requireClient().storage.from('music').getPublicUrl(storagePath).data.publicUrl
}

function avatarUrl(user = session?.user) {
  const storagePath = user?.user_metadata?.avatar_path
  if (!storagePath) return '/avatar-default.svg'
  return requireClient().storage.from('avatars').getPublicUrl(storagePath).data.publicUrl
}

function safeFileName(filename) {
  const extension = filename.includes('.') ? `.${filename.split('.').pop()}` : ''
  const name = filename
    .replace(/\.[^.]*$/, '')
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')

  return `${name || 'track'}${extension.toLowerCase()}`
}

export const sargamBackend = {
  configured: isSupabaseConfigured,

  getState() {
    return {
      configured: isSupabaseConfigured,
      initialized,
      user: session?.user || null,
      profile,
      avatarUrl: session?.user ? avatarUrl(session.user) : null,
      role: profile?.role || 'user',
      favoriteIds: [...favoriteIds]
    }
  },

  async initialize() {
    if (!supabase) {
      initialized = true
      emitAuthState()
      return this.getState()
    }

    const { data, error } = await supabase.auth.getSession()
    if (error) throw error

    await loadUserData(data.session)

    if (!authSubscription) {
      const { data: authData } = supabase.auth.onAuthStateChange((_event, nextSession) => {
        queueMicrotask(() => {
          loadUserData(nextSession).catch((error) => {
            console.error('Could not load the account profile:', error)
            session = nextSession
            profile = nextSession?.user ? { role: 'user' } : null
            favoriteIds = []
            initialized = true
            emitAuthState()
          })
        })
      })
      authSubscription = authData.subscription
    }

    if (!librarySubscription) {
      librarySubscription = supabase
        .channel('sargam-music-library')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'albums' }, () => {
          window.dispatchEvent(new Event('sargam:library-updated'))
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'tracks' }, () => {
          window.dispatchEvent(new Event('sargam:library-updated'))
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'album_requests' }, () => {
          window.dispatchEvent(new Event('sargam:library-updated'))
        })
        .subscribe()
    }

    return this.getState()
  },

  async signUp({ name, email, password }) {
    const client = requireClient()
    const { data, error } = await client.auth.signUp({
      email,
      password,
      options: { data: { display_name: name } }
    })
    if (error) throw error
    if (data.session) await loadUserData(data.session)
    return { needsEmailConfirmation: !data.session }
  },

  async signIn({ email, password }) {
    const { data, error } = await requireClient().auth.signInWithPassword({ email, password })
    if (error) throw error
    await loadUserData(data.session)
    return this.getState()
  },

  async signOut() {
    const { error } = await requireClient().auth.signOut()
    if (error) throw error
    await loadUserData(null)
  },

  async updateAvatar(file) {
    if (!session?.user) throw new Error('Log in to add a profile photo.')
    if (!file || !file.type?.startsWith('image/')) throw new Error('Choose an image file for your profile photo.')

    const client = requireClient()
    const user = session.user
    const previousPath = user.user_metadata?.avatar_path || null
    const extension = file.type === 'image/webp' ? 'webp' : (file.type.split('/')[1] || 'image').replace(/[^a-z0-9]/gi, '')
    const path = `${user.id}/avatar-${crypto.randomUUID()}.${extension}`
    const { error: uploadError } = await client.storage.from('avatars').upload(path, file, {
      contentType: file.type,
      upsert: false
    })
    if (uploadError) throw uploadError

    const { data, error: updateError } = await client.auth.updateUser({
      data: { ...user.user_metadata, avatar_path: path }
    })
    if (updateError) {
      await client.storage.from('avatars').remove([path])
      throw updateError
    }

    if (data.user) session = { ...session, user: data.user }
    emitAuthState()

    if (previousPath && previousPath !== path) {
      const { error: removeError } = await client.storage.from('avatars').remove([previousPath])
      if (removeError) console.warn('Profile photo updated, but the old file could not be removed:', removeError)
    }

    return avatarUrl(session.user)
  },

  async getAlbums() {
    const { data, error } = await requireClient()
      .from('albums')
      .select('id, title, description, artist, cover_path, position, tracks(id, title, artist, singer, composer, storage_path, duration, play_count, position)')
      .order('position', { ascending: true })

    if (error) throw error

    return (data || []).map((album) => {
      const albumCover = publicUrl(album.cover_path)
      const songs = (album.tracks || [])
        .slice()
        .sort((a, b) => a.position - b.position)
        .map((track, index) => ({
          id: track.id,
          name: track.title,
          filename: track.storage_path.split('/').pop(),
          artist: track.singer || track.artist || album.artist || 'Sargam.play',
          singer: track.singer || track.artist || album.artist || 'Sargam.play',
          composer: track.composer || '',
          playCount: Number(track.play_count) || 0,
          url: publicUrl(track.storage_path),
          cover: albumCover,
          duration: Number(track.duration) || 0,
          index
        }))

      return {
        id: album.id,
        title: album.title,
        description: album.description || `${songs.length} songs`,
        rawDescription: album.description || '',
        artist: album.artist || 'Sargam.play',
        cover: albumCover,
        songs,
        url: album.id
      }
    })
  },

  async getFavorites() {
    const user = session?.user
    if (!user) return []

    const { data, error } = await requireClient()
      .from('favorites')
      .select('track_id')
      .eq('user_id', user.id)

    if (error) throw error
    favoriteIds = (data || []).map((favorite) => favorite.track_id)
    return [...favoriteIds]
  },

  async getDashboardData() {
    if (profile?.role !== 'admin') throw new Error('Administrator access is required.')
    const client = requireClient()
    const [albumsResult, tracksResult, usersResult, likesResult, requestsResult, libraryResult] = await Promise.all([
      client.from('albums').select('id', { count: 'exact', head: true }),
      client.from('tracks').select('id', { count: 'exact', head: true }),
      client.from('profiles').select('id', { count: 'exact', head: true }),
      client.from('favorites').select('track_id', { count: 'exact', head: true }),
      client.from('album_requests').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
      client.from('tracks').select('id, title, artist, play_count, albums(title), favorites(count)').limit(1000)
    ])

    const error = [albumsResult, tracksResult, usersResult, likesResult, requestsResult, libraryResult]
      .find((result) => result.error)?.error
    if (error) throw error

    const songs = (libraryResult.data || []).map((track) => ({
      ...track,
      albumTitle: Array.isArray(track.albums) ? track.albums[0]?.title : track.albums?.title,
      likes: track.favorites?.[0]?.count || 0,
      plays: Number(track.play_count) || 0
    }))

    return {
      albumCount: albumsResult.count || 0,
      trackCount: tracksResult.count || 0,
      userCount: usersResult.count || 0,
      favoriteCount: likesResult.count || 0,
      pendingRequestCount: requestsResult.count || 0,
      totalPlays: songs.reduce((sum, song) => sum + song.plays, 0),
      mostPlayed: [...songs].sort((a, b) => b.plays - a.plays).filter((song) => song.plays).slice(0, 5),
      mostLiked: [...songs].sort((a, b) => b.likes - a.likes).filter((song) => song.likes).slice(0, 5)
    }
  },

  async getAlbumRequests({ pendingOnly = false } = {}) {
    if (profile?.role !== 'admin') throw new Error('Administrator access is required.')
    let query = requireClient()
      .from('album_requests')
      .select('id, title, description, artist, status, review_note, created_at, profiles!album_requests_requested_by_fkey(display_name, email), album_request_tracks(id, title, artist, singer, composer, file_name, position)')
      .order('created_at', { ascending: false })
    if (pendingOnly) query = query.eq('status', 'pending')

    const { data, error } = await query
    if (error) throw error
    return data || []
  },

  async getMyAlbumRequests() {
    if (!session?.user) return []
    const { data, error } = await requireClient()
      .from('album_requests')
      .select('id, title, status, review_note, created_at, album_request_tracks(id)')
      .eq('requested_by', session.user.id)
      .order('created_at', { ascending: false })
    if (error) throw error
    return data || []
  },

  async submitAlbumRequest({ title, description, artist, coverFile, audioFiles, trackCredits = [] }) {
    if (!session?.user) throw new Error('Log in before requesting a music folder.')
    if (!audioFiles?.length) throw new Error('Choose at least one audio track.')
    const client = requireClient()
    const { data: request, error: requestError } = await client
      .from('album_requests')
      .insert({
        requested_by: session.user.id,
        title,
        description,
        artist,
        status: 'pending'
      })
      .select('id')
      .single()
    if (requestError) throw requestError

    const root = `requests/${session.user.id}/${request.id}`
    const uploadedPaths = []
    try {
      let coverPath = null
      if (coverFile) {
        coverPath = `${root}/cover-${safeFileName(coverFile.name)}`
        const { error } = await client.storage.from('music-requests').upload(coverPath, coverFile, {
          contentType: coverFile.type || 'application/octet-stream',
          upsert: false
        })
        if (error) throw error
        uploadedPaths.push(coverPath)
        const { error: updateError } = await client.from('album_requests')
          .update({ cover_path: coverPath })
          .eq('id', request.id)
        if (updateError) throw updateError
      }

      const requestTracks = []
      for (let index = 0; index < audioFiles.length; index += 1) {
        const file = audioFiles[index]
        const fileName = safeFileName(file.name)
        const storagePath = `${root}/${String(index + 1).padStart(3, '0')}-${fileName}`
        const { error } = await client.storage.from('music-requests').upload(storagePath, file, {
          contentType: file.type || 'audio/mpeg',
          upsert: false
        })
        if (error) throw error
        uploadedPaths.push(storagePath)
        requestTracks.push({
          request_id: request.id,
          title: file.name.replace(/\.[^.]+$/, '').replace(/_/g, ' '),
          artist,
          singer: trackCredits[index]?.singer?.trim() || '',
          composer: trackCredits[index]?.composer?.trim() || '',
          file_name: file.name,
          storage_path: storagePath,
          position: index
        })
      }

      const { error: tracksError } = await client.from('album_request_tracks').insert(requestTracks)
      if (tracksError) throw tracksError
      return request.id
    } catch (error) {
      if (uploadedPaths.length) await client.storage.from('music-requests').remove(uploadedPaths)
      await client.from('album_requests').delete().eq('id', request.id)
      throw error
    }
  },

  async reviewAlbumRequest(requestId, decision, reviewNote = '') {
    if (!session?.user || profile?.role !== 'admin') {
      throw new Error('Only an administrator can review folder requests.')
    }

    const client = requireClient()
    const { data: request, error } = await client
      .from('album_requests')
      .select('id, title, description, artist, cover_path, status, album_request_tracks(id, title, artist, singer, composer, file_name, storage_path, position)')
      .eq('id', requestId)
      .single()
    if (error) throw error
    if (request.status !== 'pending') throw new Error('This request has already been reviewed.')

    let approvedAlbumId = null
    if (decision === 'approved') {
      const sortedTracks = [...(request.album_request_tracks || [])]
        .sort((a, b) => a.position - b.position)
      if (!sortedTracks.length) throw new Error('This request contains no tracks.')

      const audioFiles = []
      for (const track of sortedTracks) {
        const { data: file, error: downloadError } = await client.storage
          .from('music-requests')
          .download(track.storage_path)
        if (downloadError) throw downloadError
        audioFiles.push(new File([file], track.file_name, { type: file.type || 'audio/mpeg' }))
      }

      let coverFile = null
      if (request.cover_path) {
        const { data: file, error: downloadError } = await client.storage
          .from('music-requests')
          .download(request.cover_path)
        if (downloadError) throw downloadError
        const coverName = request.cover_path.split('/').pop().replace(/^cover-/, '')
        coverFile = new File([file], coverName, { type: file.type || 'image/jpeg' })
      }

      const album = await this.addAlbum({
        title: request.title,
        description: request.description,
        artist: request.artist,
        coverFile,
        audioFiles,
        trackCredits: sortedTracks.map((track) => ({ singer: track.singer, composer: track.composer }))
      })
      approvedAlbumId = album.id
    } else if (decision !== 'rejected') {
      throw new Error('Choose approve or reject for this request.')
    }

    const { error: reviewError } = await client.from('album_requests')
      .update({
        status: decision,
        review_note: reviewNote,
        reviewed_by: session.user.id,
        reviewed_at: new Date().toISOString(),
        approved_album_id: approvedAlbumId
      })
      .eq('id', requestId)
    if (reviewError) throw reviewError

    const cleanupPaths = [request.cover_path, ...(request.album_request_tracks || []).map((track) => track.storage_path)]
      .filter(Boolean)
    if (cleanupPaths.length) {
      const { error: cleanupError } = await client.storage.from('music-requests').remove(cleanupPaths)
      if (cleanupError) console.warn('Request reviewed, but some private uploads remain:', cleanupError)
    }
  },

  async recordPlay(trackId) {
    if (!isSupabaseConfigured || !trackId) return
    const { error } = await requireClient().rpc('record_track_play', { track_uuid: trackId })
    if (error) console.warn('Could not record this play:', error)
  },

  async setFavorite(trackId, liked) {
    if (!session?.user) throw new Error('Log in to save liked songs to your account.')
    const client = requireClient()

    if (liked) {
      const { error } = await client.from('favorites').upsert({
        user_id: session.user.id,
        track_id: trackId
      }, { onConflict: 'user_id,track_id' })
      if (error) throw error
      if (!favoriteIds.includes(trackId)) favoriteIds.push(trackId)
    } else {
      const { error } = await client.from('favorites')
        .delete()
        .eq('user_id', session.user.id)
        .eq('track_id', trackId)
      if (error) throw error
      favoriteIds = favoriteIds.filter((id) => id !== trackId)
    }

    emitAuthState()
  },

  async addAlbum({ title, description, artist, coverFile, audioFiles, trackCredits = [], requireCredits = false }) {
    const client = requireClient()
    if (!session?.user || profile?.role !== 'admin') {
      throw new Error('Only an administrator can add music folders.')
    }
    if (!audioFiles?.length) throw new Error('Choose at least one audio file.')
    if (requireCredits && (trackCredits.length !== audioFiles.length || trackCredits.some((credit) => !credit.singer?.trim() || !credit.composer?.trim()))) {
      throw new Error('Enter both the singer and composer for every selected song.')
    }

    const { data: album, error: albumError } = await client
      .from('albums')
      .insert({ title, description, artist })
      .select('id')
      .single()
    if (albumError) throw albumError

    const uploadedPaths = []
    try {
      let coverPath = null
      if (coverFile) {
        coverPath = `${album.id}/cover-${safeFileName(coverFile.name)}`
        const { error } = await client.storage.from('music').upload(coverPath, coverFile, {
          contentType: coverFile.type || 'application/octet-stream',
          upsert: false
        })
        if (error) throw error
        uploadedPaths.push(coverPath)
      }

      const tracks = []
      for (let index = 0; index < audioFiles.length; index += 1) {
        const file = audioFiles[index]
        const storagePath = `${album.id}/${String(index + 1).padStart(3, '0')}-${safeFileName(file.name)}`
        const { error } = await client.storage.from('music').upload(storagePath, file, {
          contentType: file.type || 'audio/mpeg',
          upsert: false
        })
        if (error) throw error
        uploadedPaths.push(storagePath)
        tracks.push({
          album_id: album.id,
          title: file.name.replace(/\.[^.]+$/, '').replace(/_/g, ' '),
          artist,
          singer: trackCredits[index]?.singer?.trim() || '',
          composer: trackCredits[index]?.composer?.trim() || '',
          storage_path: storagePath,
          position: index
        })
      }

      if (tracks.length) {
        const { error } = await client.from('tracks').insert(tracks)
        if (error) throw error
      }

      if (coverPath) {
        const { error } = await client.from('albums')
          .update({ cover_path: coverPath })
          .eq('id', album.id)
        if (error) throw error
      }
      return { id: album.id }
    } catch (error) {
      if (uploadedPaths.length) await client.storage.from('music').remove(uploadedPaths)
      await client.from('albums').delete().eq('id', album.id)
      throw error
    }
  },

  async updateAlbum({ albumId, title, description, artist, coverFile, trackEdits = [], audioFiles = [], trackCredits = [] }) {
    const client = requireClient()
    if (!session?.user || profile?.role !== 'admin') {
      throw new Error('Only an administrator can edit music folders.')
    }
    if (!title?.trim()) throw new Error('Enter a folder name.')
    if (trackCredits.length !== audioFiles.length || trackCredits.some((credit) => !credit.singer?.trim() || !credit.composer?.trim())) {
      throw new Error('Enter both the singer and composer for every new song.')
    }

    const { data: album, error: albumError } = await client
      .from('albums')
      .select('cover_path, tracks(id, storage_path, position)')
      .eq('id', albumId)
      .single()
    if (albumError) throw albumError

    const existingTracks = album.tracks || []
    const trackIds = new Set(existingTracks.map((track) => track.id))
    const edits = trackEdits.filter((edit) => trackIds.has(edit.id))
    const removedIds = edits.filter((edit) => edit.remove).map((edit) => edit.id)
    if (existingTracks.length - removedIds.length + audioFiles.length < 1) {
      throw new Error('A folder must keep at least one song. Add a song before removing all current songs.')
    }

    const uploadedPaths = []
    const insertedTrackIds = []
    let newCoverPath = null
    let albumSaved = false
    try {
      if (coverFile) {
        newCoverPath = `${albumId}/cover-${crypto.randomUUID()}-${safeFileName(coverFile.name)}`
        const { error } = await client.storage.from('music').upload(newCoverPath, coverFile, {
          contentType: coverFile.type || 'application/octet-stream',
          upsert: false
        })
        if (error) throw error
        uploadedPaths.push(newCoverPath)
      }

      const startPosition = existingTracks.reduce((max, track) => Math.max(max, Number(track.position) || 0), -1) + 1
      const newTracks = []
      for (let index = 0; index < audioFiles.length; index += 1) {
        const file = audioFiles[index]
        const storagePath = `${albumId}/${crypto.randomUUID()}-${safeFileName(file.name)}`
        const { error } = await client.storage.from('music').upload(storagePath, file, {
          contentType: file.type || 'audio/mpeg',
          upsert: false
        })
        if (error) throw error
        uploadedPaths.push(storagePath)
        newTracks.push({
          album_id: albumId,
          title: file.name.replace(/\.[^.]+$/, '').replace(/_/g, ' '),
          artist: artist.trim() || 'Sargam.play',
          singer: trackCredits[index].singer.trim(),
          composer: trackCredits[index].composer.trim(),
          storage_path: storagePath,
          position: startPosition + index
        })
      }

      if (newTracks.length) {
        const { data, error } = await client.from('tracks').insert(newTracks).select('id')
        if (error) throw error
        insertedTrackIds.push(...(data || []).map((track) => track.id))
      }

      const albumUpdate = { title: title.trim(), description: description.trim(), artist: artist.trim() || 'Sargam.play' }
      if (newCoverPath) albumUpdate.cover_path = newCoverPath
      const { error: updateError } = await client.from('albums').update(albumUpdate).eq('id', albumId)
      if (updateError) throw updateError
      albumSaved = true

      for (const edit of edits.filter((item) => !item.remove)) {
        const { error } = await client.from('tracks').update({
          title: edit.title.trim(),
          artist: albumUpdate.artist,
          singer: edit.singer.trim(),
          composer: edit.composer.trim()
        }).eq('id', edit.id).eq('album_id', albumId)
        if (error) throw error
      }

      const removedTracks = existingTracks.filter((track) => removedIds.includes(track.id))
      if (removedIds.length) {
        const { error } = await client.from('tracks').delete().eq('album_id', albumId).in('id', removedIds)
        if (error) throw error
      }

      const oldStoragePaths = [
        ...(newCoverPath && album.cover_path ? [album.cover_path] : []),
        ...removedTracks.map((track) => track.storage_path)
      ].filter(Boolean)
      if (oldStoragePaths.length) {
        const { error } = await client.storage.from('music').remove(oldStoragePaths)
        if (error) console.warn('Folder updated, but some replaced or removed files remain in storage:', error)
      }
    } catch (error) {
      if (!albumSaved) {
        if (uploadedPaths.length) await client.storage.from('music').remove(uploadedPaths)
        if (insertedTrackIds.length) await client.from('tracks').delete().in('id', insertedTrackIds)
      }
      throw error
    }
  },

  async deleteAlbum(albumId) {
    const client = requireClient()
    if (!session?.user || profile?.role !== 'admin') {
      throw new Error('Only an administrator can remove music folders.')
    }

    const { data: album, error: albumError } = await client
      .from('albums')
      .select('cover_path, tracks(storage_path)')
      .eq('id', albumId)
      .single()
    if (albumError) throw albumError

    const paths = [album.cover_path, ...(album.tracks || []).map((track) => track.storage_path)]
      .filter(Boolean)
    const { error } = await client.from('albums').delete().eq('id', albumId)
    if (error) throw error

    if (paths.length) {
      const { error: storageError } = await client.storage.from('music').remove(paths)
      if (storageError) console.warn('Album removed, but some files may remain in storage:', storageError)
    }
  }
}
