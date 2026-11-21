'use strict';
// The update feed and installer are the upstream Windows channel (signed .exe). The Linux
// port is built from feat/linux-support, so on Linux nothing may check, announce or install it.
const LINUX_UPDATE_MESSAGE='This Linux build updates from its own repository (feat/linux-support). The Windows update channel is turned off.';
function updatesSupported(platform=process.platform){return platform==='win32';}
function publicUpdateState(state,platform=process.platform){
  if(updatesSupported(platform))return {...state};
  return {status:'unsupported',supported:false,busy:false,canInstall:false,availableVersion:null,availableBuild:null,version:null,message:LINUX_UPDATE_MESSAGE,checkedAt:null,error:null};
}
module.exports={updatesSupported,publicUpdateState,LINUX_UPDATE_MESSAGE};
