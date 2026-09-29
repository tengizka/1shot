/* Moscow time is explicit; the browser/Windows local timezone is irrelevant. */
function nextClubArrival(hour,minute,now=Date.now()){
 const day=new Date(now+3*3600000);
 let at=Date.UTC(day.getUTCFullYear(),day.getUTCMonth(),day.getUTCDate(),hour,minute)-3*3600000;
 if(at<=now)at+=86400000;
 return new Date(at).toISOString();
}
function clubDateInput(iso){return new Date(Date.parse(iso)+3*3600000).toISOString().slice(0,16)}
function clubArrivalLabel(iso,now=Date.now()){
 const d=new Date(Date.parse(iso)+3*3600000),today=new Date(now+3*3600000).toISOString().slice(0,10),tomorrow=new Date(now+3*3600000+86400000).toISOString().slice(0,10),day=d.toISOString().slice(0,10);
 return (day===today?'Сегодня':day===tomorrow?'Завтра':day.split('-').reverse().join('.'))+', '+d.toISOString().slice(11,16)+' МСК';
}
