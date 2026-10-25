# Profile backup and restore

- Backup before any launch: `<home>/QA-profile-backups/bdobb-clean-v6-regression-20261008T145048/` holds Application Support, WebKit and Caches for `com.artcashin.bdobb.clean.v6` and `com.artcashin.bdobb.clean.v5.reconciled`; each copy was diffed file-by-file against the live tree (identical). Tree hashes in `ORIGINAL-TREE-HASHES.txt` there.
- v6 ran on a disposable empty profile (live v6 dirs moved to `moved-live/` inside the backup folder). The v5→v6 migration used a copy of the v5 backup; rollback moved the live v5 Application Support aside and ran v5 on a copy.
- Restore (2026-10-08 ~16:05 EDT, both apps stopped): v6 dirs moved back from `moved-live/`; v5 WebKit and Caches (touched by the rollback launch) replaced from the backup; v5 Application Support had been moved back after rollback.
- Verification: recursive sha256 of all six trees equals ORIGINAL-TREE-HASHES.txt exactly:

```
e3254c8ecb2583cfa2159baa1d991ef02fede4b346b415e38ee17d13b76101b3  Application Support/v6
f522af245fa50a359108914df9bf026bad594ef406e095a5e2441feb07dee6bf  WebKit/v6
4c37e71000b4062e2e98d67baf391a7593a3805fb4c3f091956799cc06432515  Caches/v6
45828314ca13b5a42cf85ee437d8a8b5eddcf19b2cc37d8d715159a41cfdee41  Application Support/v5.reconciled
643590ae4c98fa1c16b26b5fec0328c7e78ccffe4d9a812284d796854f835f83  WebKit/v5.reconciled
484714c5e60b6739db47fe75567539c0db1285a3ac55236d733c01e6f8956847  Caches/v5.reconciled
```

- Never opened, copied or launched: `com.artcashin.bdobb2`, `com.artcashin.bdobb`, any other app profile or installed app. The v3 Repair QA app running from another session was left alone.
