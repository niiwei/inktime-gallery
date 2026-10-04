export function selectWallpaperRow(db, config) {
  const recent = db.prepare('select photo_id from wallpaper_history order by set_at desc limit 7').all().map(row => row.photo_id);
  const curated = config.wallpaperCollection === 'curated' ? 'join curated_photos c on c.photo_id=p.id' : '';
  const representative = config.wallpaperCollection === 'representative' ? 'and p.is_representative=1' : '';
  const hasExcluded = db.prepare('pragma table_info(processed_photos)').all().some(row => row.name === 'wallpaper_excluded');
  const excluded = hasExcluded ? 'and coalesce(p.wallpaper_excluded,0)=0' : '';
  const base = `select p.id,p.wallpaper_url,s.file_name from processed_photos p join source_photos s on s.id=p.source_id ${curated} where p.wallpaper_url is not null and p.wallpaper_url!='' ${representative} ${excluded}`;
  for (let count = recent.length; count >= 0; count--) {
    const avoid = recent.slice(0,count);
    const row = db.prepare(base+(count ? ` and p.id not in (${avoid.map(()=>'?').join(',')})` : '')+' order by random() limit 1').get(...avoid);
    if (row) return row;
  }
  return null;
}

export function latestScheduledBoundary(interval, date = new Date()) {
  if (!Number.isInteger(interval) || interval <= 0) return null;
  const boundary = new Date(date); boundary.setMinutes(0,0,0);
  while (boundary.getHours()%interval !== 0) boundary.setHours(boundary.getHours()-1);
  return boundary;
}
