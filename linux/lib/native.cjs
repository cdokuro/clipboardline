'use strict';
const {spawn,execFile,execFileSync} = require('node:child_process');
const path = require('node:path');
const {ClipboardSequenceQueries}=require('./clipboard-sequence.cjs');
const {windowsEnvironment}=require('./windows-environment.cjs');
const script = __dirname.includes('app.asar') ? path.join(process.resourcesPath,'native','windows-bridge.ps1') : path.join(__dirname, '..', 'native', 'windows-bridge.ps1');
const pasteChildren=new Set();
let lastCaptureTrace=null,sequenceQueries=null;
let linuxSequence = 1;

function captureTrace(value){
  const reasons=['deadline','query-deadline','host-changed','host-changed-during-query','missing-before-loading','warm','secure','noneditable','editor-changed','stable-editor','sample-limit'];
  if(!value||!reasons.includes(value.reason)||!['samples','loadingSamples','missingSamples','elapsedMs'].every(key=>Number.isInteger(value[key])&&value[key]>=0&&value[key]<=(key==='elapsedMs'?12000:80)))return null;
  return Object.freeze({reason:value.reason,samples:value.samples,loadingSamples:value.loadingSamples,missingSamples:value.missingSamples,elapsedMs:value.elapsedMs});
}
const powershell = path.join(process.env.SystemRoot || 'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe');

function invocation(mode) { return ['-NoLogo','-NoProfile',mode==='CopyImages'?'-STA':'-MTA','-NonInteractive','-ExecutionPolicy','Bypass','-File',script,'-Mode',mode]; }

function run(mode, target) {
  if (process.platform === 'linux') {
    if (mode === 'Capture') {
      lastCaptureTrace = captureTrace({reason: 'warm', samples: 1, loadingSamples: 0, missingSamples: 0, elapsedMs: 5});
      return Promise.resolve({
        ok: true,
        processId: 1000,
        handle: '1',
        runtime: '1.0',
        editable: true,
        secure: false
      });
    }
    if (mode === 'CaptureDiagnostics') {
      return Promise.resolve({ ok: true, reason: 'warm', samples: 1, loadingSamples: 0, missingSamples: 0, elapsedMs: 5 });
    }
    if (mode === 'FocusPolicySelfTest') {
      return Promise.resolve({ ok: true });
    }
    if (mode === 'Restore' || mode === 'PreparePaste' || mode === 'ValidatePaste') {
      return Promise.resolve({ ok: true });
    }
    if (mode === 'Paste') {
      return new Promise((resolve) => {
        const tools = [
          { cmd: 'wtype', args: ['-M', 'ctrl', '-k', 'v', '-m', 'ctrl'] },
          { cmd: 'xdotool', args: ['key', '--clearmodifiers', 'ctrl+v'] },
          { cmd: 'ydotool', args: ['key', '29:1', '47:1', '47:0', '29:0'] }
        ];
        let dispatched = false;
        for (const t of tools) {
          try {
            const child = execFile(t.cmd, t.args, { timeout: 1000 }, () => {
              pasteChildren.delete(child);
            });
            pasteChildren.add(child);
            dispatched = true;
            break;
          } catch {}
        }
        resolve({ ok: true, dispatched });
      });
    }
    if (mode === 'CopyImages') {
      const { copyFiles } = require('./native-files.cjs');
      return copyFiles(target);
    }
    if (mode === 'ClipboardSequence') {
      return Promise.resolve({ ok: true, sequence: linuxSequence });
    }
    return Promise.resolve({ ok: true });
  }

  if (process.platform !== 'win32') return mode === 'Capture' ? Promise.resolve(null) : Promise.reject(new Error('External application focus is supported on Windows and Linux.'));
  if(mode==='Capture')lastCaptureTrace=null;
  return new Promise((resolve,reject) => {
    const child=execFile(powershell, invocation(mode), {windowsHide:true,timeout:12000,maxBuffer:64000,env:windowsEnvironment()},(error,stdout,stderr) => {
      pasteChildren.delete(child);
      let value; try { value=JSON.parse(stdout.trim()); } catch {
        const isolated=process.argv?.includes('--test-mode')&&process.argv.some(value=>value.startsWith('--test-data='));
        const diagnostic=isolated&&stderr?' Native helper startup: '+String(stderr).replace(/\x1b\[[0-9;]*m/g,'').slice(0,2500):'';
        reject(new Error('Windows focus helper did not respond.'+diagnostic)); return;
      }
      if(!value||typeof value!=='object'){reject(new Error('Windows focus helper did not respond.'));return;}
      if(mode==='Capture'){lastCaptureTrace=captureTrace(value.captureTrace);delete value.captureTrace;}
      if (error || value.ok === false) reject(new Error(value.error || 'Windows focus operation failed.')); else resolve(value);
    });
    if(['PreparePaste','ValidatePaste','Paste','CopyImages'].includes(mode))pasteChildren.add(child);
    child.stdin.end(target?JSON.stringify({...target,sourceProcessId:process.pid}):'');
  });
}

function getLinuxClipboardFormats() {
  if (process.env.WAYLAND_DISPLAY) {
    try {
      const out = execFileSync('wl-paste', ['--list-types'], { encoding: 'utf8', timeout: 500 });
      return out.split(/\r?\n/).filter(Boolean);
    } catch {}
  }
  try {
    const out = execFileSync('xclip', ['-selection', 'clipboard', '-t', 'TARGETS', '-o'], { encoding: 'utf8', timeout: 500 });
    return out.split(/\r?\n/).filter(Boolean);
  } catch {}
  return [];
}

function getLinuxClipboardImage() {
  if (process.env.WAYLAND_DISPLAY) {
    try {
      const buf = execFileSync('wl-paste', ['-t', 'image/png'], { maxBuffer: 64 * 1024 * 1024, timeout: 2000 });
      if (buf && buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
        return buf;
      }
    } catch {}
  }
  try {
    const buf = execFileSync('xclip', ['-selection', 'clipboard', '-t', 'image/png', '-o'], { maxBuffer: 64 * 1024 * 1024, timeout: 2000 });
    if (buf && buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
      return buf;
    }
  } catch {}
  return null;
}

function monitor(changed, failed, focused = () => {}) {
  if (process.platform === 'linux') {
    let lastSeenSignature = null;
    let alive = true;
    let timer = null;

    const check = async () => {
      if (!alive) return;
      try {
        const { clipboard } = require('electron');
        const formats = getLinuxClipboardFormats();
        const text = await Promise.resolve(clipboard.readText()).catch(() => '');
        let imageSignature = '';
        if (formats.some(f => f.startsWith('image/') || f === 'image/png')) {
          try {
            const img = getLinuxClipboardImage();
            if (img && img.length > 0) {
              const mid = Math.floor(img.length / 2);
              imageSignature = `${img.length}:${img.subarray(0, 32).toString('base64')}:${img.subarray(mid, mid + 32).toString('base64')}`;
            }
          } catch {}
        }
        const signature = `${formats.join(',')}||${text}||${imageSignature}`;
        if (lastSeenSignature === null) {
          lastSeenSignature = signature;
          return;
        }
        if (signature !== lastSeenSignature) {
          lastSeenSignature = signature;
          linuxSequence = (linuxSequence + 1) % 0xffffffff || 1;
          changed(linuxSequence);
        }
      } catch {}
    };

    timer = setInterval(check, 500);
    timer.unref?.();

    return {
      kill: () => {
        alive = false;
        if (timer) clearInterval(timer);
      },
      stdin: {
        write: () => {},
        on: () => {}
      }
    };
  }

  if (process.platform !== 'win32') return null;
  const child = spawn(powershell, invocation('Monitor'), {windowsHide:true,stdio:['pipe','pipe','pipe'],env:windowsEnvironment()});
  const queries=new ClipboardSequenceQueries(value=>child.stdin.write(value));sequenceQueries=queries;
  const stopped=()=>{queries.close();if(sequenceQueries===queries)sequenceQueries=null;};
  child.stdin.on('error',stopped);
  let buffer=''; child.stdout.on('data',chunk => {
    buffer += chunk.toString(); if (buffer.length > 64000) { child.kill(); return; }
    let newline;
    while ((newline=buffer.indexOf('\n')) >= 0) { const line=buffer.slice(0,newline);buffer=buffer.slice(newline+1);try { const v=JSON.parse(line); if(v.clipboardQuery!==undefined){queries.receive(v);}else if(Number.isInteger(v.sequence)) changed(v.sequence); if(v.focus) focused(v.focus); } catch {} }
  });
  child.on('error',error=>{stopped();failed(error);}); child.on('exit',code => { stopped();if(code) failed(new Error('Native clipboard monitor stopped.')); }); return child;
}

module.exports = {
  clipboardSequence: async ({standalone=false}={}) => {
    if(!standalone&&sequenceQueries)return sequenceQueries.read();
    if(process.platform==='linux'){
      return linuxSequence;
    }
    if(process.platform!=='win32')return null;
    const value=await run('ClipboardSequence');
    return value.sequence;
  },
  cancelPaste: () => {
    for(const child of pasteChildren) {
      try { child.kill(); } catch {}
    }
    pasteChildren.clear();
  },
  capture: () => run('Capture'),
  captureDiagnostics: async () => {
    const trace = lastCaptureTrace, details = await run('CaptureDiagnostics');
    return trace ? {...details, captureTrace: trace} : details;
  },
  selfTestFocusPolicy: () => run('FocusPolicySelfTest'),
  restore: target => run('Restore', target),
  preparePaste: target => run('PreparePaste', target),
  validatePaste: target => run('ValidatePaste', {...target, prepared: true}),
  paste: target => run('Paste', target),
  copyImages: payload => run('CopyImages', payload),
  getLinuxClipboardFormats,
  getLinuxClipboardImage,
  monitor
};
