import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { migrateLibrary } from '../server/library-service.js';
import { selectWallpaperRow, latestScheduledBoundary } from '../server/platform/wallpaper-selection.js';

test('legacy migration takes a consistent backup and preserves photo IDs, curation and history',async () => {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'inktime-migration-'));
  const file=path.join(root,'legacy.sqlite');
  const db=new DatabaseSync(file);
  try {
    db.exec(`create table source_photos(id text primary key,file_name text,status text,captured_date text,file_hash text);
      create table processed_photos(id text primary key,source_id text,memory_score real,is_representative integer,wallpaper_url text);
      create table curated_photos(photo_id text primary key);
      create table wallpaper_history(photo_id text,set_at text);
      insert into source_photos values('original-source','中文 photo.jpg','processed','2020-04-03','original-hash');
      insert into processed_photos values('original-photo','original-source',90,1,'/wallpapers/original.png');
      insert into curated_photos values('original-photo');
      insert into wallpaper_history values('original-photo','2020-01-01T00:00:00Z');`);
    await migrateLibrary(db,file);
    assert.equal(db.prepare('pragma user_version').get().user_version,3);
    assert.equal(db.prepare('select id from processed_photos').get().id,'original-photo');
    assert.equal(db.prepare('select photo_id from curated_photos').get().photo_id,'original-photo');
    assert.equal(db.prepare('select photo_id from wallpaper_history').get().photo_id,'original-photo');
    const backups=await fs.readdir(path.join(root,'backups'));
    assert.equal(backups.length,1);
    const backup=new DatabaseSync(path.join(root,'backups',backups[0]),{readOnly:true});
    assert.equal(backup.prepare('pragma integrity_check').get().integrity_check,'ok');
    assert.equal(backup.prepare('pragma user_version').get().user_version,0);
    backup.close();
    await migrateLibrary(db,file);
    assert.equal((await fs.readdir(path.join(root,'backups'))).length,1);
    assert.equal(selectWallpaperRow(db,{wallpaperCollection:'curated'}).id,'original-photo');
    db.prepare('update processed_photos set wallpaper_excluded=1').run();
    assert.equal(selectWallpaperRow(db,{wallpaperCollection:'curated'}),null);
  } finally { db.close(); await fs.rm(root,{recursive:true,force:true}); }
});

test('wallpaper candidates relax oldest history first and preserve whole-hour boundaries',() => {
  const db=new DatabaseSync(':memory:');
  try {
    db.exec(`create table source_photos(id text,file_name text); create table processed_photos(id text,source_id text,wallpaper_url text,is_representative integer,wallpaper_excluded integer);
      create table wallpaper_history(photo_id text,set_at text); create table curated_photos(photo_id text);
      insert into source_photos values('a','a'),('b','b'); insert into processed_photos values('a','a','a.png',1,0),('b','b','b.png',1,0);
      insert into wallpaper_history values('a','2026-10-04T08:00:00Z'),('b','2026-10-04T07:00:00Z');`);
    assert.equal(selectWallpaperRow(db,{wallpaperCollection:'all'}).id,'b');
    const date=new Date(2026,9,4,7,45);
    const boundary=latestScheduledBoundary(4,date);
    assert.equal(boundary.getHours(),4);
    assert.equal(boundary.getMinutes(),0);
    assert.equal(latestScheduledBoundary(0,date),null);
  } finally { db.close(); }
});

test('resource paths resolve packed and already-unpacked applications exactly once',async () => {
  const { resolveUnpackedRoot }=await import('../server/platform/runtime-paths.js');
  assert.equal(resolveUnpackedRoot('/Applications/InkTime.app/Contents/Resources/app.asar'),'/Applications/InkTime.app/Contents/Resources/app.asar.unpacked');
  assert.equal(resolveUnpackedRoot('/Applications/InkTime.app/Contents/Resources/app.asar.unpacked'),'/Applications/InkTime.app/Contents/Resources/app.asar.unpacked');
  assert.equal(resolveUnpackedRoot('C:\\中文 folder\\resources\\app.asar'),'C:\\中文 folder\\resources\\app.asar.unpacked');
  assert.equal(resolveUnpackedRoot('/workspace/app.asar-example/inktime'),'/workspace/app.asar-example/inktime');
});

test('wallpaper readback resolves filesystem aliases and preserves commas in filenames',async () => {
  const { desktopWallpaperMatches }=await import('../server/platform/desktop-wallpaper.js');
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'inktime-path-'));
  try {
    const file=path.join(root,'中文, photo.jpg');
    await fs.writeFile(file,'fixture');
    await fs.symlink(file,path.join(root,'alias.jpg'));
    assert.equal(desktopWallpaperMatches(file,path.join(root,'alias.jpg')),true);
    assert.equal(desktopWallpaperMatches(file+'\n'+file,file),true);
    assert.equal(desktopWallpaperMatches(file+'-other',file),false);
  } finally { await fs.rm(root,{recursive:true,force:true}); }
});
