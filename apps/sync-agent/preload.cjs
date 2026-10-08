const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('agent',{
  command:(action,input)=>ipcRenderer.invoke('command',action,input),
  onState:listener=>{const handler=(_event,state)=>listener(state);ipcRenderer.on('state',handler);return()=>ipcRenderer.removeListener('state',handler);},
});
