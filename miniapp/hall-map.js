/* Physical layout transcribed from the club's floor-plan screenshot.
   Coordinates are in the 1015 × 754 reference image. Not live availability. */
const HALL_LAYOUT = [
  [402,72,54],[401,144,54],[304,72,126],[303,144,126],
  [302,72,270],[301,144,270],
  [11,577,54],[12,649,54],[13,721,54],[14,793,54],[15,865,54],
  [21,577,198],[22,649,198],[23,721,198],[24,793,198],[25,865,198],
  [1,505,414],
  [204,72,414],[205,72,486],[206,72,558],[207,72,630],[208,72,702],
  [201,361,558],[202,361,630],[203,361,702],
  [104,505,558],[105,505,630],[106,505,702],
  [101,649,558],[102,649,630],[103,649,702],
].map(([id,x,y]) => ({id:String(id),x:x/1015*100,y:y/754*100,
  zone: id === 1 ? 'ps5' : id < 30 ? String(Math.floor(id/10)*10) : String(Math.floor(id/100)*100),
  group:id >= 10 && id < 30 ? 'vip' : 'standard'}));
const HOST_LABELS = {connecting:'Подключение',free:'Свободен',busy:'Занят',reserved:'Бронь',broken:'Ремонт',unknown:'Нет связи'};
function liveHostStatus(host, now = Date.now()) {
  const updated = Date.parse(host?.updated_at);
  if (!host || !Number.isFinite(updated) || now-updated>30000 || updated>now+30000) return 'unknown';
  return ['free','busy','reserved','broken'].includes(host.status) ? host.status : 'unknown';
}

// The interface now uses fixed pages of large seats instead of physical coordinates.
function isPhoneOnlyHost(hostId, zone) {
  return String(hostId).trim() === '1' || String(hostId).toLowerCase() === 'ps5' || String(zone).toLowerCase() === 'ps5';
}
const HALL_ROWS=[['10','vip',[[11,12,13,14,15]]],['20','vip',[[21,22,23,24,25]]],['100','standard',[[104,101],[105,102],[106,103]]],['200','standard',[[204,201],[205,202],[206,203],[207,null],[208,null]]],['300','standard',[[304,303],[302,301]]],['400','standard',[[402,401]]]];
function getPhysicalZones(group){return HALL_ROWS.filter(z=>z[1]===group).map(([zone,group,rows])=>({zone,group,rows,columns:rows[0].length,seats:rows.flatMap((row,r)=>row.flatMap((id,c)=>id===null?[]:[{...HALL_LAYOUT.find(p=>p.id===String(id)),row:r+1,column:c+1}]))}))}
function getZoneSeats(group){return getPhysicalZones(group).flatMap(z=>z.seats)}

// Keep whole physical rows/zones together; never split zone 200 between pages.
function getZonePages(group) {
  const pages=[];let current=[];
  for(const zone of [...new Set(getZoneSeats(group).map(pc=>pc.zone))]){
    const seats=getZoneSeats(group).filter(pc=>pc.zone===zone);
    if(current.length&&current.length+seats.length>10){pages.push(current);current=[]}
    current.push(...seats);
  }
  if(current.length)pages.push(current);
  return pages;
}
