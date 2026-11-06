# Saksi — 3-minute demo video

This is the recording script for the submission video. It follows the 3-minute structure from
the hackathon presentation guide: problem → solution → live demo → why it matters → next, with
the golden path only and no sign-up on camera.

Every number in the narration below was read from the live deployment on 6 November 2026, and
the command that reproduces it is named beside it. Nothing here is illustrative.

---

## 1. What this video may and may not claim

This matters more than production value. A judge who catches one inflated claim discounts the
whole demo.

**May claim**

- Walrus Memory is the record: the public journal page reads the relayer with no session, no
  wallet and no database query behind it.
- The demo journal holds 24 memories, 7 picks, 7 resolved, 1 bias pattern.
- `pnpm verify:reconstruct` reports `mismatches: 0` for 3 journals.
- One real settlement on Sui mainnet: status `success`, 10 000 atomic USDC, verified through
  Tatum before the payload was released.
- The oracle covers one league (`eng.1`) and one market; everything else is labelled
  `self-attested`.
- 185 tests pass across 21 files.

**May not claim**

- That the demo journal is real forecasting. It is a seeded, **synthetic** journal and the page
  labels each row `synthetic demo`. Say so once, on camera.
- That the public journal page shows a _verified_ score. It says the opposite: a memory record
  carries no oracle flag, so the verified score on that page is always zero.
- That a **buyer bought from a seller** on the marketplace. The recorded settlement is for the
  platform catalogue listing. The buyer→seller sale is not yet exercised end to end.
- That memories are encrypted or private. With the default client the relayer sees plaintext.
- That an LLM predicts anything. There is no model in the loop; it is embedding + cosine recall,
  and the verdict rule is explicit code.

---

## 2. Pre-flight (do this 30 minutes before)

- [ ] **Warm the relayer.** Open `/journals`, then the demo journal, once. Cold recall measured
      0.9–4.8 s; a warm page has no dead air.
- [ ] **Warm the terminal.** Run `pnpm verify:reconstruct` once, then clear the screen and keep
      the command in history. It prints `journals with picks: 3` then `mismatches: 0`.
- [ ] **Pre-open tabs, in this order**, so you never type a URL on camera: 1. `https://saksi-psi.vercel.app/` 2. `https://saksi-psi.vercel.app/journals` 3. the demo journal (URL in §6) 4. `https://saksi-psi.vercel.app/how-it-works`
- [ ] **Do not log in on camera.** The public pages need no session. If you want the extended cut
      (§7), log in first and confirm the session survives a reload — Slack/Slush will warn about
      the domain, and dismissing that warning is not something to do on camera.
- [ ] Hide the bookmarks bar, close other tabs, turn on Focus assist, set browser zoom to 110–125 %.
- [ ] Terminal font at least 16 pt; the two output lines must be readable after compression.
- [ ] Record at 1080p30. The judge may watch on a laptop; 4K only makes the file large.

---

## 3. The 3-minute timeline

| Time        | Say                                           | Show                                                | Avoid                           |
| ----------- | --------------------------------------------- | --------------------------------------------------- | ------------------------------- |
| 0:00 – 0:22 | Win rate is a claim, not a record             | Landing hero                                        | Origin story, team intros       |
| 0:22 – 0:52 | Seal → reveal → resolve → memory argues back  | `/how-it-works`, the four-step strip                | Architecture diagram, stack     |
| 0:52 – 1:52 | Live: public journal, 24/7/7/1, then terminal | `/journals` → demo journal → `verify:reconstruct`   | Typing, login, logs, scrolling  |
| 1:52 – 2:28 | Why it matters; what was validated            | Landing proof strip or `/how-it-works` integrations | "AI-powered" without proof      |
| 2:28 – 3:00 | What is next; the link                        | End card with URL                                   | "Any questions?", overpromising |

Speech budget: 450–540 words for a full 3 minutes at a normal pace. The narration below is 373
words, which at a demo pace (about 130 words per minute, because you are also clicking) lands
around 2:50. Ending early reads as finished; running over does not.

---

## 4. Full narration (English)

> **0:00 — Landing hero.**
> A win rate is a claim, not a record. Anyone can post ninety percent and quietly delete the
> losses. And for an analyst who sells picks, there is no proof they called it before the
> result — only their word, after the fact.

> **0:22 — `/how-it-works`, four-step strip.**
> Saksi turns the pick into a record. Seal it before the event: the selection is hashed, and
> only the hash goes to Walrus Memory. Reveal it after: the server re-hashes the payload and
> refuses if one byte moved. Resolve it against a provider the analyst does not control. Then
> memory argues back — a recalled bias pattern can downgrade the next verdict.

> **0:52 — `/journals`, then the demo journal.**
> This page has no session, no login and no database. It reads Walrus Memory directly. Fifteen
> journals, sixty-nine memories, all from the relayer.
> _(click the demo journal)_
> Here is the seeded demo journal — labelled synthetic, because it is. Twenty-four memories,
> seven picks, seven resolved, one bias pattern.
> _(scroll slowly to the memory rows)_
> Every row is the stored text itself. A commit before the event. A reveal after. An outcome
> with a Brier score. And a bias the system noticed on its own: two of two underdog picks above
> odds two-point-five lost. Nobody typed that pattern in.
> _(cut to terminal)_
> Rebuild the journal from Walrus alone, then compare it to the stored figures. Zero
> mismatches across three journals.

> **1:52 — integrations strip.**
> Three services, one loop. Walrus Memory is the record, not a cache — if the database were
> deleted, the journal still reconstructs. Tatum verifies the chain: this mainnet settlement is
> real, status success, ten thousand atomic USDC, confirmed before the payload was released.
> x402 means the buyer signs with their own wallet; the server never holds a key. And the
> limits are on the page: the oracle covers one league and one market. Everything else is
> labelled self-attested, not verified.

> **2:28 — end card.**
> Next: widen the oracle to more leagues and markets, and aggregate across journals so
> reputation travels with the record. One hundred and eighty-five tests, all green. The demo
> journal is public — open it now at saksi-psi.vercel.app. No wallet needed to read a track
> record.

---

## 5. Narasi Indonesia (kalau juri berbahasa Indonesia)

Pakai ini hanya jika Anda yakin jurinya berbahasa Indonesia. Untuk juri internasional, versi
Inggris di atas lebih aman. Jangan campur keduanya dalam satu rekaman.

> **0:00.** Sebuah win rate hanyalah klaim, bukan catatan. Siapa pun bisa mengunggah angka
> sembilan puluh persen lalu diam-diam menghapus kekalahannya. Bagi analis yang menjual
> prediksi, tidak ada bukti bahwa dia memilih sebelum hasilnya keluar — yang ada hanya
> ucapannya, setelah kejadian.

> **0:22.** Saksi mengubah prediksi menjadi catatan. Disegel sebelum pertandingan: pilihannya
> di-hash, dan hanya hash yang ditulis ke Walrus Memory. Diungkap sesudahnya: server menghitung
> ulang hash dan menolak kalau satu byte saja berubah. Diselesaikan lewat penyedia yang tidak
> dikendalikan analis. Lalu memori ikut berbicara — pola bias yang diingat bisa menurunkan
> verdict berikutnya.

> **0:52.** Halaman ini tanpa sesi, tanpa login, dan tanpa database. Ia membaca Walrus Memory
> langsung. Lima belas jurnal, enam puluh sembilan memori, semuanya dari relayer. Ini jurnal
> demo — berlabel sintetis, karena memang begitu. Dua puluh empat memori, tujuh pick, tujuh
> selesai, satu pola bias. Setiap baris adalah teks yang benar-benar tersimpan. Commit sebelum
> pertandingan. Reveal sesudahnya. Outcome dengan Brier score. Dan satu bias yang ditemukan
> sistem sendiri: dua dari dua pick underdog di atas odds dua koma lima kalah. Pola itu tidak
> ada yang mengetik. Lalu bangun ulang jurnal dari Walrus saja dan bandingkan dengan angka
> tersimpan: nol ketidakcocokan di tiga jurnal.

> **1:52.** Tiga layanan, satu lingkaran. Walrus Memory adalah catatannya, bukan cache — kalau
> database dihapus, jurnalnya tetap bisa dibangun ulang. Tatum memverifikasi rantai: settlement
> mainnet ini asli, status success, sepuluh ribu atomic USDC, dikonfirmasi sebelum payload
> dirilis. x402 berarti pembeli menandatangani dengan wallet-nya sendiri; server tidak pernah
> memegang kunci. Dan batasnya ditulis di halaman: oracle hanya mencakup satu liga dan satu
> pasar. Sisanya berlabel self-attested, bukan terverifikasi.

> **2:28.** Berikutnya: memperluas oracle ke lebih banyak liga dan pasar, lalu agregasi antar
> jurnal supaya reputasi ikut berpindah bersama catatannya. Seratus delapan puluh lima tes,
> semuanya lulus. Jurnal demo terbuka untuk umum — buka sekarang di saksi-psi.vercel.app.
> Tanpa wallet untuk membaca rekam jejak.

---

## 6. Shot list — exact URLs and what must be on screen

| #   | URL                                                                                                                | Must be visible                                                       | Do not                           |
| --- | ------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------- | -------------------------------- |
| 1   | `https://saksi-psi.vercel.app/`                                                                                    | H1 "The prediction journal that cannot lie."                          | Scroll past the hero             |
| 2   | `https://saksi-psi.vercel.app/how-it-works`                                                                        | The four-step strip: Seal / Reveal / Resolve / memory                 | Read the whole page              |
| 3   | `https://saksi-psi.vercel.app/journals`                                                                            | "15 history namespaces", "69 sum of relayer-reported counts"          | Open a random legacy journal     |
| 4   | `https://saksi-psi.vercel.app/journals/saksi%3A0xb31a2af978e55a73d954ca6f98fdec91746278654ca8263ea3b5318fa310676f` | 24 · 7 · 7 · 1, then the memory rows                                  | Open the raw JSON view on camera |
| 5   | terminal in `D:\Hackathon Project\saksi`                                                                           | `pnpm verify:reconstruct` → `journals with picks: 3`, `mismatches: 0` | Scroll terminal history          |
| 6   | `https://saksi-psi.vercel.app/how-it-works` (integrations section) or `/#integrations`                             | The x402 strip and the "does not claim" cards                         | Explain the architecture         |
| 7   | end card                                                                                                           | `saksi-psi.vercel.app` in large type                                  | End on "any questions?"          |

The demo journal URL is long. Pre-open it as a tab; never read it aloud.

---

## 7. Recording on Windows 10

`ffmpeg` and OBS are not installed on this machine. Two workable paths.

**Path A — OBS (recommended: one take, mic and screen together)**

```powershell
winget install --id OBSProject.OBSStudio -e
```

Then: Sources → Display Capture (or Window Capture on the browser) + Audio Input Capture (your
mic) → Settings → Output → 1080p, 30 fps, MP4 → Start Recording. Do one silent dry run first to
check nothing sensitive is on screen.

**Path B — no install (Xbox Game Bar + Windows video editor)**

1. `Win + G` → Capture → Start recording. This records the active window; switch windows with
   `Alt + Tab` before starting, not during.
2. Record narration separately on your phone or with Voice Recorder, then combine in Clipchamp
   (built into Windows 10/11) or CapCut.
3. Clipchamp can also burn in subtitles from `docs/demo-subtitles-en.srt`.

**Path C — post-processing only.** If you want to trim and compress, install ffmpeg:

```powershell
winget install --id Gyan.FFmpeg -e
```

```powershell
# trim to the take you want, re-encode for a small upload
ffmpeg -ss 00:00:02 -to 00:02:50 -i raw.mp4 -c:v libx264 -crf 20 -preset veryfast -c:a aac -b:a 128k saksi-demo.mp4

# check the duration before uploading
ffprobe -v error -show_entries format=duration -of default=nw=1:nk=1 saksi-demo.mp4
```

Sound is the part that decides whether a judge keeps watching. A quiet room and a headset mic
beat any amount of editing.

---

## 8. If the demo breaks mid-recording

Follow the guide's recovery plan, in this order:

1. **Stay calm, keep talking.** Dead air is worse than a stale screen.
2. **Say the fail line** and mean it: "The live relayer is slow right now — here is the same page
   from twenty minutes ago." Cut to a screenshot.
3. **Show the deployed URL** and say it aloud.
4. **Explain the expected behaviour** in one sentence, then move on.
5. **Never debug on camera.** Stop the take and re-record that segment.

Keep a folder of backup screenshots taken during pre-flight:

- landing hero
- `/journals` with 69
- demo journal with 24 · 7 · 7 · 1 and the bias row
- terminal with `mismatches: 0`
- `/memory` relayer status showing `writes ready` (extended cut only)

---

## 9. Q&A bank — the 15 questions judges actually ask

Answer formula: direct answer (10 s) → evidence (20 s) → scope honesty (10 s).

1. **Who is this for?** Analysts and tipsters who sell picks, and anyone whose reputation depends
   on a track record they cannot retroactively edit.
2. **What problem do existing tools not solve?** A posted win rate is unverifiable. Saksi makes
   the commitment itself the artifact: a hash written before the event, a reveal that fails on any
   edit, and a public page reconstructed from Walrus with no database.
3. **How did you validate demand?** Honestly: there are no external users yet. What is validated
   is the mechanism, end to end on mainnet — a real blob write, a real settlement verified by
   Tatum, and `mismatches: 0` when the record is rebuilt from Walrus alone.
4. **What did you build vs what is mocked?** Built: sealing, reveal, resolution, scoring, Walrus
   Memory, Tatum GraphQL, x402, the HTTP boundary and the UI. Not mocked at runtime — there are
   no mocks in the app. Synthetic: the demo journal's payloads, which the page labels
   `synthetic demo`, and the catalogue listing used to exercise the paywall.
5. **What breaks if 100 users try this now?** The known bottlenecks, measured: one MemWal account
   holds every namespace, so isolation is app-level and the relayer sees all of it; `recall()`
   takes 0.9–4.8 s; a global namespace walk takes 25.8 s at concurrency 8; the Postgres pool is
   sized for a small plan.
6. **How does the AI part work?** There is no LLM in the loop. Memories are embedded and recalled
   by cosine distance at the relayer; the verdict downgrade is an explicit rule (`≥2` evidence
   points, or a paid source with a negative hit rate), unit tested, and the response says
   "Memory changed the verdict from X to Y" instead of hiding it.
7. **What happens when the API is down or rate-limited?** A pick is sealed only if the memory
   write succeeds; on failure the Postgres row is deleted and the API returns `502`. Payment
   verification treats a not-yet-indexed digest as eventual consistency and retries for ~20 s
   across 7 attempts, because failing closed on a fresh digest charged a buyer without releasing
   the payload.
8. **Where is data stored and who can see it?** Walrus Memory on mainnet is the record; Postgres
   keeps only the security tables (wallet challenges, payment digest uniqueness, sealed picks).
   The relayer sees plaintext — stated in the README, not hidden. Public journal pages are public
   by design, because that is what makes a track record auditable.
9. **Why this stack?** Walrus Memory removes the need for a local write log: the journal can be
   rebuilt from the relayer alone, which is the product's central claim. Tatum over GraphQL
   because Sui JSON-RPC is deprecated. Next.js server components read the relayer directly.
10. **What would you cut with four fewer hours?** The marketplace UI polish. The seal → reveal →
    resolve → memory loop is the idea; the shop around it is not.
11. **What would you build with four more weeks?** Oracle breadth (more leagues and markets),
    one MemWal account per user so isolation moves onchain, and cross-journal reputation
    aggregation.
12. **How would you get the first 100 users?** Start with one league's tipsters: give each a
    public journal URL they can post as their proof page, instead of a screenshot of a spreadsheet.
13. **What did each teammate own?** _Fill this in yourself. Name one person per area and keep it
    to one line each._
14. **Hardest bug?** The Tatum index lag: a buyer paid, the seller asked Tatum, got
    `Transaction not found`, and returned 402 to someone who had already paid. The fix was to
    treat "not found" as temporary and retry for ~20 s; a regression test pins it.
15. **Can I try it right now?** Yes — `saksi-psi.vercel.app`. The demo journal is public and needs
    no wallet. Reading a track record should never require signing in.

---

## 10. Words not to say

| Do not say                               | Say instead                                                              |
| ---------------------------------------- | ------------------------------------------------------------------------ |
| "Encrypted memories" / "private memory"  | "The relayer sees plaintext; the journal page is public by design."      |
| "AI predicts the winner"                 | "Memory recalls a bias pattern and downgrades the verdict."              |
| "A buyer bought from a seller"           | "One real mainnet settlement, verified by Tatum before release."         |
| "Verified track record" on the demo page | "The demo journal is synthetic; verified scores are zero there."         |
| "Real users" / "users love it"           | "No external users yet; the mechanism is validated end to end."          |
| "Trustless"                              | "The server never holds the buyer's key; Tatum verifies the settlement." |

---

## 11. Subtitles

`docs/demo-subtitles-en.srt` matches the English narration in §4. Timings are approximate —
after you record, nudge each cue so it lands with the cut, or let Clipchamp auto-caption and use
the file only as a reference.

Do not burn in subtitles if the video will be uploaded to a platform that generates its own; two
overlapping caption tracks look broken.
