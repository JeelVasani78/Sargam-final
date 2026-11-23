/* Sargam.play music player and live songs-folder integration. */

(() => {
  'use strict';

  const SONGS_URL = '/songs/';
  const AUDIO_EXTENSIONS = /\.(mp3|wav|ogg|m4a|aac|flac)$/i;
  const IMAGE_EXTENSIONS = /\.(jpg|jpeg|png|webp|gif|avif)$/i;

  const DEFAULT_COVER =
    'https://images.unsplash.com/photo-1470225620780-dba8ba36b745?w=500&auto=format&fit=crop&q=80';

  const $ = (id) => document.getElementById(id);
  const audio = $('audioPlayer') || new Audio();
  const APPEARANCE_STORAGE_PREFIX = 'sargam_appearance_v1';
  const LOCAL_PLAY_COUNTS_KEY = 'sargam_local_play_counts_v1';
  let localPlayCounts = {};
  try {
    localPlayCounts = JSON.parse(localStorage.getItem(LOCAL_PLAY_COUNTS_KEY) || '{}');
  } catch {
    localPlayCounts = {};
  }
  const APPEARANCE_THEMES = [
    { id: 'steel', label: 'Cobalt', base: '#2878d0', secondary: '#194775', tertiary: '#0e2038', lightBase: '#205da8', lightSecondary: '#376caa', lightTertiary: '#17365d' },
    { id: 'violet', label: 'Violet', base: '#8b4de8', secondary: '#4d2784', tertiary: '#25143e', lightBase: '#6732b2', lightSecondary: '#7042a8', lightTertiary: '#382052' },
    { id: 'forest', label: 'Forest', base: '#15935c', secondary: '#155c3c', tertiary: '#0d2a20', lightBase: '#176d47', lightSecondary: '#286b4b', lightTertiary: '#183d2c' },
    { id: 'amber', label: 'Amber', base: '#d77a12', secondary: '#88470d', tertiary: '#3a210b', lightBase: '#98500a', lightSecondary: '#95551a', lightTertiary: '#56300d' }
  ];
  let appearance = { mode: 'dark', theme: 'steel' };
  let appearanceOwner = undefined;

  let albums = [];
  let currentAlbumIndex = -1;
  let currentSongs = [];
  let currentSongIndex = -1;
  let queueMode = 'album';
  let lastLibrarySignature = '';
  let libraryRefreshInProgress = false;
  let libraryPollTimer = null;

  let shuffleEnabled = false;
  let repeatMode = 0; // 0 = off, 1 = repeat all, 2 = repeat one
  let isSeeking = false;
  let previousVolume = 0.8;

  let activeCategory = 'all';
  const pendingAvatarUploads = new Set();
  let signupAvatarPreviewUrl = '';
  let signupAvatarCroppedFile = null;

  const likedIds = new Set(
    JSON.parse(localStorage.getItem('sargam_liked_songs') || '[]')
  );
  const LIKED_FOLDERS_STORAGE_KEY = 'sargam_liked_song_folders_v1';
  let likedFolders = [];
  let selectedLikedFolder = 'all';
  try {
    const storedFolders = JSON.parse(localStorage.getItem(LIKED_FOLDERS_STORAGE_KEY) || '[]');
    likedFolders = Array.isArray(storedFolders) ? storedFolders.filter((folder) =>
      folder && typeof folder.id === 'string' && typeof folder.name === 'string' && Array.isArray(folder.trackIds)
    ) : [];
  } catch {
    likedFolders = [];
  }

  const el = {
    cards: $('cardContainer'),
    songs: $('songListUl'),
    libraryTitle: $('libraryHeadingText'),
    heroTitle: $('heroTitle'),
    heroSubtitle: $('heroSubtitle'),
    sectionTitle: $('playlistSectionTitle'),

    search: $('globalSearchInput'),
    librarySearch: $('librarySearchInput'),
    seek: $('seekSlider'),

    play: $('play'),
    previous: $('previous'),
    next: $('next'),
    shuffle: $('shuffle'),
    repeat: $('repeat'),

    songTitle: $('currentSongTitle'),
    artist: $('currentSongArtist'),
    thumb: $('playbarThumb'),
    heart: $('playbarHeart'),
    trackName: $('playbarTrackName'),
    time: $('songTime'),

    volume: $('volumeSlider'),
    volumeIcon: $('volumeIcon'),

    filterChips: $('filterChips'),
    likedCollections: $('likedCollections'),
    likedFolderList: $('likedFolderList'),
    likedFolderDialog: $('likedFolderDialog'),
    likedFolderForm: $('likedFolderForm'),
    likedFolderName: $('likedFolderName'),
    overlay: $('sidebarOverlay'),
    sidebar: $('sidebar'),
    canvas: $('visualizerCanvas')
  };

  // --------------------------------------------------
  // Utility functions
  // --------------------------------------------------

  function fmt(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) {
      return '00:00';
    }

    return `${Math.floor(seconds / 60)
      .toString()
      .padStart(2, '0')}:${Math.floor(seconds % 60)
      .toString()
      .padStart(2, '0')}`;
  }

  function safeDecode(value) {
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }

  function cleanName(value) {
    const lastPart = safeDecode(
      String(value || '')
        .replace(/\\/g, '/')
        .replace(/\/+$/, '')
        .split('/')
        .filter(Boolean)
        .pop() || ''
    );

    return lastPart
      .replace(/\.(mp3|wav|ogg|m4a|aac|flac)$/i, '')
      .replace(/[_]+/g, ' ')
      .trim();
  }

  function artistFrom(filename) {
    const noExtension = String(filename || '').replace(/\.[^.]+$/, '');

    const parts = noExtension.split(/\s+-\s+|\s+–\s+|\s+—\s+/);

    return parts.length > 1
      ? parts[0].trim()
      : 'Sargam.play';
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (character) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    })[character]);
  }

  function isParent(name) {
    return !name || /^(\.\.?|parent directory)$/i.test(
      name.trim().replace(/\/$/, '')
    );
  }

  // --------------------------------------------------
  // Read folder links from the existing music server
  // --------------------------------------------------

  function relativePath(url, root) {
  if (url.origin !== root.origin) {
    return null;
  }

  const rootPath = root.pathname.endsWith('/')
    ? root.pathname
    : root.pathname + '/';

  if (!url.pathname.startsWith(rootPath)) {
    return null;
  }

  return url.pathname.slice(rootPath.length);
}

  async function getDirectoryLinks(directoryUrl) {
  const response = await fetch(directoryUrl, {
    cache: 'no-store'
  });

  if (!response.ok) {
    throw new Error(
      `Directory request failed (${response.status}): ${directoryUrl}`
    );
  }

  const html = await response.text();
  const doc = new DOMParser().parseFromString(html, 'text/html');

  return [...doc.querySelectorAll('a[href]')]
    .map((anchor) => {
      const raw = (anchor.getAttribute('href') || '').trim();
      const text = (anchor.textContent || '').trim();

      // Ignore parent-directory links.
      if (
        !raw ||
        raw === '../' ||
        raw === '..' ||
        text === '../' ||
        text === '..'
      ) {
        return null;
      }

      // Use the displayed filename instead of malformed
      // Windows paths containing backslashes.
      let name = text || raw.split(/[\\/]/).filter(Boolean).pop();

      name = name.trim();

      if (!name) return null;

      const isDirectory =
        /\/$/.test(raw) ||
        /\\$/.test(raw) ||
        /\/$/.test(text) ||
        /\\$/.test(text);

      name = name.replace(/[\\/]+$/, '');

      // Build a proper URL relative to the current directory.
      const encodedName = name
        .split(/[\\/]/)
        .map((part) => encodeURIComponent(part))
        .join('/');

      const url = new URL(
        encodedName + (isDirectory ? '/' : ''),
        directoryUrl
      );

      return {
        name: name + (isDirectory ? '/' : ''),
        url,
        raw
      };
    })
    .filter(Boolean);
}

  // --------------------------------------------------
  // Read one album folder and its audio files
  // --------------------------------------------------

  async function readAlbum(folderLink) {
    const root = new URL(SONGS_URL);
    const folderName = cleanName(folderLink.name);
    const relative = relativePath(folderLink.url, root);

    if (!folderName || !relative) {
      return null;
    }

    // Only accept direct subfolders of /songs/.
    if (relative.split('/').filter(Boolean).length !== 1) {
      return null;
    }

    // Preserve URL encoding for folder names containing spaces or symbols.
    const folderUrl = new URL(folderLink.url.href);

    if (!folderUrl.pathname.endsWith('/')) {
      folderUrl.pathname += '/';
    }

    let links;

    try {
      links = await getDirectoryLinks(folderUrl.href);
    } catch (error) {
      console.warn(
        'Skipping unreadable folder:',
        folderName,
        error
      );

      return null;
    }

    const audioLinks = links.filter((link) => {
      return (
        AUDIO_EXTENSIONS.test(link.url.pathname) &&
        link.url.origin === root.origin &&
        link.url.pathname.startsWith(folderUrl.pathname)
      );
    });

    const imageLink =
      links.find((link) =>
        IMAGE_EXTENSIONS.test(link.url.pathname) &&
        /^(cover|folder|album|art|front|info-cover)/i.test(
          cleanName(link.name)
        )
      ) ||
      links.find((link) =>
        IMAGE_EXTENSIONS.test(link.url.pathname)
      );

    let info = {};

    const infoLink = links.find((link) =>
      /(^|\/)info\.json$/i.test(link.url.pathname)
    );

    if (infoLink) {
      try {
        const response = await fetch(infoLink.url.href, {
          cache: 'no-store'
        });

        if (response.ok) {
          info = await response.json();
        }
      } catch (error) {
        console.warn(
          'Could not read info.json in',
          folderName,
          error
        );
      }
    }

    const songs = audioLinks
      .map((link, index) => {
        const filename = safeDecode(
          link.url.pathname.split('/').pop() || link.name
        );

        const creditList = Array.isArray(info.songs) ? info.songs : Array.isArray(info.tracks) ? info.tracks : [];
        const credit = creditList.find((entry) => {
          const entryName = String(entry.file || entry.filename || entry.title || '').toLowerCase();
          return entryName === filename.toLowerCase() || entryName === cleanName(filename).toLowerCase();
        }) || {};

        return {
          id: link.url.href,
          name: credit.title || cleanName(filename),
          filename,
          artist: credit.singer || credit.artist || artistFrom(filename),
          singer: credit.singer || credit.artist || artistFrom(filename),
          composer: credit.composer || '',
          category: credit.category || '',
          playCount: Number(localPlayCounts[link.url.href]) || 0,
          url: link.url.href,
          cover: imageLink
            ? imageLink.url.href
            : DEFAULT_COVER,
          duration: 0,
          index
        };
      })
      .sort((a, b) =>
        a.filename.localeCompare(
          b.filename,
          undefined,
          {
            numeric: true,
            sensitivity: 'base'
          }
        )
      );

    // Ignore folders without supported audio files.
    if (!songs.length) {
      return null;
    }

    let infoCover = null;

    if (info.cover) {
      try {
        infoCover = new URL(info.cover, folderUrl).href;
      } catch {
        infoCover = null;
      }
    }

    return {
      id: folderUrl.href,
      title: info.title || info.name || folderName,
      description:
        info.description ||
        `${songs.length} song${songs.length === 1 ? '' : 's'}`,
      cover:
        infoCover ||
        (imageLink ? imageLink.url.href : songs[0].cover),
      songs,
      url: folderUrl.href
    };
  }

  // --------------------------------------------------
  // Discover folders inside /songs/
  // --------------------------------------------------

  async function discoverAlbums() {
    if (window.sargamBackend?.configured) {
      return window.sargamBackend.getAlbums();
    }

    const response = await fetch('/api/songs', { cache: 'no-store' });

    if (!response.ok) {
      throw new Error(`Music library request failed (${response.status})`);
    }

    const found = await response.json();

    if (!Array.isArray(found) || found.some((album) => !Array.isArray(album.songs))) {
      throw new Error('The music library data has an invalid album format.');
    }

    return found.sort((a, b) =>
      a.title.localeCompare(b.title, undefined, { sensitivity: 'base' })
    );
  }

  function signatureForLibrary(library) {
    return JSON.stringify(library.map((album) => [
      album.id,
      album.title,
      album.description,
      album.cover,
      album.songs.map((song) => [song.id, song.name, song.artist, song.singer, song.composer, song.category, song.cover, song.playCount || 0])
    ]));
  }

  async function refreshLibrary() {
    if (libraryRefreshInProgress) return;
    libraryRefreshInProgress = true;

    try {
      const updatedAlbums = await discoverAlbums();
      const updatedSignature = signatureForLibrary(updatedAlbums);
      if (updatedSignature === lastLibrarySignature) return;

      const selectedSong = currentSongs[currentSongIndex] || null;
      const selectedAlbumId = queueMode === 'album'
        ? albums[currentAlbumIndex]?.id
        : null;

      albums = updatedAlbums;
      lastLibrarySignature = updatedSignature;

      if (queueMode === 'album') {
        currentAlbumIndex = selectedAlbumId
          ? albums.findIndex((album) => album.id === selectedAlbumId)
          : (albums.length ? 0 : -1);
        if (currentAlbumIndex >= 0) {
          currentSongs = albums[currentAlbumIndex].songs.slice();
        } else {
          queueMode = 'all';
          currentAlbumIndex = -1;
          currentSongs = albums.flatMap((album) => album.songs);
        }
      } else if (queueMode === 'all') {
        currentAlbumIndex = -1;
        currentSongs = albums.flatMap((album) => album.songs);
      } else if (queueMode === 'liked') {
        currentAlbumIndex = -1;
        currentSongs = getLikedSongs();
      } else {
        currentAlbumIndex = -1;
        currentSongs = getCategorySongs(queueMode);
      }

      currentSongIndex = selectedSong
        ? currentSongs.findIndex((song) => song.id === selectedSong.id)
        : -1;

      if (selectedSong && currentSongIndex < 0) {
        audio.pause();
        audio.removeAttribute('src');
        audio.load();
        if (el.songTitle) el.songTitle.textContent = 'Track removed from library';
        if (el.artist) el.artist.textContent = 'Choose another song to continue';
        if (el.trackName) el.trackName.textContent = 'Track removed from library';
        if (el.thumb) el.thumb.src = DEFAULT_COVER;
        updatePlayButton(false);
      }

      if (activeCategory === 'liked') {
        refreshLikedView();
      } else {
        renderCards(el.search?.value || '', activeCategory);

        if (queueMode === 'all' && activeCategory === 'all') {
          showAllSongsLibrary();
        } else {
          const activeAlbum = albums[currentAlbumIndex];
          if (activeAlbum) {
            if (el.libraryTitle) el.libraryTitle.textContent = activeAlbum.title;
            if (el.heroTitle) el.heroTitle.textContent = activeAlbum.title;
            if (el.heroSubtitle) el.heroSubtitle.textContent = activeAlbum.description;
          }
          renderSongList();
        }
      }

      loadSongDurations();
    } catch (error) {
      console.warn('Could not refresh the songs folder:', error);
    } finally {
      libraryRefreshInProgress = false;
    }
  }

  function startLibrarySync() {
    window.addEventListener('sargam:songs-updated', refreshLibrary);
    window.addEventListener('sargam:library-updated', refreshLibrary);
    if (!libraryPollTimer) {
      libraryPollTimer = window.setInterval(refreshLibrary, 12000);
    }
  }

  // --------------------------------------------------
  // Render playlist / folder cards
  // --------------------------------------------------

  function renderCards(query = '', category = 'all') {
    if (!el.cards) return;

    const searchTerm = query.trim().toLowerCase();

    const filteredAlbums = albums.filter((album) => {
      const searchableText = [
        album.title,
        album.description,
        ...album.songs.map((song) =>
          `${song.name} ${song.artist} ${song.singer || ''} ${song.composer || ''}`
        )
      ].join(' ').toLowerCase();

      const matchesSearch =
        searchableText.includes(searchTerm);

      const matchesCategory =
        category === 'all' ||
        (
          category === 'liked' &&
          album.songs.some((song) => likedIds.has(song.id))
        ) ||
        (
          category !== 'liked' &&
          category !== 'all' &&
          `${album.title} ${album.description}`
            .toLowerCase()
            .includes(category)
        );

      return matchesSearch && matchesCategory;
    });

    el.cards.innerHTML = '';

    if (category === 'pop') {
      const topHitSongs = getTopHitSongs().filter((song) =>
        `${song.name} ${song.artist} ${song.singer || ''} ${song.composer || ''}`
          .toLowerCase().includes(searchTerm));
      if (el.sectionTitle) el.sectionTitle.textContent = 'Top Hits';
      if (el.heroTitle) el.heroTitle.textContent = 'Top Hits';
      if (el.heroSubtitle) el.heroSubtitle.textContent = `${topHitSongs.length} most-played song${topHitSongs.length === 1 ? '' : 's'}, ranked by listens.`;
      if (!topHitSongs.length) {
        el.cards.innerHTML = searchTerm
          ? `<div class="status-message">No Top Hits match “${escapeHtml(query.trim())}”. Try a song, singer, or composer name.</div>`
          : '<div class="status-message">No songs are available yet. Add music to start building Top Hits.</div>';
        return;
      }

      topHitSongs.forEach((song, index) => {
        const card = document.createElement('article');
        card.className = 'card top-hit-card';
        const plays = Number(song.playCount) || 0;
        const singer = song.singer || song.artist || 'Unknown singer';
        const credits = [
          `Singer: ${singer}`,
          song.composer ? `Composer: ${song.composer}` : ''
        ].filter(Boolean).join(' / ');
        card.innerHTML = `
          <div class="card-img-wrapper">
            <img src="${escapeHtml(song.cover || DEFAULT_COVER)}" alt="${escapeHtml(song.name)} cover" loading="lazy">
            <button class="play" type="button" aria-label="Play ${escapeHtml(song.name)}" title="Play song">
              <img src="splay.svg" alt="Play">
            </button>
          </div>
          <h2>${escapeHtml(song.name)}</h2>
          <p>${escapeHtml(credits)}</p>
          <div class="top-hit-stats"><span class="top-hit-rank">#${index + 1}</span><span class="top-hit-play-count">${plays.toLocaleString()} ${plays === 1 ? 'play' : 'plays'}</span></div>
        `;
        card.addEventListener('click', () => {
          currentSongs = topHitSongs.slice();
          currentSongIndex = -1;
          currentAlbumIndex = -1;
          queueMode = 'pop';
          if (el.libraryTitle) el.libraryTitle.textContent = 'Top Hits';
          playSong(index);
        });
        el.cards.appendChild(card);
      });
      return;
    }

    if (['romance', 'lofi', 'acoustic'].includes(category)) {
      const categorySongs = getCategorySongs(category).filter((song) =>
        `${song.name} ${song.artist} ${song.singer || ''} ${song.composer || ''}`.toLowerCase().includes(searchTerm)
      );
      const categoryLabel = { romance: 'Romantic', lofi: 'Lo-Fi Beats', acoustic: 'Acoustic & Calm' }[category];
      if (el.sectionTitle) el.sectionTitle.textContent = categoryLabel;
      if (el.heroTitle) el.heroTitle.textContent = categoryLabel;
      if (el.heroSubtitle) el.heroSubtitle.textContent = `${categorySongs.length} song${categorySongs.length === 1 ? '' : 's'} in this category.`;
      if (!categorySongs.length) {
        el.cards.innerHTML = `<div class="status-message">No songs are in ${categoryLabel} yet. Choose this category when adding a song.</div>`;
        return;
      }
      categorySongs.forEach((song, index) => {
        const card = document.createElement('article');
        card.className = 'card category-song-card';
        card.innerHTML = `
          <div class="card-img-wrapper">
            <img src="${escapeHtml(song.cover || DEFAULT_COVER)}" alt="${escapeHtml(song.name)} cover" loading="lazy">
            <button class="play" type="button" aria-label="Play ${escapeHtml(song.name)}" title="Play song"><img src="splay.svg" alt="Play"></button>
          </div>
          <h2>${escapeHtml(song.name)}</h2>
          <p>${escapeHtml(song.singer || song.artist || 'Unknown artist')}${song.composer ? ` · Composer: ${escapeHtml(song.composer)}` : ''}</p>
        `;
        card.addEventListener('click', () => {
          currentSongs = categorySongs.slice();
          currentSongIndex = -1;
          currentAlbumIndex = -1;
          queueMode = category;
          playSong(index);
        });
        el.cards.appendChild(card);
      });
      return;
    }

    if (category === 'liked') {
      const likedSongs = getVisibleLikedSongs().filter((song) =>
        `${song.name} ${song.artist} ${song.singer || ''} ${song.composer || ''}`.toLowerCase().includes(searchTerm)
      );
      const selectedFolder = likedFolders.find((folder) => folder.id === selectedLikedFolder);
      if (el.sectionTitle) el.sectionTitle.textContent = selectedFolder?.name || 'Liked Songs';
      if (!likedSongs.length) {
        el.cards.innerHTML = `<div class="status-message">${selectedFolder ? 'This folder is empty. Choose All liked, then tap the folder icon on a song to add it here.' : 'No liked songs yet. Tap the heart on any song to save one here.'}</div>`;
        return;
      }
      likedSongs.forEach((song, index) => {
        const card = document.createElement('article');
        card.className = 'card liked-song-card';
        card.innerHTML = `
          <div class="card-img-wrapper">
            <img src="${escapeHtml(song.cover || DEFAULT_COVER)}" alt="${escapeHtml(song.name)} cover" loading="lazy">
            <button class="play" type="button" aria-label="Play ${escapeHtml(song.name)}" title="Play song"><img src="splay.svg" alt="Play"></button>
          </div>
          <h2>${escapeHtml(song.name)}</h2>
          <p>${escapeHtml(song.singer || song.artist || 'Unknown artist')}${song.composer ? ` · Composer: ${escapeHtml(song.composer)}` : ''}</p>
          <select class="liked-song-folder-select" aria-label="Add ${escapeHtml(song.name)} to a folder" title="Add to folder"><option value="" aria-label="Add to folder"></option>${likedFolders.map((folder) => `<option value="${escapeHtml(folder.id)}" ${folder.trackIds.includes(song.id) ? 'disabled' : ''}>${escapeHtml(folder.name)}${folder.trackIds.includes(song.id) ? ' (Added)' : ''}</option>`).join('')}${selectedLikedFolder !== 'all' ? '<option value="__remove__">Remove from this folder</option>' : ''}</select>
        `;
        card.querySelector('.liked-song-folder-select')?.addEventListener('click', (event) => event.stopPropagation());
        card.querySelector('.liked-song-folder-select')?.addEventListener('change', (event) => {
          event.stopPropagation();
          if (event.target.value === '__remove__') {
            const folder = likedFolders.find((entry) => entry.id === selectedLikedFolder);
            if (folder) folder.trackIds = folder.trackIds.filter((id) => id !== song.id);
          } else {
            const folder = likedFolders.find((entry) => entry.id === event.target.value);
            if (folder && !folder.trackIds.includes(song.id)) folder.trackIds.push(song.id);
          }
          saveLikedFolders();
          renderLikedFolders();
          renderCards(el.search?.value || '', 'liked');
          renderSongList();
        });
        card.addEventListener('click', (event) => {
          if (event.target.closest('.liked-song-folder-select')) return;
          currentSongs = likedSongs.slice();
          currentSongIndex = -1;
          currentAlbumIndex = -1;
          queueMode = 'liked';
          playSong(index);
        });
        el.cards.appendChild(card);
      });
      return;
    }

    // The virtual All Songs folder is always the first card in the main
    // playlist view. It contains every discovered track across all albums.
    const allSongs = albums.flatMap((album) => album.songs);
    const allSongsSearchText = [
      'All Songs',
      'Every track from every folder',
      ...allSongs.map((song) => `${song.name} ${song.artist} ${song.singer || ''} ${song.composer || ''}`)
    ].join(' ').toLowerCase();
    const showAllSongsCard = category === 'all' &&
      allSongs.length > 0 && allSongsSearchText.includes(searchTerm);

    if (!filteredAlbums.length && !showAllSongsCard) {
      el.cards.innerHTML = `
        <div class="status-message">
          No folders or songs found. Try another search or refresh the page.
        </div>
      `;
      return;
    }

    if (showAllSongsCard) {
      const allSongsCard = document.createElement('article');
      allSongsCard.className = 'card all-songs-card';
      allSongsCard.dataset.allSongs = 'true';
      allSongsCard.innerHTML = `
        <div class="card-img-wrapper">
          <img
            src="allsongs.png"
            alt="All Songs cover"
            loading="lazy"
          >
          <button class="play" type="button" aria-label="Play all songs" title="Play all songs">
            <img src="splay.svg" alt="Play">
          </button>
        </div>
        <h2>All Songs</h2>
        <p>Every track from all folders · ${allSongs.length} songs</p>
      `;
      allSongsCard.addEventListener('click', (event) => {
        const playClicked = event.target.closest('.play');
        showAllSongsLibrary();
        if (playClicked && currentSongs.length) playSong(0);
      });
      el.cards.appendChild(allSongsCard);
    }

    filteredAlbums.forEach((album) => {
      const index = albums.indexOf(album);

      const card = document.createElement('article');

      card.className = 'card';
      card.dataset.albumIndex = index;

      card.innerHTML = `
        <div class="card-img-wrapper">
          <img
            src="${escapeHtml(album.cover)}"
            alt="${escapeHtml(album.title)} cover"
            loading="lazy"
          >

          <button
            class="play"
            type="button"
            aria-label="Play ${escapeHtml(album.title)}"
            title="Play folder"
          >
            <img src="splay.svg" alt="Play">
          </button>
        </div>

        <h2>${escapeHtml(album.title)}</h2>
        <p>${escapeHtml(album.description)}</p>
      `;

      card.addEventListener('click', (event) => {
        const playClicked = event.target.closest('.play');

        selectAlbum(index, Boolean(playClicked));
      });

      el.cards.appendChild(card);
    });
  }

  // --------------------------------------------------
  // Select a folder / playlist
  // --------------------------------------------------

  function selectAlbum(index, playFirst = false) {
    if (index < 0 || index >= albums.length) {
      return;
    }

    currentAlbumIndex = index;
    queueMode = 'album';
    currentSongs = albums[index].songs.slice();
    currentSongIndex = -1;

    const album = albums[index];

    el.libraryTitle.textContent = album.title;
    el.heroTitle.textContent = album.title;
    el.heroSubtitle.textContent = album.description;
    el.sectionTitle.textContent = 'Your Playlists';

    renderSongList();

    if (playFirst && currentSongs.length) {
      playSong(0);
    }
  }

  // --------------------------------------------------
  // Render the song list in Your Library
  // --------------------------------------------------

  function renderSongList() {
    if (!el.songs) return;

    const query = (el.librarySearch?.value || '')
      .trim()
      .toLowerCase();
    const globalQuery = (el.search?.value || '').trim().toLowerCase();

    // Browsing Liked Songs must not replace the active playback queue.
    // Use the liked catalog for display, while transport controls continue
    // operating on the song and queue that are actually playing.
    const categorySongs = activeCategory === 'liked'
      ? getVisibleLikedSongs()
      : activeCategory === 'all'
        ? globalQuery ? albums.flatMap((album) => album.songs) : currentSongs
        : getCategorySongs(activeCategory);
    const displayedSongs = globalQuery
      ? categorySongs.filter((song) =>
          `${song.name} ${song.artist} ${song.singer || ''} ${song.composer || ''}`
            .toLowerCase().includes(globalQuery))
      : categorySongs;
    const visibleSongs = displayedSongs.filter((song) =>
      `${song.name} ${song.artist} ${song.singer || ''} ${song.composer || ''}`
        .toLowerCase()
        .includes(query)
    );

    if (el.sectionTitle) {
      el.sectionTitle.textContent = globalQuery
        ? `${activeCategory === 'pop' ? 'Top Hits · ' : ''}Songs matching “${el.search.value.trim()}”`
        : activeCategory === 'liked' ? (likedFolders.find((folder) => folder.id === selectedLikedFolder)?.name || 'Liked Songs') : activeCategory === 'pop' ? 'Top Hits' : 'Your Playlists';
    }

    el.songs.innerHTML = '';

    if (!visibleSongs.length) {
      const item = document.createElement('li');

      item.className = 'status-message';

      const categoryNames = {
        romance: 'Romantic',
        lofi: 'Lo-Fi Beats',
        pop: 'Top Hits',
        acoustic: 'Acoustic & Calm'
      };

      item.textContent = globalQuery && displayedSongs.length === 0
        ? `No songs match “${el.search.value.trim()}”. Try a song, singer, or composer name.`
        : activeCategory === 'liked' && selectedLikedFolder !== 'all' && displayedSongs.length === 0
        ? 'This folder is empty. Go to All liked and use Organize beside a song to add it here.'
        : activeCategory === 'liked' && getLikedSongs().length === 0
        ? 'No liked songs yet. Like a song with the heart button to add one here.'
        : displayedSongs.length
          ? 'No matching songs.'
          : activeCategory !== 'all'
            ? `No songs in ${categoryNames[activeCategory] || 'this category'} yet. More music will be added soon.`
            : 'Choose a folder to view its songs.';

      el.songs.appendChild(item);

      return;
    }

    visibleSongs.forEach((song) => {
      const isCurrentSong = currentSongs[currentSongIndex]?.id === song.id;

      const item = document.createElement('li');

      item.className =
        isCurrentSong
          ? 'active-song' + (!audio.paused ? ' playing' : '')
          : '';

      const icon =
        isCurrentSong && !audio.paused
          ? 'pause.svg'
          : 'play.svg';

      item.innerHTML = `
        <div class="item-left">
          <img
            class="song-thumb"
            src="${escapeHtml(song.cover)}"
            alt=""
          >

          <div class="song-meta">
            <div class="song-title">
              ${escapeHtml(song.name)}
            </div>

            <div class="song-artist">
              ${song.singer || song.artist ? `Singer: ${escapeHtml(song.singer || song.artist)}` : ''}${song.composer ? ` · Composer: ${escapeHtml(song.composer)}` : ''}
            </div>
          </div>
        </div>

        <div class="item-right">
          <span class="song-duration">
            ${song.duration ? fmt(song.duration) : '—:—'}
          </span>

          <img
            class="mini-play-icon"
            src="${icon}"
            alt="Play"
          >
          ${activeCategory === 'liked' ? `<select class="liked-song-folder-select" aria-label="Add ${escapeHtml(song.name)} to a folder"><option value="" aria-label="Organize into a folder"></option>${likedFolders.map((folder) => `<option value="${escapeHtml(folder.id)}" ${folder.trackIds.includes(song.id) ? 'disabled' : ''}>${escapeHtml(folder.name)}${folder.trackIds.includes(song.id) ? ' · Added' : ''}</option>`).join('')}${selectedLikedFolder !== 'all' ? '<option value="__remove__">Remove from this folder</option>' : ''}</select>` : ''}
        </div>
      `;

      const folderSelect = item.querySelector('.liked-song-folder-select');
      if (folderSelect) folderSelect.title = 'Add to folder';
      folderSelect?.addEventListener('click', (event) => event.stopPropagation());
      folderSelect?.addEventListener('change', (event) => {
        event.stopPropagation();
        const folderId = event.target.value;
        if (folderId === '__remove__') {
          const folder = likedFolders.find((entry) => entry.id === selectedLikedFolder);
          if (folder) folder.trackIds = folder.trackIds.filter((id) => id !== song.id);
        } else {
          const folder = likedFolders.find((entry) => entry.id === folderId);
          if (folder && !folder.trackIds.includes(song.id)) folder.trackIds.push(song.id);
        }
        saveLikedFolders();
        renderLikedFolders();
        renderSongList();
      });

      item.addEventListener('click', () => {
        if (globalQuery && activeCategory === 'all') {
          currentSongs = displayedSongs.slice();
          queueMode = 'search';
          currentAlbumIndex = -1;
        } else if (activeCategory !== 'all') {
          currentSongs = activeCategory === 'liked'
            ? getVisibleLikedSongs()
            : getCategorySongs(activeCategory);
          queueMode = activeCategory === 'liked'
            ? 'liked'
            : activeCategory;
          currentAlbumIndex = -1;
        }

        const songIndex = currentSongs.findIndex(
          (item) => item.id === song.id
        );

        playSong(songIndex);
      });

      el.songs.appendChild(item);
    });
  }

  // --------------------------------------------------
  // Keep the current song title visible beside the Like icon
  // --------------------------------------------------

  function setupTrackNameDisplay() {
    const trackName = el.trackName;
    const songInfo = trackName?.closest('.songinfo');
    const oldTitle = el.songTitle;
    const artist = el.artist;
    const details = oldTitle?.closest('.playbar-details');

    // Preserve the artist under the album artwork, but avoid showing
    // the same song title twice in the playbar.
    if (oldTitle) {
      oldTitle.style.setProperty('display', 'none', 'important');
    }

    if (artist) {
      artist.style.setProperty('display', 'block', 'important');
      artist.style.setProperty('visibility', 'visible', 'important');
    }

    if (details) {
      const compact = window.matchMedia('(max-width: 560px)').matches;
      details.style.setProperty('display', compact ? 'none' : 'flex', 'important');
      details.style.setProperty('flex-direction', 'column', 'important');
      details.style.setProperty('min-width', '0', 'important');
      details.style.setProperty('flex', '0 1 clamp(4rem, 9vw, 6.5rem)', 'important');
    }

    if (songInfo) {
      songInfo.style.setProperty('display', 'flex', 'important');
      songInfo.style.setProperty('align-items', 'center', 'important');
      songInfo.style.setProperty('min-width', '0', 'important');
      songInfo.style.setProperty('overflow', 'visible', 'important');
      songInfo.style.setProperty('flex', '1 1 40%', 'important');
    }

    if (trackName) {
      trackName.style.setProperty('display', 'block', 'important');
      trackName.style.setProperty('visibility', 'visible', 'important');
      trackName.style.setProperty('opacity', '1', 'important');
      trackName.style.setProperty('color', document.documentElement.dataset.themeMode === 'light' ? 'var(--theme-tertiary)' : 'var(--theme-text)', 'important');
      trackName.style.setProperty('font-size', '13px', 'important');
      trackName.style.setProperty('font-weight', '700', 'important');
      trackName.style.setProperty('flex', '0 1 clamp(3rem, 16vw, 16rem)', 'important');
      trackName.style.setProperty('width', 'clamp(3rem, 16vw, 16rem)', 'important');
      trackName.style.setProperty('min-width', '0', 'important');
      trackName.style.setProperty('max-width', 'clamp(3rem, 20vw, 20rem)', 'important');
      trackName.style.setProperty('white-space', 'nowrap', 'important');
      trackName.style.setProperty('overflow', 'hidden', 'important');
      trackName.style.setProperty('text-overflow', 'ellipsis', 'important');
      trackName.style.setProperty('margin', '0 10px 0 8px', 'important');
      trackName.style.setProperty('order', '3', 'important');
      trackName.textContent = trackName.textContent || 'Choose a song';
    }

    if (el.heart) {
      el.heart.style.setProperty('display', 'block', 'important');
      el.heart.style.setProperty('visibility', 'visible', 'important');
      el.heart.style.setProperty('flex', '0 0 auto', 'important');
      el.heart.style.setProperty('order', '4', 'important');
    }
  }

  // --------------------------------------------------
  // Update current song details in the new playbar
  // --------------------------------------------------

  function updateTrackDetails(song) {
    el.songTitle.textContent = song.name;

    el.artist.textContent =
      song.artist ||
      albums[currentAlbumIndex]?.title ||
      'Sargam.play';

    el.thumb.src =
      song.cover ||
      albums[currentAlbumIndex]?.cover ||
      DEFAULT_COVER;

    el.thumb.onerror = () => {
      el.thumb.onerror = null;
      el.thumb.src = DEFAULT_COVER;
    };

    const isLiked = likedIds.has(song.id);
    el.heart.classList.toggle('liked', isLiked);
    el.heart.style.setProperty(
      'filter',
      isLiked
        ? 'brightness(0) saturate(100%) invert(69%) sepia(53%) saturate(660%) hue-rotate(79deg) brightness(100%) contrast(100%)'
        : 'brightness(0) invert(1)',
      'important'
    );
    el.heart.style.setProperty('opacity', '1', 'important');
    el.heart.title = isLiked
      ? 'Remove from Liked Songs'
      : 'Add to Liked Songs';
    el.heart.setAttribute('aria-pressed', String(isLiked));

    if (el.trackName) {
      const title = song.name || 'Unknown song';
      el.trackName.textContent = title;
      el.trackName.title = title;
      setupTrackNameDisplay();
    }
  }

  // --------------------------------------------------
  // Play / pause a selected song
  // --------------------------------------------------

  async function playSong(index) {
    if (index < 0 || index >= currentSongs.length) {
      return;
    }

    currentSongIndex = index;

    const song = currentSongs[index];

    audio.src = song.url;
    audio.load();

    updateTrackDetails(song);
    renderSongList();

    try {
      await audio.play();
      updatePlayButton(true);
      song.playCount = (Number(song.playCount) || 0) + 1;
      if (!window.sargamBackend?.configured) {
        localPlayCounts[song.id] = song.playCount;
        try { localStorage.setItem(LOCAL_PLAY_COUNTS_KEY, JSON.stringify(localPlayCounts)); } catch { /* The current session count still works. */ }
      }
      window.sargamBackend?.recordPlay?.(song.id);
      if (activeCategory === 'pop') {
        renderCards(el.search?.value || '', 'pop');
        renderSongList();
      }
    } catch (error) {
      console.error(
        'Audio could not play:',
        song.url,
        error
      );

      updatePlayButton(false);
    }
  }

  function updatePlayButton(playing) {
    el.play.src = playing
      ? 'pause.svg'
      : 'play.svg';

    el.play.alt = playing ? 'Pause' : 'Play';

    el.play.title = playing
      ? 'Pause (Space)'
      : 'Play (Space)';

    renderSongList();
  }

  function togglePlay() {
    if (!currentSongs.length) {
      return;
    }

    if (currentSongIndex < 0) {
      playSong(0);
      return;
    }

    if (audio.paused) {
      audio.play()
        .then(() => updatePlayButton(true))
        .catch(console.error);
    } else {
      audio.pause();
      updatePlayButton(false);
    }
  }

  // --------------------------------------------------
  // Next / previous song controls
  // --------------------------------------------------

  function nextSong(manual = true) {
    if (!currentSongs.length) return;

    // Repeat-one repeats the same track only when it ends naturally.
    if (repeatMode === 2 && !manual && currentSongIndex >= 0) {
      audio.currentTime = 0;
      audio.play().catch(console.error);
      return;
    }

    let nextIndex;

    if (shuffleEnabled && currentSongs.length > 1) {
      // Avoid selecting the same song twice in a row when shuffling.
      do {
        nextIndex = Math.floor(Math.random() * currentSongs.length);
      } while (nextIndex === currentSongIndex);
    } else {
      // Always wrap from the last song to the first song.
      nextIndex = (currentSongIndex + 1) % currentSongs.length;
    }

    playSong(nextIndex);
  }

  function previousSong() {
    if (!currentSongs.length) return;

    // Standard player behaviour: if the current song has played for
    // more than three seconds, restart it. Otherwise go to the previous song.
    if (audio.currentTime > 3) {
      audio.currentTime = 0;
      return;
    }

    // Always wrap from the first song to the last song.
    const previousIndex = currentSongIndex <= 0
      ? currentSongs.length - 1
      : currentSongIndex - 1;

    playSong(previousIndex);
  }

    // --------------------------------------------------
  // Liked songs
  // --------------------------------------------------

  function getLikedSongs() {
    // Build from the discovered album catalog so a song remains available
    // in Liked Songs regardless of which album is currently selected.
    return albums.flatMap((album) =>
      album.songs.filter((song) => likedIds.has(song.id))
    );
  }

  function getVisibleLikedSongs() {
    const likedSongs = getLikedSongs();
    if (selectedLikedFolder === 'all') return likedSongs;
    const folder = likedFolders.find((item) => item.id === selectedLikedFolder);
    return folder ? likedSongs.filter((song) => folder.trackIds.includes(song.id)) : likedSongs;
  }

  function saveLikedFolders() {
    try {
      localStorage.setItem(LIKED_FOLDERS_STORAGE_KEY, JSON.stringify(likedFolders));
    } catch (error) {
      console.warn('Could not save liked song folders:', error);
    }
  }

  function renderLikedFolders() {
    if (!el.likedCollections || !el.likedFolderList) return;
    el.likedCollections.hidden = activeCategory !== 'liked';
    if (activeCategory !== 'liked') return;

    const entries = [
      { id: 'all', name: 'All liked', count: getLikedSongs().length, icon: 'liked' },
      ...likedFolders.map((folder) => ({
        ...folder,
        count: getLikedSongs().filter((song) => folder.trackIds.includes(song.id)).length,
        icon: 'folder'
      }))
    ];
    el.likedFolderList.innerHTML = '';
    entries.forEach((folder) => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = `liked-folder-chip${selectedLikedFolder === folder.id ? ' active' : ''}`;
      chip.setAttribute('aria-pressed', String(selectedLikedFolder === folder.id));
      const folderIcon = folder.icon === 'liked'
        ? '<svg viewBox="0 0 24 24" focusable="false"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8l1.1 1.1L12 21l7.8-7.5 1.1-1.1a5.5 5.5 0 0 0-.1-7.8Z"/></svg>'
        : '<svg viewBox="0 0 24 24" focusable="false"><path d="M3 6.75A1.75 1.75 0 0 1 4.75 5h5.1l2 2h7.4A1.75 1.75 0 0 1 21 8.75v8.5A1.75 1.75 0 0 1 19.25 19h-14A2.25 2.25 0 0 1 3 16.75z"/><path d="M3.25 9h17.5"/></svg>';
      chip.innerHTML = `<span class="liked-folder-chip-icon${folder.id === 'all' ? ' liked-folder-chip-icon--liked' : ''}" aria-hidden="true">${folderIcon}</span><span class="liked-folder-chip-name">${escapeHtml(folder.name)}</span><span class="liked-folder-count">${folder.count}</span>`;
      chip.addEventListener('click', () => {
        selectedLikedFolder = folder.id;
        renderLikedFolders();
        renderCards(el.search?.value || '', 'liked');
        renderSongList();
        if (el.sectionTitle) el.sectionTitle.textContent = folder.id === 'all' ? 'Liked Songs' : folder.name;
      });
      el.likedFolderList.appendChild(chip);

      if (folder.id !== 'all') {
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'liked-folder-delete';
        remove.setAttribute('aria-label', `Delete ${folder.name} folder`);
        remove.title = `Delete ${folder.name}`;
        remove.textContent = 'x';
        remove.addEventListener('click', () => {
          likedFolders = likedFolders.filter((item) => item.id !== folder.id);
          if (selectedLikedFolder === folder.id) selectedLikedFolder = 'all';
          saveLikedFolders();
          renderLikedFolders();
          renderCards(el.search?.value || '', 'liked');
          renderSongList();
        });
        el.likedFolderList.appendChild(remove);
      }
    });
  }

  function createLikedFolder(name) {
    const cleanName = name.trim().replace(/\s+/g, ' ');
    if (!cleanName) return false;
    if (likedFolders.some((folder) => folder.name.toLocaleLowerCase() === cleanName.toLocaleLowerCase())) {
      el.likedFolderName?.setCustomValidity('You already have a folder with this name.');
      el.likedFolderName?.reportValidity();
      return false;
    }
    likedFolders.push({ id: `folder-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, name: cleanName, trackIds: [] });
    selectedLikedFolder = likedFolders[likedFolders.length - 1].id;
    saveLikedFolders();
    renderLikedFolders();
    renderCards(el.search?.value || '', 'liked');
    renderSongList();
    if (el.sectionTitle) el.sectionTitle.textContent = cleanName;
    return true;
  }

  function getCategorySongs(category) {
    const categoryTerm = String(category || '').toLowerCase();

    if (categoryTerm === 'pop') return getTopHitSongs();

    const categoryAliases = {
      romance: /romance|romantic/i,
      lofi: /lo\s*-?\s*fi/i,
      acoustic: /acoustic|calm/i
    };
    const legacyPattern = categoryAliases[categoryTerm];
    return albums.flatMap((album) => album.songs.filter((song) => {
      const savedCategory = String(song.category || '').toLowerCase();
      if (savedCategory) {
        const normalizedCategory = savedCategory === 'romantic' ? 'romance' : savedCategory.replace(/[-\s]/g, '');
        return normalizedCategory === categoryTerm;
      }
      return legacyPattern?.test(`${album.title} ${album.description}`) || false;
    }));
  }

  function getTopHitSongs() {
    return albums.flatMap((album) => album.songs)
      .slice()
      .sort((a, b) => (Number(b.playCount) || 0) - (Number(a.playCount) || 0));
  }

  function refreshLikedView() {
    if (activeCategory !== 'liked') return;

    renderLikedFolders();
    const likedSongs = getVisibleLikedSongs();
    const selectedFolder = likedFolders.find((folder) => folder.id === selectedLikedFolder);

    // Do not replace the active playback queue here. If the currently
    // playing song is unliked, it disappears from this visible list but
    // remains in the queue until the user selects another song. This keeps
    // play/pause, next, previous, and seek controls working normally.
    if (el.libraryTitle) el.libraryTitle.textContent = selectedFolder?.name || 'Liked Songs';
    if (el.sectionTitle) el.sectionTitle.textContent = selectedFolder?.name || 'Liked Songs';
    if (el.heroTitle) el.heroTitle.textContent = selectedFolder?.name || 'Your Liked Songs';
    if (el.heroSubtitle) {
      el.heroSubtitle.textContent = `${likedSongs.length} liked song${likedSongs.length === 1 ? '' : 's'} saved on this device.`;
    }

    renderCards(el.search?.value || '', 'liked');
    renderSongList();
  }

  function showAllSongsLibrary() {
    const selectedSong = currentSongs[currentSongIndex] || null;
    const allSongs = albums.flatMap((album) => album.songs);

    currentSongs = allSongs;
    queueMode = 'all';
    currentAlbumIndex = -1;
    currentSongIndex = selectedSong
      ? currentSongs.findIndex((song) => song.id === selectedSong.id)
      : -1;

    if (el.libraryTitle) el.libraryTitle.textContent = 'All Songs';
    if (el.heroTitle) el.heroTitle.textContent = 'All Songs';
    if (el.heroSubtitle) {
      el.heroSubtitle.textContent = `Every track from all folders (${allSongs.length} songs).`;
    }
    if (el.sectionTitle) el.sectionTitle.textContent = 'Your Playlists';

    renderSongList();
  }

  async function toggleLike() {
    const song = currentSongs[currentSongIndex];
    if (!song) return;

    const wasLiked = likedIds.has(song.id);
    if (wasLiked) {
      likedIds.delete(song.id);
    } else {
      likedIds.add(song.id);
    }

    const isLiked = likedIds.has(song.id);
    const backend = window.sargamBackend;
    const syncToAccount = backend?.configured && Boolean(backend.getState().user);

    if (syncToAccount) {
      try {
        await backend.setFavorite(song.id, isLiked);
      } catch (error) {
        if (wasLiked) likedIds.add(song.id);
        else likedIds.delete(song.id);
        updateTrackDetails(song);
        refreshLikedView();
        renderSongList();
        alert(`Could not save this like: ${error.message}`);
        return;
      }
    } else {
      localStorage.setItem('sargam_liked_songs', JSON.stringify([...likedIds]));
    }

    if (el.heart) {
      el.heart.classList.toggle('liked', isLiked);
      el.heart.style.setProperty(
        'filter',
        isLiked
          ? 'brightness(0) saturate(100%) invert(69%) sepia(53%) saturate(660%) hue-rotate(79deg) brightness(100%) contrast(100%)'
          : 'brightness(0) invert(1)',
        'important'
      );
      el.heart.style.setProperty('opacity', '1', 'important');
      el.heart.title = isLiked ? 'Remove from Liked Songs' : 'Add to Liked Songs';
      el.heart.setAttribute('aria-pressed', String(isLiked));
    }

    // In Liked Songs view, unliking the currently playing track should stop
    // that track and immediately continue with the next remaining liked song.
    // The queue is rebuilt only for this explicit action; transport controls
    // continue to use a valid index, and an empty list gets a clear message.
    if (activeCategory === 'liked' && wasLiked && !isLiked) {
      const oldIndex = currentSongIndex;
      const oldQueue = currentSongs.slice();
      const nextOldSong = oldQueue.length
        ? oldQueue[(oldIndex + 1) % oldQueue.length]
        : null;
      const remainingLikedSongs = getLikedSongs();
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
      currentSongs = remainingLikedSongs;
      queueMode = 'liked';
      currentSongIndex = -1;

      if (currentSongs.length) {
        // Continue with the next liked track in the old queue, wrapping to
        // the first remaining liked track when the unliked one was last.
        let nextIndex = nextOldSong
          ? currentSongs.findIndex((item) => item.id === nextOldSong.id)
          : -1;
        if (nextIndex < 0) nextIndex = 0;
        playSong(nextIndex);
      } else {
        if (el.libraryTitle) el.libraryTitle.textContent = 'Liked Songs';
        if (el.sectionTitle) el.sectionTitle.textContent = 'Liked Songs';
        if (el.heroTitle) el.heroTitle.textContent = 'Your Liked Songs';
        if (el.heroSubtitle) el.heroSubtitle.textContent = 'No liked songs yet. Tap the heart on any song to add one.';
        if (el.trackName) {
          el.trackName.textContent = 'No liked songs';
          el.trackName.title = 'No liked songs';
        }
        if (el.songTitle) el.songTitle.textContent = 'No liked songs';
        if (el.artist) el.artist.textContent = 'Like a song to see it here';
        if (el.thumb) el.thumb.src = DEFAULT_COVER;
        updatePlayButton(false);
      }
    }

    refreshLikedView();
    renderSongList();
  }

  // --------------------------------------------------
  // Seekbar and song time
  // --------------------------------------------------

  function updateProgress() {
    const duration = audio.duration || 0;
    const progress = duration
      ? Math.max(0, Math.min(100, (audio.currentTime / duration) * 100))
      : 0;

    if (!isSeeking && el.seek) {
      el.seek.value = progress;
    }

    el.seek?.style.setProperty(
      '--seek-progress',
      `${isSeeking && el.seek ? Number(el.seek.value) : progress}%`
    );

    if (el.time) {
      el.time.textContent =
        `${fmt(audio.currentTime || 0)} / ${fmt(duration)}`;
    }
  }

  // --------------------------------------------------
  // Volume and mute controls
  // --------------------------------------------------

  function setVolume(value) {
    const volume = Math.max(
      0,
      Math.min(1, Number(value))
    );

    audio.volume = volume;
    audio.muted = volume === 0;

    if (volume > 0) {
      previousVolume = volume;
    }

    if (el.volume) {
      el.volume.value = String(volume);
    }

    if (el.volumeIcon) {
      // Only use SVG files already present in the project.
      // This avoids a broken image if volume-low.svg does not exist.
      el.volumeIcon.src = volume === 0 ? 'mute.svg' : 'volume.svg';
    }
  }

  function toggleMute() {
    if (audio.volume > 0 && !audio.muted) {
      previousVolume = audio.volume;
      audio.volume = 0;
      audio.muted = true;
    } else {
      audio.muted = false;
      audio.volume = previousVolume || 0.8;
    }

    setVolume(audio.muted ? 0 : audio.volume);
  }

  // --------------------------------------------------
  // Sidebar and modal helpers
  // --------------------------------------------------

  function syncMobileSidebarOffset() {
    const navbar = document.querySelector('.navbar');
    if (!navbar) return;
    const navbarBottom = Math.ceil(navbar.getBoundingClientRect().bottom);
    document.documentElement.style.setProperty('--mobile-navbar-bottom', `${navbarBottom}px`);
  }

  function openSidebar() {
    syncMobileSidebarOffset();
    el.sidebar?.classList.add('open');
    el.overlay?.classList.add('active');
  }

  function closeSidebar() {
    el.sidebar?.classList.remove('open');
    el.overlay?.classList.remove('active');
  }

  function openModal(id) {
    $(id)?.classList.add('open');
  }

  function closeModal(id) {
    $(id)?.classList.remove('open');
  }

  function setFormMessage(id, message, kind = '') {
    const output = $(id);
    if (!output) return;
    output.textContent = message;
    output.dataset.kind = kind;
  }

  function cropAvatarFile(file) {
    if (!file?.type?.startsWith('image/')) return Promise.reject(new Error('Choose an image file for your profile photo.'));
    if (file.size > 12 * 1024 * 1024) return Promise.reject(new Error('Choose an image smaller than 12 MB.'));

    return new Promise((resolve, reject) => {
      const modal = $('avatarCropModal');
      const viewport = $('avatarCropViewport');
      const image = $('avatarCropImage');
      const zoomInput = $('avatarCropZoom');
      const applyButton = $('applyAvatarCrop');
      const cancelButton = $('cancelAvatarCrop');
      if (!modal || !viewport || !image || !zoomInput || !applyButton || !cancelButton) {
        reject(new Error('The profile photo crop tool could not be opened.'));
        return;
      }

      const objectUrl = URL.createObjectURL(file);
      let viewSize = 0;
      let baseWidth = 0;
      let baseHeight = 0;
      let offsetX = 0;
      let offsetY = 0;
      let dragStart = null;
      let settled = false;

      const updatePreview = () => {
        const zoom = Number(zoomInput.value) || 1;
        const width = baseWidth * zoom;
        const height = baseHeight * zoom;
        offsetX = Math.max(-(width - viewSize) / 2, Math.min((width - viewSize) / 2, offsetX));
        offsetY = Math.max(-(height - viewSize) / 2, Math.min((height - viewSize) / 2, offsetY));
        image.style.width = `${width}px`;
        image.style.height = `${height}px`;
        image.style.left = `calc(50% + ${offsetX}px)`;
        image.style.top = `calc(50% + ${offsetY}px)`;
      };

      const cleanup = () => {
        modal.classList.remove('open');
        viewport.classList.remove('is-dragging');
        viewport.removeEventListener('pointerdown', onPointerDown);
        viewport.removeEventListener('pointermove', onPointerMove);
        viewport.removeEventListener('pointerup', onPointerUp);
        viewport.removeEventListener('pointercancel', onPointerUp);
        zoomInput.removeEventListener('input', updatePreview);
        applyButton.removeEventListener('click', onApply);
        cancelButton.removeEventListener('click', onCancel);
        modal.removeEventListener('click', onBackdropClick);
        document.removeEventListener('keydown', onKeyDown);
        image.removeAttribute('src');
        image.style.cssText = '';
        URL.revokeObjectURL(objectUrl);
      };

      const finish = (result) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(result);
      };
      const fail = (error) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(error);
      };

      const onCancel = () => finish(null);
      const onBackdropClick = (event) => { if (event.target === modal) onCancel(); };
      const onKeyDown = (event) => { if (event.key === 'Escape') onCancel(); };
      const onPointerDown = (event) => {
        if (event.button !== undefined && event.button !== 0) return;
        dragStart = { x: event.clientX, y: event.clientY, offsetX, offsetY };
        viewport.classList.add('is-dragging');
        viewport.setPointerCapture?.(event.pointerId);
      };
      const onPointerMove = (event) => {
        if (!dragStart) return;
        offsetX = dragStart.offsetX + event.clientX - dragStart.x;
        offsetY = dragStart.offsetY + event.clientY - dragStart.y;
        updatePreview();
      };
      const onPointerUp = () => {
        dragStart = null;
        viewport.classList.remove('is-dragging');
      };
      const onApply = () => {
        applyButton.disabled = true;
        const zoom = Number(zoomInput.value) || 1;
        const drawWidth = baseWidth * zoom;
        const drawHeight = baseHeight * zoom;
        const scale = drawWidth / image.naturalWidth;
        const sourceSize = viewSize / scale;
        const sourceX = Math.max(0, Math.min(image.naturalWidth - sourceSize, (drawWidth / 2 - offsetX) / scale));
        const sourceY = Math.max(0, Math.min(image.naturalHeight - sourceSize, (drawHeight / 2 - offsetY) / scale));
        const canvas = document.createElement('canvas');
        canvas.width = 512;
        canvas.height = 512;
        const context = canvas.getContext('2d');
        if (!context) {
          fail(new Error('This image could not be processed. Try another image.'));
          return;
        }
        context.drawImage(image, sourceX, sourceY, sourceSize, sourceSize, 0, 0, canvas.width, canvas.height);
        canvas.toBlob((blob) => {
          if (!blob) {
            fail(new Error('This image could not be processed. Try another image.'));
            return;
          }
          finish(new File([blob], 'profile-photo.webp', { type: 'image/webp' }));
        }, 'image/webp', 0.86);
      };

      image.onload = () => {
        modal.classList.add('open');
        requestAnimationFrame(() => {
          viewSize = viewport.clientWidth;
          const scale = Math.max(viewSize / image.naturalWidth, viewSize / image.naturalHeight);
          baseWidth = image.naturalWidth * scale;
          baseHeight = image.naturalHeight * scale;
          offsetX = 0;
          offsetY = 0;
          zoomInput.value = '1';
          updatePreview();
          viewport.addEventListener('pointerdown', onPointerDown);
          viewport.addEventListener('pointermove', onPointerMove);
          viewport.addEventListener('pointerup', onPointerUp);
          viewport.addEventListener('pointercancel', onPointerUp);
          zoomInput.addEventListener('input', updatePreview);
          applyButton.addEventListener('click', onApply);
          cancelButton.addEventListener('click', onCancel);
          modal.addEventListener('click', onBackdropClick);
          document.addEventListener('keydown', onKeyDown);
        });
      };
      image.onerror = () => {
        URL.revokeObjectURL(objectUrl);
        reject(new Error('The selected file is not a readable image.'));
      };
      image.src = objectUrl;
    });
  }

  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('Could not temporarily save the selected profile photo.'));
      reader.readAsDataURL(blob);
    });
  }

  function dataUrlToImageFile(dataUrl) {
    const [header, encoded] = dataUrl.split(',');
    const mime = header.match(/data:([^;]+)/)?.[1] || 'image/webp';
    const bytes = Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0));
    return new File([bytes], 'profile-photo.webp', { type: mime });
  }

  function pendingAvatarKey(email) {
    return `sargam_pending_avatar:${String(email || '').trim().toLowerCase()}`;
  }

  async function uploadPendingAvatar(user) {
    if (!user?.email || !window.sargamBackend?.configured) return;
    const email = user.email.trim().toLowerCase();
    if (pendingAvatarUploads.has(email)) return;

    const key = pendingAvatarKey(email);
    let dataUrl = '';
    try { dataUrl = localStorage.getItem(key) || ''; } catch { return; }
    if (!dataUrl) return;

    pendingAvatarUploads.add(email);
    try {
      await window.sargamBackend.updateAvatar(dataUrlToImageFile(dataUrl));
      localStorage.removeItem(key);
      if ($('signupModal')?.classList.contains('open')) {
        setFormMessage('signupMessage', 'Your profile photo has been saved.', 'success');
      }
    } catch (error) {
      console.error('Could not upload the selected profile photo:', error);
      setFormMessage('signupMessage', `Your account is ready, but the profile photo could not be uploaded: ${error.message}`, 'error');
    } finally {
      pendingAvatarUploads.delete(email);
    }
  }

  function renderAppearanceControls() {
    const modeButton = $('appearanceModeButton');
    const modeIcon = $('appearanceModeIcon');
    const modeLabel = $('appearanceModeLabel');
    const themeTitle = $('appearanceThemeTitle');
    const themeOptions = $('appearanceThemeOptions');
    const mode = appearance.mode;
    const nextMode = mode === 'dark' ? 'light' : 'dark';

    document.documentElement.dataset.themeMode = mode;
    document.documentElement.dataset.themePalette = appearance.theme;

    if (modeButton) {
      modeButton.title = `Switch to ${nextMode} mode`;
      modeButton.setAttribute('aria-label', `Switch to ${nextMode} mode`);
    }
    if (modeIcon) {
      modeIcon.innerHTML = mode === 'dark'
        ? '<path d="M20.2 15.1A8.2 8.2 0 0 1 8.9 3.8 8.5 8.5 0 1 0 20.2 15.1Z"/><path d="M16.4 3.4v3.2M14.8 5h3.2"/>'
        : '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>';
    }
    if (modeLabel) modeLabel.textContent = mode === 'dark' ? 'Dark' : 'Light';
    if (themeTitle) themeTitle.textContent = `${mode === 'dark' ? 'Dark' : 'Light'} color themes`;
    if (themeOptions) {
      themeOptions.replaceChildren();
      APPEARANCE_THEMES.forEach((theme) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'appearance-theme-option';
        button.dataset.appearanceTheme = theme.id;
        button.setAttribute('aria-pressed', String(appearance.theme === theme.id));
        button.setAttribute('aria-label', `${theme.label} ${mode} theme`);
        const swatch = document.createElement('span');
        swatch.className = 'appearance-theme-swatch';
        swatch.style.setProperty('--swatch-base', mode === 'dark' ? theme.base : theme.lightBase);
        swatch.style.setProperty('--swatch-secondary', mode === 'dark' ? theme.secondary : theme.lightSecondary);
        swatch.style.setProperty('--swatch-tertiary', mode === 'dark' ? theme.tertiary : theme.lightTertiary);
        const label = document.createElement('span');
        label.textContent = theme.label;
        button.append(swatch, label);
        themeOptions.appendChild(button);
      });
    }

    document.querySelectorAll('[data-appearance-mode]').forEach((button) => {
      button.setAttribute('aria-pressed', String(button.dataset.appearanceMode === mode));
    });

    const currentTrackName = $('playbarTrackName');
    if (currentTrackName) {
      currentTrackName.style.setProperty('color', mode === 'light' ? 'var(--theme-tertiary)' : 'var(--theme-text)', 'important');
    }
  }

  function saveAppearance() {
    const owner = appearanceOwner || 'guest';
    try {
      localStorage.setItem(`${APPEARANCE_STORAGE_PREFIX}:${owner}`, JSON.stringify(appearance));
    } catch (error) {
      console.warn('Could not save appearance preference:', error);
    }
  }

  function setAppearance(changes, persist = true) {
    appearance = { ...appearance, ...changes };
    renderAppearanceControls();
    if (persist) saveAppearance();
  }

  function loadAppearanceForUser(userId) {
    const owner = userId || 'guest';
    if (appearanceOwner === owner) return;
    appearanceOwner = owner;
    try {
      const stored = localStorage.getItem(`${APPEARANCE_STORAGE_PREFIX}:${owner}`);
      if (stored) {
        const parsed = JSON.parse(stored);
        appearance = {
          mode: parsed.mode === 'light' ? 'light' : 'dark',
          theme: APPEARANCE_THEMES.some((item) => item.id === parsed.theme) ? parsed.theme : 'steel'
        };
      } else {
        appearance = { mode: 'dark', theme: 'steel' };
      }
    } catch (error) {
      appearance = { mode: 'dark', theme: 'steel' };
      console.warn('Could not load appearance preference:', error);
    }
    renderAppearanceControls();
  }

  function renderAuthState(state) {
    if (!state) return;

    loadAppearanceForUser(state.user?.id || null);

    const signedIn = Boolean(state.user);
    const name = state.profile?.display_name || state.user?.email || '';
    const navbarProfile = $('navbarProfile');
    const userName = $('authUserName');
    const avatarButton = $('profileAvatarButton');
    const avatarImage = $('authUserAvatar');
    const signupButton = $('signupBtn');
    const loginButton = $('loginBtn');
    const logoutButton = $('logoutBtn');
    const adminButton = $('adminPanelBtn');
    const requestButton = $('requestMusicBtn');

    if (userName) {
      userName.textContent = name;
      userName.hidden = !signedIn;
      userName.title = state.user?.email || '';
    }
    if (navbarProfile) navbarProfile.hidden = !signedIn;
    if (avatarButton) avatarButton.hidden = !signedIn;
    if (avatarImage && signedIn) {
      avatarImage.alt = `${name}'s profile photo`;
      avatarImage.onerror = () => { avatarImage.src = '/avatar-default.svg'; };
      avatarImage.src = state.avatarUrl || '/avatar-default.svg';
    }
    if (signupButton) signupButton.hidden = signedIn;
    if (loginButton) loginButton.hidden = signedIn;
    if (logoutButton) logoutButton.hidden = !signedIn;
    if (adminButton) adminButton.hidden = state.role !== 'admin';
    if (requestButton) requestButton.hidden = !signedIn || state.role === 'admin';
    if (signedIn) queueMicrotask(() => uploadPendingAvatar(state.user));

    if (state.configured && state.initialized) {
      likedIds.clear();
      const ids = signedIn
        ? state.favoriteIds || []
        : JSON.parse(localStorage.getItem('sargam_liked_songs') || '[]');
      ids.forEach((id) => likedIds.add(id));

      if (albums.length) {
        renderCards(el.search?.value || '', activeCategory);
        renderSongList();
      }
    }
  }

  function setAdminPanelVisible(visible) {
    const adminPanel = $('adminPanel');
    if (!adminPanel) return;

    adminPanel.hidden = !visible;
    [el.filterChips, document.querySelector('.playlist-hero'), document.querySelector('.section-header'), el.cards]
      .filter(Boolean)
      .forEach((element) => {
        element.hidden = visible;
      });

    if (visible) {
      renderAdminAlbums();
      renderAdminDashboard();
    }
  }

  function renderRanking(containerId, songs, metric) {
    const list = $(containerId);
    if (!list) return;
    list.replaceChildren();
    if (!songs.length) {
      list.textContent = 'No listening data yet. Play or like songs to build this list.';
      return;
    }
    songs.forEach((song, index) => {
      const row = document.createElement('div');
      row.className = 'admin-ranking-row';
      const rank = document.createElement('span');
      rank.className = 'admin-ranking-rank';
      rank.textContent = String(index + 1).padStart(2, '0');
      const details = document.createElement('div');
      details.className = 'admin-ranking-details';
      const title = document.createElement('strong');
      title.textContent = song.title;
      const album = document.createElement('span');
      album.textContent = song.albumTitle || song.artist || 'Sargam.play';
      const count = document.createElement('b');
      count.textContent = `${song[metric]} ${metric === 'plays' ? 'plays' : 'likes'}`;
      details.append(title, album);
      row.append(rank, details, count);
      list.appendChild(row);
    });
  }

  async function renderAdminDashboard() {
    if (!window.sargamBackend?.configured) return;
    try {
      const data = await window.sargamBackend.getDashboardData();
      const values = {
        metricAlbums: data.albumCount,
        metricTracks: data.trackCount,
        metricUsers: data.userCount,
        metricPlays: data.totalPlays,
        metricLikes: data.favoriteCount,
        metricRequests: data.pendingRequestCount
      };
      Object.entries(values).forEach(([id, value]) => { if ($(id)) $(id).textContent = Number(value).toLocaleString(); });
      renderRanking('mostPlayedList', data.mostPlayed, 'plays');
      renderRanking('mostLikedList', data.mostLiked, 'likes');
      await renderAdminRequests();
    } catch (error) {
      const requests = $('adminRequestList');
      if (requests) requests.textContent = `Dashboard data could not be loaded: ${error.message}`;
    }
  }

  async function renderAdminRequests() {
    const list = $('adminRequestList');
    if (!list) return;
    list.replaceChildren();
    try {
      const requests = await window.sargamBackend.getAlbumRequests({ pendingOnly: true });
      if (!requests.length) {
        list.textContent = 'No pending folder requests.';
        return;
      }
      requests.forEach((request) => {
        const row = document.createElement('article');
        row.className = 'admin-request-row';
        const details = document.createElement('div');
        details.className = 'admin-request-details';
        const title = document.createElement('h4');
        title.textContent = request.title;
        const requester = request.profiles?.display_name || request.profiles?.email || 'A listener';
        const meta = document.createElement('p');
        meta.textContent = `${requester} · ${request.album_request_tracks?.length || 0} tracks · ${new Date(request.created_at).toLocaleDateString()}`;
        const artist = document.createElement('span');
        artist.textContent = `Artist: ${request.artist || 'Sargam.play'}`;
        const description = document.createElement('span');
        description.textContent = request.description || 'No description provided';
        details.append(title, meta, artist, description);

        const submittedTracks = document.createElement('details');
        submittedTracks.className = 'admin-request-track-review';
        const trackSummary = document.createElement('summary');
        trackSummary.textContent = `Review songs and credits (${request.album_request_tracks?.length || 0})`;
        const trackList = document.createElement('ul');
        (request.album_request_tracks || [])
          .slice()
          .sort((a, b) => a.position - b.position)
          .forEach((track) => {
            const trackItem = document.createElement('li');
            const trackName = document.createElement('strong');
            trackName.textContent = track.title;
            const trackCredit = document.createElement('span');
            trackCredit.textContent = `Singer: ${track.singer || '—'} · Composer: ${track.composer || '—'}`;
            trackItem.append(trackName, trackCredit);
            const categoryLabel = { romance: 'Romantic', lofi: 'Lo-Fi', acoustic: 'Acoustic & Calm', general: 'General' }[track.category] || 'General';
            trackCredit.textContent += ` | Category: ${categoryLabel}`;
            trackList.appendChild(trackItem);
          });
        submittedTracks.append(trackSummary, trackList);
        details.appendChild(submittedTracks);

        const actions = document.createElement('div');
        actions.className = 'admin-request-actions';
        [['Approve', 'approved'], ['Reject', 'rejected']].forEach(([label, decision]) => {
          const button = document.createElement('button');
          button.type = 'button';
          button.className = decision === 'approved' ? 'admin-approve-button' : 'admin-remove-button';
          button.textContent = label;
          button.addEventListener('click', async () => {
            button.disabled = true;
            try {
              const note = decision === 'rejected' ? (window.prompt('Optional note for the requester:') || '') : '';
              await window.sargamBackend.reviewAlbumRequest(request.id, decision, note);
              await refreshLibrary();
              await renderAdminDashboard();
              await renderAdminAlbums();
            } catch (error) {
              window.alert(`Could not ${label.toLowerCase()} this request: ${error.message}`);
              button.disabled = false;
            }
          });
          actions.appendChild(button);
        });
        if (request.cover_url) {
          const cover = document.createElement('img');
          cover.className = 'admin-request-cover';
          cover.src = request.cover_url;
          cover.alt = `${request.title} requested cover`;
          row.appendChild(cover);
        }
        row.append(details, actions);
        list.appendChild(row);
      });
    } catch (error) {
      list.textContent = `Requests could not be loaded: ${error.message}`;
    }
  }

  async function renderMyRequests() {
    const list = $('myRequestList');
    if (!list || !window.sargamBackend?.configured) return;
    list.replaceChildren();
    try {
      const requests = await window.sargamBackend.getMyAlbumRequests();
      if (!requests.length) { list.textContent = 'You have not sent a folder request yet.'; return; }
      const pendingRequests = requests
        .filter((request) => request.status === 'pending')
        .slice(0, 2);
      const reviewedRequests = requests.filter((request) => request.status !== 'pending');
      const visibleRequests = [...pendingRequests, ...reviewedRequests]
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
      visibleRequests.forEach((request) => {
        const row = document.createElement('div');
        row.className = 'my-request-row';
        const title = document.createElement('strong');
        title.textContent = request.title;
        const status = document.createElement('span');
        status.className = `request-status request-status-${request.status}`;
        status.textContent = request.status;
        const info = document.createElement('small');
        info.textContent = `${request.album_request_tracks?.length || 0} tracks · ${new Date(request.created_at).toLocaleDateString()}${request.review_note ? ` · ${request.review_note}` : ''}`;
        row.append(title, status, info);
        list.appendChild(row);
      });
    } catch (error) { list.textContent = `Your requests could not be loaded: ${error.message}`; }
  }

  function createTrackCategoryField(value = 'general', editField = false) {
    const label = document.createElement('label');
    label.className = 'admin-field';
    const caption = document.createElement('span');
    caption.textContent = 'Category';
    const select = document.createElement('select');
    select.required = true;
    select.setAttribute('aria-label', 'Song category');
    if (editField) select.dataset.editTrackField = 'category';
    else select.dataset.trackCategory = 'true';
    [
      ['romance', 'Romantic'],
      ['lofi', 'Lo-Fi'],
      ['acoustic', 'Acoustic & Calm'],
      ['general', 'General']
    ].forEach(([category, labelText]) => {
      const option = document.createElement('option');
      option.value = category;
      option.textContent = labelText;
      option.selected = (value || 'general') === category;
      select.appendChild(option);
    });
    label.append(caption, select);
    return label;
  }

  function renderAdminTrackCredits(files) {
    const section = $('adminTrackCredits');
    const list = $('adminTrackCreditsList');
    if (!section || !list) return;
    list.replaceChildren();
    section.hidden = !files.length;
    files.forEach((file, index) => {
      const row = document.createElement('div');
      row.className = 'admin-track-credit-row';
      const title = document.createElement('strong');
      title.textContent = file.name.replace(/\.[^.]+$/, '').replace(/_/g, ' ');
      const fields = document.createElement('div');
      fields.className = 'admin-track-credit-fields';
      [['Singer', 'singer', 'Singer name'], ['Composer', 'composer', 'Composer name']].forEach(([labelText, key, placeholder]) => {
        const label = document.createElement('label');
        label.className = 'admin-field';
        const labelName = document.createElement('span');
        labelName.textContent = labelText;
        const input = document.createElement('input');
        input.type = 'text';
        input.required = true;
        input.placeholder = placeholder;
        input.dataset.trackCredit = key;
        input.dataset.trackIndex = String(index);
        label.append(labelName, input);
        fields.appendChild(label);
      });
      fields.appendChild(createTrackCategoryField());
      row.append(title, fields);
      list.appendChild(row);
    });
  }

  function renderRequestTrackCredits(files) {
    const section = $('requestTrackCredits');
    const list = $('requestTrackCreditsList');
    if (!section || !list) return;
    list.replaceChildren();
    section.hidden = !files.length;

    files.forEach((file, index) => {
      const row = document.createElement('div');
      row.className = 'request-track-credit-row';
      const title = document.createElement('strong');
      title.textContent = file.name.replace(/\.[^.]+$/, '').replace(/_/g, ' ');
      const fields = document.createElement('div');
      fields.className = 'admin-track-credit-fields';
      [['Singer', 'singer'], ['Composer', 'composer']].forEach(([labelText, key]) => {
        const label = document.createElement('label');
        label.className = 'admin-field';
        const caption = document.createElement('span');
        caption.textContent = labelText;
        const input = document.createElement('input');
        input.type = 'text';
        input.required = true;
        input.placeholder = `${labelText} name`;
        input.dataset.requestTrackCredit = key;
        input.dataset.trackIndex = String(index);
        label.append(caption, input);
        fields.appendChild(label);
      });
      fields.appendChild(createTrackCategoryField());
      row.append(title, fields);
      list.appendChild(row);
    });
  }

  function collectRequestTrackCredits() {
    return [...($('requestTrackCreditsList')?.querySelectorAll('.request-track-credit-row') || [])]
      .map((row) => ({
        singer: row.querySelector('[data-request-track-credit="singer"]')?.value.trim() || '',
        composer: row.querySelector('[data-request-track-credit="composer"]')?.value.trim() || '',
        category: row.querySelector('[data-track-category]')?.value || 'general'
      }));
  }

  function collectAdminTrackCredits() {
    return [...($('adminTrackCreditsList')?.querySelectorAll('.admin-track-credit-row') || [])]
      .map((row) => ({
        singer: row.querySelector('[data-track-credit="singer"]')?.value.trim() || '',
        composer: row.querySelector('[data-track-credit="composer"]')?.value.trim() || '',
        category: row.querySelector('[data-track-category]')?.value || 'general'
      }));
  }

  function renderEditAlbumTracks(songs) {
    const list = $('editAlbumTrackList');
    if (!list) return;
    list.replaceChildren();

    songs.forEach((song) => {
      const row = document.createElement('article');
      row.className = 'admin-edit-track-row';
      row.dataset.trackId = song.id;

      const titleLabel = document.createElement('label');
      titleLabel.className = 'admin-field';
      const titleText = document.createElement('span');
      titleText.textContent = 'Song title';
      const titleInput = document.createElement('input');
      titleInput.type = 'text';
      titleInput.required = true;
      titleInput.value = song.name || '';
      titleInput.dataset.editTrackField = 'title';
      titleLabel.append(titleText, titleInput);

      const singerLabel = document.createElement('label');
      singerLabel.className = 'admin-field';
      const singerText = document.createElement('span');
      singerText.textContent = 'Singer';
      const singerInput = document.createElement('input');
      singerInput.type = 'text';
      singerInput.value = song.singer || '';
      singerInput.dataset.editTrackField = 'singer';
      singerLabel.append(singerText, singerInput);

      const composerLabel = document.createElement('label');
      composerLabel.className = 'admin-field';
      const composerText = document.createElement('span');
      composerText.textContent = 'Composer';
      const composerInput = document.createElement('input');
      composerInput.type = 'text';
      composerInput.value = song.composer || '';
      composerInput.dataset.editTrackField = 'composer';
      composerLabel.append(composerText, composerInput);
      const categoryLabel = createTrackCategoryField(song.category, true);

      const removeLabel = document.createElement('label');
      removeLabel.className = 'admin-edit-track-remove';
      const removeInput = document.createElement('input');
      removeInput.type = 'checkbox';
      removeInput.dataset.removeTrack = 'true';
      const removeText = document.createElement('span');
      removeText.textContent = 'Remove this song';
      removeLabel.append(removeInput, removeText);

      row.append(titleLabel, singerLabel, composerLabel, categoryLabel, removeLabel);
      list.appendChild(row);
    });
  }

  function renderEditAlbumNewTracks(files) {
    const list = $('editAlbumNewTrackList');
    if (!list) return;
    list.replaceChildren();

    files.forEach((file, index) => {
      const row = document.createElement('article');
      row.className = 'admin-edit-new-track-row';
      const title = document.createElement('strong');
      title.textContent = file.name.replace(/\.[^.]+$/, '').replace(/_/g, ' ');
      const fields = document.createElement('div');
      fields.className = 'admin-track-credit-fields';

      [['Singer', 'singer'], ['Composer', 'composer']].forEach(([labelText, key]) => {
        const label = document.createElement('label');
        label.className = 'admin-field';
        const labelTextNode = document.createElement('span');
        labelTextNode.textContent = labelText;
        const input = document.createElement('input');
        input.type = 'text';
        input.required = true;
        input.placeholder = `${labelText} name`;
        input.dataset.newTrackCredit = key;
        input.dataset.trackIndex = String(index);
        label.append(labelTextNode, input);
        fields.appendChild(label);
      });
      fields.appendChild(createTrackCategoryField());

      row.append(title, fields);
      list.appendChild(row);
    });
  }

  function openAlbumEditor(album) {
    $('editAlbumForm')?.reset();
    $('editAlbumId').value = album.id;
    $('editAlbumTitle').value = album.title || '';
    $('editAlbumArtist').value = album.artist || '';
    $('editAlbumDescription').value = album.rawDescription ?? album.description ?? '';
    $('editAlbumMessage').textContent = '';
    renderEditAlbumTracks(album.songs || []);
    renderEditAlbumNewTracks([]);
    $('editAlbumModal')?.classList.add('open');
  }

  function collectEditAlbumNewTrackCredits() {
    return [...($('editAlbumNewTrackList')?.querySelectorAll('.admin-edit-new-track-row') || [])]
      .map((row) => ({
        singer: row.querySelector('[data-new-track-credit="singer"]')?.value.trim() || '',
        composer: row.querySelector('[data-new-track-credit="composer"]')?.value.trim() || '',
        category: row.querySelector('[data-track-category]')?.value || 'general'
      }));
  }

  async function renderAdminAlbums() {
    const list = $('adminAlbumList');
    if (!list) return;
    list.innerHTML = '';

    try {
      const library = await window.sargamBackend.getAlbums();
      if (!library.length) {
        list.textContent = 'No music folders have been added yet.';
        return;
      }

      library.forEach((album) => {
        const row = document.createElement('article');
        row.className = 'admin-album-row';

        const cover = document.createElement('img');
        cover.className = 'admin-album-cover';
        cover.src = album.cover || 'music.svg';
        cover.alt = '';

        const details = document.createElement('div');
        details.className = 'admin-album-details';
        const title = document.createElement('h4');
        title.textContent = album.title;
        const description = document.createElement('p');
        description.textContent = album.description || '';
        const count = document.createElement('span');
        count.textContent = `${album.songs.length} track${album.songs.length === 1 ? '' : 's'}`;
        details.append(title, description, count);

        const actions = document.createElement('div');
        actions.className = 'admin-album-actions';

        const edit = document.createElement('button');
        edit.className = 'admin-secondary-button';
        edit.type = 'button';
        edit.textContent = 'Edit folder';
        edit.addEventListener('click', () => openAlbumEditor(album));

        const remove = document.createElement('button');
        remove.className = 'admin-remove-button';
        remove.type = 'button';
        remove.textContent = 'Remove folder';
        remove.addEventListener('click', async () => {
          if (!window.confirm(`Remove “${album.title}” and all of its tracks?`)) return;
          remove.disabled = true;
          try {
            await window.sargamBackend.deleteAlbum(album.id);
            setFormMessage('adminFormMessage', `${album.title} was removed.`, 'success');
            await refreshLibrary();
            await renderAdminAlbums();
            await renderAdminDashboard();
          } catch (error) {
            setFormMessage('adminFormMessage', error.message, 'error');
            remove.disabled = false;
          }
        });

        actions.append(edit, remove);
        row.append(cover, details, actions);
        list.appendChild(row);
      });
    } catch (error) {
      list.textContent = `Could not load folders: ${error.message}`;
    }
  }

  // --------------------------------------------------
  // Connect all interface controls
  // --------------------------------------------------

  function bindEvents() {
    $('createLikedFolder')?.addEventListener('click', () => {
      if (!el.likedFolderDialog?.open) el.likedFolderDialog?.showModal();
      if (el.likedFolderName) {
        el.likedFolderName.value = '';
        el.likedFolderName.setCustomValidity('');
        el.likedFolderName.focus();
      }
    });
    $('closeLikedFolderDialog')?.addEventListener('click', () => el.likedFolderDialog?.close());
    $('cancelLikedFolder')?.addEventListener('click', () => el.likedFolderDialog?.close());
    el.likedFolderName?.addEventListener('input', () => el.likedFolderName.setCustomValidity(''));
    el.likedFolderForm?.addEventListener('submit', (event) => {
      event.preventDefault();
      if (createLikedFolder(el.likedFolderName?.value || '')) {
        el.likedFolderDialog?.close();
        el.likedFolderForm.reset();
      }
    });

    window.addEventListener('resize', setupTrackNameDisplay);

    const appearanceMenu = $('appearanceMenu');
    const appearanceMenuButton = $('appearanceMenuButton');
    const closeAppearanceMenu = () => {
      if (!appearanceMenu) return;
      appearanceMenu.hidden = true;
      appearanceMenuButton?.setAttribute('aria-expanded', 'false');
    };

    $('appearanceModeButton')?.addEventListener('click', () => {
      setAppearance({ mode: appearance.mode === 'dark' ? 'light' : 'dark' });
    });
    appearanceMenuButton?.addEventListener('click', () => {
      if (!appearanceMenu) return;
      appearanceMenu.hidden = !appearanceMenu.hidden;
      appearanceMenuButton.setAttribute('aria-expanded', String(!appearanceMenu.hidden));
    });
    $('closeAppearanceMenu')?.addEventListener('click', closeAppearanceMenu);
    appearanceMenu?.querySelectorAll('[data-appearance-mode]').forEach((button) => {
      button.addEventListener('click', () => setAppearance({ mode: button.dataset.appearanceMode }));
    });
    $('appearanceThemeOptions')?.addEventListener('click', (event) => {
      const button = event.target.closest('[data-appearance-theme]');
      if (button) setAppearance({ theme: button.dataset.appearanceTheme });
    });
    document.addEventListener('pointerdown', (event) => {
      if (!$('appearanceControls')?.contains(event.target)) closeAppearanceMenu();
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && appearanceMenu && !appearanceMenu.hidden) closeAppearanceMenu();
    });

    // Playbar controls
    el.play?.addEventListener('click', togglePlay);

    el.next?.addEventListener('click', () => {
      nextSong(true);
    });

    el.previous?.addEventListener('click', previousSong);

    el.shuffle?.addEventListener('click', () => {
      shuffleEnabled = !shuffleEnabled;

      el.shuffle.classList.toggle(
        'active',
        shuffleEnabled
      );
    });

    el.repeat?.addEventListener('click', () => {
      repeatMode = (repeatMode + 1) % 3;

      el.repeat.classList.toggle(
        'active',
        repeatMode !== 0
      );

      el.repeat.title = [
        'Repeat off',
        'Repeat all',
        'Repeat one'
      ][repeatMode];
    });

    el.heart?.addEventListener('click', toggleLike);

    // Seekbar: preview while dragging, seek when released.
    el.seek?.addEventListener('input', () => {
      isSeeking = true;
      el.seek.style.setProperty('--seek-progress', `${Number(el.seek.value)}%`);

      if (audio.duration && el.time) {
        const previewTime =
          audio.duration * Number(el.seek.value) / 100;

        el.time.textContent =
          `${fmt(previewTime)} / ${fmt(audio.duration)}`;
      }
    });

    el.seek?.addEventListener('change', () => {
      if (audio.duration) {
        audio.currentTime =
          audio.duration * Number(el.seek.value) / 100;
      }

      isSeeking = false;
      updateProgress();
    });

    // Volume
    el.volume?.addEventListener('input', () => {
      setVolume(el.volume.value);
    });

    el.volumeIcon?.addEventListener('click', toggleMute);

    // Audio events
    audio.addEventListener('timeupdate', updateProgress);

    audio.addEventListener('loadedmetadata', () => {
      updateProgress();

      const song = currentSongs[currentSongIndex];

      if (song) {
        song.duration = audio.duration || 0;
      }

      renderSongList();
    });

    audio.addEventListener('play', () => {
      updatePlayButton(true);
    });

    audio.addEventListener('pause', () => {
      updatePlayButton(false);
    });

    audio.addEventListener('ended', () => {
      nextSong(false);
    });

    audio.addEventListener('error', () => {
      if (audio.src) {
        console.warn(
          'Could not load audio file:',
          audio.src,
          audio.error
        );
      }
    });

    // Main search
    el.search?.addEventListener('input', () => {
      renderCards(el.search.value, activeCategory);
      renderSongList();
    });

    // Search within the selected playlist
    el.librarySearch?.addEventListener('input', renderSongList);

    // Category chips
    el.filterChips
      ?.querySelectorAll('[data-category]')
      .forEach((chip) => {
        chip.addEventListener('click', () => {
          el.filterChips
            .querySelectorAll('.filter-chip')
            .forEach((item) => {
              item.classList.remove('active');
            });

          chip.classList.add('active');

          activeCategory = chip.dataset.category || 'all';
          renderLikedFolders();

          if (activeCategory === 'liked') {
            el.sectionTitle.textContent = 'Liked Songs';
            el.heroTitle.textContent = 'Your Liked Songs';

            selectedLikedFolder = 'all';
            renderLikedFolders();
            const likedSongs = getVisibleLikedSongs();

            el.heroSubtitle.textContent =
              `${likedSongs.length} liked song` +
              `${likedSongs.length === 1 ? '' : 's'} saved on this device.`;

            renderCards(el.search.value, 'liked');

            el.libraryTitle.textContent = 'Liked Songs';

            renderSongList();
          } else {
            el.sectionTitle.textContent = 'Your Playlists';

            if (activeCategory === 'pop') {
              el.heroTitle.textContent = 'Top Hits';
              el.heroSubtitle.textContent = 'The most-played songs in your library, ranked by listens.';
              el.libraryTitle.textContent = 'Top Hits';
            }

            if (
              activeCategory === 'all' ||
              el.libraryTitle.textContent === 'Liked Songs'
            ) {
              showAllSongsLibrary();
            } else {
              renderSongList();
            }

            renderCards(
              el.search?.value || '',
              activeCategory
            );
          }
        });
      });

    // Mobile sidebar
    $('hamburgerBtn')?.addEventListener('click', openSidebar);
    window.addEventListener('resize', () => {
      if (el.sidebar?.classList.contains('open')) syncMobileSidebarOffset();
    });

    $('closeSidebarBtn')?.addEventListener(
      'click',
      closeSidebar
    );

    el.overlay?.addEventListener('click', closeSidebar);

    // Home and search navigation
    $('navHome')?.addEventListener('click', () => {
      activeCategory = 'all';

      if (el.search) {
        el.search.value = '';
      }

      showAllSongsLibrary();
      renderCards();
      closeSidebar();
    });

    $('navSearch')?.addEventListener('click', () => {
      el.search?.focus();
      closeSidebar();
    });

    $('brandLogo')?.addEventListener('click', () => {
      activeCategory = 'all';
      showAllSongsLibrary();
      renderCards();
    });

    // Show all playlists
    $('seeAllBtn')?.addEventListener('click', () => {
      if (el.search) {
        el.search.value = '';
      }

      activeCategory = 'all';

      el.filterChips
        ?.querySelectorAll('.filter-chip')
        .forEach((chip) => {
          chip.classList.toggle(
            'active',
            chip.dataset.category === 'all'
          );
        });

      showAllSongsLibrary();
      renderCards();
    });

    // Signup and login modals
    $('signupBtn')?.addEventListener('click', () => {
      openModal('signupModal');
    });

    $('loginBtn')?.addEventListener('click', () => {
      openModal('loginModal');
    });

    $('closeLoginModal')?.addEventListener('click', () => {
      closeModal('loginModal');
    });

    $('closeSignupModal')?.addEventListener('click', () => {
      closeModal('signupModal');
    });

    $('signupAvatar')?.addEventListener('change', async (event) => {
      const input = event.currentTarget;
      const file = input.files?.[0];
      input.value = '';
      if (!file) return;
      try {
        const cropped = await cropAvatarFile(file);
        if (!cropped) return;
        signupAvatarCroppedFile = cropped;
        const preview = $('signupAvatarPreview');
        if (signupAvatarPreviewUrl) URL.revokeObjectURL(signupAvatarPreviewUrl);
        signupAvatarPreviewUrl = URL.createObjectURL(cropped);
        if (preview) {
          preview.src = signupAvatarPreviewUrl;
          preview.alt = 'Cropped profile photo preview';
        }
      } catch (error) {
        window.alert(`Could not crop this profile photo: ${error.message}`);
      }
    });

    $('profileAvatarButton')?.addEventListener('click', () => $('profileAvatarInput')?.click());
    $('profileAvatarInput')?.addEventListener('change', async (event) => {
      const input = event.currentTarget;
      const file = input.files?.[0];
      input.value = '';
      if (!file) return;
      const button = $('profileAvatarButton');
      button.disabled = true;
      button.title = 'Uploading profile photo…';
      try {
        const cropped = await cropAvatarFile(file);
        if (!cropped) return;
        await window.sargamBackend.updateAvatar(cropped);
      } catch (error) {
        window.alert(`Could not update your profile photo: ${error.message}`);
      } finally {
        button.disabled = false;
        button.title = 'Change profile photo';
      }
    });

    ['loginModal', 'signupModal'].forEach((id) => {
      $(id)?.addEventListener('click', (event) => {
        if (event.target.id === id) {
          closeModal(id);
        }
      });
    });

    $('logoutBtn')?.addEventListener('click', async () => {
      try {
        await window.sargamBackend.signOut();
        setAdminPanelVisible(false);
      } catch (error) {
        alert(error.message);
      }
    });

    $('adminPanelBtn')?.addEventListener('click', () => {
      setAdminPanelVisible(true);
    });
    $('requestMusicBtn')?.addEventListener('click', () => {
      openModal('requestModal');
      renderMyRequests();
    });
    $('closeRequestModal')?.addEventListener('click', () => closeModal('requestModal'));
    $('requestModal')?.addEventListener('click', (event) => {
      if (event.target.id === 'requestModal') closeModal('requestModal');
    });
    $('musicRequestForm')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      // Fast Refresh can re-run this legacy script while retaining the same DOM.
      // Ignore duplicate submit listeners so one click creates only one request.
      if (form.dataset.submittingRequest === 'true') return;
      form.dataset.submittingRequest = 'true';
      const submit = $('submitMusicRequest');
      submit.disabled = true;
      setFormMessage('requestFormMessage', 'Uploading your folder and songs…');
      try {
        const audioFiles = [...($('requestAlbumTracks')?.files || [])];
        const requestData = {
          title: $('requestAlbumTitle').value.trim(),
          artist: $('requestAlbumArtist').value.trim(),
          description: $('requestAlbumDescription').value.trim(),
          coverFile: $('requestAlbumCover')?.files?.[0] || null,
          audioFiles,
          trackCredits: collectRequestTrackCredits()
        };
        await window.sargamBackend.submitAlbumRequest(requestData);
        $('musicRequestForm').reset();
        renderRequestTrackCredits([]);
        setFormMessage('requestFormMessage', `Your folder and ${audioFiles.length} song${audioFiles.length === 1 ? '' : 's'} were sent for admin review.`, 'success');
        await renderMyRequests();
      } catch (error) {
        setFormMessage('requestFormMessage', error.message, 'error');
      } finally {
        submit.disabled = false;
        form.dataset.submittingRequest = 'false';
      }
    });
    $('requestAlbumTracks')?.addEventListener('change', (event) => {
      renderRequestTrackCredits([...event.currentTarget.files || []]);
    });
    $('closeAdminPanel')?.addEventListener('click', () => {
      setAdminPanelVisible(false);
    });

    const closeAlbumEditor = () => closeModal('editAlbumModal');
    $('closeEditAlbumModal')?.addEventListener('click', closeAlbumEditor);
    $('cancelEditAlbum')?.addEventListener('click', closeAlbumEditor);
    $('editAlbumModal')?.addEventListener('click', (event) => {
      if (event.target.id === 'editAlbumModal') closeAlbumEditor();
    });
    $('editAlbumTracks')?.addEventListener('change', (event) => {
      renderEditAlbumNewTracks([...event.currentTarget.files || []]);
    });

    $('editAlbumForm')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const submit = $('saveEditAlbum');
      const trackEdits = [...($('editAlbumTrackList')?.querySelectorAll('.admin-edit-track-row') || [])]
        .map((row) => ({
          id: row.dataset.trackId,
          title: row.querySelector('[data-edit-track-field="title"]')?.value.trim() || '',
          singer: row.querySelector('[data-edit-track-field="singer"]')?.value.trim() || '',
          composer: row.querySelector('[data-edit-track-field="composer"]')?.value.trim() || '',
          category: row.querySelector('[data-edit-track-field="category"]')?.value || 'general',
          remove: Boolean(row.querySelector('[data-remove-track]')?.checked)
        }));
      const audioFiles = [...($('editAlbumTracks')?.files || [])];
      const trackCredits = collectEditAlbumNewTrackCredits();
      submit.disabled = true;
      $('editAlbumMessage').textContent = 'Saving folder changes and uploading new songs…';
      $('editAlbumMessage').className = 'admin-form-message';

      try {
        await window.sargamBackend.updateAlbum({
          albumId: $('editAlbumId').value,
          title: $('editAlbumTitle').value.trim(),
          artist: $('editAlbumArtist').value.trim(),
          description: $('editAlbumDescription').value.trim(),
          coverFile: $('editAlbumCover')?.files?.[0] || null,
          trackEdits,
          audioFiles,
          trackCredits
        });
        closeAlbumEditor();
        $('editAlbumForm').reset();
        setFormMessage('adminFormMessage', 'Folder details and songs were updated.', 'success');
        await refreshLibrary();
        await renderAdminAlbums();
        await renderAdminDashboard();
      } catch (error) {
        $('editAlbumMessage').textContent = error.message;
        $('editAlbumMessage').className = 'admin-form-message error';
      } finally {
        submit.disabled = false;
      }
    });

    $('adminAlbumTracks')?.addEventListener('change', (event) => {
      renderAdminTrackCredits([...event.currentTarget.files || []]);
    });

    $('adminAlbumForm')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const submit = $('adminUploadButton');
      const audioFiles = [...($('adminAlbumTracks')?.files || [])];
      const coverFile = $('adminAlbumCover')?.files?.[0] || null;
      submit.disabled = true;
      setFormMessage('adminFormMessage', 'Uploading folder and tracks…');

      try {
        await window.sargamBackend.addAlbum({
          title: $('adminAlbumTitle').value.trim(),
          description: $('adminAlbumDescription').value.trim(),
          artist: $('adminAlbumArtist').value.trim(),
          coverFile,
          audioFiles,
          trackCredits: collectAdminTrackCredits(),
          requireCredits: true
        });
        $('adminAlbumForm').reset();
        renderAdminTrackCredits([]);
        setFormMessage('adminFormMessage', 'Folder added to the library.', 'success');
        await refreshLibrary();
        await renderAdminAlbums();
        await renderAdminDashboard();
      } catch (error) {
        setFormMessage('adminFormMessage', error.message, 'error');
      } finally {
        submit.disabled = false;
      }
    });

    $('signupForm')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const backend = window.sargamBackend;
      if (!backend?.configured) {
        setFormMessage('signupMessage', 'Connect Supabase first. Add the project URL and anon key to .env.local, then restart the app.', 'error');
        return;
      }

      const email = $('signupEmail').value.trim();
      const avatarFile = signupAvatarCroppedFile;
      let storedAvatarKey = '';
      setFormMessage('signupMessage', 'Creating your account…');
      try {
        if (avatarFile) {
          const dataUrl = await blobToDataUrl(avatarFile);
          storedAvatarKey = pendingAvatarKey(email);
          localStorage.setItem(storedAvatarKey, dataUrl);
        }
        const result = await backend.signUp({
          name: $('signupName').value.trim(),
          email,
          password: $('signupPassword').value
        });
        if (result.needsEmailConfirmation) {
          setFormMessage('signupMessage', 'Account created. Check your email to confirm, then log in.', 'success');
        } else {
          closeModal('signupModal');
          $('signupForm').reset();
        }
        signupAvatarCroppedFile = null;
        if (signupAvatarPreviewUrl) URL.revokeObjectURL(signupAvatarPreviewUrl);
        signupAvatarPreviewUrl = '';
        if ($('signupAvatarPreview')) {
          $('signupAvatarPreview').src = '/avatar-default.svg';
          $('signupAvatarPreview').alt = 'Default profile photo preview';
        }
      } catch (error) {
        if (storedAvatarKey) localStorage.removeItem(storedAvatarKey);
        setFormMessage('signupMessage', error.message, 'error');
      }
    });

    $('loginForm')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const backend = window.sargamBackend;
      if (!backend?.configured) {
        setFormMessage('loginMessage', 'Connect Supabase first. Add the project URL and anon key to .env.local, then restart the app.', 'error');
        return;
      }

      setFormMessage('loginMessage', 'Signing in…');
      try {
        await backend.signIn({
          email: $('loginEmail').value.trim(),
          password: $('loginPassword').value
        });
        closeModal('loginModal');
        $('loginForm').reset();
      } catch (error) {
        setFormMessage('loginMessage', error.message, 'error');
      }
    });

    // Keyboard shortcuts
    document.addEventListener('keydown', (event) => {
      const tag = document.activeElement?.tagName;

      if (
        ['INPUT', 'TEXTAREA'].includes(tag) ||
        document.activeElement?.isContentEditable
      ) {
        return;
      }

      if (event.code === 'Space') {
        event.preventDefault();
        togglePlay();
      }

      if (event.key === 'ArrowRight') {
        if (audio.duration) {
          audio.currentTime = Math.min(
            audio.duration,
            audio.currentTime + 5
          );
        } else {
          nextSong();
        }
      }

      if (event.key === 'ArrowLeft') {
        if (audio.currentTime > 5) {
          audio.currentTime -= 5;
        } else {
          previousSong();
        }
      }

      if (event.key.toLowerCase() === 's') {
        el.shuffle?.click();
      }

      if (event.key.toLowerCase() === 'r') {
        el.repeat?.click();
      }

      if (event.key.toLowerCase() === 'm') {
        toggleMute();
      }
    });
  }

  // --------------------------------------------------
  // Decorative audio visualizer
  // --------------------------------------------------

  function startVisualizer() {
    const canvas = el.canvas;

    if (!canvas) return;

    const context = canvas.getContext('2d');

    if (!context) return;

    let phase = 0;

    function draw() {
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;

      if (
        canvas.width !== Math.round(rect.width * dpr) ||
        canvas.height !== Math.round(rect.height * dpr)
      ) {
        canvas.width = Math.round(rect.width * dpr);
        canvas.height = Math.round(rect.height * dpr);
      }

      context.setTransform(dpr, 0, 0, dpr, 0, 0);

      context.clearRect(
        0,
        0,
        rect.width,
        rect.height
      );

      const bars = 28;
      const gap = 4;
      const accentColor = getComputedStyle(document.documentElement)
        .getPropertyValue('--theme-accent').trim() || '#1ed760';

      const width = Math.max(
        2,
        (rect.width - gap * (bars - 1)) / bars
      );

      for (let i = 0; i < bars; i++) {
        const wave = Math.abs(Math.sin(phase + i * 0.43));

        const height = audio.paused
          ? 5 + wave * 8
          : 5 + wave * (rect.height - 8);

        context.fillStyle = accentColor;
        context.globalAlpha = 0.45 + wave * 0.5;

        context.beginPath();

        context.roundRect(
          i * (width + gap),
          (rect.height - height) / 2,
          width,
          height,
          3
        );

        context.fill();
      }

      context.globalAlpha = 1;

      phase += audio.paused ? 0.012 : 0.09;

      requestAnimationFrame(draw);
    }

    draw();
  }

  // --------------------------------------------------
  // Start the music player
  // --------------------------------------------------

  function loadSongDurations() {
    albums.forEach((album) => {
      album.songs.forEach((song) => {
        if (song.duration) return;

        const probe = new Audio();
        probe.preload = 'metadata';
        probe.src = song.url;

        probe.addEventListener('loadedmetadata', () => {
          song.duration = probe.duration || 0;
          if (currentSongs.some((item) => item.id === song.id)) {
            renderSongList();
          }
        }, { once: true });

        probe.addEventListener('error', () => {
          console.warn('Could not read song metadata:', song.url);
        }, { once: true });
      });
    });
  }

  async function init() {
    setupTrackNameDisplay();
    bindEvents();
    window.addEventListener('sargam:auth-changed', (event) => {
      renderAuthState(event.detail);
      if (event.detail?.user && event.detail.role !== 'admin') renderMyRequests();
    });
    window.addEventListener('sargam:library-updated', () => {
      if (!$('adminPanel')?.hidden && window.sargamBackend?.getState()?.role === 'admin') renderAdminDashboard();
      if ($('requestModal')?.classList.contains('open')) renderMyRequests();
    });
    renderAuthState(window.sargamBackend?.getState());
    startLibrarySync();

    audio.volume = 0.8;

    if (el.volume) {
      el.volume.value = '0.8';
    }

    if (el.cards) {
      el.cards.innerHTML = `
        <div class="status-message">
          Loading your music library…
        </div>
      `;
    }

    try {
      albums = await discoverAlbums();
      lastLibrarySignature = signatureForLibrary(albums);

      if (!albums.length) {
        const emptyLibraryMessage = window.sargamBackend?.configured
          ? 'No music folders have been added yet. An admin can add the first folder from Manage Music.'
          : `No albums containing audio files were found in ${SONGS_URL}. Add a song folder and an info.json file, then it will appear here.`;

        if (el.cards) {
          el.cards.innerHTML = `
            <div class="status-message">
              ${escapeHtml(emptyLibraryMessage)}
            </div>
          `;
        }

        if (el.songs) {
          el.songs.innerHTML = `
            <li class="status-message">No songs loaded yet.</li>
          `;
        }

        startVisualizer();
        return;
      }

      renderCards();

      selectAlbum(0, false);

      // Read durations in the background without delaying the playlist view.
      loadSongDurations();
    } catch (error) {
      console.error(
        'Sargam.play music library failed to load:',
        error
      );

      if (el.cards) {
        const librarySource = window.sargamBackend?.configured
          ? 'the Supabase library'
          : '/api/songs';
        el.cards.innerHTML = `
          <div class="status-message">
            Could not load the music library from ${escapeHtml(librarySource)}.
            Details: ${escapeHtml(error.message)}
          </div>
        `;
      }

      if (el.songs) {
        el.songs.innerHTML = `
          <li class="status-message">
            The music library could not be loaded.
          </li>
        `;
      }
    }

    startVisualizer();
  }

  init();
})();
