import fs from 'node:fs/promises';
import path from 'node:path';

export async function migrateLibrary(db, dbPath) {
  db.exec('pragma busy_timeout = 5000');
  const version = Number(db.prepare('pragma user_version').get().user_version);
  if (version > 3) throw new Error("数据库版本高于当前应用，请使用更新版本");
  if (version === 3) return;
  const backups = path.join(path.dirname(dbPath), 'backups');
  await fs.mkdir(backups, { recursive: true });
  const target = path.join(backups, `pre-upgrade-${Date.now()}.sqlite`);
  db.exec(`vacuum into '${target.replaceAll("'", "''")}'`);
  db.exec('begin immediate');
  try {
    for (const [table, name, definition] of [
      ['source_photos', 'file_size', 'integer'], ['source_photos', 'file_mtime', 'real'],
      ['processed_photos', 'manual_edits', "text not null default '{}'"],
      ['processed_photos', 'wallpaper_excluded', 'integer not null default 0'],
      ['processed_photos', 'group_override', 'text'],
      ['processed_photos', 'source_hash', 'text'],
    ]) {
      if (!db.prepare(`pragma table_info(${table})`).all().some(row => row.name === name)) db.exec(`alter table ${table} add column ${name} ${definition}`);
    }
    db.exec(`
      create table if not exists tasks (
        id text primary key, mode text not null, status text not null, config_json text not null,
        created_at text not null, updated_at text not null, message text not null default '', scan_report_json text not null default '{}'
      );
      create table if not exists task_items (
        task_id text not null references tasks(id) on delete cascade,
        source_id text not null references source_photos(id) on delete cascade,
        ordinal integer not null, status text not null default 'pending', stage text not null default 'analysis',
        checkpoint_json text not null default '{}', error text not null default '',
        primary key(task_id, source_id)
      );
      create index if not exists idx_tasks_status on tasks(status,created_at);
      create index if not exists idx_task_items_status on task_items(task_id,status,ordinal);
      create index if not exists idx_photo_score on processed_photos(memory_score,id);
      create index if not exists idx_source_date on source_photos(captured_date,id);
      update processed_photos set source_hash=(select file_hash from source_photos s where s.id=processed_photos.source_id) where source_hash is null;
      pragma user_version = 3;
    `);
    if (!db.prepare('pragma table_info(tasks)').all().some(row => row.name === 'scan_report_json')) db.exec("alter table tasks add column scan_report_json text not null default '{}'");
    // A task interrupted by process death is recoverable, never auto-resumed.
    db.exec("update tasks set status='paused',message='应用退出后已暂停，可继续' where status in ('running','queued'); update task_items set status='pending' where status='running'; update source_photos set status='pending' where status='processing';");
    db.exec('commit');
  } catch (error) { db.exec('rollback'); throw error; }
}

export function effectivePhoto(item, row) {
  const manual = JSON.parse(row.manual_edits || '{}');
  return { ...item, sideCaption: manual.sideCaption ?? item.sideCaption, capturedDate: manual.capturedDate ?? item.capturedDate, location: manual.location ?? item.location, manualEdits: manual, wallpaperExcluded: Boolean(row.wallpaper_excluded), thumbnailUrl: `/api/thumbnails/${row.source_id || row.id}?v=${row.file_mtime || row.file_hash || 0}` };
}

export function buildFilters(query, sources = false) {
  const predicates = [];
  const params = [];
  const add = (sql, value) => { predicates.push(sql); params.push(value); };
  if (query.collection === 'curated') predicates.push('c.photo_id is not null');
  else if (query.collection === 'representative' || (!sources && query.collection !== 'all')) predicates.push('p.is_representative=1');
  if (sources && query.status && query.status !== 'all') add('s.status = ?', query.status);
  if (query.wallpaperEligible === '1' || query.wallpaperEligible === true) predicates.push("coalesce(p.wallpaper_excluded,0)=0 and p.wallpaper_url is not null and p.wallpaper_url!=''");
  if (query.groupId) add('p.similar_group_id=?',query.groupId);
  const date = "coalesce(json_extract(p.manual_edits,'$.capturedDate'),s.captured_date)";
  const place = "coalesce(json_extract(p.manual_edits,'$.location'),s.location,'')";
  if (query.month && query.month !== 'all') add(`cast(substr(${date},6,2) as integer)=?`, Number(query.month));
  if (query.day && query.day !== 'all') add(`cast(substr(${date},9,2) as integer)=?`, Number(query.day));
  if (query.dateFrom) add(`${date}>=?`, query.dateFrom);
  if (query.dateTo) add(`${date}<=?`, query.dateTo);
  if (query.location) add(`${place} like ? escape '\\'`, '%' + String(query.location).replace(/[\\%_]/g, '\\$&') + '%');
  if (query.minScore !== undefined && query.minScore !== '') add('p.memory_score>=?', Number(query.minScore));
  if (query.maxScore !== undefined && query.maxScore !== '') add('p.memory_score<=?', Number(query.maxScore));
  return { where: predicates.length ? 'where ' + predicates.join(' and ') : '', params };
}

export function queryPage(db, query, sources, mapRow) {
  const page = Math.max(1, Math.floor(Number(query.page) || 1));
  const pageSize = Math.min(120, Math.max(1, Math.floor(Number(query.pageSize) || 60)));
  const { where, params } = buildFilters(query, sources);
  const from = sources ? 'from source_photos s left join processed_photos p on p.source_id=s.id' : 'from processed_photos p join source_photos s on s.id=p.source_id';
  const join = `${from} left join curated_photos c on c.photo_id=p.id`;
  const total = Number(db.prepare(`select count(*) as n ${join} ${where}`).get(...params).n);
  const sort = query.sort === 'capture' ? "coalesce(json_extract(p.manual_edits,'$.capturedDate'),s.captured_date) desc,s.captured_at desc,s.id" : query.sort === 'newest' ? 'p.processed_at desc,s.id' : sources ? 's.last_seen_at desc,s.id' : 'p.memory_score desc,p.id';
  const columns = sources ? 's.*,p.id as processed_id,p.source_id,p.processed_at,p.memory_score,p.caption,p.side_caption,p.similar_group_id,p.is_representative,p.manual_edits,p.wallpaper_excluded,c.photo_id as curated_photo_id' : 'p.*,s.source_path,s.file_name,s.file_hash,s.file_mtime,s.perceptual_hash,s.captured_at,s.captured_date,s.location,s.width,s.height,s.orientation,c.photo_id as curated_photo_id';
  const rows = db.prepare(`select ${columns} ${join} ${where} order by ${sort} limit ? offset ?`).all(...params, pageSize, (page-1)*pageSize);
  return { items: rows.map(mapRow), total, page, pageSize };
}

export function selectSourceIds(db, selection, sources = true) {
  const { where, params } = buildFilters(selection.filters || {}, sources);
  const join = sources ? 'from source_photos s left join processed_photos p on p.source_id=s.id' : 'from processed_photos p join source_photos s on s.id=p.source_id';
  return db.prepare(`select s.id ${join} left join curated_photos c on c.photo_id=p.id ${where} order by s.id`).all(...params).map(row => row.id);
}
