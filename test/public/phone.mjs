// Fresh public-server journey. Only Drive, Telegram and model HTTP answers are pretend.
import fs from "node:fs";
import path from "node:path";
import https from "node:https";
import crypto from "node:crypto";
import {spawn} from "node:child_process";
import {pathToFileURL,fileURLToPath} from "node:url";
const repo=process.env.CLERK_REPO||path.resolve(path.dirname(fileURLToPath(import.meta.url)),"../..");
const {totp}=await import(pathToFileURL(path.join(repo,"lib/install/totp.mjs")));
const {TEST_CLIENT}=await import(pathToFileURL(path.join(repo,"test/fakes/drive.mjs")));
const [machine,kind,ip,caFile,evidenceFile]=process.argv.slice(2);
if(!/^clerk-b6-[a-z0-9-]+$/.test(machine)||!["docker","native"].includes(kind)||!ip||!caFile||!evidenceFile)throw Error("Use this run's disposable machine, kind, IP, CA and safe evidence path");
const optionalDrive=process.argv.includes("--optional-drive");
let lateDriveIdentity=null;
const expectedTitle="Electricity invoice September 2026";
const expectedDate="2026-10-12";
const ca=fs.readFileSync(caFile),name=`notebook-${kind}.localhost`;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const run=(exe,args,{input,timeout=15*60000}={})=>new Promise((resolve,reject)=>{const c=spawn(exe,args);let out="",err="";const t=setTimeout(()=>{c.kill("SIGKILL");reject(Error("Command timed out"));},timeout);c.stdout.setEncoding("utf8");c.stderr.setEncoding("utf8");c.stdout.on("data",x=>out+=x);c.stderr.on("data",x=>err+=x);c.on("error",reject);c.on("close",code=>{clearTimeout(t);resolve({code,out,err});});c.stdin.on("error",()=>{});c.stdin.end(input);});
const inMachine=async(args,opts)=>{const r=await run("docker",["exec","-i",machine,...args],opts);if(r.code)throw Error(`Test machine command failed: ${r.err.slice(-500)}`);return r.out;};
const readJSON=async f=>JSON.parse(await inMachine(["cat",f]));
const serviceText=await inMachine(["cat","/var/lib/godspeed/clerk/service.env"]);
if(/GODSPEED_(MODEL_COMMAND|CLERK_NOTEBOOK)=/.test(serviceText))throw Error("The real model/notebook route must not be replaced");
const envArgs=serviceText.split(/\r?\n/).filter(l=>/^[A-Z_]+=/.test(l)).flatMap(l=>["-e",l]);
const command=async(args)=>{const r=await run("docker",["exec",...envArgs,machine,"godspeed-clerk",...args]);if(r.code)throw Error(`Clerk ${args[0]} failed: ${(r.out+r.err).slice(-600)}`);return r.out;};
const rec=await readJSON("/var/lib/godspeed/clerk/installed.json");
const login=await readJSON("/var/lib/godspeed/clerk/login.json");
const checks=[];const check=(ok,what)=>{if(!ok)throw Error(what);checks.push(what);console.log("PASS "+what);};
const runtimeSource=kind==="docker"?JSON.parse(await inMachine(["docker","inspect","godspeed-mission-control-godspeed-1"]))[0].Config.Labels["org.opencontainers.image.revision"]:(await inMachine(["cat","/root/godspeed-v2/.godspeed/integrated-runtime/version"])).trim();
check(runtimeSource==="9390da492a0035a41b0eb02584234e269bca6dc8","the installed runtime is the actual released beta.6 source");
check(rec.stage==="done"&&rec.timezone==="Europe/Berlin","managed Paperless installed with the real notebook's timezone");
const request=(method,url,{body,headers={},port=rec.https_port}={})=>new Promise((resolve,reject)=>{const data=body===undefined?null:Buffer.isBuffer(body)?body:Buffer.from(JSON.stringify(body));const r=https.request({host:ip,servername:name,port,path:url,method,ca,headers:{Host:`${name}:${port}`,Accept:"application/json",...(data&&!Buffer.isBuffer(body)?{"Content-Type":"application/json"}:{}),...(data?{"Content-Length":data.length}:{}),...headers}},res=>{const cert=res.socket.getPeerCertificate();const chunks=[];res.on("data",c=>chunks.push(c));res.on("end",()=>{const text=Buffer.concat(chunks).toString();let payload;try{payload=JSON.parse(text);}catch{payload=text;}resolve({status:res.statusCode,body:payload,cert});});});r.on("error",reject);if(data)r.write(data);r.end();});
const unauth=await request("GET","/api/ui_settings/");check(unauth.status===401,"Paperless answers through trusted HTTPS");
const notebookHTTPS=await request("GET","/health",{port:443});check(notebookHTTPS.status===200&&notebookHTTPS.body.version==="2.0.0-beta.6","the same fresh public Godspeed notebook remains healthy over HTTPS");
check(unauth.cert.fingerprint256===notebookHTTPS.cert.fingerprint256,"Paperless and Godspeed present the same certificate");
const missing=await request("POST","/api/token/",{body:{username:login.user,password:login.password}});check(missing.status===400&&/MFA code is required/.test(JSON.stringify(missing.body)),"a password alone is refused");
const freshCode=async()=>{const left=30000-Date.now()%30000;if(left<3000)await sleep(left+250);return totp(login.secret);};
let signed=await request("POST","/api/token/",{body:{username:login.user,password:login.password,code:await freshCode()}});
if(signed.status===400){await sleep(30000-Date.now()%30000+250);signed=await request("POST","/api/token/",{body:{username:login.user,password:login.password,code:totp(login.secret)}});}
check(signed.status===200&&signed.body.token,"phone-style password and authenticator sign-in works");
const token=signed.body.token,headers={Authorization:`Token ${token}`};
async function connectDrive() {
await inMachine(["sh","-c","umask 077; cat > /root/clerk-test-google-app.json"],{input:JSON.stringify({installed:{client_id:TEST_CLIENT.id,client_secret:TEST_CLIENT.secret,redirect_uris:["http://127.0.0.1"]}})});
const linked=await command(["drive","connect","--client-file","/root/clerk-test-google-app.json"]);
const link=linked.match(/http\S+\/o\/oauth2\/v2\/auth\S+/)?.[0];if(!link)throw Error("The Clerk did not offer normal Drive consent");
const redirect=(await fetch(link,{redirect:"manual"})).headers.get("location");if(!redirect)throw Error("The pretend Drive did not give the normal callback");
await command(["drive","finish",redirect]);await command(["drive","folder","Paperwork"]);await command(["plan","propose"]);await command(["plan","confirm"]);await command(["resume"]);check(true,"normal Drive consent, documents folder, plan and resume complete");
}
if(!optionalDrive)await connectDrive();
else await command(["resume"]);
await command(["phone"]);
const boundary="----clerk"+crypto.randomBytes(6).toString("hex");
const part=(key,value,file)=>Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${key}"${file?`; filename="${file}"\r\nContent-Type: application/pdf`:""}\r\n\r\n`),Buffer.isBuffer(value)?value:Buffer.from(value),Buffer.from("\r\n")]);
const pdf=fs.readFileSync(path.join(repo,"test/kit/rendered/water-invoice.pdf"));
const uploadBody=Buffer.concat([part("document",pdf,"Scan 2026-10-24 16-17-01.pdf"),part("created","2026-10-24"),Buffer.from(`--${boundary}--\r\n`)]);
const uploaded=await request("POST","/api/documents/post_document/",{body:uploadBody,headers:{...headers,"Content-Type":`multipart/form-data; boundary=${boundary}`}});
const task=typeof uploaded.body==="string"?uploaded.body:uploaded.body?.task_id;check(uploaded.status===200&&task,"phone-style multipart letter upload accepted");
for(const until=Date.now()+10*60000;;){const r=await request("GET",`/api/tasks/?task_id=${encodeURIComponent(task)}`,{headers});const state=String((Array.isArray(r.body)?r.body:r.body.results||[])[0]?.status||"").toLowerCase();if(state==="success")break;if(state==="failure"||Date.now()>until)throw Error("The invented letter was not read: "+state);await sleep(2000);}
check(true,"real Paperless OCR finished");
let driveState,document;
for(const until=Date.now()+10*60000;;){await command(["run"]);driveState=await(await fetch("http://10.89.0.1:48905")).json();const r=await request("GET","/api/documents/?page_size=100",{headers});document=r.body.results?.find(d=>d.title===expectedTitle);const file=driveState.files.find(f=>f.marks?.clerkDoc&&f.name?.includes(expectedTitle));if((optionalDrive||file)&&document)break;if(Date.now()>until)throw Error("The letter was not named and filed");await sleep(10000);}
let filed=driveState.files.find(f=>f.marks?.clerkDoc&&f.name?.includes(expectedTitle));
check(document.created.startsWith(expectedDate),"the invented invoice is named and dated in Paperless");
if(!optionalDrive)check(filed.path.startsWith("Paperwork/Invoices/"),"the invented invoice is filed into the confirmed Drive folder");
else check(!filed&&!driveState.files.some(f=>f.marks?.clerkDoc),"no Drive copy or Google setup is needed before sorting and notes");
const workspace=kind==="docker"?"/opt/data/full-candidate/workspace":"/root/godspeed-v2";
const node=kind==="docker"?"node":"/root/godspeed-v2/.godspeed/integrated-runtime/runtime/node-v22.19.0-linux-x64/bin/node";
const privatePort=kind==="docker"?47832:47831;
const queryScript=`const b='http://127.0.0.1:${privatePort}'; const post=async(p,v)=>{const r=await fetch(b+p,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(v)});const j=await r.json();if(!r.ok||j.error)throw Error('Real notebook query failed');return j.data;}; const notes=await post('/api/query',{table:'notes',operation:'select',filters:[['eq','source_app','godspeed-clerk']]});const collections=await post('/api/query',{table:'collections',operation:'select',filters:[['eq','source_app','godspeed-clerk']]});const items=collections.length?await post('/api/query',{table:'collection_items',operation:'select',filters:[['eq','collection_id',collections[0].id]]}):[];const due=await post('/api/functions/addon-deadlines',{addon:'godspeed-clerk',action:'list'});console.log(JSON.stringify({notes:notes.map(n=>({id:n.id,doc:n.clerk_doc,skip_processing:n.skip_processing,has_paperless:String(n.content).includes("/documents/"),has_drive:String(n.content).includes("drive.google.com")})),items:items.length,item_ids:items.map(i=>i.id),item_drive:items.map(i=>!!i.data?.in_drive),deadlines:due.deadlines}));`;
const actual=kind==="docker"?["docker","exec","--user","hermes","godspeed-mission-control-godspeed-1",node,"--input-type=module","-e",queryScript]:[node,"--input-type=module","-e",queryScript];
const notebook=JSON.parse(await inMachine(actual));
check(notebook.notes.some(n=>n.skip_processing===true)&&notebook.items>=1,"the real installed notebook has the Clerk note and collection item without AI reprocessing");
check(notebook.deadlines?.some(d=>JSON.stringify(d).includes("2026-11-20")),"the real installed notebook has the letter's deadline");
check(driveState.model_requests>=2,"the released Godspeed model made real tools-free requests to the test-only HTTP provider");
check(driveState.sent.some(t=>/first scan|phone|connected/i.test(t)),"the actual assistant's discovered Telegram connection delivered the first-scan message to the pretend endpoint");
if(optionalDrive){
  check(notebook.notes.length===1&&notebook.notes[0].has_paperless&&!notebook.notes[0].has_drive&&notebook.item_drive.every(x=>!x),"without Drive the same Paperless letter has a sorted notebook record and Paperless links");
  const basicStatus=await command(["status"]);
  check(/Google Drive: optional, not connected/.test(basicStatus)&&/no off-server backup/.test(basicStatus),"basic status explains optional Drive and no off-server backup");
  await connectDrive();
  for(const until=Date.now()+10*60000;;){
    await command(["run"]);driveState=await(await fetch("http://10.89.0.1:48905")).json();
    filed=driveState.files.find(f=>f.marks?.clerkDoc&&f.name?.includes(expectedTitle));
    if(filed)break;if(Date.now()>until)throw Error("Connecting Drive did not file the existing paper");await sleep(3000);
  }
  check(filed.path.startsWith("Paperwork/Invoices/")&&driveState.files.filter(f=>f.marks?.clerkDoc===String(document.id)).length===1,"later Drive connection files the existing letter exactly once");
  const later=JSON.parse(await inMachine(actual));
  const identity=n=>({notes:n.notes.map(x=>x.id),items:n.item_ids,deadlines:n.deadlines.map(d=>({key:d.key,slug:d.slug}))});
  lateDriveIdentity={before:identity(notebook),after:identity(later)};
  check(JSON.stringify(later.notes.map(n=>n.id))===JSON.stringify(notebook.notes.map(n=>n.id))&&JSON.stringify(later.item_ids)===JSON.stringify(notebook.item_ids)&&JSON.stringify(later.deadlines.map(d=>[d.key,d.slug]))===JSON.stringify(notebook.deadlines.map(d=>[d.key,d.slug])),"later Drive keeps the same actual note, item and deadline identities");
  check(later.notes.every(n=>n.has_drive)&&later.item_drive.every(Boolean),"the same notebook records gain their Drive links");
}
const status=await command(["status"]);check(!/not approved|AI: not|could not|PAUSED/i.test(status),"Clerk status is active after the complete journey");
const evidence={machine,kind,optional_drive_first:optionalDrive,late_drive_identity:lateDriveIdentity,godspeed:"2.0.0-beta.6",runtime_source:runtimeSource,clerk:JSON.parse(await inMachine(["cat","/usr/local/lib/godspeed-clerk/package.json"])).version,workspace,https_host:name,https_port:rec.https_port,certificate_fingerprint256:unauth.cert.fingerprint256,time_zone:rec.timezone,document_id:document.id,filed_path:filed.path,notebook_note_count:notebook.notes.length,notebook_collection_items:notebook.items,notebook_deadline_count:notebook.deadlines.length,model_http_requests:driveState.model_requests,telegram_messages:driveState.sent.length,checks};
fs.writeFileSync(evidenceFile,JSON.stringify(evidence,null,2)+"\n");console.log("Safe evidence written: "+evidenceFile);
