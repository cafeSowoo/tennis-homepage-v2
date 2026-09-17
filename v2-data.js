/* V2 domain adapter: no legacy-table writes and no public snapshot fallback. */
(function(root) {
  'use strict';
  const parts = value => Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(new Date(value)).filter(x => x.type !== 'literal').map(x => [x.type,x.value]));
  function schedule(row, responses) {
    const a=parts(row.starts_at), b=parts(row.ends_at);
    const own=responses.filter(r=>r.schedule_id===row.id);
    const clock = p => `${Number(p.hour)<12?'오전':'오후'} ${Number(p.hour)%12||12}:${p.minute}`;
    return {
      id:row.id, date:`${a.year}-${a.month}-${a.day}`, time:`${clock(a)} ~ ${a.day !== b.day && b.hour === '00' && b.minute === '00' ? '24:00' : clock(b)}`,
      day:new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',weekday:'short'}).format(new Date(row.starts_at)),
      title:row.status === 'cancelled' ? '[취소] ' + row.title : row.title, courtId:row.court_id, courtUnitId:row.court_unit_id, hostId:row.host_member_id,
      creatorMemberId:row.creator_member_id, creatorName:row.creator_name_snapshot,
      place:row.court_name_snapshot, unitLabel:row.court_unit_label_snapshot,
      capacity:row.capacity, closed:row.registration_closed, regular:row.regular,
      status:row.status, startsAt:row.starts_at, endsAt:row.ends_at, version:row.version,
      updatedAt:row.updated_at, createdAt:row.created_at, source:'v2',
      legacyScheduleId:row.legacy_schedule_id, importedAt:row.create_payload?.imported_at,
      originalCreator:row.create_payload?.v1_snapshot?.kakao_creator_name || '',
      importedResponseIds:own.filter(r=>r.response_source==='v1').map(r=>r.member_id),
      attendeeIds:own.filter(r=>r.state==='attending').map(r=>r.member_id),
      absenteeIds:own.filter(r=>r.state==='declined').map(r=>r.member_id)
    };
  }
  function input(row) {
    return {
      title:row.title, starts_at:row.startsAt, ends_at:row.endsAt,
      court_id:row.courtId, court_unit_id:row.courtUnitId||null,
      capacity:row.capacity??16, host:Boolean(row.hostId),
      registration_closed:Boolean(row.closed), regular:Boolean(row.regular)
    };
  }
  async function rows(client, table, order='id') {
    const all=[];
    for(let offset=0;;offset+=500) {
      let query=client.from(table).select('*').order(order);
      if(table==='v2_schedule_rsvps') query=query.order('member_id');
      const {data,error}=await query.range(offset,offset+499);
      if(error) throw error;
      all.push(...data);
      if(data.length<500) return all;
    }
  }
  async function rpc(client,name,args) {
    const {data,error}=await client.rpc(name,args);
    if(error) {
      const messages={
        '42501':'권한이 없거나 마감·취소·시작된 일정입니다. 로그인 및 승인 상태를 확인해 주세요.',
        '40001':'다른 변경이 먼저 저장됐습니다. 새로고침 후 다시 수정해 주세요.',
        '22023':'입력값 또는 참석 정원을 확인해 주세요.',
        '23505':'이미 사용된 요청입니다. 새로고침 후 확인해 주세요.',
        'P0002':'일정을 찾을 수 없습니다. 새로고침해 주세요.'
      };
      throw new Error(messages[error.code] || error.message || '저장하지 못했습니다. 다시 시도해 주세요.');
    }
    return data;
  }
  const api={schedule,input,rows,rpc};
  if(typeof module==='object' && module.exports) module.exports=api;
  else root.TennisV2=api;
})(typeof window==='object'?window:globalThis);
