# Sargam.play

## Supabase setup

1. Create a Supabase project.
2. Open its SQL Editor and run [`supabase/schema.sql`](supabase/schema.sql).
3. For an existing project, run [`supabase/update-existing-project.sql`](supabase/update-existing-project.sql) in SQL Editor. It adds singer/composer fields, ensures Top Hits play counting, and sets up avatar storage. New projects get these from `schema.sql`.
4. Copy `.env.example` to `.env.local` and add the project URL and publishable key from the project's **Connect** dialog or **Settings > API Keys**.
5. Restart the Vite server:

   ```powershell
   npm.cmd run dev
   ```

The app uses Supabase Auth for registration and login, Postgres for albums, tracks, folder requests, and per-account favorites, and Supabase Storage for music files. Approved music is in the public `music` bucket; unapproved requests stay in the private `music-requests` bucket. Only the project URL and publishable key belong in `.env.local`; never put a secret or service-role key in the browser app.

## Make the first admin

Register the account that should administer the library. Then, in the Supabase SQL Editor, run this once with that email:

```sql
update public.profiles
set role = 'admin'
where id = (
  select id from auth.users where email = 'your-admin-email@example.com'
);
```

Log out and back in. The **Manage Music** button will appear for that account. Admin rights are checked by database policies as well as the interface.

## Manage folders and tracks

In **Manage Music**, enter a folder name and select its audio tracks. A song-credit section appears for the selected files; enter each track's singer and composer before uploading. Add an optional description and cover image, then submit the folder. Singer and composer names appear in the song list and are included in search. The dashboard shows folder and song counts, listeners, plays, likes, pending requests, and the most played and liked songs. Removing a folder deletes its tracks and removes its files from Storage.

Signed-in listeners can use **Request Music** to submit a prepared folder. Include `info.json`, audio tracks, and an optional cover image. Example `info.json`:

```json
{
  "title": "My Album",
  "description": "A short description",
  "artist": "Artist name",
  "cover": "cover.jpg",
  "songs": [
    {
      "file": "evening-song.mp3",
      "title": "Evening Song",
      "singer": "Singer name",
      "composer": "Composer name"
    }
  ]
}
```

The `songs` list is optional. If included, use each audio file's exact filename in `file`; the singer and composer credits are carried into the admin review and library when approved.

The folder is private while pending. The admin sees it under **Folder requests** and can approve or reject it. Approval moves its tracks and cover into the public music library; rejection leaves it out of the library. Listeners can check their request status in the same request window.

When Supabase is configured, this database library is the source shown to users. Existing files under `public/songs` are the local development library; upload those tracks through the admin panel to make them available to all accounts.

## Local development without Supabase

The Vite server can still scan `public/songs` for local playback. Put audio files directly inside an album folder. An `info.json` file can provide the folder metadata:

```json
{
  "title": "My Album",
  "description": "A short description",
  "artist": "Artist name",
  "cover": "cover.jpg"
}
```

Adding or removing local files updates the library while the dev server is running. Supported formats are MP3, WAV, OGG, M4A, AAC, and FLAC.

## Project report

[`PROJECT_REPORT.md`](PROJECT_REPORT.md) explains the project flow, technologies, data model, key implementation decisions, and the main problems solved in report-friendly language.
