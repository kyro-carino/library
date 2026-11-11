// UI smoke test (jsdom, mocked API). Run from the project root: npm i --no-save jsdom && node tests/stage7_ui_smoke.js
const {JSDOM,VirtualConsole}=require('jsdom');const fs=require('fs');
const html=fs.readFileSync('index.html','utf8').replace('<script src="js/vendor/gsap.min.js"></script>','').replace('<script src="script.js"></script>','');
const errors=[];const vc=new VirtualConsole();vc.on('jsdomError',e=>errors.push('jsdomError '+e.message));vc.on('error',e=>errors.push('console.error '+e));
const dom=new JSDOM(html,{runScripts:'outside-only',pretendToBeVisual:true,url:'http://localhost/library/',virtualConsole:vc});
const w=dom.window;let pass=0,fail=0;const ck=(n,c,x='')=>{c?pass++:(fail++,console.log('FAIL',n,x));};
w.matchMedia=w.matchMedia||(q=>({matches:false,addEventListener(){},addListener(){}}));
w.HTMLElement.prototype.scrollIntoView=function(){};w.scrollTo=()=>{};
const books=[{id:'B1',title:'Safe" data-pwn="1',author:'A',category:'Science',isbn:'9780743273565',year:2000,location:'A-1',status:'Borrowed',borrowedBy:'U1',issueDate:'2026-10-01',dueDate:'2026-10-08',description:null,format:null,cover:null,borrowCount:2},{id:'B2',title:'Free',author:'B',category:'History',isbn:'',year:null,location:'',status:'Available',borrowedBy:null,borrowCount:0}];
const users=[{id:'U1',lastName:'<b>Evil</b>',firstName:'"><svg onload=1>',middleInitial:'',name:'<b>Evil</b>, "><svg onload=1>',program:'BSIT',yearLevel:1,contact:'a@b.co',status:'Active',borrowedBookIds:['B1']}];
const settings={finePerDay:10,loanDays:7,maxBooksPerUser:5,maxRenewals:2,gracePeriodDays:1,overdueFinesEnabled:true,dateFormat:'short',timeFormat:'12h',pageSize:25,confirmDeletes:true,landingPage:'dashboard',density:'comfortable',libraryName:'L',libraryEmail:'',libraryPhone:'',libraryAddress:''};
const report={activity:[...Array(7)].map((_,i)=>({date:'2026-10-0'+(i+1),label:'D'+i,issued:i%2,returned:0})),overdue:[],dueToday:[],collection:{},totals:{estimatedOverdueFines:0,finesAssessed:0,finesUnpaid:0},recent:[],recentTotal:0,recentPage:1,recentPageSize:10,recentSort:'newest',asOf:'2026-10-04'};
w.fetch=async(url,o={})=>{const u=String(url);(w.__calls=w.__calls||[]).push(u);let b={};
 let mm=/(books|users)\.php\?id=([^&]+)/.exec(u);
 if(mm){const id=decodeURIComponent(mm[2]);const rec=(mm[1]==='books'?books:users).find(x=>x.id===id);
   return rec?{ok:true,status:200,json:async()=>({[mm[1]==='books'?'book':'user']:rec})}:{ok:false,status:404,json:async()=>({error:'not found'})};}
 if(u.includes('auth.php'))b={authenticated:true};else if(u.includes('books.php'))b={books,total:2};else if(u.includes('users.php'))b={users,total:1};
 else if(u.includes('settings.php'))b={settings};else if(u.includes('account.php'))b={account:{displayName:'Lib Admin',username:'admin',email:'a@b.co',role:'admin',status:'Active'}};
 else if(u.includes('notifs.php'))b={prefs:{due:true,overdue:true,newUser:false,returns:true,system:true},items:[]};else if(u.includes('reports.php'))b=report;
 return {ok:true,status:200,json:async()=>b};};
w.SVGElement.prototype.getTotalLength=function(){return 100};
w.eval(fs.readFileSync('js/vendor/gsap.min.js','utf8'));
w.eval(fs.readFileSync('script.js','utf8'));
(async()=>{
 w.dispatchEvent(new w.Event('load'));
 await new Promise(r=>setTimeout(r,3500));
 const d=w.document;const $=s=>d.querySelector(s);
 ck('skip link target exists',!!$('#main-content')&&$('.skip-link').getAttribute('href')==='#main-content');
 ck('single visible <main>',d.querySelectorAll('main').length===1);
 d.querySelectorAll('section.view').forEach(v=>ck('one h1 in '+v.id,v.querySelectorAll('h1').length===1,v.querySelectorAll('h1').length));
 // navigate every view
 for(const v of ['books','users','issue','return','reports','settings','dashboard']){
   const b=$(`[data-view="${v}"]`);b.click();await new Promise(r=>setTimeout(r,900));
   ck('view '+v+' active',$('#view-'+v).classList.contains('active'));
   const h=$('#view-'+v+' h1');ck('focus on h1 '+v,d.activeElement===h,d.activeElement&&d.activeElement.tagName);
 }
 ck('return uses issue desk layout',!!$('#return-pane-loan')&&!!$('#return-pane-details')&&!!$('#return-bar')&&!!$('#return-confirm-btn'));
 ck('return wizard rail removed',!$('#return-rail')&&!$('#return-stage-1'));
 w.eval('goToView("reports",{force:true,report:"borrowing"})');await new Promise(r=>setTimeout(r,900));
 ck('borrowing sort dropdown',!!$('#borrowing-sort')&&$('#borrowing-sort').options.length===7);
 ck('borrowing pager 10 per page',$('#overdue-foot')&&$('#overdue-foot').textContent.includes('10 per page'));
 ck('borrowing prev disabled on first/empty',$('#borrowing-prev')&&$('#borrowing-prev').disabled);
 // XSS: user edit modal + issue list
 w.eval('openUserModal("U1")');await new Promise(r=>setTimeout(r,700));
 ck('borrowed field: quote cannot break out of value attribute',!$('#f-borrowed').hasAttribute('data-pwn')&&$('#f-borrowed').value.startsWith('Safe"'),$('#f-borrowed').outerHTML);
 ck('no injected nodes in user modal',!$('#modal-root img')&&!$('#modal-root svg[onload]'));
 w.eval('closeModal()');await new Promise(r=>setTimeout(r,700));
 w.eval('goToView("issue",{force:true})');await new Promise(r=>setTimeout(r,900));
 ck('issue list: no injected b/svg',!$('#issue-student-list b')&&!$('#issue-student-list svg[onload]'));
 // confirm body escaped
 w.eval('confirmDeleteBook("B2")');await new Promise(r=>setTimeout(r,600));
 w.eval('closeModal()');
 w.eval('renderConfirm({title:"t",body:"<img src=x onerror=1>",confirmLabel:"ok",onConfirm(){}})');await new Promise(r=>setTimeout(r,600));
 ck('confirm body is text',!$('#confirm-root img')&&$('#confirm-root p').textContent.includes('<img'));

 // modal focus now follows the animation callback (no fixed delay)
 w.eval('openUserModal(null)');await new Promise(r=>setTimeout(r,900));
 ck('modal moves focus to its first field',d.activeElement&&d.activeElement.id==='f-lastname',d.activeElement&&d.activeElement.id);
 w.eval('closeModal()');await new Promise(r=>setTimeout(r,700));
 w.eval('renderConfirm({title:"t",body:"b",confirmLabel:"ok",onConfirm(){}})');await new Promise(r=>setTimeout(r,900));
 ck('confirm dialog focuses its confirm button',d.activeElement&&d.activeElement.id==='confirm-btn',d.activeElement&&d.activeElement.id);
 w.document.querySelector('#confirm-root [data-close]').click();await new Promise(r=>setTimeout(r,700));
 
 // session expiry while a dialog is open must not leave the UI inert or swallow Tab
 w.eval('openUserModal(null)');await new Promise(r=>setTimeout(r,900));
 ck('app is inert while modal open',$('#app').hasAttribute('inert'));
 w.eval('handleSessionExpired()');await new Promise(r=>setTimeout(r,100));
 ck('session expiry clears inert on #app',!$('#app').hasAttribute('inert'));
 ck('session expiry releases body scroll lock',d.body.style.overflow==='');
 const tabEv=new w.KeyboardEvent('keydown',{key:'Tab',bubbles:true,cancelable:true});d.dispatchEvent(tabEv);
 ck('stale dialog key handler no longer blocks Tab',!tabEv.defaultPrevented);
 ck('login screen shown after expiry',!$('#login-screen').hidden);
 // targeted refresh: only the touched record is re-read; the full lists are not reloaded
 w.__calls=[];books[0].status='Available';books[0].borrowedBy=null;
 await w.eval('refreshBook("B1")');
 ck('refreshBook updates that one record in place',w.eval('findBook("B1").status')==='Available');
 ck('refreshBook does not reload the whole catalog',!w.__calls.some(c=>/books\.php\?limit=/.test(c))&&w.__calls.length===1,w.__calls);
 const gone=books.splice(1,1)[0];await w.eval('refreshBook("B2")');
 ck('a 404 on refreshBook removes the record',w.eval('findBook("B2")')===undefined);books.splice(1,0,gone);
 w.__calls=[];await w.eval('refreshAffected("B1","U1")');
 ck('refreshAffected reads exactly one book and one patron',w.__calls.length===2&&w.__calls.every(c=>/\?id=/.test(c)),w.__calls);
 ck('unpaid-fine/overdue fields survive mapping',w.eval('typeof findUser("U1").unpaidFines')==='number');
 books[0].status='Available';books[0].borrowedBy=null;
 w.eval('renderReturnLoanList()');
 ck('return list explains when there are no active loans',$('#return-loan-list').textContent.includes('No books are currently borrowed.'));
 // ---- Renew on the Return page
 const origFetch=w.fetch;w.__tx=[];
 w.fetch=async(url,o={})=>{if(String(url).includes('transactions.php')&&o.method==='POST'){w.__tx.push(JSON.parse(o.body));await new Promise(r=>setTimeout(r,50));return {ok:true,status:200,json:async()=>({transaction:{dueDate:'2099-02-01',renewalCount:1}})};}return origFetch(url,o);};
 Object.assign(books[0],{status:'Borrowed',borrowedBy:'U1',dueDate:'2099-01-01',renewalCount:0});
 await w.eval('refreshBook("B1")');w.eval('goToView("return",{force:true})');await new Promise(r=>setTimeout(r,1500));
 $('#return-loan-list .issue-row').click();
 const rb=$('#return-renew-btn');
 ck('renew button exists and is enabled for a renewable loan',!!rb&&!rb.disabled,rb&&rb.disabled);
 ck('renew info shows the next renewal',$('#return-renew-info').textContent.includes('Renewal 1 of 2'),$('#return-renew-info').textContent);
 rb.click();rb.click();await new Promise(r=>setTimeout(r,300));
 ck('double click sends exactly one renew request',w.__tx.length===1,w.__tx.length);
 ck('renew sends only type, bookId, userId',JSON.stringify(w.__tx[0])==='{"type":"renew","bookId":"B1","userId":"U1"}',JSON.stringify(w.__tx[0]));
 ck('busy flag released after renew',!$('#return-renew-btn').disabled&&$('#return-renew-btn').textContent==='Renew loan');
 w.eval('findBook("B1").renewalCount=2;renderReturn()');
 ck('button disabled at the renewal limit',$('#return-renew-btn').disabled&&$('#return-renew-info').textContent.includes('limit'));
 w.eval('Object.assign(findBook("B1"),{renewalCount:0,dueDate:"2020-01-01"});renderReturn()');
 ck('button disabled for an overdue loan',$('#return-renew-btn').disabled&&$('#return-renew-info').textContent.includes('Overdue'));
 w.fetch=origFetch;Object.assign(books[0],{status:'Available',borrowedBy:null,dueDate:null});await w.eval('refreshBook("B1")');w.eval('resetReturnWizard()');
 console.log(`${pass} passed, ${fail} failed`);console.log('errors:',errors.length?errors.slice(0,5):'none');process.exit(fail||errors.length?1:0);
})();